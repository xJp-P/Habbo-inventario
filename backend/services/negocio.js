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
      moneda_venta: monedaDesdeTexto(entrada.moneda_venta),
      precio_venta: numeroValido(entrada.precio_venta, { campo: 'El precio de venta', opcional: true }),
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
    if ('moneda_venta' in cambios) campos.moneda_venta = monedaDesdeTexto(cambios.moneda_venta);
    if ('precio_venta' in cambios) campos.precio_venta = numeroValido(cambios.precio_venta, { campo: 'El precio de venta', opcional: true });
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
  async function crearCompra(entrada) {
    const args = {
      p_cantidad: numeroValido(entrada.cantidad ?? 1, { campo: 'La cantidad', minimo: 1, entero: true }),
      p_moneda: monedaDesdeTexto(entrada.moneda_compra),
      p_precio: numeroValido(entrada.precio_compra, { campo: 'El precio de compra' }),
      p_fecha: entrada.fecha_compra || hoyStr(),
      p_notas: entrada.notas || null,
    };
    if (entrada.furni_id) {
      args.p_furni_id = Number(entrada.furni_id);
    } else {
      const existente = await buscarFurni(entrada);
      if (existente) args.p_furni_id = existente.id;
      else {
        const oficial = resolverNombre(entrada);
        Object.assign(args, { p_nombre: oficial.nombre, p_classname: oficial.classname, p_revision: oficial.revision });
      }
    }
    const r = await datos(db().rpc('crear_compra', args));
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

  // Publicar a mano un furni completo: toma sus unidades en mano de todos sus lotes, del
  // mas antiguo al mas nuevo (funcion publicar_furni). Sin cantidad, publica todas.
  async function publicarFurni(id, entrada = {}) {
    const r = await datos(db().rpc('publicar_furni', {
      p_furni_id: Number(id),
      p_cantidad: entrada.cantidad === undefined || entrada.cantidad === null || entrada.cantidad === ''
        ? null : numeroValido(entrada.cantidad, { campo: 'La cantidad a publicar', minimo: 1, entero: true }),
      p_precio_lista: numeroValido(entrada.precio_lista, { campo: 'El precio de lista', opcional: true }),
    }));
    return { cantidad: r.cantidad, en_mano: r.en_mano, precio_lista: r.precio_lista, lotes: r.lotes };
  }

  // Desde el Mercadillo (por furni). Venta de N unidades publicadas, FIFO; con
  // precio_lista, solo de los lotes publicados a ese precio (funcion vender_furni). Lo
  // que se guarda es el neto: vender_lote descuenta la comision.
  async function venderFurni(id, entrada = {}) {
    const r = await datos(db().rpc('vender_furni', {
      p_furni_id: Number(id),
      p_cantidad: numeroValido(entrada.cantidad, { campo: 'La cantidad vendida', minimo: 1, entero: true }),
      p_precio: numeroValido(entrada.precio_venta, { campo: 'El precio de venta', opcional: true }),
      p_fecha: entrada.fecha_venta || hoyStr(),
      p_precio_lista: numeroValido(entrada.precio_lista, { campo: 'El precio de lista', opcional: true }),
    }));
    return { cantidad: r.cantidad, ventas: r.ventas };
  }

  // Retira N unidades que publicaste tu de un furni (todas si no se indica), FIFO;
  // con precio_lista, solo las de ese precio (funcion retirar_furni).
  async function retirarFurni(id, entrada = {}) {
    const r = await datos(db().rpc('retirar_furni', {
      p_furni_id: Number(id),
      p_cantidad: entrada.cantidad === undefined || entrada.cantidad === null || entrada.cantidad === ''
        ? null : numeroValido(entrada.cantidad, { campo: 'La cantidad a retirar', minimo: 1, entero: true }),
      p_precio_lista: numeroValido(entrada.precio_lista, { campo: 'El precio de lista', opcional: true }),
    }));
    return { cantidad: r.cantidad, lotes: r.lotes };
  }

  // Deshace una publicacion manual: el lote vuelve a "comprado" (funcion retirar_lote).
  async function retirarLote(id) {
    const r = await datos(db().rpc('retirar_lote', { p_id: Number(id) }));
    return { fusionada: r.fusionada, compra: await compraPorId(r.compra_id) };
  }

  // ── Lotes huerfanos (llegados del Sniper, pendientes de activar) ──────────
  // Agrupados por furni: un precio por furni activa todos sus lotes.
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
            moneda_venta: f.moneda_venta, precio_venta: f.precio_venta, costo_promedio_cr: f.costo_promedio_cr,
            precio_minimo_cr: f.precio_minimo_cr, stock_activo: f.stock_activo, nuevo: f.stock_activo <= 0 && f.precio_venta === null,
            precio_lista_actual: f.precio_lista_actual, moneda_lista_actual: f.moneda_lista_actual,
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

  async function activarPendientes({ furni_id, compra_ids, precio_venta, moneda_venta } = {}) {
    const ids = Array.isArray(compra_ids) && compra_ids.length ? compra_ids.map(Number) : null;
    const r = await datos(db().rpc('activar_pendientes', {
      p_furni_id: furni_id ? Number(furni_id) : null,
      p_compra_ids: ids,
      p_precio: numeroValido(precio_venta, { campo: 'El precio de venta', opcional: true }),
      p_moneda: moneda_venta ? monedaDesdeTexto(moneda_venta) : null,
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
  // SHA-256, que es contra lo que compara la funcion registrar_compras_sniper.
  function listarTokens() {
    return datos(db().from('tokens_sniper').select('id,nombre,prefijo,creado_en,ultimo_uso,revocado').order('creado_en', { ascending: false }));
  }

  async function crearToken(nombre) {
    const limpio = String(nombre || '').trim().slice(0, 60);
    if (!limpio) throw new ClientError('Ponle un nombre al token (p. ej. "VPS Contabo 1").');
    const token = 'hbi_' + crypto.randomBytes(32).toString('base64url');
    const fila = await datos(db().from('tokens_sniper').insert({
      nombre: limpio,
      hash: crypto.createHash('sha256').update(token, 'utf8').digest('hex'),
      prefijo: token.slice(0, 12),
    }).select('id,nombre,prefijo,creado_en,ultimo_uso,revocado').single());
    return { ...fila, token };
  }

  async function revocarToken(id) {
    const r = await datos(db().from('tokens_sniper').update({ revocado: true }).eq('id', Number(id)).select('id'));
    if (!r.length) throw new ClientError('Ese token no existe.', 404);
    return { ok: true };
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

  return {
    tasa, fijarTasa, resumen,
    listarFurnis, furniPorId, crearFurni, actualizarFurni, eliminarFurni,
    listarCompras, compraPorId, crearCompra, actualizarCompra, eliminarCompra,
    vender, revertirVenta, publicarLote, publicarFurni, venderFurni, retirarFurni, retirarLote, pendientesPorFurni, activarPendientes,
    importarExcel, listarTokens, crearToken, revocarToken,
    resolverNombre, sincronizarConCatalogo,
  };
}

module.exports = { crearServicioNegocio };
