// backend/db/clienteLocal.js — un "Supabase de bolsillo" sobre PGlite, para pruebas y
// para el modo demo (`npm run demo`).
//
// POR QUE EXISTE: la app real habla con Supabase (Postgres en la nube). Para probar el
// esquema, la seguridad por filas y las funciones SQL sin depender de internet ni de
// Docker, aca se levanta PGlite (Postgres 18 compilado a WebAssembly, dentro de Node),
// se le instala EXACTAMENTE el mismo archivo supabase/migrations/*.sql y se expone la
// PARTE de la API de supabase-js que usa la app:
//
//   from(tabla).select/insert/update/upsert/delete + eq/neq/in/is/order/range/limit
//   + single/maybeSingle · rpc(funcion, args) · auth.signInWithPassword/signOut/
//   getSession/getUser/onAuthStateChange · channel(...).on('postgres_changes').subscribe
//
// Cada consulta corre en una transaccion con `SET LOCAL ROLE authenticated` (o anon) y
// el id del usuario en `request.jwt.claim.sub`, que es lo que lee auth.uid(): las
// politicas RLS se aplican igual que en Supabase. El "tiempo real" se simula con un
// trigger que hace NOTIFY en cada insert/update de `compras`.
//
// NO es un reemplazo de Supabase en produccion: no hay red, ni PostgREST, ni JWT.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR_MIGRACIONES = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const CANAL_NOTIFY = 'habbo_realtime_local';
const IDENT = /^[a-z_][a-z0-9_]*$/;

// Lo minimo de Supabase que el esquema da por hecho: esquema auth, auth.uid() y roles.
const SQL_BASE = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique not null,
    clave_hash text not null
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

// "Tiempo real" local: NOTIFY con la fila nueva, que el cliente reparte a los canales.
const SQL_TIEMPO_REAL = `
  create or replace function public._local_notificar() returns trigger
  language plpgsql security definer set search_path = '' as $$
  begin
    perform pg_notify('${CANAL_NOTIFY}', json_build_object(
      'table', tg_table_name, 'eventType', tg_op, 'new', row_to_json(new))::text);
    return new;
  end $$;
  drop trigger if exists compras_tiempo_real_local on public.compras;
  create trigger compras_tiempo_real_local after insert or update on public.compras
    for each row execute function public._local_notificar();
  do $$ begin
    if to_regclass('public.eventos_sniper') is not null then
      drop trigger if exists eventos_tiempo_real_local on public.eventos_sniper;
      create trigger eventos_tiempo_real_local after insert on public.eventos_sniper
        for each row execute function public._local_notificar();
    end if;
  end $$;
`;

function hashClave(clave, sal = crypto.randomBytes(16).toString('hex')) {
  return sal + ':' + crypto.scryptSync(String(clave), sal, 32).toString('hex');
}

function claveValida(clave, guardado) {
  const [sal, hash] = String(guardado).split(':');
  const calc = crypto.scryptSync(String(clave), sal, 32);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}

function ident(nombre) {
  if (!IDENT.test(nombre)) throw new Error(`Identificador no permitido: ${nombre}`);
  return nombre;
}

function aError(e) {
  return { code: e.code || 'LOCAL', message: e.message, details: e.detail || null, hint: e.hint || null };
}

// Valor de un argumento de rpc: objetos y listas de objetos van como jsonb; listas de
// numeros, como arreglo de Postgres ({1,2,3}).
function argumentoRpc(v) {
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number')) return { valor: `{${v.join(',')}}`, cast: '' };
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return { valor: JSON.stringify(v), cast: '::jsonb' };
  return { valor: v, cast: '' };
}

class Consulta {
  constructor(cliente, tabla) {
    this.cliente = cliente;
    this.tabla = ident(tabla);
    this.op = 'select';
    this.columnas = '*';
    this.devolver = false;
    this.filtros = [];
    this.ordenes = [];
    this.limite = null;
    this.desde = null;
    this.modo = null;
    this.valores = null;
    this.conflicto = null;
  }

  select(columnas = '*') {
    if (this.op === 'select') this.columnas = columnas;
    else this.devolver = true;
    return this;
  }
  insert(v) { this.op = 'insert'; this.valores = Array.isArray(v) ? v : [v]; return this; }
  upsert(v, { onConflict } = {}) { this.op = 'upsert'; this.valores = Array.isArray(v) ? v : [v]; this.conflicto = onConflict; return this; }
  update(v) { this.op = 'update'; this.valores = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filtros.push([ident(c), '=', v]); return this; }
  neq(c, v) { this.filtros.push([ident(c), '<>', v]); return this; }
  in(c, lista) { this.filtros.push([ident(c), 'in', lista]); return this; }
  is(c, v) { this.filtros.push([ident(c), 'is', v]); return this; }
  order(c, { ascending = true } = {}) { this.ordenes.push(`${ident(c)} ${ascending ? 'asc' : 'desc'}`); return this; }
  limit(n) { this.limite = Number(n); return this; }
  range(desde, hasta) { this.desde = Number(desde); this.limite = Number(hasta) - Number(desde) + 1; return this; }
  single() { this.modo = 'single'; return this; }
  maybeSingle() { this.modo = 'maybe'; return this; }

  _sql() {
    const params = [];
    const p = (v) => { params.push(v); return '$' + params.length; };
    const where = () => {
      if (!this.filtros.length) return '';
      return ' where ' + this.filtros.map(([c, op, v]) => {
        if (op === 'in') return v.length ? `${c} in (${v.map(p).join(', ')})` : 'false';
        if (op === 'is') return v === null ? `${c} is null` : `${c} is ${v ? 'true' : 'false'}`;
        return `${c} ${op} ${p(v)}`;
      }).join(' and ');
    };
    const tabla = `public.${this.tabla}`;
    if (this.op === 'select') {
      const cols = this.columnas === '*' ? '*' : this.columnas.split(',').map((s) => ident(s.trim())).join(', ');
      let sql = `select ${cols} from ${tabla}${where()}`;
      if (this.ordenes.length) sql += ' order by ' + this.ordenes.join(', ');
      if (this.limite !== null) sql += ` limit ${this.limite}`;
      if (this.desde !== null) sql += ` offset ${this.desde}`;
      return { sql, params };
    }
    const ret = this.devolver ? ' returning *' : '';
    if (this.op === 'insert' || this.op === 'upsert') {
      const cols = [...new Set(this.valores.flatMap((f) => Object.keys(f)))].map(ident);
      const filas = this.valores.map((f) => `(${cols.map((c) => (c in f ? p(f[c]) : 'default')).join(', ')})`);
      let sql = `insert into ${tabla} (${cols.join(', ')}) values ${filas.join(', ')}`;
      if (this.op === 'upsert') {
        const conf = String(this.conflicto || 'id').split(',').map((s) => ident(s.trim()));
        const set = cols.filter((c) => !conf.includes(c)).map((c) => `${c} = excluded.${c}`);
        sql += ` on conflict (${conf.join(', ')}) do ${set.length ? 'update set ' + set.join(', ') : 'nothing'}`;
      }
      return { sql: sql + ret, params };
    }
    if (this.op === 'update') {
      const set = Object.keys(this.valores).map((c) => `${ident(c)} = ${p(this.valores[c])}`).join(', ');
      return { sql: `update ${tabla} set ${set}${where()}${ret}`, params };
    }
    return { sql: `delete from ${tabla}${where()}${ret}`, params };
  }

  async _ejecutar() {
    try {
      const { sql, params } = this._sql();
      const r = await this.cliente._consultar(sql, params);
      let data = this.op === 'select' || this.devolver ? r.rows : null;
      if (this.modo === 'single') {
        if (!data || data.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null } };
        }
        data = data[0];
      } else if (this.modo === 'maybe') {
        data = data && data.length ? data[0] : null;
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: aError(e) };
    }
  }

  then(resolver, rechazar) { return this._ejecutar().then(resolver, rechazar); }
}

class CanalLocal {
  constructor(cliente, nombre) {
    this.cliente = cliente;
    this.nombre = nombre;
    this.manejadores = [];
  }
  on(tipo, filtro, cb) {
    if (tipo === 'postgres_changes') this.manejadores.push({ filtro, cb });
    return this;
  }
  subscribe(cb) {
    this.cliente._canales.add(this);
    if (cb) setTimeout(() => cb('SUBSCRIBED'), 0);
    return this;
  }
  unsubscribe() { this.cliente._canales.delete(this); return Promise.resolve('ok'); }
}

class ClienteLocal {
  constructor(pg, compartido = null) {
    this.pg = pg;
    this.sesion = null;
    this._escuchas = new Set();
    this._canales = compartido ? compartido._canales : new Set();
    this.local = true;
    const yo = this;
    this.auth = {
      async signInWithPassword({ email, password }) {
        const r = await pg.query('select id, email, clave_hash from auth.users where lower(email) = lower($1)', [String(email || '')]);
        const u = r.rows[0];
        if (!u || !claveValida(password, u.clave_hash)) {
          return { data: { session: null, user: null }, error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } };
        }
        yo.sesion = { access_token: 'local', user: { id: u.id, email: u.email } };
        yo._avisar('SIGNED_IN');
        return { data: { session: yo.sesion, user: yo.sesion.user }, error: null };
      },
      async signOut() { yo.sesion = null; yo._avisar('SIGNED_OUT'); return { error: null }; },
      async getSession() { return { data: { session: yo.sesion }, error: null }; },
      async getUser() { return { data: { user: yo.sesion ? yo.sesion.user : null }, error: null }; },
      onAuthStateChange(cb) {
        yo._escuchas.add(cb);
        return { data: { subscription: { unsubscribe: () => yo._escuchas.delete(cb) } } };
      },
    };
  }

  _avisar(evento) { for (const cb of this._escuchas) cb(evento, this.sesion); }

  async _consultar(sql, params) {
    const uid = this.sesion ? this.sesion.user.id : '';
    return this.pg.transaction(async (tx) => {
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      return tx.query(sql, params);
    });
  }

  from(tabla) { return new Consulta(this, tabla); }

  async rpc(funcion, args = {}) {
    try {
      const nombres = Object.keys(args).filter((k) => args[k] !== undefined);
      const params = [];
      const partes = nombres.map((k) => {
        const { valor, cast } = argumentoRpc(args[k]);
        params.push(valor);
        return `${ident(k)} => $${params.length}${cast}`;
      });
      const r = await this._consultar(`select public.${ident(funcion)}(${partes.join(', ')}) as r`, params);
      return { data: r.rows[0].r, error: null };
    } catch (e) {
      return { data: null, error: aError(e) };
    }
  }

  channel(nombre) { return new CanalLocal(this, nombre); }
  removeChannel(canal) { return canal.unsubscribe(); }

  // Reparte un NOTIFY a los canales cuyo filtro coincide, y solo al dueño de la fila
  // (igual que Realtime respeta RLS).
  _repartir(texto) {
    let ev;
    try { ev = JSON.parse(texto); } catch (_) { return; }
    for (const canal of this._canales) {
      const dueño = canal.cliente.sesion && canal.cliente.sesion.user.id;
      if (!dueño || !ev.new || ev.new.propietario !== dueño) continue;
      for (const { filtro, cb } of canal.manejadores) {
        if (filtro.table && filtro.table !== ev.table) continue;
        if (filtro.event && filtro.event !== '*' && filtro.event !== ev.eventType) continue;
        if (filtro.filter) {
          const m = /^(\w+)=eq\.(.+)$/.exec(filtro.filter);
          if (m && String(ev.new[m[1]]) !== m[2]) continue;
        }
        cb({ schema: 'public', table: ev.table, eventType: ev.eventType, new: ev.new, old: {}, commit_timestamp: new Date().toISOString() });
      }
    }
  }

  // Otra "conexion" a la misma base, sin sesion: para probar lo que puede hacer la clave anon.
  comoAnon() { return new ClienteLocal(this.pg, this); }

  // Solo local: crea un usuario de Auth (como hacerlo en el panel de Supabase).
  async crearUsuario(email, password) {
    const r = await this.pg.query(
      'insert into auth.users (email, clave_hash) values ($1, $2) on conflict (email) do update set email = excluded.email returning id',
      [email, hashClave(password)]);
    return r.rows[0].id;
  }

  async cerrar() { await this.pg.close(); }
}

function archivosMigracion() {
  return fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
}

// Aplica en orden las migraciones de supabase/migrations que falten, igual que se
// ejecutan en Supabase. Lleva la cuenta en _local.migraciones; una base demo creada
// antes de existir ese registro (con el esquema inicial ya puesto) se marca como tal.
// `omitir` (solo pruebas): nombres de archivo que no se aplican, para simular una base
// de produccion a la que le falta alguna migracion.
async function aplicarMigraciones(pg, omitir = []) {
  await pg.exec(SQL_BASE);
  await pg.exec('create schema if not exists _local; create table if not exists _local.migraciones (nombre text primary key, aplicada_en timestamptz default now());');
  const aplicadas = new Set((await pg.query('select nombre from _local.migraciones')).rows.map((r) => r.nombre));
  const archivos = archivosMigracion();
  if (!aplicadas.size && (await pg.query("select to_regclass('public.compras') as t")).rows[0].t) {
    await pg.query('insert into _local.migraciones (nombre) values ($1)', [archivos[0]]);
    aplicadas.add(archivos[0]);
  }
  for (const nombre of archivos) {
    if (aplicadas.has(nombre) || omitir.includes(nombre)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(fs.readFileSync(path.join(DIR_MIGRACIONES, nombre), 'utf8'));
      await tx.query('insert into _local.migraciones (nombre) values ($1)', [nombre]);
    });
  }
  await pg.exec(SQL_TIEMPO_REAL);
}

// Levanta PGlite (en memoria, o persistido en `dir`) con el esquema de Supabase.
async function crearClienteLocal({ dir = null, omitir = [] } = {}) {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const aIso = (v) => new Date(v).toISOString();
  // Numeric e int8 como numero (igual que los devuelve la API de Supabase) y fechas como
  // texto ISO. Ojo: las opciones van en UN objeto; con `new PGlite(undefined, {...})` se
  // ignoran en silencio.
  const pg = new PGlite({
    ...(dir ? { dataDir: dir } : {}),
    parsers: {
      [types.NUMERIC]: Number,
      [types.INT8]: Number,
      [types.DATE]: (v) => v,
      [types.TIMESTAMPTZ]: aIso,
      [types.TIMESTAMP]: aIso,
    },
  });
  await aplicarMigraciones(pg, omitir);
  const cliente = new ClienteLocal(pg);
  await pg.listen(CANAL_NOTIFY, (texto) => cliente._repartir(texto));
  return cliente;
}

module.exports = { crearClienteLocal };
