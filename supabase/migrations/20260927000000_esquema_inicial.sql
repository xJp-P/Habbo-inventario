-- =============================================================================
-- Habbo Inventario — esquema de Supabase (Postgres 15+)
--
-- Cómo instalarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- (Con la CLI de Supabase también sirve `supabase db push`.)
--
-- MODELO (nombres de la INTERFAZ entre paréntesis):
--   config         ajustes por usuario (tasa del Lingo)
--   furnis         (vista MERCADILLO) un renglón por furni con su precio de venta
--   compras        (vista INVENTARIO) un renglón por lote comprado; al vender una
--                  parte, el lote se divide (origen_id apunta al original)
--   tokens_sniper  un token por cada SniperMercadillo (cada VPS) que envía compras
--
-- SEGURIDAD:
--   * Cada fila tiene `propietario` (el usuario de Supabase Auth). Las políticas RLS
--     solo dejan ver y tocar lo propio, y las vistas usan security_invoker para que
--     esas políticas también apliquen a los cálculos.
--   * La clave "anon" NO da acceso a ninguna tabla. Lo único que puede hacer es
--     llamar a registrar_compras_sniper / estado_sniper, y esas funciones exigen un
--     token de sniper válido (se guarda solo su huella SHA-256, nunca el token).
--   * Solo se aceptan compras del hotel Habbo.es (Habbo Origins queda fuera).
--
-- MONEDAS: todo se guarda en su moneda original ('creditos' | 'lingos') y se
-- convierte a Créditos con la tasa vigente del usuario (config.tasa_lingo).
--
-- ERRORES: las funciones lanzan SQLSTATE 'PTxyz'; PostgREST lo devuelve como HTTP xyz
-- (PT400, PT401, PT404, PT409, PT422), así la app y el sniper reciben códigos claros.
-- =============================================================================

-- ─── Tablas ──────────────────────────────────────────────────────────────────

create table if not exists public.config (
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  clave       text not null,
  valor       text not null,
  primary key (propietario, clave)
);

create table if not exists public.furnis (
  id             bigint generated always as identity primary key,
  propietario    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) > 0),
  classname      text,
  revision       integer,
  moneda_venta   text not null default 'creditos' check (moneda_venta in ('creditos', 'lingos')),
  precio_venta   numeric check (precio_venta is null or precio_venta >= 0),
  notas          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Destino de la llave compuesta de compras: un lote solo puede apuntar a un furni
  -- del MISMO propietario (las llaves foráneas no pasan por RLS).
  unique (id, propietario)
);

-- Nombre único por usuario, sin distinguir mayúsculas.
create unique index if not exists furnis_nombre_unico on public.furnis (propietario, lower(nombre));
create index if not exists furnis_classname on public.furnis (propietario, classname);

create table if not exists public.compras (
  id             bigint generated always as identity primary key,
  propietario    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  furni_id       bigint not null,
  estado         text not null default 'comprado' check (estado in ('comprado', 'vendido')),
  cantidad       integer not null check (cantidad > 0),
  moneda_compra  text not null default 'creditos' check (moneda_compra in ('creditos', 'lingos')),
  precio_compra  numeric not null check (precio_compra >= 0),
  -- Precio real de venta, congelado al vender (null mientras esté "comprado").
  moneda_venta   text check (moneda_venta is null or moneda_venta in ('creditos', 'lingos')),
  precio_venta   numeric check (precio_venta is null or precio_venta >= 0),
  fecha_compra   date,
  fecha_venta    date,
  -- Lote del que se dividió esta venta parcial (null = compra original).
  origen_id      bigint,
  -- De dónde vino: la app, el Excel importado o un SniperMercadillo.
  fuente         text not null default 'manual' check (fuente in ('manual', 'excel', 'sniper')),
  -- Id de la compra en el sniper (id de la oferta del mercadillo): evita duplicados.
  id_externo     text,
  -- Huérfano: llegó del sniper y aún no tiene precio de venta confirmado.
  pendiente      boolean not null default false,
  instancia      text,
  sprite_id      integer,
  notas          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  foreign key (furni_id, propietario) references public.furnis (id, propietario) on delete restrict,
  unique (id, propietario),
  check (estado = 'comprado' or (precio_venta is not null and moneda_venta is not null))
);

alter table public.compras drop constraint if exists compras_origen_fk;
alter table public.compras add constraint compras_origen_fk
  foreign key (origen_id, propietario) references public.compras (id, propietario)
  on delete set null (origen_id);

create unique index if not exists compras_externo_unico
  on public.compras (propietario, fuente, id_externo) where id_externo is not null;
create index if not exists compras_por_furni on public.compras (propietario, furni_id, estado);
create index if not exists compras_pendientes on public.compras (propietario, furni_id) where pendiente;
create index if not exists compras_origen on public.compras (origen_id);

create table if not exists public.tokens_sniper (
  id          bigint generated always as identity primary key,
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) > 0),
  hash        text not null unique,
  prefijo     text not null,
  creado_en   timestamptz not null default now(),
  ultimo_uso  timestamptz,
  revocado    boolean not null default false
);

-- ─── actualizado_en automático ───────────────────────────────────────────────

create or replace function public.tocar_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists furnis_actualizado on public.furnis;
create trigger furnis_actualizado before update on public.furnis
  for each row execute function public.tocar_actualizado_en();
drop trigger if exists compras_actualizado on public.compras;
create trigger compras_actualizado before update on public.compras
  for each row execute function public.tocar_actualizado_en();

-- ─── Vistas calculadas (los números del Excel) ───────────────────────────────

create or replace view public.v_tasa with (security_invoker = true) as
select coalesce(
  (select case when c.valor ~ '^[0-9]+(\.[0-9]+)?$' and c.valor::numeric > 0 then c.valor::numeric end
     from public.config c
    where c.clave = 'tasa_lingo' and c.propietario = auth.uid()),
  50::numeric
) as tasa;

-- Lotes. *_cr = Créditos, *_lg = Lingos.
create or replace view public.v_compras with (security_invoker = true) as
select
  b.*,
  b.precio_compra_cr * b.cantidad                        as costo_total_cr,
  b.precio_compra_cr * b.cantidad / b.tasa               as costo_total_lg,
  b.precio_venta_cr / b.tasa                             as precio_venta_lg,
  case when b.precio_venta_cr is null then null
       else (b.precio_venta_cr - b.precio_compra_cr) * b.cantidad end              as ganancia_cr,
  case when b.precio_venta_cr is null then null
       else (b.precio_venta_cr - b.precio_compra_cr) * b.cantidad / b.tasa end     as ganancia_lg,
  case when b.precio_venta_cr is null or b.precio_compra_cr = 0 then null
       else (b.precio_venta_cr - b.precio_compra_cr) / b.precio_compra_cr end      as margen
from (
  select
    c.id, c.furni_id, f.nombre, f.classname, f.revision,
    c.estado, c.pendiente, c.fuente, c.id_externo, c.instancia, c.sprite_id,
    c.cantidad, c.moneda_compra, c.precio_compra,
    c.moneda_venta as moneda_venta_real, c.precio_venta as precio_venta_real,
    c.fecha_compra, c.fecha_venta, c.origen_id, c.notas, c.creado_en,
    t.tasa,
    case c.moneda_compra when 'lingos' then c.precio_compra * t.tasa else c.precio_compra end as precio_compra_cr,
    case
      when c.estado = 'vendido' then
        case c.moneda_venta when 'lingos' then c.precio_venta * t.tasa else c.precio_venta end
      else
        case f.moneda_venta when 'lingos' then f.precio_venta * t.tasa else f.precio_venta end
    end as precio_venta_cr
  from public.compras c
  join public.furnis f on f.id = c.furni_id
  cross join public.v_tasa t
) b;

-- Furnis con agregados de sus lotes. El stock incluye los huérfanos (son tuyos);
-- stock_activo los excluye.
create or replace view public.v_furnis with (security_invoker = true) as
select
  s.*,
  s.stock - s.unidades_pendientes                                          as stock_activo,
  s.costo_promedio_cr / s.tasa                                             as costo_promedio_lg,
  case when s.stock > 0 and s.precio_venta_cr is not null
       then s.stock * s.precio_venta_cr end                                as venta_esperada_cr,
  case when s.stock > 0 and s.precio_venta_cr is not null
       then s.stock * s.precio_venta_cr - s.inversion_cr end               as ganancia_esperada_cr,
  case when s.stock > 0 and s.precio_venta_cr is not null
       then (s.stock * s.precio_venta_cr - s.inversion_cr) / s.tasa end    as ganancia_esperada_lg,
  ceil(s.costo_promedio_cr)                                                as precio_minimo_cr,
  case when s.unidades_compradas = 0 then 'sin_compras'
       when s.stock = 0 then 'agotado'
       when s.stock - s.unidades_pendientes <= 0 then 'por_revisar'
       else 'en_venta' end                                                 as estado,
  (s.precio_venta_cr is not null and s.costo_promedio_cr is not null
     and s.precio_venta_cr < s.costo_promedio_cr)                          as en_perdida
from (
  select
    a.*,
    a.unidades_compradas - a.unidades_vendidas                            as stock,
    case when a.unidades_compradas - a.unidades_vendidas > 0
         then a.inversion_cr / (a.unidades_compradas - a.unidades_vendidas) end as costo_promedio_cr
  from (
    select
      f.id, f.nombre, f.classname, f.revision, f.moneda_venta, f.precio_venta,
      f.notas, f.creado_en, t.tasa,
      case f.moneda_venta when 'lingos' then f.precio_venta * t.tasa else f.precio_venta end as precio_venta_cr,
      case f.moneda_venta when 'lingos' then f.precio_venta else f.precio_venta / t.tasa end as precio_venta_lg,
      coalesce(sum(vc.cantidad), 0)                                                   as unidades_compradas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'vendido'), 0)              as unidades_vendidas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'comprado' and vc.pendiente), 0) as unidades_pendientes,
      count(vc.id) filter (where vc.estado = 'comprado' and vc.pendiente)             as lotes_pendientes,
      count(vc.id) filter (where vc.origen_id is null)                                as n_compras,
      coalesce(sum(vc.costo_total_cr) filter (where vc.estado = 'comprado'), 0)       as inversion_cr,
      min(vc.precio_compra_cr)                                                        as compra_min_cr,
      max(vc.precio_compra_cr)                                                        as compra_max_cr,
      coalesce(sum(vc.ganancia_cr) filter (where vc.estado = 'vendido'), 0)           as ganancia_realizada_cr,
      max(vc.creado_en) filter (where vc.fuente = 'sniper')                           as ultima_compra_sniper
    from public.furnis f
    cross join public.v_tasa t
    left join public.v_compras vc on vc.furni_id = f.id
    group by f.id, t.tasa
  ) a
) s;

-- ─── Seguridad por filas (RLS) ───────────────────────────────────────────────

alter table public.config        enable row level security;
alter table public.furnis        enable row level security;
alter table public.compras       enable row level security;
alter table public.tokens_sniper enable row level security;

drop policy if exists "config propio" on public.config;
create policy "config propio" on public.config for all to authenticated
  using (propietario = auth.uid()) with check (propietario = auth.uid());
drop policy if exists "furnis propios" on public.furnis;
create policy "furnis propios" on public.furnis for all to authenticated
  using (propietario = auth.uid()) with check (propietario = auth.uid());
drop policy if exists "compras propias" on public.compras;
create policy "compras propias" on public.compras for all to authenticated
  using (propietario = auth.uid()) with check (propietario = auth.uid());
drop policy if exists "tokens propios" on public.tokens_sniper;
create policy "tokens propios" on public.tokens_sniper for all to authenticated
  using (propietario = auth.uid()) with check (propietario = auth.uid());

-- La clave anon no toca tablas ni vistas; solo las dos funciones del sniper.
revoke all on public.config, public.furnis, public.compras, public.tokens_sniper from anon;
revoke all on public.v_tasa, public.v_compras, public.v_furnis from anon;
grant select, insert, update, delete on public.config, public.furnis, public.compras, public.tokens_sniper to authenticated;
grant select on public.v_tasa, public.v_compras, public.v_furnis to authenticated;

-- ─── Operaciones de la app (usuario autenticado, respetan RLS) ───────────────

-- Vende `p_cantidad` unidades de un lote. Todo el lote: la fila pasa a "vendido".
-- Una parte: la fila baja su cantidad y nace una fila "vendido" con origen_id.
create or replace function public.vender_lote(
  p_id bigint, p_cantidad integer default null, p_moneda text default null,
  p_precio numeric default null, p_fecha date default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.compras%rowtype;
  f public.furnis%rowtype;
  v_cant integer;
  v_moneda text;
  v_precio numeric;
  v_fecha date := coalesce(p_fecha, current_date);
  v_nuevo bigint;
begin
  select * into c from public.compras where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese lote no existe.'; end if;
  if c.estado <> 'comprado' then raise exception using errcode = 'PT400', message = 'Ese lote ya esta vendido.'; end if;

  v_cant := coalesce(p_cantidad, c.cantidad);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a vender debe ser mayor o igual a 1.'; end if;
  if v_cant > c.cantidad then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) en ese lote.', c.cantidad);
  end if;

  select * into f from public.furnis where id = c.furni_id;
  v_moneda := coalesce(p_moneda, f.moneda_venta);
  v_precio := coalesce(p_precio, f.precio_venta);
  if v_precio is null then raise exception using errcode = 'PT400', message = 'Falta el precio de venta.'; end if;

  if v_cant = c.cantidad then
    update public.compras
       set estado = 'vendido', pendiente = false, moneda_venta = v_moneda, precio_venta = v_precio, fecha_venta = v_fecha
     where id = p_id;
    return jsonb_build_object('dividida', false, 'original_id', null, 'venta_id', p_id);
  end if;

  update public.compras set cantidad = cantidad - v_cant where id = p_id;
  -- id_externo NO se copia: es único por compra original.
  insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                              moneda_venta, precio_venta, fecha_compra, fecha_venta, origen_id, notas,
                              fuente, pendiente, instancia, sprite_id)
  values (c.propietario, c.furni_id, 'vendido', v_cant, c.moneda_compra, c.precio_compra,
          v_moneda, v_precio, c.fecha_compra, v_fecha, c.id, c.notas,
          c.fuente, false, c.instancia, c.sprite_id)
  returning id into v_nuevo;
  return jsonb_build_object('dividida', true, 'original_id', p_id, 'venta_id', v_nuevo);
end;
$$;

-- Deshace una venta. Si vino de una división y el lote original sigue "comprado",
-- las unidades vuelven a él; si no, la fila regresa a "comprado".
create or replace function public.revertir_venta(p_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.compras%rowtype;
  o public.compras%rowtype;
begin
  select * into c from public.compras where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese lote no existe.'; end if;
  if c.estado <> 'vendido' then raise exception using errcode = 'PT400', message = 'Ese lote no esta vendido.'; end if;

  if c.origen_id is not null then
    select * into o from public.compras where id = c.origen_id for update;
    if found and o.estado = 'comprado' and o.furni_id = c.furni_id
       and o.moneda_compra = c.moneda_compra and o.precio_compra = c.precio_compra then
      update public.compras set cantidad = cantidad + c.cantidad where id = o.id;
      delete from public.compras where id = c.id;
      return jsonb_build_object('fusionada', true, 'compra_id', o.id);
    end if;
  end if;

  update public.compras
     set estado = 'comprado', moneda_venta = null, precio_venta = null, fecha_venta = null
   where id = c.id;
  return jsonb_build_object('fusionada', false, 'compra_id', c.id);
end;
$$;

-- Activa lotes huérfanos. Con `p_precio` fija antes el precio del furni. Sin
-- `p_compra_ids` activa TODOS los lotes pendientes del furni.
create or replace function public.activar_pendientes(
  p_furni_id bigint default null, p_compra_ids bigint[] default null,
  p_precio numeric default null, p_moneda text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_furni bigint := p_furni_id;
  v_furnis bigint[];
  f public.furnis%rowtype;
  v_n integer;
begin
  if v_furni is null then
    if p_compra_ids is null or cardinality(p_compra_ids) = 0 then
      raise exception using errcode = 'PT400', message = 'Indica el furni o los lotes a activar.';
    end if;
    select array_agg(distinct furni_id) into v_furnis from public.compras where id = any (p_compra_ids);
    if v_furnis is null or cardinality(v_furnis) <> 1 then
      raise exception using errcode = 'PT400', message = 'Activa los lotes de un furni a la vez.';
    end if;
    v_furni := v_furnis[1];
  end if;

  select * into f from public.furnis where id = v_furni for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;

  if p_compra_ids is not null and exists (
       select 1 from public.compras where id = any (p_compra_ids) and furni_id <> v_furni) then
    raise exception using errcode = 'PT400', message = 'Hay lotes de otro furni en la seleccion.';
  end if;

  if p_precio is not null then
    if p_precio < 0 then raise exception using errcode = 'PT400', message = 'El precio de venta no puede ser negativo.'; end if;
    update public.furnis set precio_venta = p_precio, moneda_venta = coalesce(p_moneda, moneda_venta) where id = v_furni;
    f.precio_venta := p_precio;
  end if;
  if f.precio_venta is null then
    raise exception using errcode = 'PT400', message = format('Ponle un precio de venta a "%s" para activarlo.', f.nombre);
  end if;

  update public.compras set pendiente = false
   where furni_id = v_furni and estado = 'comprado' and pendiente
     and (p_compra_ids is null or id = any (p_compra_ids));
  get diagnostics v_n = row_count;
  return jsonb_build_object('activados', v_n, 'furni_id', v_furni);
end;
$$;

-- Registra una compra hecha a mano. Busca el furni (id, classname o nombre) y, si no
-- existe, lo crea sin precio, todo en la misma transacción.
create or replace function public.crear_compra(
  p_furni_id bigint default null, p_nombre text default null, p_classname text default null,
  p_revision integer default null, p_cantidad integer default 1, p_moneda text default 'creditos',
  p_precio numeric default null, p_fecha date default null, p_notas text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_furni bigint;
  v_creado boolean := false;
  v_id bigint;
begin
  if p_precio is null then raise exception using errcode = 'PT400', message = 'Falta el precio de compra.'; end if;
  if p_furni_id is not null then
    select id into v_furni from public.furnis where id = p_furni_id;
    if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  else
    if p_classname is not null then
      select id into v_furni from public.furnis where classname = p_classname order by id limit 1;
    end if;
    if v_furni is null and p_nombre is not null then
      select id into v_furni from public.furnis where lower(nombre) = lower(trim(p_nombre)) limit 1;
    end if;
    if v_furni is null then
      if coalesce(trim(p_nombre), '') = '' then
        raise exception using errcode = 'PT400', message = 'Falta el nombre del furni.';
      end if;
      insert into public.furnis (nombre, classname, revision) values (trim(p_nombre), p_classname, p_revision)
      returning id into v_furni;
      v_creado := true;
    end if;
  end if;

  insert into public.compras (furni_id, cantidad, moneda_compra, precio_compra, fecha_compra, notas)
  values (v_furni, coalesce(p_cantidad, 1), coalesce(p_moneda, 'creditos'), p_precio, coalesce(p_fecha, current_date), p_notas)
  returning id into v_id;
  return jsonb_build_object('compra_id', v_id, 'furni_id', v_furni, 'furni_creado', v_creado);
end;
$$;

-- Importación del Excel en UNA transacción: o entra todo, o nada.
-- p_furnis:  [{ clave, nombre, classname, revision, moneda_venta, precio_venta }]
-- p_compras: [{ clave_furni, estado, cantidad, moneda_compra, precio_compra, moneda_venta, precio_venta, notas }]
create or replace function public.importar_excel(
  p_tasa numeric, p_furnis jsonb, p_compras jsonb, p_reemplazar boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hay bigint;
  v_mapa jsonb := '{}'::jsonb;
  e jsonb;
  v_id bigint;
  n_f integer := 0;
  n_c integer := 0;
begin
  select (select count(*) from public.furnis) + (select count(*) from public.compras) into v_hay;
  if v_hay > 0 and not coalesce(p_reemplazar, false) then
    raise exception using errcode = 'PT409',
      message = 'La base de datos ya tiene furnis o lotes. Usa la opcion de reemplazar para importar encima.';
  end if;
  if coalesce(p_reemplazar, false) then
    delete from public.compras where propietario = auth.uid();
    delete from public.furnis where propietario = auth.uid();
  end if;

  if p_tasa is not null and p_tasa > 0 then
    insert into public.config (clave, valor) values ('tasa_lingo', p_tasa::text)
    on conflict (propietario, clave) do update set valor = excluded.valor;
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_furnis, '[]'::jsonb)) loop
    insert into public.furnis (nombre, classname, revision, moneda_venta, precio_venta)
    values (e->>'nombre', nullif(e->>'classname', ''), (e->>'revision')::integer,
            coalesce(e->>'moneda_venta', 'creditos'), (e->>'precio_venta')::numeric)
    returning id into v_id;
    v_mapa := v_mapa || jsonb_build_object(e->>'clave', v_id);
    n_f := n_f + 1;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_compras, '[]'::jsonb)) loop
    v_id := (v_mapa->>(e->>'clave_furni'))::bigint;
    if v_id is null then
      raise exception using errcode = 'PT400', message = format('Lote sin furni en el Excel: %s', e->>'clave_furni');
    end if;
    insert into public.compras (furni_id, estado, cantidad, moneda_compra, precio_compra, moneda_venta, precio_venta, notas, fuente)
    values (v_id, coalesce(e->>'estado', 'comprado'), (e->>'cantidad')::integer,
            coalesce(e->>'moneda_compra', 'creditos'), (e->>'precio_compra')::numeric,
            e->>'moneda_venta', (e->>'precio_venta')::numeric, e->>'notas', 'excel');
    n_c := n_c + 1;
  end loop;

  return jsonb_build_object('furnis', n_f, 'compras', n_c);
end;
$$;

-- ─── API de los SniperMercadillo (clave anon + token del sniper) ─────────────

-- Valida el token y devuelve su fila (o lanza PT401). Uso interno.
create or replace function public._token_sniper_valido(p_token text)
returns public.tokens_sniper
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tokens_sniper%rowtype;
begin
  select * into t from public.tokens_sniper
   where hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and not revocado;
  if not found then
    raise exception using errcode = 'PT401', message = 'Token de sniper invalido o revocado.';
  end if;
  return t;
end;
$$;

-- Registra compras confirmadas por un sniper. Cada compra entra como lote HUÉRFANO
-- (pendiente = true) hasta que el usuario le confirme un precio en la app.
--
-- p_hotel:    'es' (también se acepta 'habbo.es', 'www.habbo.es', 'game-es.habbo.com')
-- p_compras:  [{ id_externo, classname, nombre, sprite_id, tipo, revision, cantidad,
--                precio, moneda, fecha, variante, ltd, notas }]
--             id_externo y precio son obligatorios; se necesita classname o nombre.
-- p_instancia: nombre de la instancia del sniper (p. ej. el VPS), opcional.
create or replace function public.registrar_compras_sniper(
  p_token text, p_hotel text, p_compras jsonb, p_instancia text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tokens_sniper%rowtype;
  e jsonb;
  i integer := -1;
  v_id_ext text;
  v_classname text;
  v_nombre text;
  v_precio numeric;
  v_cantidad integer;
  v_moneda text;
  v_fecha date;
  v_furni bigint;
  v_compra bigint;
  v_notas text;
  v_registradas integer := 0;
  v_duplicadas integer := 0;
  v_errores jsonb := '[]'::jsonb;
  v_detalle jsonb := '[]'::jsonb;
begin
  t := public._token_sniper_valido(p_token);

  if lower(trim(coalesce(p_hotel, ''))) not in ('es', 'habbo.es', 'www.habbo.es', 'game-es.habbo.com') then
    raise exception using errcode = 'PT422', message = format(
      'Hotel "%s" no admitido. Solo se aceptan compras de Habbo.es (Habbo Origins y otros hoteles quedan fuera).',
      coalesce(p_hotel, ''));
  end if;
  if p_compras is null or jsonb_typeof(p_compras) <> 'array' or jsonb_array_length(p_compras) = 0 then
    raise exception using errcode = 'PT400', message = 'No llegaron compras: p_compras debe ser una lista.';
  end if;
  if jsonb_array_length(p_compras) > 200 then
    raise exception using errcode = 'PT400', message = 'Maximo 200 compras por envio.';
  end if;

  update public.tokens_sniper set ultimo_uso = now() where id = t.id;

  for e in select * from jsonb_array_elements(p_compras) loop
    i := i + 1;
    v_id_ext := nullif(trim(coalesce(e->>'id_externo', '')), '');
    begin
      if jsonb_typeof(e) <> 'object' then raise exception 'Cada compra debe ser un objeto.'; end if;
      if v_id_ext is null then raise exception 'Falta id_externo (id unico de la compra, p. ej. el id de la oferta).'; end if;
      v_id_ext := left(v_id_ext, 120);

      select id into v_compra from public.compras
       where propietario = t.propietario and fuente = 'sniper' and id_externo = v_id_ext;
      if found then
        v_duplicadas := v_duplicadas + 1;
        v_detalle := v_detalle || jsonb_build_object('indice', i, 'id_externo', v_id_ext, 'id', v_compra, 'duplicada', true);
        continue;
      end if;

      if (e->>'precio') is null or (e->>'precio') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'Falta precio (numero mayor o igual a 0).';
      end if;
      v_precio := (e->>'precio')::numeric;
      v_cantidad := coalesce((e->>'cantidad')::integer, 1);
      if v_cantidad < 1 then raise exception 'La cantidad debe ser mayor o igual a 1.'; end if;
      v_moneda := lower(coalesce(e->>'moneda', 'creditos'));
      if v_moneda not in ('creditos', 'lingos') then raise exception 'Moneda no valida: usa creditos o lingos.'; end if;
      v_fecha := case
        when (e->>'fecha') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(e->>'fecha', 10)::date
        when (e->>'fecha') ~ '^[0-9]{10,}$' then (to_timestamp((e->>'fecha')::numeric / 1000) at time zone 'UTC')::date
        else current_date end;
      v_classname := nullif(trim(coalesce(e->>'classname', '')), '');
      v_nombre := nullif(trim(coalesce(e->>'nombre', '')), '');

      v_furni := null;
      if v_classname is not null then
        select id into v_furni from public.furnis
         where propietario = t.propietario and classname = v_classname order by id limit 1;
      end if;
      if v_furni is null and v_nombre is not null then
        select id into v_furni from public.furnis
         where propietario = t.propietario and lower(nombre) = lower(v_nombre) order by id limit 1;
      end if;
      if v_furni is null then
        if v_nombre is null then
          raise exception 'Furni nuevo sin nombre: envia classname y nombre (del furnidata de Habbo.es).';
        end if;
        insert into public.furnis (propietario, nombre, classname, revision)
        values (t.propietario, v_nombre, v_classname, nullif(e->>'revision', '')::integer)
        returning id into v_furni;
      end if;

      v_notas := concat_ws(' · ',
        'Sniper' || coalesce(' ' || nullif(trim(coalesce(p_instancia, '')), ''), ''),
        'oferta ' || v_id_ext,
        nullif(trim(coalesce(e->>'variante', '')), ''),
        case when nullif(e->>'ltd', '') is not null then 'LTD #' || (e->>'ltd') end,
        nullif(left(trim(coalesce(e->>'notas', '')), 300), ''));

      insert into public.compras (propietario, furni_id, cantidad, moneda_compra, precio_compra, fecha_compra,
                                  fuente, id_externo, pendiente, instancia, sprite_id, notas)
      values (t.propietario, v_furni, v_cantidad, v_moneda, v_precio, v_fecha,
              'sniper', v_id_ext, true, nullif(trim(coalesce(p_instancia, '')), ''),
              nullif(e->>'sprite_id', '')::integer, v_notas)
      on conflict (propietario, fuente, id_externo) where id_externo is not null do nothing
      returning id into v_compra;

      if v_compra is null then
        -- Otro sniper la registró entre la búsqueda y el insert.
        v_duplicadas := v_duplicadas + 1;
        v_detalle := v_detalle || jsonb_build_object('indice', i, 'id_externo', v_id_ext, 'duplicada', true);
      else
        v_registradas := v_registradas + 1;
        v_detalle := v_detalle || jsonb_build_object('indice', i, 'id_externo', v_id_ext, 'id', v_compra,
          'furni_id', v_furni, 'cantidad', v_cantidad, 'precio', v_precio, 'pendiente', true);
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('indice', i, 'id_externo', v_id_ext, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'recibidas', jsonb_array_length(p_compras),
    'registradas', v_registradas,
    'duplicadas', v_duplicadas,
    'errores', v_errores,
    'compras', v_detalle);
end;
$$;

-- Prueba de conexión para el sniper: valida el token y devuelve lo básico.
create or replace function public.estado_sniper(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tokens_sniper%rowtype;
begin
  t := public._token_sniper_valido(p_token);
  return jsonb_build_object(
    'ok', true,
    'app', 'Habbo Inventario',
    'hotel', 'es',
    'token', t.nombre,
    'pendientes', (select count(*) from public.compras c
                    where c.propietario = t.propietario and c.estado = 'comprado' and c.pendiente));
end;
$$;

-- ─── Permisos de las funciones ───────────────────────────────────────────────

revoke execute on function public.tocar_actualizado_en() from public, anon, authenticated;
revoke execute on function public._token_sniper_valido(text) from public, anon, authenticated;
revoke execute on function public.vender_lote(bigint, integer, text, numeric, date) from public, anon;
revoke execute on function public.revertir_venta(bigint) from public, anon;
revoke execute on function public.activar_pendientes(bigint, bigint[], numeric, text) from public, anon;
revoke execute on function public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text) from public, anon;
revoke execute on function public.importar_excel(numeric, jsonb, jsonb, boolean) from public, anon;
revoke execute on function public.registrar_compras_sniper(text, text, jsonb, text) from public;
revoke execute on function public.estado_sniper(text) from public;

grant execute on function public.vender_lote(bigint, integer, text, numeric, date) to authenticated;
grant execute on function public.revertir_venta(bigint) to authenticated;
grant execute on function public.activar_pendientes(bigint, bigint[], numeric, text) to authenticated;
grant execute on function public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text) to authenticated;
grant execute on function public.importar_excel(numeric, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.registrar_compras_sniper(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.estado_sniper(text) to anon, authenticated;

-- ─── Tiempo real: la app se entera al instante de cada compra del sniper ─────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'compras') then
    alter publication supabase_realtime add table public.compras;
  end if;
end;
$$;
