// public/js/core/tablero.js — el Resumen nuevo (v2.0.0): el «centro de mando». Puro, sin React
// ni red: npm run verificar lo prueba, tambien contra la base.
//
// Maqueta aprobada por el dueño el 09-10-2026 (decisiones 1A a 8A del plan y 1A a 6A de la
// maqueta): barra de control (keko, periodo y moneda), tres cifras principales, el ciclo de los
// furnis, rendimiento, «Necesita tu atencion», por keko y destacados. Requisito del dueño: todo
// el dinero en las dos monedas (cr y L, sin iconos; el Lingo siempre es «L»).
//
// De donde sale cada cosa:
//   - Lo que hay AHORA (capital, por cobrar, el ciclo, la atencion, por keko, «capital dormido»):
//     los lotes de v_compras tal cual (costo_total_cr, ganancia_cr, comision_cr). El periodo no
//     lo toca (decision 3A). «Todo» da lo mismo que el Resumen viejo (calculos.js).
//   - Lo REALIZADO (ganancia realizada, rendimiento, vendido, mas vendidos): las filas del
//     Historial (core/historial.js), con sus mismos periodos y su dia local. Asi el Resumen y el
//     Historial nunca se contradicen.
//   - El filtro de keko (decision 2A) se aplica a todo; la clave es la de core/kekos.js
//     ('' = sin keko, 'todos' = sin filtro).

import { filtrar, metricas, serieDiaria, sumarDias, hoyDe } from './historial.js';
import { claveKeko, agruparPorKeko } from './kekos.js';
import { caducada, delSniper, restante } from './caducidad.js';

export var PERIODOS = ['7', '30', 'mes', 'todo'];
export var MONEDAS = ['cr', 'L'];
export var DESTACADOS = ['cobrar', 'vendidos', 'dormido'];
export var TODOS = 'todos';
export var DORMIDO_DIAS = 14;          // decision 5A: «capital dormido» desde 14 dias en mano
export var DORMIDO_VIEJO = 30;         // en ambar desde 30
export var TOPE_DESTACADOS = 5;
export var CLAVE_PREFERENCIAS = 'hbi.resumen';
export var PREFERENCIAS_INICIALES = { keko: TODOS, periodo: '30', moneda: 'cr', destacados: 'cobrar' };

var DIA_MS = 86400000;
function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
function lotesDe(compras) { return Array.isArray(compras) ? compras.filter(Boolean) : []; }
function sumar(xs, f) { return xs.reduce(function (s, x) { return s + f(x); }, 0); }
var DIA = /^\d{4}-\d{2}-\d{2}/;

// ── Dinero: la cifra doble (cr y L) ──
var NF_CR = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
var NF_L = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function textoCr(n) { return NF_CR.format(Math.round(Math.abs(num(n)))); }
export function textoL(n) { return NF_L.format(Math.abs(num(n))); }

// cr: el valor en creditos (todo el Resumen trabaja en creditos). opciones: tasa (creditos que
// vale 1 L; 50 si no llega), moneda ('cr' | 'L': la que va grande), signo (+ / − y tono),
// cero (un cero devuelve null: la vista pone «—»).
// Devuelve { principal: { texto, unidad }, secundaria: { texto, unidad }, tono, titulo }.
export function cifraDoble(cr, opciones) {
  var o = opciones || {};
  var v = num(cr);
  if (o.cero && Math.round(v) === 0) return null;
  var tasa = num(o.tasa) > 0 ? num(o.tasa) : 50;
  var tono = !o.signo ? null : Math.round(v) > 0 ? 'pos' : Math.round(v) < 0 ? 'neg' : null;
  var sg = o.signo ? (tono === 'pos' ? '+' : tono === 'neg' ? '−' : '') : (Math.round(v) < 0 ? '−' : '');
  var lingos = v / tasa;
  var enCr = { texto: sg + textoCr(v), unidad: 'cr' };
  var enL = { texto: sg + textoL(lingos), unidad: 'L' };
  return {
    principal: o.moneda === 'L' ? enL : enCr,
    secundaria: o.moneda === 'L' ? enCr : enL,
    tono: tono,
    titulo: sg + textoCr(v) + ' cr = ' + sg + textoL(lingos) + ' L (1 L = ' + NF_L.format(tasa).replace(/,00$/, '') + ' cr)',
  };
}

// ── Kekos ──
// ¿Entra este lote (o fila) en el filtro de keko? Ojo: '' es «Sin keko», no «todos».
export function deKeko(item, keko) {
  if (keko === undefined || keko === null || keko === TODOS) return true;
  return claveKeko(item && item.keko) === keko;
}
function delFiltro(xs, keko) { return xs.filter(function (x) { return deKeko(x, keko); }); }

// Los chips de la barra: los kekos que tienen lotes, en el orden de la app (core/kekos.js:
// manuales, Snipers y «Sin keko» al final). lista = /api/kekos (kekos[]).
export function kekosDelResumen(compras, lista) {
  return agruparPorKeko(lotesDe(compras), lista || [], function (l) { return l.keko; }).bloques.map(function (b) {
    return { clave: b.keko.clave, nombre: b.keko.nombre, origen: b.keko.origen || 'manual' };
  });
}

// El keko guardado ya no tiene lotes (o nunca existio): vuelve a «Todos».
export function kekoVigente(keko, chips) {
  if (keko === TODOS) return TODOS;
  return (chips || []).some(function (k) { return k.clave === keko; }) ? keko : TODOS;
}

// ── Lo que hay ahora ──
function bloqueCosto(lotes) {
  return { lotes: lotes.length, unidades: sumar(lotes, function (l) { return num(l.cantidad); }), costo: sumar(lotes, function (l) { return num(l.costo_total_cr); }) };
}
function deEstado(compras, estado, pendiente) {
  return lotesDe(compras).filter(function (l) { return l.estado === estado && (pendiente === undefined || !!l.pendiente === pendiente); });
}

// Capital en juego: lo invertido y aun sin vender (por revisar + en mano + publicado).
export function capital(compras) {
  var c = { revisar: bloqueCosto(deEstado(compras, 'comprado', true)), mano: bloqueCosto(deEstado(compras, 'comprado', false)), publicado: bloqueCosto(deEstado(compras, 'publicado')) };
  c.total = { unidades: c.revisar.unidades + c.mano.unidades + c.publicado.unidades, costo: c.revisar.costo + c.mano.costo + c.publicado.costo };
  return c;
}

// Ganancia por cobrar: la de lo publicado (la unica ganancia esperada), como el Resumen viejo.
export function porCobrar(compras) {
  var pub = deEstado(compras, 'publicado');
  var b = bloqueCosto(pub);
  b.ganancia = sumar(pub, function (l) { return num(l.ganancia_cr); });
  b.comision = sumar(pub, function (l) { return num(l.comision_cr) * num(l.cantidad); });
  b.entraria = b.costo + b.ganancia;
  b.margen = b.costo ? b.ganancia / b.costo : 0;
  return b;
}

// ── Lo realizado (las filas del Historial) ──
// { desde, hasta } del periodo anterior (claves de dia) o null en «Todo». «Este mes» se compara
// con los mismos dias del mes anterior (del 1 al dia de hoy, sin pasarse del ultimo del mes).
export function periodoAnterior(periodo, ahora) {
  var hoy = hoyDe(ahora);
  if (periodo === '7') return { desde: sumarDias(hoy, -13), hasta: sumarDias(hoy, -7) };
  if (periodo === '30') return { desde: sumarDias(hoy, -59), hasta: sumarDias(hoy, -30) };
  if (periodo === 'mes') {
    var anio = Number(hoy.slice(0, 4)), mes = Number(hoy.slice(5, 7)) - 1, dia = Number(hoy.slice(8, 10));
    var a = new Date(anio, mes - 1, 1, 12);
    var ultimo = new Date(anio, mes, 0, 12).getDate();
    var clave = a.getFullYear() + '-' + String(a.getMonth() + 1).padStart(2, '0') + '-';
    return { desde: clave + '01', hasta: clave + String(Math.min(dia, ultimo)).padStart(2, '0') };
  }
  return null;
}

// filas: las del Historial (filasHistorial) de la cuenta. Devuelve las metricas del periodo
// (core/historial.js) y las del anterior (null en «Todo»).
export function realizado(filas, periodo, keko, ahora) {
  var lista = delFiltro(Array.isArray(filas) ? filas : [], keko);
  var p = PERIODOS.indexOf(periodo) === -1 ? PREFERENCIAS_INICIALES.periodo : periodo;
  var actual = filtrar(lista, { rango: p }, ahora);
  var r = metricas(actual);
  r.filas = actual;
  var ant = periodoAnterior(p, ahora);
  r.anterior = ant ? metricas(filtrar(lista, { rango: 'propio', desde: ant.desde, hasta: ant.hasta }, ahora)) : null;
  r.rangoAnterior = ant;
  return r;
}

// La variacion de la ganancia contra el periodo anterior (decision 4A): null si no hay con que
// comparar (o los dos son cero); «nuevo» si antes no hubo ganancia y ahora si.
export function variacion(actual, anterior) {
  if (!anterior) return null;
  var a = num(actual && actual.ganancia), b = num(anterior.ganancia);
  if (Math.round(a) === 0 && Math.round(b) === 0) return null;
  if (Math.round(b) === 0) return { tipo: a > 0 ? 'nuevo' : 'baja', valor: null };
  var v = (a - b) / Math.abs(b);
  return { tipo: Math.abs(v) < 0.0005 ? 'igual' : v > 0 ? 'sube' : 'baja', valor: v };
}

// El grafico de rendimiento: la serie del Historial (por dia; en «Todo», por semana o por mes).
export function serieRendimiento(filas, periodo, keko, ahora) {
  return serieDiaria(delFiltro(Array.isArray(filas) ? filas : [], keko), { rango: PERIODOS.indexOf(periodo) === -1 ? '30' : periodo }, ahora);
}

// ── Capital dormido (decision 5A) ──
// Dias que lleva un lote en mano (desde su fecha de compra, en dias del reloj local); null sin fecha.
export function diasEnMano(l, ahora) {
  var f = l && typeof l.fecha_compra === 'string' && DIA.test(l.fecha_compra) ? l.fecha_compra.slice(0, 10) : null;
  if (!f) return null;
  var p = f.split('-');
  var compra = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12).getTime();
  var h = hoyDe(ahora).split('-');
  var hoy = new Date(Number(h[0]), Number(h[1]) - 1, Number(h[2]), 12).getTime();
  return Math.max(0, Math.round((hoy - compra) / DIA_MS));
}

// Lo que lleva DORMIDO_DIAS o mas en mano (sin lo por revisar), de lo mas antiguo a lo mas nuevo.
export function dormido(compras, ahora) {
  var lotes = deEstado(compras, 'comprado', false).map(function (l) { return { lote: l, dias: diasEnMano(l, ahora) }; })
    .filter(function (x) { return x.dias !== null && x.dias >= DORMIDO_DIAS; })
    .sort(function (a, b) { return b.dias - a.dias || num(a.lote.id) - num(b.lote.id); });
  lotes.forEach(function (x) { x.viejo = x.dias >= DORMIDO_VIEJO; });
  return { lotes: lotes, unidades: sumar(lotes, function (x) { return num(x.lote.cantidad); }), costo: sumar(lotes, function (x) { return num(x.lote.costo_total_cr); }) };
}

// ── El ciclo de tus furnis (decision 5A) ──
// Por revisar → En mano → Publicado → Vendido (del periodo). Cada etapa lleva a su seccion.
export function ciclo(compras, real, ahora) {
  var c = capital(compras);
  var pub = deEstado(compras, 'publicado');
  var hoy = caducanHoy(pub, ahora);
  return [
    { clave: 'revisar', unidades: c.revisar.unidades, lotes: c.revisar.lotes, dinero: c.revisar.costo, destino: { vista: 'inventario', filtro: 'comprado' } },
    { clave: 'mano', unidades: c.mano.unidades, lotes: c.mano.lotes, dinero: c.mano.costo, dormidos: dormido(compras, ahora).lotes.length, destino: { vista: 'inventario', filtro: 'comprado' } },
    { clave: 'publicado', unidades: c.publicado.unidades, lotes: c.publicado.lotes, dinero: c.publicado.costo, caducadas: unidadesCaducadasSniper(pub, ahora), caducanHoy: hoy.ofertas, destino: { vista: 'mercadillo' } },
    { clave: 'vendido', unidades: real ? real.unidades : 0, ventas: real ? real.ventas : 0, dinero: real ? real.entro : 0, destino: { vista: 'historial' } },
  ];
}

function unidadesCaducadasSniper(pub, ahora) {
  return sumar(pub.filter(function (l) { return delSniper(l) && caducada(l, ahora); }), function (l) { return num(l.cantidad); });
}
// Las ofertas del Sniper que caducan en menos de un dia, la mas proxima primero.
function caducanHoy(pub, ahora) {
  var xs = pub.filter(function (l) { if (!delSniper(l)) return false; var r = restante(l, ahora); return r !== null && r > 0 && r < DIA_MS; })
    .map(function (l) { return { lote: l, ms: restante(l, ahora) }; })
    .sort(function (a, b) { return a.ms - b.ms; });
  return { ofertas: xs.length, unidades: sumar(xs, function (x) { return num(x.lote.cantidad); }), proxima: xs[0] || null };
}

// Por furni (un grupo por furni_id), para las perdidas y los destacados.
function porFurni(lotes, valor) {
  var m = {}, orden = [];
  lotes.forEach(function (l) {
    var k = l.furni_id !== null && l.furni_id !== undefined ? 'f' + l.furni_id : 'n' + (l.nombre || '');
    var g = m[k];
    if (!g) {
      g = m[k] = { furni_id: l.furni_id === undefined ? null : l.furni_id, nombre: typeof l.nombre === 'string' ? l.nombre : '', classname: typeof l.classname === 'string' ? l.classname : null,
        revision: l.revision, unidades: 0, valor: 0, kekos: [], ltds: [] };
      orden.push(g);
    }
    g.unidades += num(l.cantidad);
    g.valor += valor(l);
    var n = l.keko ? String(l.keko).trim() : null;
    if (g.kekos.map(claveKeko).indexOf(claveKeko(n)) === -1) g.kekos.push(n);
    if (l.numero_ltd) g.ltds.push(Number(l.numero_ltd));
  });
  return orden;
}

// Los furnis publicados que dejan perdida (lo neto de lista no cubre lo que costo).
export function perdidas(compras) {
  return porFurni(deEstado(compras, 'publicado'), function (l) { return num(l.ganancia_cr); })
    .filter(function (g) { return g.valor < -1e-9; })
    .sort(function (a, b) { return a.valor - b.valor || a.nombre.localeCompare(b.nombre); });
}

// ── Necesita tu atencion (decision 6A): una sola bandeja, por prioridad ──
// fuentes: { compras, porAsignar (/api/ventas-por-asignar), auditoria (/api/auditoria/resumen),
// fantasmas (/api/fantasmas) }. Cada aviso: { tipo, tono, titulo, detalle, dinero?, destino }.
// La vista agrega el dinero (en las dos monedas) al detalle.
var PL = function (n, uno, varios) { return n === 1 ? uno : varios; };
export function atencion(fuentes, keko, ahora) {
  var f = fuentes || {};
  var compras = delFiltro(lotesDe(f.compras), keko);
  var conKeko = keko !== undefined && keko !== null && keko !== TODOS ? { keko: keko } : {};
  var avisos = [];

  var perd = perdidas(compras);
  if (perd.length) {
    avisos.push({ tipo: 'perdida', tono: 'rojo', n: perd.length,
      titulo: perd.length + PL(perd.length, ' furni publicado deja pérdida', ' furnis publicados dejan pérdida'),
      detalle: perd[0].nombre + (perd.length > 1 ? ' y ' + (perd.length - 1) + ' más' : '') + ': ' + PL(perd.length, 'su precio no cubre', 'sus precios no cubren') + ' lo que costó',
      dinero: perd.reduce(function (s, g) { return s + g.valor; }, 0), signo: true, destino: Object.assign({ vista: 'mercadillo' }, conKeko) });
  }

  var pa = f.porAsignar && f.porAsignar.disponible !== false && Array.isArray(f.porAsignar.ventas) ? delFiltro(f.porAsignar.ventas, keko) : [];
  if (pa.length) {
    var kpa = nombresKekos(pa);
    avisos.push({ tipo: 'por_asignar', tono: 'azul', n: pa.length,
      titulo: pa.length + PL(pa.length, ' venta del Sniper por asignar', ' ventas del Sniper por asignar'),
      detalle: 'No casaron con ningún lote' + (kpa.length ? ' de ' + lista(kpa) : ''), destino: Object.assign({ vista: 'inventario', filtro: 'por_asignar' }, conKeko) });
  }

  var rev = bloqueCosto(compras.filter(function (l) { return l.estado === 'comprado' && l.pendiente; }));
  if (rev.unidades) {
    avisos.push({ tipo: 'por_revisar', tono: 'ambar', n: rev.unidades,
      titulo: rev.unidades + ' und del Sniper por revisar', detalle: 'sin confirmar', dinero: rev.costo,
      destino: Object.assign({ vista: 'inventario', filtro: 'comprado' }, conKeko) });
  }

  var fz = f.fantasmas && f.fantasmas.disponible !== false && Array.isArray(f.fantasmas.fantasmas) ? delFiltro(f.fantasmas.fantasmas, keko) : [];
  var undFz = sumar(fz, function (x) { return num(x.unidades); });
  if (undFz) {
    avisos.push({ tipo: 'fantasmas', tono: 'gris', n: undFz,
      titulo: undFz + PL(undFz, ' furni fantasma', ' furnis fantasma'), detalle: 'Cuentan dos veces: «Ver cómo limpiarlos» en el Mercadillo',
      destino: Object.assign({ vista: 'mercadillo' }, conKeko) });
  }

  var aud = f.auditoria && Array.isArray(f.auditoria.kekos) ? delFiltro(f.auditoria.kekos, keko).filter(function (k) { return num(k.pendientes) > 0; }) : [];
  var difs = sumar(aud, function (k) { return num(k.pendientes); });
  if (difs) {
    avisos.push({ tipo: 'auditoria', tono: 'ambar', n: difs,
      titulo: difs + PL(difs, ' diferencia en la Auditoría', ' diferencias en la Auditoría'), detalle: lista(nombresKekos(aud)),
      destino: Object.assign({ vista: 'auditoria' }, aud.length === 1 ? { keko: aud[0].keko } : conKeko) });
  }

  var pub = compras.filter(function (l) { return l.estado === 'publicado'; });
  var cad = unidadesCaducadasSniper(pub, ahora);
  if (cad) {
    avisos.push({ tipo: 'caducadas', tono: 'ambar', n: cad,
      titulo: cad + PL(cad, ' und caducada', ' und caducadas'), detalle: 'Vuelven solas a Comprado con la próxima foto del Sniper',
      destino: Object.assign({ vista: 'inventario', filtro: 'publicado' }, conKeko) });
  }

  var hoy = caducanHoy(pub, ahora);
  if (hoy.ofertas) {
    avisos.push({ tipo: 'caducan_hoy', tono: 'ambar', n: hoy.ofertas,
      titulo: hoy.ofertas + PL(hoy.ofertas, ' oferta caduca hoy', ' ofertas caducan hoy'),
      detalle: (hoy.proxima.lote.nombre || 'Una oferta') + ' en ' + tiempoCorto(hoy.proxima.ms), proxima: hoy.proxima,
      destino: Object.assign({ vista: 'mercadillo' }, conKeko) });
  }
  return avisos;
}
function nombresKekos(xs) {
  var vistos = [], nombres = [];
  xs.forEach(function (x) { var c = claveKeko(x.keko); if (vistos.indexOf(c) === -1) { vistos.push(c); nombres.push(c ? String(x.keko).trim() : 'sin keko'); } });
  return nombres;
}
function lista(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]; }
function tiempoCorto(ms) {
  var m = Math.max(1, Math.floor(num(ms) / 60000));
  var h = Math.floor(m / 60), mi = m % 60;
  return h ? h + ' h' + (mi ? ' ' + mi + ' min' : '') : mi + ' min';
}

// ── Por keko ──
// Una fila por keko con lotes, en el orden de la app: capital, por cobrar, realizada del periodo
// y su parte del capital. kekos = /api/kekos (kekos[]); auditoria = /api/auditoria/resumen (la
// hora del ultimo inventario de cada keko del Sniper). La suma de las filas = el total.
export function porKeko(compras, filas, kekos, auditoria, periodo, ahora) {
  var lotes = lotesDe(compras);
  var bloques = agruparPorKeko(lotes, kekos || [], function (l) { return l.keko; }).bloques;
  var total = capital(lotes).total.costo;
  var fotos = {};
  (auditoria && Array.isArray(auditoria.kekos) ? auditoria.kekos : []).forEach(function (k) { fotos[claveKeko(k.keko)] = k.recibido_en || null; });
  return bloques.map(function (b) {
    var k = b.keko;
    var cap = capital(b.items).total.costo;
    var real = realizado(filas, periodo, k.clave, ahora);
    return {
      clave: k.clave, nombre: k.nombre, origen: k.origen || 'manual',
      inventario_en: k.clave ? fotos[k.clave] || null : null,
      capital: cap, porCobrar: porCobrar(b.items).ganancia, realizada: real.ganancia, ventas: real.ventas,
      parte: total ? cap / total : 0,
    };
  });
}

// ── Destacados (decision 8A) ──
export function masPorCobrar(compras) {
  return porFurni(deEstado(compras, 'publicado'), function (l) { return num(l.ganancia_cr); })
    .sort(function (a, b) { return b.valor - a.valor || a.nombre.localeCompare(b.nombre); });
}
// filas: las del periodo (realizado(...).filas). Lo mas vendido por unidades; empate, la ganancia.
export function masVendidos(filasPeriodo) {
  var lotes = (filasPeriodo || []).filter(function (x) { return x.tipo === 'lote'; })
    .map(function (x) { return { furni_id: x.furni_id, nombre: x.nombre, classname: x.classname, revision: x.revision, cantidad: x.cantidad, keko: x.keko, numero_ltd: null, ganancia: x.ganancia }; });
  return porFurni(lotes, function (l) { return num(l.ganancia); })
    .sort(function (a, b) { return b.unidades - a.unidades || b.valor - a.valor || a.nombre.localeCompare(b.nombre); });
}

// ── El pie: las cuentas de «Datos rapidos» ──
export function pieDatos(compras) {
  var lotes = lotesDe(compras);
  var furnis = {}, conStock = {};
  lotes.forEach(function (l) {
    furnis[l.furni_id] = 1;
    if (l.estado === 'comprado' || l.estado === 'publicado') conStock[l.furni_id] = 1;
  });
  return { furnis: Object.keys(furnis).length, conStock: Object.keys(conStock).length,
    compras: lotes.filter(function (l) { return l.origen_id === null || l.origen_id === undefined; }).length };
}

// ── Todo junto: lo que dibuja el Resumen ──
// datos: { compras, filas (filasHistorial), kekos, auditoria, porAsignar, fantasmas }.
// pref: { keko, periodo } (ya validadas con leerPreferencias / kekoVigente).
export function tablero(datos, pref, ahora) {
  var d = datos || {};
  var p = pref || PREFERENCIAS_INICIALES;
  var compras = delFiltro(lotesDe(d.compras), p.keko);
  var real = realizado(d.filas, p.periodo, p.keko, ahora);
  return {
    capital: capital(compras),
    porCobrar: porCobrar(compras),
    realizado: real,
    variacion: variacion(real, real.anterior),
    ciclo: ciclo(compras, real, ahora),
    serie: serieRendimiento(d.filas, p.periodo, p.keko, ahora),
    atencion: atencion({ compras: d.compras, porAsignar: d.porAsignar, auditoria: d.auditoria, fantasmas: d.fantasmas }, p.keko, ahora),
    porKeko: porKeko(d.compras, d.filas, d.kekos, d.auditoria, p.periodo, ahora),
    destacados: { cobrar: masPorCobrar(compras), vendidos: masVendidos(real.filas), dormido: dormido(compras, ahora) },
    pie: pieDatos(compras),
  };
}

// ── Textos del periodo ──
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// { titulo: «Últimos 30 días», corto: «30 días», comparado: «vs. los 30 días anteriores» }.
export function textoPeriodo(periodo, ahora) {
  var hoy = hoyDe(ahora);
  if (periodo === '7') return { titulo: 'Últimos 7 días', corto: '7 días', comparado: 'vs. los 7 días anteriores' };
  if (periodo === 'mes') {
    var mes = Number(hoy.slice(5, 7)) - 1;
    var ant = periodoAnterior('mes', ahora);
    return { titulo: 'Este mes (' + MESES[mes] + ')', corto: 'el mes',
      comparado: 'vs. del 1 al ' + Number(ant.hasta.slice(8, 10)) + ' de ' + MESES[(mes + 11) % 12] };
  }
  if (periodo === 'todo') return { titulo: 'Desde el principio', corto: 'todo', comparado: null };
  return { titulo: 'Últimos 30 días', corto: '30 días', comparado: 'vs. los 30 días anteriores' };
}

// ── Preferencias (se recuerdan en este equipo; decision 2A) ──
// Sin almacenamiento (o roto), los valores iniciales. Lo que no es valido, tambien.
export function leerPreferencias(almacen) {
  var g = null;
  try { g = JSON.parse((almacen && almacen.getItem(CLAVE_PREFERENCIAS)) || 'null'); } catch (_) { g = null; }
  var p = Object.assign({}, PREFERENCIAS_INICIALES);
  if (g && typeof g === 'object') {
    if (typeof g.keko === 'string') p.keko = g.keko === TODOS ? TODOS : claveKeko(g.keko);
    if (PERIODOS.indexOf(g.periodo) !== -1) p.periodo = g.periodo;
    if (MONEDAS.indexOf(g.moneda) !== -1) p.moneda = g.moneda;
    if (DESTACADOS.indexOf(g.destacados) !== -1) p.destacados = g.destacados;
  }
  return p;
}
export function guardarPreferencias(almacen, pref) {
  try {
    if (almacen) almacen.setItem(CLAVE_PREFERENCIAS, JSON.stringify({ keko: pref.keko, periodo: pref.periodo, moneda: pref.moneda, destacados: pref.destacados }));
  } catch (_) { /* sin almacenamiento */ }
}
