// backend/core/fantasmas.js — los furnis fantasma de antes de la 1.10.0 (v1.10.1). Puro.
//
// Antes de la 1.10.0, lo que caducaba en el Mercadillo volvia a la mano, la Auditoria lo daba
// como sobrante y se registraba con «Entrada con costo»: el lote viejo se quedaba en Publicado,
// caducado, y el mismo furni contaba dos veces. Una oferta REAL que caduco y todavia no se ve de
// vuelta en la mano (o que ya salio de ella) tambien esta caducada y fuera de la mano: por eso no
// basta con «Habbo no la tiene». Hace falta la HUELLA de la duplicacion: una entrada de la
// Auditoria (su nota fija, negocio.entradaAuditoria) del mismo keko y furni, fechada el dia en que
// caduco o despues; en un LTD, otra copia buena con el mismo numero.
//
// Es la MISMA regla que scripts/limpiar-fantasmas/1-revisar.sql (npm run verificar exige filas
// identicas). La unica diferencia es para el aviso: `fantasma` no exige un inventario reciente (el
// aviso no borra nada); `accion`, como el script, si.

const CADUCIDAD_H = 168;                       // = caducidad_mercadillo() y CADUCIDAD_MERCADILLO_H
const NOTA_ENTRADA = 'Entrada por auditoria del inventario';
const INVENTARIO_MAX_MS = 60 * 60000;          // el inventario del keko, de hace menos de esto
const MARGEN_MS = 15 * 60000;                  // la oferta caduco al menos esto antes del inventario
const HUSOS_MS = 14 * 3600000;                 // la fecha de la entrada es la del equipo, no la UTC

const H = 3600000;
const CADUCA_MS = CADUCIDAD_H * H;

function instante(v) { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? null : t; }
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function diaUtc(t) { return new Date(t).toISOString().slice(0, 10); }
function claveFurni(keko, sprite, tipo) { return keko + '\u0000' + sprite + '\u0000' + tipo; }

function caducada(l, ahora) {
  if (l.estado !== 'publicado') return false;
  const t = instante(l.publicado_en);
  return t === null || t <= ahora - CADUCA_MS;
}

// Los mismos textos del script (con tildes: los lee el usuario).
function decidir(g, reciente, ahora) {
  if (g.keko === null) return 'Sin keko: no hay un inventario de Habbo con qué comprobarlo.';
  if (!g.conInventario) return 'Este keko no envía su inventario (keko manual o sin Sniper): no se puede comprobar.';
  if (g.sprite_id === null) return 'Este furni no tiene sprite: no se puede buscar en el inventario de Habbo.';
  if (!reciente) {
    return 'El inventario de este keko es de hace ' + Math.floor((ahora - g.recibido) / 60000)
      + ' min. Mueve un furni en Habbo (o reconecta el Sniper) para que envíe uno nuevo y vuelve a revisar.';
  }
  if (g.comprobables === 0) return 'Caducó después del último inventario: espera a que el Sniper envíe uno nuevo y vuelve a revisar.';
  if (g.numero_ltd === null) {
    if (g.habbo > g.app) return 'En Habbo tienes ' + (g.habbo - g.app) + ' más en la mano que en la app: el próximo inventario lo devuelve solo a Comprado.';
    if (g.entradas === 0) return 'Sin huella: nadie lo volvió a registrar con «Entrada con costo» después de que caducara, así que no se puede asegurar que sea un fantasma: revísalo a mano.';
    if (g.entradas < g.comprobables) return 'Solo ' + g.entradas + ' se volvieron a registrar con «Entrada con costo» y hay ' + g.comprobables + ' caducadas: revísalo a mano.';
    return null;
  }
  if (g.ltdEnHabbo && !g.ltdEnApp) return 'Este LTD está en tu mano en Habbo: el próximo inventario lo devuelve solo a Comprado.';
  if (!g.repetido) return 'No hay otra copia de este LTD en la app: revísalo a mano.';
  return null;
}

// lotes: TODOS los lotes de la cuenta { id, keko, furni_id, cantidad, estado, numero_ltd,
// publicado_en, notas, fecha_compra }; furnis: { id, nombre, sprite_id, tipo }; fotos: el inventario
// de cada keko { keko, recibido_en, furnis: [{ sprite_id, tipo, cantidad, ltds }] }.
// Devuelve una fila por keko y furni (por lote en un LTD) con algo caducado, como el script.
function planFantasmas({ lotes = [], furnis = [], fotos = [], ahora = Date.now() } = {}) {
  const furniDe = new Map(furnis.map((f) => [Number(f.id), f]));
  const datosDe = (l) => {
    const f = furniDe.get(Number(l.furni_id)) || {};
    const sprite = f.sprite_id === null || f.sprite_id === undefined ? null : Number(f.sprite_id);
    return { sprite, tipo: f.tipo || null, nombre: f.nombre || '' };
  };

  const fotoDe = new Map();
  fotos.forEach((fo) => {
    const items = new Map();
    (Array.isArray(fo.furnis) ? fo.furnis : []).forEach((x) => {
      const k = Number(x.sprite_id) + '\u0000' + x.tipo;
      const previo = items.get(k) || { cantidad: 0, ltds: [] };
      items.set(k, { cantidad: previo.cantidad + num(x.cantidad), ltds: previo.ltds.concat((Array.isArray(x.ltds) ? x.ltds : []).map(Number)) });
    });
    fotoDe.set(fo.keko, { t: instante(fo.recibido_en), items });
  });

  // Lo que la app tiene en la mano de cada keko, y las entradas de la Auditoria.
  const mano = new Map();
  const entradas = new Map();
  lotes.forEach((l) => {
    if (!l.keko) return;
    const d = datosDe(l);
    if (d.sprite === null) return;
    const k = claveFurni(l.keko, d.sprite, d.tipo);
    if (l.estado === 'comprado') {
      const m = mano.get(k) || { sinNumero: 0, ltds: new Set() };
      if (l.numero_ltd === null || l.numero_ltd === undefined) m.sinNumero += num(l.cantidad);
      else m.ltds.add(Number(l.numero_ltd));
      mano.set(k, m);
    }
    if (l.notas === NOTA_ENTRADA && (l.numero_ltd === null || l.numero_ltd === undefined) && l.fecha_compra) {
      if (!entradas.has(k)) entradas.set(k, []);
      entradas.get(k).push({ dia: String(l.fecha_compra).slice(0, 10), cantidad: num(l.cantidad) });
    }
  });

  // Lo publicado y caducado, en grupos como el script.
  const grupos = new Map();
  const filasLtd = [];
  lotes.filter((l) => caducada(l, ahora)).forEach((l) => {
    const d = datosDe(l);
    const keko = l.keko || null;
    const fo = keko !== null ? fotoDe.get(keko) : undefined;
    const t = instante(l.publicado_en);
    const antes = Boolean(fo) && fo.t !== null && (t === null || t + CADUCA_MS <= fo.t - MARGEN_MS);
    const base = { keko, furni_id: Number(l.furni_id), sprite_id: d.sprite, tipo: d.tipo, conInventario: Boolean(fo), recibido: fo ? fo.t : null };
    if (l.numero_ltd === null || l.numero_ltd === undefined) {
      const k = [keko, d.sprite, d.tipo, d.sprite === null ? l.furni_id : ''].join('\u0000');
      const g = grupos.get(k) || { ...base, numero_ltd: null, nombre: null, caducadas: 0, comprobables: 0, lotes: [], desde: null };
      g.nombre = g.nombre === null || d.nombre < g.nombre ? d.nombre : g.nombre;
      g.caducadas += num(l.cantidad);
      if (antes) {
        g.comprobables += num(l.cantidad);
        g.lotes.push(Number(l.id));
        const dia = t === null ? '1900-01-01' : diaUtc(t + CADUCA_MS - HUSOS_MS);
        if (g.desde === null || dia < g.desde) g.desde = dia;
      }
      grupos.set(k, g);
    } else {
      const n = Number(l.numero_ltd);
      const repetido = lotes.some((o) => Number(o.id) !== Number(l.id) && Number(o.numero_ltd) === n
        && (Number(o.furni_id) === Number(l.furni_id) || (d.sprite !== null && datosDe(o).sprite === d.sprite && datosDe(o).tipo === d.tipo))
        && !caducada(o, ahora));
      filasLtd.push({ ...base, numero_ltd: n, nombre: d.nombre, caducadas: num(l.cantidad), comprobables: antes ? num(l.cantidad) : 0,
        lotes: antes ? [Number(l.id)] : [], repetido });
    }
  });

  return [...grupos.values(), ...filasLtd].map((g) => {
    const fo = g.keko !== null ? fotoDe.get(g.keko) : undefined;
    const item = fo && g.sprite_id !== null ? fo.items.get(g.sprite_id + '\u0000' + g.tipo) : undefined;
    const m = g.keko !== null && g.sprite_id !== null ? mano.get(claveFurni(g.keko, g.sprite_id, g.tipo)) : undefined;
    const lista = g.keko !== null && g.sprite_id !== null ? entradas.get(claveFurni(g.keko, g.sprite_id, g.tipo)) || [] : [];
    const x = {
      ...g,
      habbo: item ? Math.max(item.cantidad - item.ltds.length, 0) : 0,
      app: m ? m.sinNumero : 0,
      ltdEnHabbo: Boolean(item && g.numero_ltd !== null && item.ltds.includes(g.numero_ltd)),
      ltdEnApp: Boolean(m && g.numero_ltd !== null && m.ltds.has(g.numero_ltd)),
      entradas: g.numero_ltd === null && g.desde !== null ? lista.filter((e) => e.dia >= g.desde).reduce((s, e) => s + e.cantidad, 0) : 0,
      entradasDias: g.numero_ltd === null && g.desde !== null ? [...new Set(lista.filter((e) => e.dia >= g.desde).map((e) => e.dia))].sort() : [],
    };
    const reciente = x.recibido !== null && x.recibido >= ahora - INVENTARIO_MAX_MS;
    const noSeToca = decidir(x, reciente, ahora);
    const fantasma = decidir(x, true, ahora) === null;
    const motivo = noSeToca || (x.numero_ltd === null
      ? 'Fantasma: se volvió a registrar con «Entrada con costo» (' + x.entradas + ' desde que caducó) y Habbo no tiene más en la mano que la app (' + x.habbo + ' y ' + x.app + ').'
      : 'Fantasma: el LTD #' + x.numero_ltd + ' está repetido y la otra copia es la buena.')
      + (!noSeToca && x.caducadas > x.comprobables ? ' Otras ' + (x.caducadas - x.comprobables) + ' caducaron después del inventario: no se tocan.' : '');
    return {
      keko: x.keko,
      furni: x.nombre + (x.numero_ltd !== null ? ' #' + x.numero_ltd : ''),
      furni_id: x.furni_id,
      sprite_id: x.sprite_id,
      tipo: x.tipo,
      numero_ltd: x.numero_ltd,
      caducadas: x.caducadas,
      accion: noSeToca ? 'NO SE TOCA' : 'BORRAR',
      borrar: noSeToca ? 0 : x.comprobables,
      motivo,
      lotes: noSeToca ? [] : x.lotes.slice().sort((a, b) => a - b),
      // Para el aviso: fantasma aunque el inventario no sea reciente (el paso 1 pedira uno nuevo).
      fantasma,
      unidades: fantasma ? x.comprobables : 0,
      lotes_fantasma: fantasma ? x.lotes.slice().sort((a, b) => a - b) : [],
      // Para la ventana: los dias de las «Entrada con costo» que cuentan como huella.
      entradas_dias: fantasma ? x.entradasDias : [],
      inventario_reciente: reciente,
      inventario_en: x.recibido === null ? null : new Date(x.recibido).toISOString(),
    };
  });
}

// El resumen para el aviso: solo lo que es fantasma.
function resumenFantasmas(filas) {
  const fantasmas = filas.filter((f) => f.fantasma);
  return {
    fantasmas,
    unidades: fantasmas.reduce((s, f) => s + f.unidades, 0),
    lotes: fantasmas.reduce((s, f) => s + f.lotes_fantasma.length, 0),
    kekos: [...new Set(fantasmas.map((f) => f.keko))],
  };
}

module.exports = { planFantasmas, resumenFantasmas, CADUCIDAD_H, NOTA_ENTRADA, INVENTARIO_MAX_MS, MARGEN_MS, HUSOS_MS };
