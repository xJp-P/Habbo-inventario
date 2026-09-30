// backend/services/negocio.js — operaciones del negocio sobre Supabase.
//
// Las rutas HTTP y el importador de Excel usan ESTAS funciones: una sola implementacion
// de cada regla. Las operaciones de varias escrituras (vender dividiendo el lote,
// revertir, activar huerfanos, registrar compra creando el furni, importar el Excel)
// son funciones SQL del esquema: corren en UNA transaccion dentro de Postgres, asi que
// son todo-o-nada aunque se corte la conexion a mitad de camino.
//
// NOMBRES EN LA INTERFAZ: la tabla `furnis` se muestra como "Mercadillo" (tus furnis con
// su precio de venta) y la tabla `compras` como "Inventario" (tus lotes comprados).
//
// VALIDACION DE NOMBRES: si el catalogo de Habbo.es esta disponible, un furni nuevo debe
// existir en el (se guarda el nombre oficial exacto + classname para el icono). Sin
// catalogo (sin internet en el primer arranque) se acepta el nombre tal cual.

const crypto = require('crypto');
const { ClientError, monedaDesdeTexto, numeroValido, hoyStr, normalizar } = require('../core/util');
const { calcularResumen } = require('../core/calculos');
const { datos, todas } = require('../db/respuestas');

function crearServicioNegocio({ conexion, furnidata }) {
  const db = () => conexion.clienteListo();

  // ── Config ────────────────────────────────────────────────────────────────
  async function tasa() {
    const r = await datos(db().from('v_tasa').select('tasa').single());
    return Number(r.tasa);
  }

  async function fijarTasa(valor) {
    const n = numeroValido(valor, { campo: 'La tasa del Lingo', minimo: 0.0001 });
    await datos(db().from('config').upsert({ clave: 'tasa_lingo', valor: String(n) }, { onConflict: 'propietario,clave' }));
    return n;
  }

  // ── Lecturas ──────────────────────────────────────────────────────────────
  function listarFurnis() {
    return todas(() => db().from('v_furnis').select('*').order('id'));
  }

  async function furniPorId(id) {
    const f = await datos(db().from('v_furnis').select('*').eq('id', Number(id)).maybeSingle());
    if (!f) throw new ClientError('Ese furni no existe.', 404);
    return f;
  }

  function listarCompras({ pendientes } = {}) {
    return pendientes
      ? todas(() => db().from('v_compras').select('*').eq('estado', 'comprado').eq('pendiente', true).order('id', { ascending: false }))
      : todas(() => db().from('v_compras').select('*').order('id'));
  }

  async function compraPorId(id) {
    const c = await datos(db().from('v_compras').select('*').eq('id', Number(id)).maybeSingle());
    if (!c) throw new ClientError('Ese lote no existe.', 404);
    return c;
  }

  async function resumen() {
    const [compras, furnis, t] = await Promise.all([listarCompras(), listarFurnis(), tasa()]);
    return calcularResumen({ compras, furnis, tasa: t });
  }

  // ── Resolucion de nombres contra el catalogo oficial ─────────────────────
  function resolverNombre({ nombre, classname }) {
    const disponible = furnidata && furnidata.estado().disponible;
    if (classname) {
      const oficial = disponible ? furnidata.porClase(classname) : null;
      if (oficial) return { nombre: oficial.nombre, classname: oficial.classname, revision: oficial.revision, sprite_id: oficial.sprite_id, tipo: oficial.tipo };
      if (disponible) throw new ClientError(`El classname "${classname}" no existe en el catalogo de Habbo.es.`);
    }
    const limpio = String(nombre || '').trim();
    if (!limpio) throw new ClientError('Falta el nombre del furni.');
    if (!disponible) return { nombre: limpio, classname: null, revision: null };

    const r = furnidata.coincidencia(limpio);
    if (r.tipo === 'exacta') return { nombre: r.furni.nombre, classname: r.furni.classname, revision: r.furni.revision, sprite_id: r.furni.sprite_id, tipo: r.furni.tipo };
    const opciones = (r.furni ? [r.furni] : r.sugerencias).map((s) => `"${s.nombre}"`).join(', ');
    throw new ClientError(
      `"${limpio}" no es un nombre oficial de Habbo.es.` + (opciones ? ` ¿Quisiste decir ${opciones}?` : ''), 422);
  }

  // Furni ya registrado con ese nombre (sin distinguir mayusculas) o con ese classname.
  async function buscarFurni({ nombre, classname }) {
    const lista = await todas(() => db().from('furnis').select('id,nombre,classname').order('id'));
    if (classname) {
      const f = lista.find((x) => x.classname === classname);
      if (f) return f;
    }
    const n = normalizar(nombre);
    return n ? lista.find((x) => normalizar(x.nombre) === n) || null : null;
  }

  // ── Furnis (vista MERCADILLO) ─────────────────────────────────────────────
  async function crearFurni(entrada, { sinValidar = false } = {}) {
    const oficial = sinValidar
      ? { nombre: String(entrada.nombre || '').trim(), classname: entrada.classname || null, revision: entrada.revision || null }
      : resolverNombre(entrada);
    if (!oficial.nombre) throw new ClientError('Falta el nombre del furni.');
    const fila = await datos(db().from('furnis').insert({
      nombre: oficial.nombre,
      classname: oficial.classname,
      revision: oficial.revision,
      sprite_id: oficial.sprite_id ?? null,
      tipo: oficial.tipo || 'suelo',
      notas: entrada.notas || null,
    }).select('id').single());
    return furniPorId(fila.id);
  }

  async function actualizarFurni(id, cambios) {
    const actual = await furniPorId(id);
    const campos = {};
    if ('nombre' in cambios || 'classname' in cambios) {
      Object.assign(campos, resolverNombre({ nombre: cambios.nombre ?? actual.nombre, classname: cambios.classname }));
    }
    if ('notas' in cambios) campos.notas = cambios.notas || null;
    if (!Object.keys(campos).length) return actual;
    await datos(db().from('furnis').update(campos).eq('id', Number(id)).select('id'));
    return furniPorId(id);
  }

  async function eliminarFurni(id) {
    const f = await furniPorId(id);
    const lotes = await datos(db().from('compras').select('id').eq('furni_id', Number(id)));
    if (lotes.length) throw new ClientError(`"${f.nombre}" tiene ${lotes.length} lote(s) en el Inventario. Eliminalos primero.`, 409);
    await datos(db().from('furnis').delete().eq('id', Number(id)));
    return { ok: true };
  }

  // ── Compras (vista INVENTARIO) ────────────────────────────────────────────
  // La app se actualiza sola, pero la migracion 20261007000000 la ejecuta el usuario
  // a mano: hasta entonces crear_compra y vender_en_mano no conocen p_keko, p_sprite_id
  // ni p_tipo, y Supabase rechaza la llamada entera. Esos parametros van solo si traen
  // valor, y si la base no los conoce se reintenta sin ellos.
  const PARAMETROS_1_1 = ['p_keko', 'p_sprite_id', 'p_tipo'];

  async function rpcCompatible(nombre, args) {
    const conValor = { ...args };
    for (const k of PARAMETROS_1_1) if (conValor[k] === null || conValor[k] === undefined) delete conValor[k];
    try {
      return await datos(db().rpc(nombre, conValor));
    } catch (e) {
      if (!faltaMigracion(e) || !PARAMETROS_1_1.some((k) => k in conValor)) throw e;
      for (const k of PARAMETROS_1_1) delete conValor[k];
      return datos(db().rpc(nombre, conValor));
    }
  }

  // Nombre de un keko de Habbo (donde estan las unidades). null si viene vacio.
  function nombreKeko(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (s.length > 60) throw new ClientError('El nombre del keko admite hasta 60 caracteres.');
    return s;
  }

  // Numero de serie de un LTD: 45, "45" o "#45". null si viene vacio.
  function numeroLtd(v) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const s = String(v).trim().replace(/^#\s*/, '');
    if (!/^[0-9]{1,9}$/.test(s) || Number(s) < 1) throw new ClientError('El numero LTD debe ser un entero mayor que 0 (p. ej. 45 o #45).');
    return Number(s);
  }

  async function crearCompra(entrada) {
    const args = {
      p_cantidad: numeroValido(entrada.cantidad ?? 1, { campo: 'La cantidad', minimo: 1, entero: true }),
      p_moneda: monedaDesdeTexto(entrada.moneda_compra),
      p_precio: numeroValido(entrada.precio_compra, { campo: 'El precio de compra' }),
      p_fecha: entrada.fecha_compra || hoyStr(),
      p_notas: entrada.notas || null,
      p_numero_ltd: numeroLtd(entrada.numero_ltd),
      p_keko: nombreKeko(entrada.keko),
    };
    if (entrada.furni_id) {
      args.p_furni_id = Number(entrada.furni_id);
    } else {
      const existente = await buscarFurni(entrada);
      if (existente) args.p_furni_id = existente.id;
      else {
        // Con sprite y tipo del catalogo, la auditoria del inventario lo reconoce.
        const oficial = resolverNombre(entrada);
        Object.assign(args, { p_nombre: oficial.nombre, p_classname: oficial.classname, p_revision: oficial.revision,
          p_sprite_id: oficial.sprite_id ?? null, p_tipo: oficial.tipo || null });
      }
    }
    const r = await rpcCompatible('crear_compra', args);
    return compraPorId(r.compra_id);
  }

  // Un lote publicado esta en el mercadillo de Habbo: no se edita ni se borra. Si lo
  // publico el Sniper, el Sniper lo mueve (publicar / recuperar); si lo publicaste tu,
  // lo retiras con retirarLote. En los dos casos se registra su venta cuando se vende.
  function exigirNoPublicado(lote) {
    if (lote.estado === 'publicado') {
      throw new ClientError(lote.publicado_por === 'manual'
        ? 'Ese lote esta publicado en el mercadillo. Retíralo primero si quieres cambiarlo.'
        : 'Ese lote esta publicado en el mercadillo: su stock lo controla el Sniper. Solo puedes registrar su venta.', 409);
    }
  }

  async function actualizarCompra(id, cambios) {
    const actual = await compraPorId(id);
    exigirNoPublicado(actual);
    const campos = {};
    if ('furni_id' in cambios) campos.furni_id = (await furniPorId(cambios.furni_id)).id;
    if ('cantidad' in cambios) campos.cantidad = numeroValido(cambios.cantidad, { campo: 'La cantidad', minimo: 1, entero: true });
    if ('moneda_compra' in cambios) campos.moneda_compra = monedaDesdeTexto(cambios.moneda_compra);
    if ('precio_compra' in cambios) campos.precio_compra = numeroValido(cambios.precio_compra, { campo: 'El precio de compra' });
    if ('fecha_compra' in cambios) campos.fecha_compra = cambios.fecha_compra || null;
    if ('notas' in cambios) campos.notas = cambios.notas || null;
    if (actual.estado === 'vendido') {
      if ('moneda_venta' in cambios) campos.moneda_venta = monedaDesdeTexto(cambios.moneda_venta);
      if ('precio_venta' in cambios) campos.precio_venta = numeroValido(cambios.precio_venta, { campo: 'El precio de venta' });
      if ('fecha_venta' in cambios) campos.fecha_venta = cambios.fecha_venta || null;
    }
    if (!Object.keys(campos).length) return actual;
    await datos(db().from('compras').update(campos).eq('id', Number(id)).select('id'));
    return compraPorId(id);
  }

  async function eliminarCompra(id) {
    exigirNoPublicado(await compraPorId(id));
    const borradas = await datos(db().from('compras').delete().eq('id', Number(id)).select('id'));
    if (!borradas.length) throw new ClientError('Ese lote no existe.', 404);
    return { ok: true };
  }

  // Vende `cantidad` unidades de un lote (todo el lote si no se indica). Si es una
  // parte, el lote se divide dentro de Postgres (funcion vender_lote).
  async function vender(id, entrada = {}) {
    const r = await datos(db().rpc('vender_lote', {
      p_id: Number(id),
      p_cantidad: entrada.cantidad === undefined || entrada.cantidad === null || entrada.cantidad === ''
        ? null : numeroValido(entrada.cantidad, { campo: 'La cantidad a vender', minimo: 1, entero: true }),
      p_moneda: entrada.moneda_venta ? monedaDesdeTexto(entrada.moneda_venta) : null,
      p_precio: numeroValido(entrada.precio_venta, { campo: 'El precio de venta', opcional: true }),
      p_fecha: entrada.fecha_venta || hoyStr(),
    }));
    return {
      dividida: r.dividida,
      original: r.original_id ? await compraPorId(r.original_id) : null,
      venta: await compraPorId(r.venta_id),
    };
  }

  async function revertirVenta(id) {
    const r = await datos(db().rpc('revertir_venta', { p_id: Number(id) }));
    return { fusionada: r.fusionada, compra: await compraPorId(r.compra_id) };
  }

  // Publicar a mano (lo que pusiste tu en el mercadillo, p. ej. lo que venia del Excel):
  // todo el lote o una parte, a un precio de lista en creditos (funcion publicar_lote).
  async function publicarLote(id, entrada = {}) {
    const r = await datos(db().rpc('publicar_lote', {
      p_id: Number(id),
      p_cantidad: entrada.cantidad === undefined || entrada.cantidad === null || entrada.cantidad === ''
        ? null : numeroValido(entrada.cantidad, { campo: 'La cantidad a publicar', minimo: 1, entero: true }),
      p_precio_lista: numeroValido(entrada.precio_lista, { campo: 'El precio de lista', opcional: true }),
    }));
    return {
      dividida: r.dividida,
      original: r.original_id ? await compraPorId(r.original_id) : null,
      publicado: await compraPorId(r.lote_id),
    };
  }

  // Publicar, vender y retirar un furni desde UN keko (el bloque del Inventario o del
  // Mercadillo donde se pulso): { keko } = solo los lotes de ese keko, { sin_keko: true } =
  // solo los que no tienen. Sin nada, todos los lotes del furni, como antes.
  function ambitoKeko(entrada) {
    if (entrada.sin_keko === true) return { p_sin_keko: true };
    const keko = nombreKeko(entrada.keko);
    return keko ? { p_keko: keko } : {};
  }
  const MIGRACION_POR_KEKO = 'Para actuar solo sobre un keko instala la migración 20261014000000_inventario_por_keko.sql en tu Supabase (aviso ámbar de arriba).';

  // Sin la migracion 20261014000000 la base no conoce p_keko ni p_sin_keko. Si ese furni no
  // tiene lotes de otros kekos en ese estado, da lo mismo y se llama sin el ambito; si los
  // tiene, se niega: sin el ambito tocaria unidades de otro keko.
  async function rpcConAmbito(nombre, args, ambito, { furniId, estado, soloManual }) {
    if (!Object.keys(ambito).length) return datos(db().rpc(nombre, args));
    try {
      return await datos(db().rpc(nombre, { ...args, ...ambito }));
    } catch (e) {
      if (!faltaMigracion(e)) throw e;
      let consulta = db().from('compras').select('keko').eq('furni_id', furniId).eq('estado', estado);
      if (estado === 'comprado') consulta = consulta.eq('pendiente', false);
      if (soloManual) consulta = consulta.eq('publicado_por', 'manual');
      const ajenos = (await datos(consulta)).filter((l) => (ambito.p_sin_keko
        ? l.keko !== null && l.keko !== undefined
        : String(l.keko || '').toLowerCase() !== ambito.p_keko.toLowerCase()));
      if (ajenos.length) throw new ClientError(MIGRACION_POR_KEKO, 428);
      return datos(db().rpc(nombre, args));
    }
  }

  // Publicar a mano un furni completo: toma sus unidades en mano (de todos sus lotes o de
  // los de un keko), del mas antiguo al mas nuevo (funcion publicar_furni). Sin cantidad,
  // publica todas.
  async function publicarFurni(id, entrada = {}) {
    const r = await rpcConAmbito('publicar_furni', {
      p_furni_id: Number(id),
      p_cantidad: entrada.cantidad === undefined || entrada.cantidad === null || entrada.cantidad === ''
        ? null : numeroValido(entrada.cantidad, { campo: 'La cantidad a publicar', minimo: 1, entero: true }),
      p_precio_lista: numeroValido(entrada.precio_lista, { campo: 'El precio de lista', opcional: true }),
    }, ambitoKeko(entrada), { furniId: Number(id), estado: 'comprado' });
    return { cantidad: r.cantidad, en_mano: r.en_mano, precio_lista: r.precio_lista, lotes: r.lotes };
  }

  // Desde el Mercadillo (por furni, dentro del bloque de un keko). Venta de N unidades
  // publicadas, FIFO; con precio_lista, solo de los lotes publicados a ese precio (funcion
  // vender_furni). Lo que se guarda es el neto: vender_lote descuenta la comision.
  async function venderFurni(id, entrada = {}) {
    const r = await rpcConAmbito('vender_furni', {
      p_furni_id: Number(id),
      p_cantidad: numeroValido(entrada.cantidad, { campo: 'La cantidad vendida', minimo: 1, entero: true }),
      p_precio: numeroValido(entrada.precio_venta, { campo: 'El precio de venta', opcional: true }),
      p_fecha: entrada.fecha_venta || hoyStr(),
      p_precio_lista: numeroValido(entrada.precio_lista, { campo: 'El precio de lista', opcional: true }),
    }, ambitoKeko(entrada), { furniId: Number(id), estado: 'publicado' });
    return { cantidad: r.cantidad, ventas: r.ventas };
  }

  // Retira N unidades que publicaste tu de un furni (todas si no se indica; de todos sus
  // lotes o de los de un keko), FIFO; con precio_lista, solo las de ese precio (funcion
  // retirar_furni).
  async function retirarFurni(id, entrada = {}) {
    const r = await rpcConAmbito('retirar_furni', {
      p_furni_id: Number(id),
      p_cantidad: entrada.cantidad === undefined || entrada.cantidad === null || entrada.cantidad === ''
        ? null : numeroValido(entrada.cantidad, { campo: 'La cantidad a retirar', minimo: 1, entero: true }),
      p_precio_lista: numeroValido(entrada.precio_lista, { campo: 'El precio de lista', opcional: true }),
    }, ambitoKeko(entrada), { furniId: Number(id), estado: 'publicado', soloManual: true });
    return { cantidad: r.cantidad, lotes: r.lotes };
  }

  // Venta manual de lo que tienes en mano (tradeo, o venta desde un keko sin Sniper):
  // de un lote o FIFO entre los lotes en mano del furni. En el mercadillo se guarda el
  // neto y la comision; en un tradeo, el precio tal cual (funcion vender_en_mano).
  async function venderEnMano(id, entrada = {}) {
    const r = await rpcCompatible('vender_en_mano', {
      p_furni_id: Number(id),
      p_cantidad: numeroValido(entrada.cantidad, { campo: 'La cantidad vendida', minimo: 1, entero: true }),
      p_precio: numeroValido(entrada.precio, { campo: 'El precio de venta' }),
      p_moneda: entrada.moneda ? monedaDesdeTexto(entrada.moneda) : 'creditos',
      p_mercadillo: entrada.mercadillo === true,
      p_fecha: entrada.fecha || hoyStr(),
      p_lote_id: entrada.lote_id ? Number(entrada.lote_id) : null,
      p_keko: nombreKeko(entrada.keko),
    });
    return { cantidad: r.cantidad, precio_neto: r.precio_neto, comision: r.comision, moneda: r.moneda, ventas: r.ventas };
  }

  // Pone, cambia o quita (null) el numero LTD de un lote. Un lote de varias unidades en
  // mano separa una unidad con ese numero (funcion asignar_ltd).
  async function asignarLtd(id, numero) {
    const r = await datos(db().rpc('asignar_ltd', { p_id: Number(id), p_numero: numeroLtd(numero) }));
    return { separado: r.separado, lote: await compraPorId(r.lote_id) };
  }

  // Deshace una publicacion manual: el lote vuelve a "comprado" (funcion retirar_lote).
  async function retirarLote(id) {
    const r = await datos(db().rpc('retirar_lote', { p_id: Number(id) }));
    return { fusionada: r.fusionada, compra: await compraPorId(r.compra_id) };
  }

  // ── Lotes huerfanos (llegados del Sniper, pendientes de activar) ──────────
  // Agrupados por furni. "Confirmar" los pasa a en mano (sin precio: el precio se pone
  // al publicar o al vender).
  async function pendientesPorFurni() {
    const lotes = await listarCompras({ pendientes: true });
    if (!lotes.length) return [];
    const ids = [...new Set(lotes.map((l) => l.furni_id))];
    const furnis = await datos(db().from('v_furnis').select('*').in('id', ids));
    const porId = new Map(furnis.map((f) => [f.id, f]));
    const grupos = new Map();
    for (const l of lotes) {
      const f = porId.get(l.furni_id);
      if (!grupos.has(l.furni_id)) {
        grupos.set(l.furni_id, {
          furni: {
            id: f.id, nombre: f.nombre, classname: f.classname, revision: f.revision,
            // Nuevo: todo lo que se compro de este furni es lo que acaba de llegar.
            nuevo: f.unidades_compradas === f.unidades_pendientes,
          },
          lotes: [], unidades: 0, costo_cr: 0, recibido_en: null, instancias: [],
        });
      }
      const g = grupos.get(l.furni_id);
      g.lotes.push(l);
      g.unidades += l.cantidad;
      g.costo_cr += l.costo_total_cr;
      if (l.instancia && !g.instancias.includes(l.instancia)) g.instancias.push(l.instancia);
      if (!g.recibido_en || l.creado_en > g.recibido_en) g.recibido_en = l.creado_en;
    }
    return [...grupos.values()].sort((a, b) => String(b.recibido_en).localeCompare(String(a.recibido_en)));
  }

  // Confirma lo "por revisar" de un furni (todo, o los lotes indicados): pasa a en mano.
  async function activarPendientes({ furni_id, compra_ids } = {}) {
    const ids = Array.isArray(compra_ids) && compra_ids.length ? compra_ids.map(Number) : null;
    const r = await datos(db().rpc('activar_pendientes', {
      p_furni_id: furni_id ? Number(furni_id) : null,
      p_compra_ids: ids,
    }));
    return { activados: r.activados, furni: await furniPorId(r.furni_id) };
  }

  // ── Importacion del Excel (una sola transaccion en Postgres) ──────────────
  function importarExcel({ tasa: t, furnis, compras, reemplazar }) {
    return datos(db().rpc('importar_excel', {
      p_tasa: t || null, p_furnis: furnis, p_compras: compras, p_reemplazar: !!reemplazar,
    }));
  }

  // ── Tokens de los SniperMercadillo ────────────────────────────────────────
  // El token se genera aca y se muestra UNA vez; en Supabase solo queda su huella
  // SHA-256, que es contra lo que comparan registrar_eventos_sniper y estado_sniper.
  // `keko` (el que aprendio cada sniper al enviar su inventario) llega con la migracion
  // 20261007000000; sin ella la columna no existe y se listan sin keko.
  const COLUMNAS_TOKEN = 'id,nombre,prefijo,creado_en,ultimo_uso,revocado';
  async function listarTokens() {
    const leer = (columnas) => datos(db().from('tokens_sniper').select(columnas).order('creado_en', { ascending: false }));
    try {
      return await leer(COLUMNAS_TOKEN + ',keko');
    } catch (e) {
      if (!faltaMigracion(e)) throw e;
      return leer(COLUMNAS_TOKEN);
    }
  }

  async function crearToken(nombre) {
    const limpio = String(nombre || '').trim().slice(0, 60);
    if (!limpio) throw new ClientError('Ponle un nombre al token (p. ej. "VPS 1").');
    const token = 'hbi_' + crypto.randomBytes(32).toString('base64url');
    const fila = await datos(db().from('tokens_sniper').insert({
      nombre: limpio,
      hash: crypto.createHash('sha256').update(token, 'utf8').digest('hex'),
      prefijo: token.slice(0, 12),
    }).select(COLUMNAS_TOKEN).single());
    return { ...fila, token };
  }

  async function revocarToken(id) {
    const r = await datos(db().from('tokens_sniper').update({ revocado: true }).eq('id', Number(id)).select('id'));
    if (!r.length) throw new ClientError('Ese token no existe.', 404);
    return { ok: true };
  }

  // Eliminar de verdad (no solo marcar) un token YA revocado, o todos los revocados, para
  // limpiar la tabla de Ajustes. Uno activo nunca: primero se revoca.
  //   - Borrado simple: lo que envio ese sniper se conserva (sus eventos y la foto de su
  //     keko quedan sin token: la base los deja en null) y su keko sigue en la lista.
  //   - Limpieza profunda (`limpieza: true`, migracion 20261012000000): ademas se borran
  //     todos los datos de su keko (lotes en mano, publicados y vendidos, la foto, las
  //     exclusiones) y el historial de eventos de esos tokens, en UNA transaccion que se
  //     niega si el keko tiene un token activo (su Sniper sigue gestionando ese inventario).
  const MIGRACION_LIMPIEZA = 'Para la limpieza profunda instala la migración 20261012000000_limpieza_tokens.sql en tu Supabase (aviso ámbar de arriba).';
  function idsTokens(ids) {
    const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (!lista.length) throw new ClientError('Indica al menos un token.');
    return lista;
  }

  // Lo que borraria la limpieza profunda (para el modal), o { disponible: false } sin la migracion.
  async function vistaLimpieza(ids) {
    try {
      return { disponible: true, ...(await datos(db().rpc('vista_limpieza_tokens', { p_ids: idsTokens(ids) }))) };
    } catch (e) {
      if (faltaMigracion(e)) return { disponible: false };
      throw e;
    }
  }

  async function limpiarTokens(ids) {
    try {
      return await datos(db().rpc('eliminar_tokens_sniper', { p_ids: idsTokens(ids), p_limpieza: true }));
    } catch (e) {
      if (faltaMigracion(e)) throw new ClientError(MIGRACION_LIMPIEZA, 428);
      throw e;
    }
  }

  async function borrarToken(id, { limpieza = false } = {}) {
    if (limpieza) return limpiarTokens([id]);
    const r = await datos(db().from('tokens_sniper').delete().eq('id', Number(id)).eq('revocado', true).select('id'));
    if (r.length) return { borrados: 1 };
    const existe = await datos(db().from('tokens_sniper').select('id').eq('id', Number(id)));
    if (existe.length) throw new ClientError('Solo se eliminan los tokens revocados: revócalo primero.', 409);
    throw new ClientError('Ese token no existe.', 404);
  }

  async function borrarTokensRevocados({ limpieza = false } = {}) {
    if (limpieza) {
      const revocados = await datos(db().from('tokens_sniper').select('id').eq('revocado', true));
      return revocados.length ? limpiarTokens(revocados.map((t) => t.id)) : { borrados: 0 };
    }
    const r = await datos(db().from('tokens_sniper').delete().eq('revocado', true).select('id'));
    return { borrados: r.length };
  }

  // ── Kekos: los de los snipers (se detectan solos) y los manuales ──────────
  // Un keko manual es una cuenta sin Sniper (una bodega): nunca envia su inventario, asi
  // que nunca se audita. Llega con la migracion 20261008000000; sin ella no hay lista y
  // «+ Compra» y «Venta» funcionan como antes (sin keko).
  async function listarKekos() {
    try {
      return { disponible: true, kekos: await datos(db().rpc('listar_kekos')) };
    } catch (e) {
      if (faltaMigracion(e)) return { disponible: false, kekos: [] };
      throw e;
    }
  }

  function crearKeko(nombre) {
    return datos(db().rpc('crear_keko', { p_nombre: String(nombre || '').trim() }));
  }

  function renombrarKeko(id, nombre) {
    return datos(db().rpc('renombrar_keko', { p_id: Number(id), p_nombre: String(nombre || '').trim() }));
  }

  function borrarKeko(id) {
    return datos(db().rpc('borrar_keko', { p_id: Number(id) }));
  }

  // Pasa a un keko las unidades en mano SIN keko de los furnis elegidos (una transaccion).
  async function asignarSinKeko({ hacia, items } = {}) {
    const lista = Array.isArray(items) ? items : [];
    const limpios = lista.map((x) => ({ furni_id: Number(x && x.furni_id), cantidad: Number(x && x.cantidad) }));
    if (!limpios.length) throw new ClientError('Marca al menos un furni para asignar.');
    if (limpios.some((x) => !Number.isInteger(x.furni_id) || !Number.isInteger(x.cantidad) || x.cantidad < 1)) {
      throw new ClientError('Cada furni necesita una cantidad entera mayor que 0.');
    }
    return datos(db().rpc('asignar_sin_keko', { p_hacia: nombreKeko(hacia), p_items: limpios }));
  }

  // Sincroniza tus furnis con el catalogo de Habbo.es (corre al iniciar sesion, al
  // refrescar el catalogo y cada vez que llegan eventos del Sniper):
  //  - completa sprite_id + tipo de los furnis con classname (el Sniper los identifica
  //    por sprite_id; sin esto no podria publicarlos ni recuperarlos);
  //  - pone nombre oficial a los furnis PROVISIONALES que el Sniper creo solo con un
  //    sprite_id ("Sprite 4623 (suelo)"), o los une al furni que ya tenias;
  //  - actualiza la revision (ruta del icono) y vincula por nombre los que no tenian classname.
  async function sincronizarConCatalogo() {
    if (!furnidata || !furnidata.estado().disponible) return { actualizados: 0, vinculados: 0, sprites: 0, unidos: 0 };
    let actualizados = 0;
    let vinculados = 0;
    let sprites = 0;
    let unidos = 0;
    let lista = await todas(() => db().from('furnis').select('id,nombre,classname,revision,sprite_id,tipo').order('id'));

    // Provisionales creados por el Sniper: sprite_id sin classname.
    for (const f of lista.filter((x) => !x.classname && x.sprite_id !== null)) {
      const of = furnidata.porSpriteId(f.sprite_id, f.tipo);
      if (!of) continue;
      const real = lista.find((x) => x.id !== f.id && (x.classname === of.classname || normalizar(x.nombre) === normalizar(of.nombre)));
      if (real) {
        await datos(db().rpc('fusionar_furnis', { p_origen: f.id, p_destino: real.id }));
        unidos++;
      } else {
        await datos(db().from('furnis').update({ nombre: of.nombre, classname: of.classname, revision: of.revision }).eq('id', f.id));
        vinculados++;
      }
    }
    if (unidos || vinculados) lista = await todas(() => db().from('furnis').select('id,nombre,classname,revision,sprite_id,tipo').order('id'));

    for (const f of lista) {
      if (f.classname) {
        const of = furnidata.porClase(f.classname);
        const cambios = {};
        if (of && of.revision && of.revision !== f.revision) { cambios.revision = of.revision; actualizados++; }
        if (of && of.sprite_id !== null && f.sprite_id === null) { cambios.sprite_id = of.sprite_id; cambios.tipo = of.tipo; sprites++; }
        if (Object.keys(cambios).length) await datos(db().from('furnis').update(cambios).eq('id', f.id));
      } else if (f.sprite_id === null) {
        const r = furnidata.coincidencia(f.nombre);
        if (r.tipo === 'exacta') {
          try {
            await datos(db().from('furnis').update({ nombre: r.furni.nombre, classname: r.furni.classname, revision: r.furni.revision, sprite_id: r.furni.sprite_id, tipo: r.furni.tipo }).eq('id', f.id));
            vinculados++;
          } catch (_) { /* otro furni ya usa ese nombre oficial: se deja como esta */ }
        }
      }
    }
    return { actualizados, vinculados, sprites, unidos };
  }

  // ── Auditoria del inventario de Habbo (conciliacion por keko) ────────────
  // Cada sniper envia el inventario de su keko (auditar_inventario); aqui se compara en
  // vivo con lo que esta en mano en ese keko y se resuelven las diferencias. Sin la
  // migracion 20261007000000 esas funciones no existen: el resumen responde vacio (el
  // aviso de migraciones ya pide instalarla) y la vista explica que falta.
  // db/respuestas.js marca con SIN_ESQUEMA una funcion o tabla que no existe.
  function faltaMigracion(e) {
    return Boolean(e && e.codigo === 'SIN_ESQUEMA');
  }

  // Nombre e icono del catalogo para los furnis que la app no tiene registrados.
  function conCatalogo(fila) {
    const it = furnidata && fila.sprite_id !== null ? furnidata.porSpriteId(fila.sprite_id, fila.tipo) : null;
    return it ? { ...fila, catalogo: { nombre: it.nombre, classname: it.classname, revision: it.revision } } : fila;
  }

  async function auditoria(keko) {
    let r;
    try {
      r = await datos(db().rpc('auditoria_inventario', { p_keko: nombreKeko(keko) }));
    } catch (e) {
      if (faltaMigracion(e)) {
        throw new ClientError('Falta instalar la migracion 20261007000000_auditoria_inventario.sql en tu Supabase (usa el aviso de la app).', 428);
      }
      throw e;
    }
    return { ...r, filas: (r.filas || []).map(conCatalogo), excluidos: (r.excluidos || []).map(conCatalogo) };
  }

  async function resumenAuditoria() {
    try {
      return await datos(db().rpc('resumen_auditoria'));
    } catch (e) {
      if (faltaMigracion(e)) return { pendientes: 0, kekos: [], sin_migracion: true };
      throw e;
    }
  }

  function lotesDe(v) {
    if (!Array.isArray(v) || !v.length) return null;
    return v.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
  }

  function moverAKeko(entrada) {
    return datos(db().rpc('mover_a_keko', {
      p_furni_id: Number(entrada.furni_id),
      p_cantidad: numeroValido(entrada.cantidad, { campo: 'La cantidad', minimo: 1, entero: true }),
      p_desde: nombreKeko(entrada.desde),
      p_hacia: nombreKeko(entrada.hacia),
      p_lote_ids: lotesDe(entrada.lote_ids),
    }));
  }

  function darDeBaja(entrada) {
    return datos(db().rpc('dar_de_baja', {
      p_furni_id: Number(entrada.furni_id),
      p_cantidad: numeroValido(entrada.cantidad, { campo: 'La cantidad', minimo: 1, entero: true }),
      p_keko: nombreKeko(entrada.keko),
      p_lote_ids: lotesDe(entrada.lote_ids),
    }));
  }

  // «Quitar de la auditoria» de uno o varios furnis (con 0 unidades vuelve a incluirlos).
  async function excluirDeAuditoria(entrada) {
    const keko = nombreKeko(entrada.keko);
    const items = Array.isArray(entrada.items) ? entrada.items : [entrada];
    for (const it of items) {
      await datos(db().rpc('excluir_de_auditoria', {
        p_keko: keko,
        p_sprite_id: Number(it.sprite_id),
        p_tipo: it.tipo === 'pared' ? 'pared' : 'suelo',
        p_unidades: Number(it.unidades) || 0,
        p_habbo: Number.isFinite(Number(it.habbo)) ? Number(it.habbo) : null,
        p_app: Number.isFinite(Number(it.app)) ? Number(it.app) : null,
      }));
    }
    return { excluidos: items.length };
  }

  // Entrada con costo: de un furni ya registrado, o de uno que la app no conocia (se
  // crea con el nombre oficial y su sprite, para que la auditoria lo reconozca).
  async function entradaAuditoria(entrada) {
    const base = { cantidad: entrada.cantidad, precio_compra: entrada.precio, moneda_compra: entrada.moneda,
                   keko: entrada.keko, numero_ltd: entrada.numero_ltd,
                   notas: entrada.notas || 'Entrada por auditoria del inventario' };
    if (entrada.furni_id) return crearCompra({ ...base, furni_id: entrada.furni_id });
    const sprite = Number(entrada.sprite_id);
    const tipo = entrada.tipo === 'pared' ? 'pared' : 'suelo';
    if (!Number.isInteger(sprite) || sprite < 1) throw new ClientError('Falta el sprite del furni.');
    const it = furnidata ? furnidata.porSpriteId(sprite, tipo) : null;
    const r = await datos(db().rpc('crear_compra', {
      p_nombre: it ? it.nombre : 'Sprite ' + sprite + ' (' + tipo + ')',
      p_classname: it ? it.classname : null,
      p_revision: it ? it.revision : null,
      p_sprite_id: sprite,
      p_tipo: tipo,
      p_cantidad: numeroValido(base.cantidad ?? 1, { campo: 'La cantidad', minimo: 1, entero: true }),
      p_moneda: monedaDesdeTexto(base.moneda_compra),
      p_precio: numeroValido(base.precio_compra, { campo: 'El precio de compra' }),
      p_fecha: hoyStr(),
      p_notas: base.notas,
      p_numero_ltd: numeroLtd(base.numero_ltd),
      p_keko: nombreKeko(base.keko),
    }));
    return compraPorId(r.compra_id);
  }

  return {
    tasa, fijarTasa, resumen,
    listarFurnis, furniPorId, crearFurni, actualizarFurni, eliminarFurni,
    listarCompras, compraPorId, crearCompra, actualizarCompra, eliminarCompra,
    vender, revertirVenta, asignarLtd, publicarLote, publicarFurni, venderFurni, venderEnMano, retirarFurni, retirarLote, pendientesPorFurni, activarPendientes,
    importarExcel, listarTokens, crearToken, revocarToken, borrarToken, borrarTokensRevocados, vistaLimpieza,
    listarKekos, crearKeko, renombrarKeko, borrarKeko, asignarSinKeko,
    resolverNombre, sincronizarConCatalogo,
    auditoria, resumenAuditoria, moverAKeko, darDeBaja, excluirDeAuditoria, entradaAuditoria,
  };
}

module.exports = { crearServicioNegocio };
