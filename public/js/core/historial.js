// public/js/core/historial.js — el Historial de ventas (v1.9.0; maqueta aprobada por el
// dueño el 03-10-2026): todas las ventas de la cuenta en orden cronologico, sin importar el
// keko. Sin React ni red: npm run verificar lo prueba, tambien contra la base.
//
//   - filasHistorial: una fila por lote vendido y por venta «por asignar» del Sniper.
//     El dinero sale de v_compras tal cual (ganancia_cr, precio_venta_cr, costo_total_cr,
//     comision_pagada_cr): asi el historial da lo mismo que el Inventario y el Resumen.
//   - filtrar / ordenar / porDia: lo que muestra el libro (agrupado por dia).
//   - metricas: las 4 tarjetas de arriba. Las ventas por asignar se cuentan aparte y no
//     suman dinero (no se sabe de que lote salieron ni lo que costaron).
//   - serieDiaria: la ganancia por dia del grafico (por semana o por mes en rangos largos).
//   - csv: lo filtrado, para Excel («;», BOM, coma decimal).
//   - leerFiltros / guardarFiltros: los filtros se recuerdan en este equipo (decision 8).
//
// La hora: solo el Sniper (migracion 19) y las ventas a mano desde la 1.9.0 (migracion 20,
// si eran del dia) la guardan en vendido_en. Las demas solo tienen el dia (fecha_venta):
// van «sin hora», al final de su dia. Lo importado del Excel no tiene ni el dia.
// El dia de una venta con hora es el de TU reloj (como «vendida hoy a las…» del Inventario).

import { calcularComision } from './comision.js';
import { claveKeko } from './kekos.js';
import { diaDe, horaDe, nombreVentaPendiente } from './ventas.js';

function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
function numONulo(x) { if (x === null || x === undefined || x === '') return null; var n = Number(x); return isFinite(n) ? n : null; }
function tiempo(x) { if (!x) return null; var t = Date.parse(x); return isNaN(t) ? null : t; }
var DIA = /^\d{4}-\d{2}-\d{2}$/;
function esDia(x) { return typeof x === 'string' && DIA.test(x) && !isNaN(Date.parse(x + 'T12:00:00')); }

// ── Dias (siempre en hora local; las claves AAAA-MM-DD se comparan como texto) ──
function claveDe(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fechaDe(clave) { var p = clave.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12); }
export function sumarDias(clave, n) { var d = fechaDe(clave); d.setDate(d.getDate() + n); return claveDe(d); }
export function hoyDe(ahora) { return claveDe(new Date(ahora === undefined ? Date.now() : ahora)); }
function diasEntre(a, b) { return Math.round((fechaDe(b) - fechaDe(a)) / 86400000); }

function sinAcentos(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Las filas ──
// compras: los lotes (v_compras); porAsignar: las ventas por asignar pendientes; furnis:
// para nombrar las por asignar de un furni que la app registro despues.
export function filasHistorial(compras, porAsignar, furnis) {
  var filas = [];
  (compras || []).forEach(function (l) {
    if (!l || l.estado !== 'vendido') return;
    filas.push(filaDeLote(l));
  });
  (porAsignar || []).forEach(function (v) {
    if (v) filas.push(filaPorAsignar(v, furnis));
  });
  return filas;
}

// Quien la registro: el Sniper, tu (desde la 1.9.0 queda marcada), tu antes de la 1.9.0
// (sin marca) o la importacion del Excel (sin marca y sin dia).
function registroDe(l) {
  if (l.vendido_por === 'sniper') return 'sniper';
  if (l.vendido_por === 'manual') return 'manual';
  return l.fuente === 'excel' && !l.fecha_venta ? 'excel' : 'antigua';
}

function filaDeLote(l) {
  var registro = registroDe(l);
  var cant = num(l.cantidad);
  var hora = tiempo(l.vendido_en);
  var dia = hora !== null ? diaDe(l.vendido_en) : esDia(l.fecha_venta) ? l.fecha_venta : null;
  var mercadillo = l.comision_venta !== null && l.comision_venta !== undefined;
  var precioReal = numONulo(l.precio_venta_real);
  var costo = numONulo(l.costo_total_cr);
  var ganancia = numONulo(l.ganancia_cr);
  var publicado = tiempo(l.publicado_en);
  return {
    clave: 'l' + l.id, tipo: 'lote', id: l.id,
    origen: registro === 'sniper' ? 'sniper' : 'manual', registro: registro,
    conHora: hora !== null, momento: hora !== null ? hora : dia ? fechaDe(dia).getTime() : null, dia: dia,
    furni_id: l.furni_id, nombre: typeof l.nombre === 'string' ? l.nombre : '', classname: typeof l.classname === 'string' ? l.classname : null, revision: l.revision,
    keko: l.keko || null, cantidad: cant,
    // Lo que pago el comprador por unidad: en el mercadillo, el neto guardado + la comision.
    precio: precioReal === null ? null : precioReal + (mercadillo ? num(l.comision_venta) : 0),
    moneda: l.moneda_venta_real === 'lingos' ? 'lingos' : 'creditos',
    mercadillo: mercadillo,
    // La que pago (en creditos); sin comision_pagada_cr en la vista, la guardada.
    comision: mercadillo ? num(l.comision_pagada_cr !== undefined && l.comision_pagada_cr !== null ? l.comision_pagada_cr : l.comision_venta) * cant : 0,
    entro: num(l.precio_venta_cr) * cant,
    costo: costo, ganancia: ganancia,
    margen: ganancia !== null && costo ? ganancia / costo : null,
    numero_ltd: l.numero_ltd || null, origen_id: l.origen_id || null, fuente: l.fuente || null,
    publicado_en: l.publicado_en || null, publicado_por: l.publicado_por || null,
    // Cuanto estuvo publicado antes de venderse (solo con la hora exacta de la venta).
    publicadoMs: hora !== null && publicado !== null && hora >= publicado ? hora - publicado : null,
    lote: l,
  };
}

function filaPorAsignar(v, furnis) {
  var f = nombreVentaPendiente(v, furnis);
  var precio = num(v.precio);
  var com = calcularComision(precio);
  var hora = tiempo(v.vendido_en);
  return {
    clave: 'p' + v.id, tipo: 'por_asignar', id: v.id,
    origen: 'por_asignar', registro: 'sniper',
    conHora: hora !== null, momento: hora, dia: hora !== null ? diaDe(v.vendido_en) : null,
    furni_id: v.furni_id || null, nombre: f.nombre, classname: f.classname, revision: f.revision, registrado: f.registrado,
    keko: v.keko || null, cantidad: 1,
    precio: precio, moneda: 'creditos', mercadillo: true,
    // Se muestra lo que entro, pero no suma: no se sabe de que lote salio.
    comision: com, entro: precio - com,
    costo: null, ganancia: null, margen: null,
    numero_ltd: v.numero_ltd || null, origen_id: null, fuente: 'sniper', publicado_en: null, publicado_por: null, publicadoMs: null,
    causa: v.causa || null, motivo: v.motivo || null,
    venta: v,
  };
}

// ── Filtros ──
export var RANGOS = ['hoy', '7', '30', 'mes', 'todo', 'propio'];
export var ORIGENES = ['todas', 'sniper', 'manual'];
export var ORDENES = ['fecha', 'ganancia', 'entro'];
export var FILTROS_INICIALES = { q: '', rango: '30', desde: null, hasta: null, periodo: null, kekos: [], origen: 'todas', perdida: false, orden: 'fecha' };

// { desde, hasta } (claves de dia; un lado null = abierto) o null = sin limite. `periodo`
// (un dia o una semana elegidos en el grafico) manda sobre el rango.
export function rangoDias(filtros, ahora) {
  var f = filtros || {};
  if (f.periodo && esDia(f.periodo.desde) && esDia(f.periodo.hasta)) return ordenado(f.periodo.desde, f.periodo.hasta);
  return rangoBase(f, ahora);
}
function rangoBase(f, ahora) {
  var hoy = hoyDe(ahora);
  switch (f.rango) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case '7': return { desde: sumarDias(hoy, -6), hasta: hoy };
    case 'mes': return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
    case 'todo': return null;
    case 'propio': {
      var d = esDia(f.desde) ? f.desde : null;
      var h = esDia(f.hasta) ? f.hasta : null;
      return d && h ? ordenado(d, h) : d || h ? { desde: d, hasta: h } : null;
    }
    default: return { desde: sumarDias(hoy, -29), hasta: hoy };   // '30'
  }
}
function ordenado(a, b) { return a <= b ? { desde: a, hasta: b } : { desde: b, hasta: a }; }

// La venta sin dia (Excel) solo aparece cuando no hay limite de fechas.
export function filtrar(filas, filtros, ahora) {
  var f = filtros || {};
  var r = rangoDias(f, ahora);
  var q = sinAcentos(f.q);
  var kekos = Array.isArray(f.kekos) && f.kekos.length ? f.kekos.map(claveKeko) : null;
  return (filas || []).filter(function (x) {
    if (r) {
      if (!x.dia) return false;
      if (r.desde && x.dia < r.desde) return false;
      if (r.hasta && x.dia > r.hasta) return false;
    }
    if (q && sinAcentos(x.nombre + ' ' + (x.classname || '') + (x.numero_ltd ? ' #' + x.numero_ltd : '')).indexOf(q) === -1) return false;
    if (kekos && kekos.indexOf(claveKeko(x.keko)) === -1) return false;
    if (f.origen === 'sniper' && x.origen === 'manual') return false;
    if (f.origen === 'manual' && x.origen !== 'manual') return false;
    if (f.perdida && !(x.ganancia !== null && x.ganancia < 0)) return false;
    return true;
  });
}

// fecha: el dia mas reciente primero (lo sin dia al final); dentro del dia, lo que tiene hora
// de la mas nueva a la mas vieja y despues lo «sin hora». ganancia / entro: de mayor a menor
// (lo que no tiene ganancia, como las por asignar, al final).
export function ordenar(filas, orden) {
  return (filas || []).slice().sort(function (a, b) {
    if (orden === 'ganancia' || orden === 'entro') {
      var va = orden === 'ganancia' ? a.ganancia : a.entro;
      var vb = orden === 'ganancia' ? b.ganancia : b.entro;
      if (va !== vb) return va === null ? 1 : vb === null ? -1 : vb - va;
    } else {
      if (a.dia !== b.dia) return !a.dia ? 1 : !b.dia ? -1 : a.dia < b.dia ? 1 : -1;
      if (a.conHora !== b.conHora) return a.conHora ? -1 : 1;
    }
    return num(b.momento) - num(a.momento) || (a.tipo === b.tipo ? b.id - a.id : a.tipo === 'lote' ? -1 : 1);
  });
}

// Los dias del libro, en el orden de las filas (ordenadas por fecha), con su subtotal. Los
// subtotales son de TODAS las filas del dia, aunque el libro muestre solo las primeras.
export function porDia(filasOrdenadas) {
  var grupos = [];
  var actual = null;
  (filasOrdenadas || []).forEach(function (x) {
    if (!actual || actual.dia !== x.dia) {
      actual = { dia: x.dia, filas: [], ventas: 0, unidades: 0, entro: 0, ganancia: 0, porAsignar: 0 };
      grupos.push(actual);
    }
    actual.filas.push(x);
    if (x.tipo === 'por_asignar') { actual.porAsignar++; return; }
    actual.ventas++;
    actual.unidades += x.cantidad;
    actual.entro += x.entro;
    actual.ganancia += num(x.ganancia);
  });
  return grupos;
}

// Las 4 tarjetas. «ventas» = registros de venta (una venta manual de 3 unidades es una).
export function metricas(filas) {
  var m = { ventas: 0, unidades: 0, furnis: 0, entro: 0, comision: 0, costo: 0, ganancia: 0, margen: null,
    sniper: { ventas: 0, ganancia: 0 }, manual: { ventas: 0, ganancia: 0 }, mejor: null, porAsignar: 0 };
  var porFurni = {};
  (filas || []).forEach(function (x) {
    if (x.tipo === 'por_asignar') { m.porAsignar++; return; }
    var g = num(x.ganancia);
    m.ventas++;
    m.unidades += x.cantidad;
    m.entro += x.entro;
    m.comision += x.comision;
    m.costo += num(x.costo);
    m.ganancia += g;
    var lado = x.origen === 'sniper' ? m.sniper : m.manual;
    lado.ventas++;
    lado.ganancia += g;
    var k = x.furni_id !== null && x.furni_id !== undefined ? 'f' + x.furni_id : 'n' + x.nombre;
    var p = porFurni[k] || (porFurni[k] = { furni_id: x.furni_id, nombre: x.nombre, classname: x.classname, revision: x.revision, ganancia: 0, ventas: 0, unidades: 0 });
    p.ganancia += g;
    p.ventas++;
    p.unidades += x.cantidad;
  });
  var lista = Object.keys(porFurni).map(function (k) { return porFurni[k]; });
  m.furnis = lista.length;
  m.mejor = lista.sort(function (a, b) { return b.ganancia - a.ganancia || b.ventas - a.ventas || a.nombre.localeCompare(b.nombre); })[0] || null;
  m.margen = m.costo ? m.ganancia / m.costo : null;
  return m;
}

// Los kekos que aparecen en el historial (para el menu de kekos), con cuantas ventas tiene
// cada uno: de mas a menos ventas; «Sin keko» (clave '') al final.
export function kekosDe(filas) {
  var por = {};
  (filas || []).forEach(function (x) {
    var c = claveKeko(x.keko);
    var k = por[c] || (por[c] = { clave: c, nombre: c ? String(x.keko).trim() : null, ventas: 0 });
    k.ventas++;
  });
  return Object.keys(por).map(function (c) { return por[c]; }).sort(function (a, b) {
    if (!a.clave !== !b.clave) return a.clave ? -1 : 1;
    return b.ventas - a.ventas || a.clave.localeCompare(b.clave);
  });
}

// ── El grafico ──
// filas: ya filtradas por todo MENOS el periodo elegido en el grafico (asi se ven los demas
// dias). Un punto por dia del rango; si pasa de 62 dias, por semana (de lunes a domingo); si
// pasa de 62 semanas, por mes. Cada punto trae su propio desde/hasta (para filtrar al hacer
// clic) y la ganancia separada en Sniper y manual.
export var TOPE_DIAS = 62;
export function serieDiaria(filas, filtros, ahora) {
  var hoy = hoyDe(ahora);
  var conDia = (filas || []).filter(function (x) { return x.dia; });
  var r = rangoBase(filtros || {}, ahora) || { desde: null, hasta: null };
  var desde = r.desde, hasta = r.hasta;
  if (!desde || !hasta) {
    var dias = conDia.map(function (x) { return x.dia; }).sort();
    if (!desde) desde = dias.length && dias[0] < hoy ? dias[0] : hoy;
    if (!hasta) hasta = dias.length && dias[dias.length - 1] > hoy ? dias[dias.length - 1] : hoy;
    if (desde > hasta) { var t = desde; desde = hasta; hasta = t; }
  }
  var n = diasEntre(desde, hasta) + 1;
  var por = n <= TOPE_DIAS ? 'dia' : n <= TOPE_DIAS * 7 ? 'semana' : 'mes';
  var puntos = [];
  var indice = {};
  for (var d = inicioDe(desde, por); d <= hasta; d = siguienteDe(d, por)) {
    var fin = sumarDias(siguienteDe(d, por), -1);
    var p = { clave: d, desde: d < desde ? desde : d, hasta: fin > hasta ? hasta : fin, ventas: 0, porAsignar: 0, entro: 0, ganancia: 0, sniper: 0, manual: 0 };
    indice[d] = puntos.length;
    puntos.push(p);
  }
  // sinDia: las ventas que no entran en ninguna barra (las del Excel no tienen dia).
  var total = { ventas: 0, ganancia: 0, porAsignar: 0, sinDia: (filas || []).filter(function (x) { return !x.dia && x.tipo !== 'por_asignar'; }).length };
  conDia.forEach(function (x) {
    if (x.dia < desde || x.dia > hasta) return;
    var p = puntos[indice[inicioDe(x.dia, por)]];
    if (!p) return;
    if (x.tipo === 'por_asignar') { p.porAsignar++; total.porAsignar++; return; }
    var g = num(x.ganancia);
    p.ventas++;
    p.entro += x.entro;
    p.ganancia += g;
    if (x.origen === 'sniper') p.sniper += g; else p.manual += g;
    total.ventas++;
    total.ganancia += g;
  });
  return { por: por, desde: desde, hasta: hasta, puntos: puntos, total: total };
}
function inicioDe(clave, por) {
  if (por === 'mes') return clave.slice(0, 8) + '01';
  if (por === 'semana') return sumarDias(clave, -((fechaDe(clave).getDay() + 6) % 7));
  return clave;
}
function siguienteDe(clave, por) {
  if (por === 'mes') { var d = fechaDe(clave.slice(0, 8) + '01'); d.setMonth(d.getMonth() + 1); return claveDe(d); }
  return sumarDias(clave, por === 'semana' ? 7 : 1);
}

// ── Textos del libro ──
var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
// «3 oct» (con el año si no es el actual).
export function diaCorto(clave, ahora) {
  if (!esDia(clave)) return '';
  var d = fechaDe(clave);
  return d.getDate() + ' ' + MESES[d.getMonth()] + (clave.slice(0, 4) !== hoyDe(ahora).slice(0, 4) ? ' ' + clave.slice(0, 4) : '');
}
// El encabezado de un dia: «Hoy · sábado 3 de oct», «Ayer · viernes 2 de oct», «Jueves 1 de oct».
export function tituloDia(clave, ahora) {
  if (!esDia(clave)) return 'Sin fecha';
  var hoy = hoyDe(ahora);
  var d = fechaDe(clave);
  var largo = DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()] + (clave.slice(0, 4) !== hoy.slice(0, 4) ? ' de ' + clave.slice(0, 4) : '');
  if (clave === hoy) return 'Hoy · ' + largo;
  if (clave === sumarDias(hoy, -1)) return 'Ayer · ' + largo;
  return largo.charAt(0).toUpperCase() + largo.slice(1);
}
// Cuanto estuvo publicado: «25 min», «5 h», «3 días».
export function duracion(ms) {
  if (ms === null || ms === undefined || !isFinite(ms) || ms < 0) return '';
  var min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return min + ' min';
  var horas = Math.round(ms / 3600000);
  if (horas < 48) return horas + ' h';
  var dias = Math.round(ms / 86400000);
  return dias + (dias === 1 ? ' día' : ' días');
}

// Los filtros activos como chips («Keko: xJp ✕»). El rango no: ya se ve en su botón.
// nombreKeko(clave): como se muestra un keko (sus claves van en minusculas).
export function activos(filtros, nombreKeko, ahora) {
  var f = filtros || {};
  var a = [];
  if (f.periodo && esDia(f.periodo.desde) && esDia(f.periodo.hasta)) {
    a.push({ clave: 'periodo', texto: f.periodo.desde === f.periodo.hasta ? 'Día: ' + tituloDia(f.periodo.desde, ahora)
      : 'Del ' + diaCorto(f.periodo.desde, ahora) + ' al ' + diaCorto(f.periodo.hasta, ahora) });
  }
  if (f.q && String(f.q).trim()) a.push({ clave: 'q', texto: 'Furni: «' + String(f.q).trim() + '»' });
  (f.kekos || []).forEach(function (k) {
    a.push({ clave: 'keko:' + k, texto: 'Keko: ' + (k ? (nombreKeko ? nombreKeko(k) : k) : 'Sin keko') });
  });
  if (f.origen === 'sniper' || f.origen === 'manual') a.push({ clave: 'origen', texto: f.origen === 'sniper' ? 'Solo del Sniper' : 'Solo manuales' });
  if (f.perdida) a.push({ clave: 'perdida', texto: 'Con pérdida' });
  return a;
}
// Quita un chip ('todo' = todos; el rango y el orden se quedan).
export function quitarFiltro(filtros, clave) {
  var f = Object.assign({}, filtros);
  if (clave === 'todo') return Object.assign(f, { periodo: null, q: '', kekos: [], origen: 'todas', perdida: false });
  if (clave === 'periodo') f.periodo = null;
  else if (clave === 'q') f.q = '';
  else if (clave === 'origen') f.origen = 'todas';
  else if (clave === 'perdida') f.perdida = false;
  else if (String(clave).indexOf('keko:') === 0) {
    var k = String(clave).slice(5);
    f.kekos = (f.kekos || []).filter(function (x) { return x !== k; });
  }
  return f;
}

// ── CSV para Excel ──
// «;» y coma decimal (Excel en español), BOM para los acentos, una venta por linea en el
// orden recibido. Un texto que empieza con = + - @ va con un apostrofo delante: Excel no lo
// ejecuta como formula (un keko de Habbo puede llamarse «=algo»).
var TEXTO_REGISTRO = { sniper: 'El Sniper', manual: 'Tú', antigua: 'Tú (antes de la 1.9.0)', excel: 'Importada del Excel' };
var TEXTO_ORIGEN = { sniper: 'Sniper', manual: 'Manual', por_asignar: 'Por asignar' };
export var COLUMNAS_CSV = ['Fecha', 'Hora', 'Furni', 'LTD', 'Keko', 'Cantidad', 'Precio c/u', 'Moneda', 'Comisión (cr)', 'Entró (cr)', 'Costo (cr)', 'Ganancia (cr)', 'Margen', 'Origen', 'Registrada por', 'Lote'];

function numeroCsv(n) {
  if (n === null || n === undefined || !isFinite(n)) return '';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}
function textoCsv(s) {
  var t = String(s === null || s === undefined ? '' : s);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}
function celda(v) {
  var s = String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function csv(filas) {
  var lineas = [COLUMNAS_CSV];
  (filas || []).forEach(function (x) {
    lineas.push([
      x.dia || '', x.conHora ? horaDe(x.momento) : '', textoCsv(x.nombre), x.numero_ltd || '', textoCsv(x.keko || 'Sin keko'),
      x.cantidad, numeroCsv(x.precio), x.moneda === 'lingos' ? 'Lingos' : 'Créditos', numeroCsv(x.comision), numeroCsv(x.entro),
      numeroCsv(x.costo), numeroCsv(x.ganancia), x.margen === null ? '' : numeroCsv(x.margen * 100) + '%',
      TEXTO_ORIGEN[x.origen], TEXTO_REGISTRO[x.registro], x.tipo === 'lote' ? x.id : '',
    ]);
  });
  return '﻿' + lineas.map(function (l) { return l.map(celda).join(';'); }).join('\r\n') + '\r\n';
}
export function nombreCsv(ahora) { return 'historial-ventas-' + hoyDe(ahora) + '.csv'; }

// ── Los filtros que dejaste (en este equipo) ──
// Se recuerdan el rango, los kekos, el origen, «con pérdida» y el orden. La busqueda y el
// dia elegido en el grafico no: son de un momento.
export var CLAVE_FILTROS = 'hbi.historial-filtros';
function almacenDe(almacen) {
  if (almacen) return almacen;
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_) { return null; }
}
// Sin almacenamiento o con un dato raro: los filtros de siempre (o lo que se pueda salvar).
export function leerFiltros(almacen) {
  var f = Object.assign({}, FILTROS_INICIALES, { kekos: [] });
  try {
    var a = almacenDe(almacen);
    var v = a ? JSON.parse(a.getItem(CLAVE_FILTROS) || 'null') : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return f;
    if (RANGOS.indexOf(v.rango) !== -1) f.rango = v.rango;
    if (esDia(v.desde)) f.desde = v.desde;
    if (esDia(v.hasta)) f.hasta = v.hasta;
    if (Array.isArray(v.kekos)) {
      f.kekos = v.kekos.filter(function (k) { return typeof k === 'string'; }).map(claveKeko)
        .filter(function (k, i, l) { return l.indexOf(k) === i; }).slice(0, 50);
    }
    if (ORIGENES.indexOf(v.origen) !== -1) f.origen = v.origen;
    if (typeof v.perdida === 'boolean') f.perdida = v.perdida;
    if (ORDENES.indexOf(v.orden) !== -1) f.orden = v.orden;
  } catch (_) { /* almacenamiento roto: los de siempre */ }
  return f;
}
export function guardarFiltros(filtros, almacen) {
  var f = filtros || {};
  try {
    var a = almacenDe(almacen);
    if (a) a.setItem(CLAVE_FILTROS, JSON.stringify({ rango: f.rango, desde: f.desde || null, hasta: f.hasta || null,
      kekos: f.kekos || [], origen: f.origen, perdida: !!f.perdida, orden: f.orden }));
  } catch (_) { /* sin almacenamiento: solo dura esta sesion */ }
}
