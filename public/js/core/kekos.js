// public/js/core/kekos.js — el Inventario y el Mercadillo divididos en un bloque por keko
// (v1.6.0).
//
// Orden de los bloques (decision del dueno): primero los kekos manuales, del mas antiguo
// al mas nuevo; luego los de los Snipers, tambien por antiguedad; al final lo que no tiene
// keko. La antiguedad es `desde` de listar_kekos (migracion 20261014000000: el primer
// token que aprendio el keko, o su alta como keko manual); sin esa migracion, los manuales
// van por su id (el orden en que se crearon) y los de Sniper por nombre. Un keko que traen
// los lotes pero la lista no conoce va con los manuales, detras de ellos.
//
// Un keko es una cuenta de Habbo: se compara sin distinguir mayusculas (como la base).
// Funciones puras, sin React: las prueba scripts/verificar.js.

export function claveKeko(nombre) {
  return nombre === null || nombre === undefined ? '' : String(nombre).trim().toLowerCase();
}

var SIN_KEKO = { nombre: null, clave: '', origen: 'sin' };

function tiempo(k) {
  var t = k.desde ? Date.parse(k.desde) : NaN;
  return isNaN(t) ? null : t;
}

// Manuales antes que Snipers; dentro de cada grupo, por antiguedad (sin fecha, al final);
// empate: por id (manuales) y luego por nombre.
export function ordenarKekos(lista) {
  return (lista || []).slice().sort(function (a, b) {
    var ga = a.origen === 'sniper' ? 1 : 0;
    var gb = b.origen === 'sniper' ? 1 : 0;
    if (ga !== gb) return ga - gb;
    var ta = tiempo(a);
    var tb = tiempo(b);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    }
    if ((a.id || b.id) && a.id !== b.id) {
      if (!a.id) return 1;
      if (!b.id) return -1;
      return a.id - b.id;
    }
    return claveKeko(a.nombre).localeCompare(claveKeko(b.nombre));
  });
}

// Reparte `items` (lotes o filas del Mercadillo) en bloques. `kekoDe(item)` dice su keko
// (null = sin keko). Devuelve los bloques que tienen algo, en orden, cada uno con su keko
// ({ nombre, clave, origen: 'manual' | 'sniper' | 'sin', snipers, desde }) y sus items en
// el orden en que llegaron; y los nombres de los kekos conocidos que quedaron vacios.
export function agruparPorKeko(items, lista, kekoDe) {
  var conocidos = ordenarKekos((lista || []).map(function (k) { return Object.assign({}, k, { clave: claveKeko(k.nombre) }); }));
  var porClave = {};
  conocidos.forEach(function (k) { if (!porClave[k.clave]) porClave[k.clave] = k; });
  var cubos = {};
  var extra = [];
  (items || []).forEach(function (it) {
    var nombre = kekoDe(it);
    var c = claveKeko(nombre);
    if (c && !porClave[c]) {
      porClave[c] = { nombre: String(nombre).trim(), clave: c, origen: 'manual', desconocido: true };
      extra.push(porClave[c]);
    }
    (cubos[c] = cubos[c] || []).push(it);
  });
  var orden = conocidos.filter(function (k) { return k.origen !== 'sniper'; })
    .concat(ordenarKekos(extra), conocidos.filter(function (k) { return k.origen === 'sniper'; }), [SIN_KEKO]);
  var vistos = {};
  return {
    bloques: orden.filter(function (k) {
      if (!cubos[k.clave] || vistos[k.clave]) return false;
      vistos[k.clave] = true;
      return true;
    }).map(function (k) { return { keko: k, items: cubos[k.clave] }; }),
    vacios: conocidos.filter(function (k) { return !cubos[k.clave]; }).map(function (k) { return k.nombre; }),
  };
}

// Lo que un bloque le pasa a publicar / vender / retirar: solo ese keko, o solo lo que no
// tiene keko (sin esto la base tomaria unidades de cualquier keko).
export function ambitoDe(keko) {
  return keko && keko.clave ? { keko: keko.nombre } : { sin_keko: true };
}

// Para los textos de los modales: « en xJp», « sin keko» o nada (todos los kekos).
export function textoAmbito(ambito) {
  return !ambito ? '' : ambito.sin_keko ? ' sin keko' : ' en ' + ambito.keko;
}

// ¿Este lote es del keko `nombre`? (null = sin keko).
export function esDelKeko(lote, nombre) {
  return claveKeko(lote.keko) === claveKeko(nombre);
}
