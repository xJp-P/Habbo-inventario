// public/js/core/grupos.js — el Inventario agrupado por furni y la composicion del
// encabezado de cada keko (v1.8.0; diseño elegido por el dueño en la maqueta del
// 02-10-2026). Sin React ni red: npm run verificar lo prueba, tambien contra la base.
//
//   - agruparPorFurni: dentro del bloque de un keko, una fila por furni con sus lotes
//     (un furni con un solo lote se dibuja como hoy). Los lotes van en el MISMO orden en que
//     la base los toma, para que «1º en salir» diga la verdad:
//       Comprado:  fecha_compra asc nulls first, id asc   (publicar_furni; sin lo por revisar)
//       Publicado: publicado_en asc nulls first, id asc   (vender_furni, retirar_furni)
//       Vendido:   la ultima venta primero (no sale nada: es el historial)
//   - franjaPrecios: un punto por lote sobre el rango de compra c/u, y el promedio.
//   - composicion: «donde esta tu dinero» en un keko, por furni (la dona, el globo y la barra
//     de colores del encabezado C). En el Inventario: el costo en Comprado, lo que te
//     entraria en Publicado y lo que entro en Vendido; en el Mercadillo, lo que te entraria
//     (el mismo `neto` de resumenPublicado, asi el globo y el detalle dan el mismo numero).
//   - leerAbiertos / guardarAbiertos: los furnis que dejaste abiertos, en este equipo.
//
// Los numeros de la base pueden llegar como texto: todo pasa por num().

import { calcularComision } from './comision.js';
import { claveKeko } from './kekos.js';

function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
function tiempo(x) { if (!x) return null; var t = Date.parse(x); return isNaN(t) ? null : t; }
// Ascendente con los vacios primero (nulls first), como el `order by` de la base.
function ascVaciosPrimero(a, b) {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}
function momentoVenta(l) { var t = tiempo(l.vendido_en); return t !== null ? t : tiempo(l.fecha_venta); }

// Los lotes de un furni en el orden de la base (ver arriba).
export function ordenLotes(lotes, estado) {
  return (lotes || []).slice().sort(function (a, b) {
    if (estado === 'vendido') {
      var va = momentoVenta(a), vb = momentoVenta(b);
      if (va !== vb) return va === null ? 1 : vb === null ? -1 : vb - va;
      return b.id - a.id;
    }
    var campo = estado === 'publicado' ? 'publicado_en' : 'fecha_compra';
    return ascVaciosPrimero(tiempo(a[campo]), tiempo(b[campo])) || a.id - b.id;
  });
}

// El dinero de un lote para la composicion del encabezado.
//   comprado:  lo que costo (en creditos, aunque se pagara en lingos)
//   publicado: lo que te entraria al venderse = (precio de lista - comision) x unidades; un
//              precio en lingos no paga comision (igual que resumenPublicado en comision.js)
//   vendido:   lo que entro (en el mercadillo ya es el neto)
export function valorComposicion(l, estado) {
  var cant = num(l.cantidad);
  if (estado === 'publicado') {
    var p = num(l.precio_lista_cr);
    return (p - (l.moneda_lista === 'lingos' ? 0 : calcularComision(p))) * cant;
  }
  if (estado === 'vendido') return num(l.precio_venta_cr) * cant;
  return l.costo_total_cr !== undefined && l.costo_total_cr !== null ? num(l.costo_total_cr) : num(l.precio_compra_cr) * cant;
}

// El lote que «Publicar todo» toma primero: el mas antiguo que no esta por revisar
// (publicar_furni no toca lo por revisar). Solo en Comprado.
export function primeroEnSalir(lotesOrdenados) {
  var l = (lotesOrdenados || []).find(function (x) { return !x.pendiente; });
  return l ? l.id : null;
}

// Para ordenar los grupos: su actividad mas reciente (la misma idea que hoy, donde lo mas
// nuevo va arriba).
function actividad(l, estado) {
  var t = estado === 'vendido' ? momentoVenta(l) : tiempo(estado === 'publicado' ? l.publicado_en : l.fecha_compra);
  return [t === null ? -Infinity : t, l.id];
}
function masReciente(a, b) { return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]; }

// Los lotes de UN bloque (un keko) y UNA pestaña -> una fila por furni.
// Orden de los grupos: los que tienen algo por revisar primero; despues, el de actividad mas
// reciente; empate, por nombre.
export function agruparPorFurni(lotes, estado) {
  var porFurni = {};
  var orden = [];
  (lotes || []).forEach(function (l) {
    var clave = l.furni_id !== undefined && l.furni_id !== null ? String(l.furni_id) : 'n:' + (l.nombre || '');
    if (!porFurni[clave]) { porFurni[clave] = []; orden.push(clave); }
    porFurni[clave].push(l);
  });
  return orden.map(function (clave) { return resumirGrupo(clave, ordenLotes(porFurni[clave], estado), estado); })
    .sort(function (a, b) {
      if ((a.porRevisar > 0) !== (b.porRevisar > 0)) return a.porRevisar > 0 ? -1 : 1;
      if (a.actividad[0] !== b.actividad[0] || a.actividad[1] !== b.actividad[1]) return masReciente(a.actividad, b.actividad) ? -1 : 1;
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    });
}

function resumirGrupo(clave, ls, estado) {
  var primero = ls[0];
  var g = {
    clave: clave, furni_id: primero.furni_id, nombre: primero.nombre, classname: primero.classname, revision: primero.revision,
    estado: estado, lotes: ls, unidades: 0, costo: 0, compraProm: null, compraMin: null, compraMax: null,
    ltds: [], porRevisar: 0, unidadesPorRevisar: 0, primero: estado === 'comprado' ? primeroEnSalir(ls) : null,
    actividad: [-Infinity, -Infinity],
  };
  var ganancia = 0, valor = 0, conGanancia = false, sniper = 0, listas = {};
  ls.forEach(function (l) {
    var cant = num(l.cantidad);
    var cu = num(l.precio_compra_cr);
    g.unidades += cant;
    g.costo += l.costo_total_cr !== undefined && l.costo_total_cr !== null ? num(l.costo_total_cr) : cu * cant;
    g.compraMin = g.compraMin === null ? cu : Math.min(g.compraMin, cu);
    g.compraMax = g.compraMax === null ? cu : Math.max(g.compraMax, cu);
    if (l.numero_ltd) g.ltds.push(l.numero_ltd);
    if (l.pendiente) { g.porRevisar++; g.unidadesPorRevisar += cant; }
    if (l.ganancia_cr !== null && l.ganancia_cr !== undefined) { ganancia += num(l.ganancia_cr); conGanancia = true; }
    valor += valorComposicion(l, estado);
    if (estado === 'publicado') listas[num(l.precio_lista_cr)] = true;
    if (l.vendido_por === 'sniper') sniper++;
    var act = actividad(l, estado);
    if (masReciente(act, g.actividad)) g.actividad = act;
  });
  if (g.unidades) g.compraProm = g.costo / g.unidades;
  if (estado !== 'comprado') {
    g.ganancia = conGanancia ? ganancia : null;
    g.margen = conGanancia && g.costo > 0 ? ganancia / g.costo : null;
  }
  if (estado === 'publicado') {
    g.neto = valor;
    g.listas = Object.keys(listas).map(Number).sort(function (a, b) { return a - b; });
  }
  if (estado === 'vendido') {
    g.ingreso = valor;
    g.ventaProm = g.unidades ? valor / g.unidades : null;
    g.ultimaVenta = ls[0].vendido_en || ls[0].fecha_venta || null;
    g.todasSniper = sniper === ls.length;
  }
  return g;
}

// La franja de precios de compra (solo si no todos costaron lo mismo): cada punto en % del
// rango, mas grande cuantas mas unidades tiene su lote (de 8 a 18 px), y el promedio.
export function franjaPrecios(grupo) {
  if (!grupo || grupo.compraMin === null || grupo.compraMax === grupo.compraMin) return null;
  var min = grupo.compraMin, max = grupo.compraMax;
  var pos = function (v) { return (v - min) / (max - min) * 100; };
  var maxCant = Math.max.apply(null, grupo.lotes.map(function (l) { return num(l.cantidad); }));
  return {
    min: min, max: max, promedio: grupo.compraProm, posPromedio: pos(grupo.compraProm),
    puntos: grupo.lotes.map(function (l) {
      return { id: l.id, pos: pos(num(l.precio_compra_cr)), tam: 8 + Math.round(10 * num(l.cantidad) / (maxCant || 1)), pendiente: !!l.pendiente };
    }),
  };
}

// Composicion: cuanto dinero hay en cada furni de un bloque. Hasta 5 furnis van por su
// nombre; con mas, los 4 primeros y «Otros». Lo que no suma (0 o negativo) no entra: la
// dona no puede dibujar porciones negativas.
//   items: lo que tenga el bloque (lotes del Inventario o filas del Mercadillo)
//   op.valor(item) -> creditos; op.furni(item) -> { id, nombre, classname, revision }
// -> { total, furnis, partes: [{ furni_id, nombre, classname, revision, valor, porcentaje, indice, otros }] }
//    `indice` 0..4 es el color de la parte (la interfaz lo traduce); «Otros» lleva otros = N.
export var MAX_PARTES = 5;
export function composicion(items, op) {
  var porFurni = {};
  var orden = [];
  var distintos = {};
  (items || []).forEach(function (x) {
    var f = op.furni(x) || {};
    var clave = String(f.id !== undefined && f.id !== null ? f.id : f.nombre);
    distintos[clave] = true;
    var v = num(op.valor(x));
    // Solo texto: el globo dibuja estos datos en la cabecera del bloque, y un nombre con otro
    // formato tumbaria el bloque entero en vez de solo la fila de ese lote (que tiene su barrera).
    if (!porFurni[clave]) {
      porFurni[clave] = { furni_id: f.id === undefined ? null : f.id, nombre: typeof f.nombre === 'string' ? f.nombre : null,
        classname: typeof f.classname === 'string' ? f.classname : null, revision: f.revision, valor: 0 };
      orden.push(clave);
    }
    porFurni[clave].valor += v;
  });
  var lista = orden.map(function (c) { return porFurni[c]; }).filter(function (p) { return p.valor > 0; })
    .sort(function (a, b) { return b.valor - a.valor || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'); });
  var total = lista.reduce(function (s, p) { return s + p.valor; }, 0);
  if (lista.length > MAX_PARTES) {
    var resto = lista.slice(MAX_PARTES - 1);
    lista = lista.slice(0, MAX_PARTES - 1).concat([{ furni_id: null, nombre: null, classname: null, revision: null,
      valor: resto.reduce(function (s, p) { return s + p.valor; }, 0), otros: resto.length }]);
  }
  return {
    total: total,
    furnis: Object.keys(distintos).length,
    partes: lista.map(function (p, i) { return Object.assign({}, p, { porcentaje: total ? p.valor / total : 0, indice: i, otros: p.otros || 0 }); }),
  };
}

function furniDeLote(l) { return { id: l.furni_id, nombre: l.nombre, classname: l.classname, revision: l.revision }; }

// Inventario: los lotes de un bloque en una pestaña.
export function composicionLotes(lotes, estado) {
  return composicion(lotes, { valor: function (l) { return valorComposicion(l, estado); }, furni: furniDeLote });
}

// Mercadillo: sus filas (una por keko+furni, con r = resumenPublicado de lo publicado).
export function composicionMercadillo(filas) {
  return composicion(filas, { valor: function (x) { return x.r ? x.r.neto : 0; }, furni: function (x) { return x.f; } });
}

// Los cortes de la dona para un conic-gradient: cada parte con su color y un hueco fino
// entre partes (en puntos porcentuales; sin hueco si solo hay una).
// colores: lista de colores CSS por `indice`. -> 'c0 0% 73.4%, hueco 73.4% 74%, ...'
export function cortesDona(partes, colores, hueco, fondo) {
  var h = partes.length > 1 ? (hueco === undefined ? 0.6 : hueco) : 0;
  var a = 0;
  return partes.map(function (p, i) {
    var b = i === partes.length - 1 ? 100 : a + p.porcentaje * 100;
    var fin = Math.max(a, b - h);
    var tramo = colores[p.indice] + ' ' + redondo(a) + '% ' + redondo(fin) + '%' + (h && fin < b ? ', ' + (fondo || 'transparent') + ' ' + redondo(fin) + '% ' + redondo(b) + '%' : '');
    a = b;
    return tramo;
  }).join(', ');
}
function redondo(x) { return Math.round(x * 100) / 100; }

// ── Los furnis que dejaste abiertos (en este equipo) ──
// Clave de un grupo: keko (sin distinguir mayusculas) | pestaña | furni.
export var CLAVE_ABIERTOS = 'hbi.grupos-abiertos';
export var TOPE_ABIERTOS = 300;
export function claveGrupo(keko, estado, furniId) {
  return (claveKeko(keko) || '(sin keko)') + '|' + estado + '|' + furniId;
}
function almacenDe(almacen) {
  if (almacen) return almacen;
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_) { return null; }
}
// Sin almacenamiento (navegacion privada, bloqueado) o con un dato raro: ninguno abierto.
export function leerAbiertos(almacen) {
  try {
    var a = almacenDe(almacen);
    if (!a) return [];
    var v = JSON.parse(a.getItem(CLAVE_ABIERTOS) || '[]');
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
  } catch (_) { return []; }
}
export function guardarAbiertos(lista, almacen) {
  try {
    var a = almacenDe(almacen);
    if (a) a.setItem(CLAVE_ABIERTOS, JSON.stringify((lista || []).slice(-TOPE_ABIERTOS)));
  } catch (_) { /* sin almacenamiento: solo dura esta sesion */ }
}
// Abre o cierra uno: lo recien abierto va al final (el tope descarta los mas viejos).
export function alternarAbierto(lista, clave, abrir) {
  var sin = (lista || []).filter(function (x) { return x !== clave; });
  return abrir ? sin.concat([clave]) : sin;
}
