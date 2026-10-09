// public/js/core/fantasmas.js — el aviso de furnis fantasma en la interfaz (v1.10.1). Puro: lo
// carga npm run verificar.
//
// Los datos llegan de /api/fantasmas (backend/core/fantasmas.js: la misma regla que los SQL de
// scripts/limpiar-fantasmas, con la «huella» de la Auditoria). Aqui: si el aviso se ve («Ahora no»
// lo oculta en ese equipo hasta que la lista cambie: decision de la maqueta), los lotes fantasma
// (para las etiquetas de las listas) y la lista por keko de la ventana.

export var CLAVE_AHORA_NO = 'hbi.fantasmas-ahora-no';

function filasDe(r) { return r && Array.isArray(r.fantasmas) ? r.fantasmas : []; }
function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }

// La firma de la lista: sus lotes fantasma, ordenados. Si cambia, el aviso vuelve.
export function firmaFantasmas(r) {
  return filasDe(r).reduce(function (s, f) { return s.concat(f.lotes_fantasma || []); }, [])
    .map(Number).sort(function (a, b) { return a - b; }).join(',');
}

export function hayFantasmas(r) { return !!r && r.disponible !== false && num(r.unidades) > 0; }

export function avisoVisible(r, oculta) { return hayFantasmas(r) && firmaFantasmas(r) !== (oculta || ''); }

// Los lotes fantasma (para «N fantasma» en el Mercadillo y «Fantasma» en Publicado).
export function idsFantasma(r) {
  var ids = new Set();
  filasDe(r).forEach(function (f) { (f.lotes_fantasma || []).forEach(function (id) { ids.add(Number(id)); }); });
  return ids;
}

// Unidades fantasma de unos lotes (la fila de un furni en un keko).
export function unidadesFantasma(lotes, ids) {
  if (!ids || !ids.size) return 0;
  return (lotes || []).reduce(function (s, l) { return s + (ids.has(Number(l.id)) ? num(l.cantidad) : 0); }, 0);
}

// La lista de la ventana, agrupada por keko (en el orden en que llegan), con la hora de su
// inventario: si no es reciente, el paso 1 lo dejara fuera y hay que reconectar su Sniper.
export function porKeko(r) {
  var grupos = [];
  var de = {};
  filasDe(r).forEach(function (f) {
    var k = f.keko;
    if (!de[k]) { de[k] = { keko: k, inventario_en: f.inventario_en, reciente: !!f.inventario_reciente, filas: [], unidades: 0 }; grupos.push(de[k]); }
    de[k].filas.push(f);
    de[k].unidades += num(f.unidades);
  });
  return grupos;
}

// Los textos del aviso: «Tienes 8 furnis fantasma…» y los kekos donde estan.
export function textoAviso(r) {
  var n = num(r && r.unidades);
  return {
    titulo: 'Tienes ' + n + (n === 1 ? ' furni fantasma' : ' furnis fantasma') + ' de antes de la 1.10.0',
    kekos: porKeko(r).map(function (g) { return g.keko; }),
  };
}

// «Ahora no»: lo guardado en este equipo (localStorage). Sin almacenamiento, el aviso se ve.
export function leerAhoraNo(almacen) {
  try { return (almacen && almacen.getItem(CLAVE_AHORA_NO)) || ''; } catch (_) { return ''; }
}
export function guardarAhoraNo(almacen, firma) {
  try { if (almacen) almacen.setItem(CLAVE_AHORA_NO, firma); } catch (_) { /* sin almacenamiento */ }
}
