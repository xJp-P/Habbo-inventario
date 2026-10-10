// public/js/vistas/Resumen.js — el Resumen nuevo (v2.0.0): el «centro de mando».
//
// Maqueta aprobada por el dueño el 09-10-2026 (plan 1A a 8A y maqueta 1A a 6A): barra de control
// fija (keko, periodo y moneda), tres cifras principales (capital en juego, ganancia realizada y
// por cobrar), el ciclo de los furnis, rendimiento, «Necesita tu atencion» (a la altura de
// «Rendimiento», con scroll por dentro), por keko y destacados (a la altura de «Por keko», tambien
// con scroll por dentro: pedido del dueño tras probar la fase 3). Todo el dinero va en las dos
// monedas, sin iconos: el credito es «cr» y el Lingo siempre «L» (decision del dueño).
//
// Toda la logica esta en core/tablero.js (puro, con pruebas contra la base); aqui solo se dibuja.
// Cada tarjeta tiene su barrera: si una falla, las demas se ven. La tasa del Lingo ya no tiene
// tarjeta (esta en la cabecera); si tu base guarda otra que la de Habbo.es, un aviso deja volver.

import { h, useState, useEffect, useRef } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtLg, fmtPct, fmtHace } from '../core/format.js';
import { filasHistorial, diaCorto } from '../core/historial.js';
import { tablero, cifraDoble, kekosDelResumen, kekoVigente, leerPreferencias, guardarPreferencias, textoPeriodo, TODOS, DORMIDO_DIAS, TOPE_DESTACADOS } from '../core/tablero.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni } from '../componentes/base.js';
import { AvatarKeko } from '../componentes/BloquesKeko.js';
import { Barrera, Dibujar } from '../componentes/Barrera.js';

var TASA_HABBO = 50;
var PERIODOS_UI = [['7', '7 d'], ['30', '30 d'], ['mes', 'Este mes'], ['todo', 'Todo']];
var ICONO_AVISO = { perdida: 'alert', por_asignar: 'tag', por_revisar: 'radar', fantasmas: 'fantasma', auditoria: 'audit', caducadas: 'reloj', caducan_hoy: 'reloj' };

function almacen() { try { return window.localStorage; } catch (_) { return null; } }
function mayuscula(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function pl(n, uno, varios) { return n === 1 ? uno : varios; }

// La cifra doble: la moneda principal grande y la otra debajo (tam: '', 'm' o 's').
function Cifra(props) {
  var c = cifraDoble(props.valor, { tasa: props.tasa, moneda: props.moneda, signo: props.signo, cero: props.cero });
  if (!c) return h('span', { className: 'tenue mono', title: 'Nada' }, '—');
  var esL = c.principal.unidad === 'L';
  return h('div', { className: 'rz-cifra' + (props.tam ? ' ' + props.tam : '') + (c.tono ? ' ' + c.tono : ''), title: c.titulo },
    h('div', { className: 'rz-cifra-p' }, c.principal.texto, h('span', { className: 'u' + (esL ? ' rz-l' : '') }, c.principal.unidad)),
    h('div', { className: 'rz-cifra-s' + (esL ? '' : ' rz-l') }, h('span', { className: 'mono' }, c.secundaria.texto), c.secundaria.unidad));
}
// En una linea de texto: «14.965 cr · 299,30 L».
function Dual(props) {
  var c = cifraDoble(props.valor, { tasa: props.tasa, moneda: props.moneda, signo: props.signo });
  var esL = c.principal.unidad === 'L';
  return h('span', { className: 'rz-dual', title: c.titulo },
    h('b', { className: esL ? 'rz-l' : '' }, c.principal.texto), ' ' + c.principal.unidad,
    h('span', { className: 'o' + (esL ? ' cr' : '') }, '· ' + c.secundaria.texto + ' ' + c.secundaria.unidad));
}

// Si la lista no cabe en su tarjeta, el borde de abajo se desvanece (hasta llegar al final).
function useDesborda(ref) {
  useEffect(function () {
    var l = ref.current;
    if (!l) return undefined;
    function revisar() { l.classList.toggle('desborda', l.scrollHeight - l.scrollTop - l.clientHeight > 4); }
    revisar();
    l.addEventListener('scroll', revisar);
    var ro = window.ResizeObserver ? new ResizeObserver(revisar) : null;
    if (ro) ro.observe(l);
    return function () { l.removeEventListener('scroll', revisar); if (ro) ro.disconnect(); };
  });
}

function Delta(props) {
  var v = props.variacion;
  if (!v) return null;
  var texto = v.tipo === 'nuevo' ? '▲ nuevo' : v.tipo === 'igual' ? '= 0 %' : (v.tipo === 'sube' ? '▲ ' : '▼ ') + (v.valor === null ? '' : fmtPct(Math.abs(v.valor)).replace(/\s/g, ''));
  return h('span', { className: 'rz-delta ' + v.tipo, title: props.titulo }, texto.trim());
}

export function ResumenView(props) {
  var sP = useState(function () { return leerPreferencias(almacen()); }); var pref = sP[0]; var setPref = sP[1];
  var sA = useState(Date.now()); var ahora = sA[0]; var setAhora = sA[1];
  var refLista = useRef(null);
  var refDest = useRef(null);
  // Al minuto: lo que caduca hoy y los periodos se mueven solos.
  useEffect(function () { var t = setInterval(function () { setAhora(Date.now()); }, 60000); return function () { clearInterval(t); }; }, []);
  useEffect(function () { guardarPreferencias(almacen(), pref); }, [pref.keko, pref.periodo, pref.moneda, pref.destacados]);
  function cambiar(parche) { setPref(function (p) { return Object.assign({}, p, parche); }); }

  var r = props.resumen || {};
  var tasa = Number(r.tasa) > 0 ? Number(r.tasa) : TASA_HABBO;
  var compras = props.compras || [];
  var listaKekos = props.kekos && props.kekos.disponible ? props.kekos.kekos || [] : [];
  var porAsignar = props.porAsignar && props.porAsignar.disponible ? props.porAsignar.ventas || [] : [];
  var chips = kekosDelResumen(compras, listaKekos);
  var keko = kekoVigente(pref.keko, chips);
  var filas = filasHistorial(compras, porAsignar, props.furnis || []);
  var t = tablero({ compras: compras, filas: filas, kekos: listaKekos, auditoria: props.auditoria, porAsignar: props.porAsignar, fantasmas: props.fantasmas },
    { keko: keko, periodo: pref.periodo }, ahora);
  var tp = textoPeriodo(pref.periodo, ahora);
  var mon = { tasa: tasa, moneda: pref.moneda };

  // El nombre de un keko a partir de su clave (la Auditoria lo pide con su nombre).
  function nombreDe(clave) {
    if (clave === undefined || clave === null || clave === TODOS) return null;
    var k = chips.find(function (x) { return x.clave === clave; });
    return k ? k.nombre : null;
  }
  var nombreKeko = keko === '' ? 'lo sin keko' : nombreDe(keko);
  var kekosHistorial = keko === TODOS ? [] : [keko];
  // Adonde lleva cada clic: el destino de core/tablero.js con el keko del filtro.
  function ir(destino) {
    if (!destino || !props.onIr) return;
    var d = Object.assign({}, destino);
    if (d.keko !== undefined && d.keko !== null) d.keko = nombreDe(d.keko) || d.keko;
    if (d.vista === 'historial') d = Object.assign({ rango: pref.periodo, kekos: kekosHistorial }, d);
    props.onIr(d);
  }

  useDesborda(refLista);
  useDesborda(refDest);

  function volverATasaHabbo() {
    API.put('/api/config/tasa', { tasa_lingo: TASA_HABBO }).then(function (x) { if (x) props.onCambio('Tasa del Lingo: ' + TASA_HABBO + ' cr, la de Habbo.es'); });
  }

  function tarjeta(nombre, dibujar) {
    return h(Barrera, { key: nombre, tipo: 'tarjeta', etiqueta: '«' + nombre + '»', donde: 'Resumen › ' + nombre, onVerErrores: props.onVerErrores },
      h(Dibujar, { dibujar: dibujar }));
  }

  // ── La barra de control ──
  var barra = h('div', { className: 'rz-barra' },
    h('div', { className: 'rz-kekos', role: 'group', 'aria-label': 'Keko' },
      h('button', { className: 'chip rz-todos' + (keko === TODOS ? ' activo' : ''), onClick: function () { cambiar({ keko: TODOS }); } }, 'Todos'),
      chips.map(function (k) {
        return h('button', { key: k.clave || '(sin)', className: 'chip' + (keko === k.clave ? ' activo' : ''), title: k.origen === 'sniper' ? 'Keko de un Sniper' : k.origen === 'sin' ? 'Lotes sin keko' : 'Keko manual',
          onClick: function () { cambiar({ keko: keko === k.clave ? TODOS : k.clave }); } },
          h(AvatarKeko, { keko: { nombre: k.nombre || '', origen: k.origen }, tam: 20 }), k.clave ? k.nombre : 'Sin keko');
      })),
    h('div', { className: 'rz-segs' },
      h('div', { className: 'segmento rz-seg', role: 'group', 'aria-label': 'Período de lo vendido' }, PERIODOS_UI.map(function (p) {
        return h('button', { key: p[0], className: pref.periodo === p[0] ? 'activo' : '', title: textoPeriodo(p[0], ahora).titulo, onClick: function () { cambiar({ periodo: p[0] }); } }, p[1]);
      })),
      h('div', { className: 'segmento rz-seg', role: 'group', 'aria-label': 'Moneda principal', title: 'La moneda que va grande; la otra va debajo' },
        h('button', { className: pref.moneda === 'cr' ? 'activo' : '', title: 'Créditos', onClick: function () { cambiar({ moneda: 'cr' }); } }, 'cr'),
        h('button', { className: 'rz-l' + (pref.moneda === 'L' ? ' activo' : ''), title: 'Lingos (1 L = ' + fmtLg(tasa) + ' cr)', onClick: function () { cambiar({ moneda: 'L' }); } }, 'L'))));

  var avisoTasa = tasa !== TASA_HABBO ? h('div', { className: 'aviso aviso-ambar rz-aviso-tasa' },
    h('span', { style: { flex: 1, minWidth: 200 } }, 'Tienes guardada una tasa de ' + fmtLg(tasa) + ' cr por L y los cálculos la usan; en Habbo.es 1 L = ' + TASA_HABBO + ' cr.'),
    h('button', { className: 'btn btn-chico', onClick: volverATasaHabbo }, 'Usar ' + TASA_HABBO + ' cr')) : null;

  // ── Las tres cifras principales ──
  function heroes() {
    var cap = t.capital, total = cap.total.costo || 1;
    var seg = function (v, color, titulo) { return v ? h('span', { key: titulo, title: titulo, style: { flex: '0 0 ' + (v / total * 100) + '%', background: color } }) : null; };
    var real = t.realizado, pc = t.porCobrar;
    return h('div', { className: 'rz-heroes' },
      h('div', { className: 'rz-hero entra' },
        h('div', { className: 'rz-et' }, h(Ico, { name: 'capas', size: 14 }), 'Capital en juego'),
        h(Cifra, Object.assign({ valor: cap.total.costo }, mon)),
        cap.total.costo ? [
          h('div', { key: 'b', className: 'rz-capbar', title: 'Lo que invertiste y aún no vendes' },
            seg(cap.revisar.costo, 'var(--yellow)', 'Por revisar'), seg(cap.mano.costo, 'var(--text3)', 'En mano'), seg(cap.publicado.costo, 'var(--purple)', 'Publicado')),
          h('div', { key: 'l', className: 'rz-leyenda' },
            cap.revisar.costo ? h('span', null, h('i', { style: { background: 'var(--yellow)' } }), 'Por revisar ', h(Dual, Object.assign({ valor: cap.revisar.costo }, mon))) : null,
            h('span', null, h('i', { style: { background: 'var(--text3)' } }), 'En mano ', h(Dual, Object.assign({ valor: cap.mano.costo }, mon))),
            h('span', null, h('i', { style: { background: 'var(--purple)' } }), 'Publicado ', h(Dual, Object.assign({ valor: cap.publicado.costo }, mon))))]
          : h('div', { className: 'rz-pie-hero' }, 'Cuando registres una compra (o llegue una del Sniper), aquí verás dónde está tu dinero.')),
      h('div', { className: 'rz-hero entra' },
        h('div', { className: 'rz-et' }, h(Ico, { name: 'tag', size: 14 }), 'Ganancia realizada', h('span', { className: 'tag tag-gris' }, mayuscula(tp.corto))),
        h(Cifra, Object.assign({ valor: real.ganancia, signo: true }, mon)),
        h('div', { className: 'rz-pie-hero' },
          t.variacion ? h('div', { className: 'linea' }, h(Delta, { variacion: t.variacion, titulo: 'Ganancia del período anterior: ' + fmtLg(Math.round(real.anterior.ganancia)) + ' cr' }), h('span', null, tp.comparado))
            : !t.realizado.rangoAnterior && real.ventas ? h('div', { className: 'linea' }, 'Desde tu primera venta') : null,
          h('div', { className: 'linea' }, real.ventas ? 'Margen ' + (real.margen === null ? '—' : fmtPct(real.margen)) + ' · ' + real.ventas + pl(real.ventas, ' venta', ' ventas') : 'Sin ventas en este período'))),
      h('div', { className: 'rz-hero entra' },
        h('div', { className: 'rz-et' }, h(Ico, { name: 'trending', size: 14 }), 'Ganancia por cobrar'),
        h(Cifra, Object.assign({ valor: pc.ganancia, signo: true }, mon)),
        h('div', { className: 'rz-pie-hero' }, pc.lotes
          ? [h('div', { key: 'e', className: 'linea' }, 'Te entraría ', h(Dual, Object.assign({ valor: pc.entraria }, mon))),
            h('div', { key: 'm', className: 'linea' }, 'Margen ' + fmtPct(pc.margen) + ' · comisión ', h(Dual, Object.assign({ valor: pc.comision }, mon)))]
          : h('div', { className: 'linea' }, 'Nada publicado: la ganancia aparece al publicar'))));
  }

  // ── El ciclo de tus furnis ──
  function ciclo() {
    var conKeko = keko === TODOS ? {} : { keko: keko };
    var datos = {
      revisar: { nombre: 'Por revisar', color: 'var(--yellow)', titulo: 'Lo que compró el Sniper y aún no confirmas', vacio: 'al día', extra: function () { return 'del Sniper, sin confirmar'; } },
      mano: { nombre: 'En mano', color: 'var(--text3)', titulo: 'Lo que tienes en Habbo sin publicar: solo su costo', vacio: 'nada en mano',
        extra: function (e) { return [e.lotes + pl(e.lotes, ' lote', ' lotes'), e.dormidos ? h('span', { key: 'd', className: 'rz-ambar' }, '· ' + e.dormidos + ' con ' + DORMIDO_DIAS + '+ días') : null]; } },
      publicado: { nombre: 'Publicado', color: 'var(--purple)', titulo: 'Lo que está en el Mercadillo: lo que costó', vacio: 'nada en el Mercadillo',
        extra: function (e) { return [e.lotes + pl(e.lotes, ' lote', ' lotes'), e.caducadas ? h('span', { key: 'c', className: 'rz-ambar' }, '· ' + e.caducadas + pl(e.caducadas, ' caducada', ' caducadas'))
          : e.caducanHoy ? h('span', { key: 'h', className: 'rz-ambar' }, '· ' + e.caducanHoy + ' caduca' + pl(e.caducanHoy, '', 'n') + ' hoy') : null]; } },
      vendido: { nombre: 'Vendido · ' + tp.corto, color: 'var(--green)', titulo: 'Lo que vendiste en el período: lo que te entró, ya sin comisión', vacio: 'sin ventas en este período', extra: function () { return 'lo que te entró'; } },
    };
    return h('div', { className: 'rz-ciclo entra' }, t.ciclo.map(function (e, i) {
      var d = datos[e.clave];
      return h('button', { key: e.clave, className: 'rz-etapa' + (e.unidades ? '' : ' vacia'), title: d.titulo, onClick: function () { ir(Object.assign({}, e.destino, conKeko)); } },
        i ? h('span', { className: 'flecha', 'aria-hidden': true }, h(Ico, { name: 'chevright', size: 13, sw: 2.2 })) : null,
        h('span', { className: 'rz-etapa-ir', 'aria-hidden': true }, h(Ico, { name: 'ir', size: 14 })),
        h('span', { className: 'rz-etapa-n' }, h('span', { className: 'rz-etapa-dot', style: { background: d.color } }), d.nombre),
        h('span', { className: 'rz-etapa-und' }, e.unidades.toLocaleString('es-CO'), h('small', null, 'und')),
        e.unidades ? h(Cifra, Object.assign({ valor: e.dinero, tam: 's' }, mon)) : h('span', { className: 'rz-etapa-extra' }, d.vacio),
        e.unidades ? h('span', { className: 'rz-etapa-extra' }, d.extra(e)) : null);
    }));
  }

  // ── Rendimiento ──
  function rendimiento() {
    var s = t.serie, real = t.realizado;
    var graf;
    if (!s.total.ventas) {
      graf = h('div', { className: 'rz-vacio' }, h(Ico, { name: 'tag', size: 22, color: 'var(--text3)' }),
        h('div', { className: 't' }, pref.periodo === 'todo' ? 'Todavía no hay ventas' : 'Sin ventas en este período'),
        h('div', null, 'Cuando el Sniper o tú vendan algo, aquí verás la ganancia de cada día.'));
    } else {
      var max = s.puntos.reduce(function (m, p) { return Math.max(m, Math.abs(p.ganancia), Math.max(0, p.sniper) + Math.max(0, p.manual)); }, 1);
      var medio = s.puntos[Math.floor(s.puntos.length / 2)];
      graf = h('div', { className: 'rz-graf' },
        h('span', { className: 'rz-max mono' }, h(Dual, Object.assign({ valor: max }, mon))),
        h('div', { className: 'rz-barras' }, s.puntos.map(function (p) {
          var cuando = (s.por === 'semana' ? 'Semana del ' : s.por === 'mes' ? 'Mes de ' : '') + diaCorto(p.desde, ahora);
          var c = cifraDoble(p.ganancia, { tasa: tasa, moneda: 'cr', signo: true });
          var titulo = cuando + ': ' + (p.ventas ? c.principal.texto + ' cr (' + c.secundaria.texto + ' L) · ' + p.ventas + pl(p.ventas, ' venta', ' ventas') : 'sin ventas') + (p.porAsignar ? ' · ' + p.porAsignar + ' por asignar' : '');
          var abrir = function () { ir({ vista: 'historial', periodo: { desde: p.desde, hasta: p.hasta } }); };
          if (!p.ventas) return h('button', { key: p.clave, className: 'rz-b vacia', title: titulo, 'aria-label': titulo, onClick: abrir });
          if (p.ganancia < 0) return h('button', { key: p.clave, className: 'rz-b', title: titulo, 'aria-label': titulo, onClick: abrir }, h('i', { className: 'n', style: { height: Math.max(3, Math.abs(p.ganancia) / max * 100) + '%' } }));
          var sn = Math.max(0, p.sniper), mn = Math.max(0, p.manual), k = sn + mn ? p.ganancia / (sn + mn) : 0;
          return h('button', { key: p.clave, className: 'rz-b', title: titulo, 'aria-label': titulo, onClick: abrir },
            mn > 0 ? h('i', { className: 'm', style: { height: Math.max(2, mn * k / max * 100) + '%' } }) : null,
            sn > 0 ? h('i', { className: 's', style: { height: Math.max(2, sn * k / max * 100) + '%' } }) : null);
        })),
        h('div', { className: 'rz-eje' }, h('span', null, diaCorto(s.puntos[0].desde, ahora)), h('span', null, medio ? diaCorto(medio.desde, ahora) : ''),
          h('span', null, s.por === 'dia' ? 'hoy' : s.por === 'semana' ? 'esta semana' : 'este mes')));
    }
    return h('div', { className: 'rz-caja entra' },
      h('div', { className: 'rz-caja-cab' },
        h('span', { className: 'titulo' }, h(Ico, { name: 'reloj', size: 16, color: 'var(--green)' }), 'Rendimiento'),
        h('span', { className: 'sub' }, tp.titulo + (s.por === 'semana' ? ' · por semana' : s.por === 'mes' ? ' · por mes' : '')),
        h('span', { style: { marginLeft: 'auto' } }, h(Delta, { variacion: t.variacion, titulo: tp.comparado || '' }))),
      h('div', { className: 'rz-mini' },
        h('div', null, h('div', { className: 'et' }, 'Ventas'), h('div', { className: 'num' }, real.ventas.toLocaleString('es-CO'))),
        h('div', null, h('div', { className: 'et' }, 'Te entró'), h(Cifra, Object.assign({ valor: real.entro, tam: 'm' }, mon))),
        h('div', null, h('div', { className: 'et' }, 'Comisión pagada'), h(Cifra, Object.assign({ valor: real.comision, tam: 'm' }, mon))),
        h('div', null, h('div', { className: 'et' }, 'Margen'), h('div', { className: 'num ' + (real.ganancia > 0 ? 'pos' : real.ganancia < 0 ? 'neg' : '') }, real.ventas && real.margen !== null ? fmtPct(real.margen) : '—'))),
      graf,
      h('div', { className: 'rz-graf-pie' },
        h('div', { className: 'rz-leyenda' },
          h('span', null, h('i', { style: { background: 'var(--green)' } }), 'Sniper'),
          h('span', null, h('i', { style: { background: 'var(--blue)' } }), 'Tú'),
          h('span', null, h('i', { style: { background: 'var(--red)' } }), 'Día con pérdida')),
        h('button', { className: 'btn-enlace', onClick: function () { ir({ vista: 'historial' }); } }, 'Ver todo en el Historial')));
  }

  // ── Necesita tu atencion ──
  function atencion() {
    var avisos = t.atencion;
    return h('div', { className: 'rz-caja rz-at entra' },
      h('div', { className: 'rz-caja-cab' },
        h('span', { className: 'titulo' }, h(Ico, { name: 'bell', size: 16, color: avisos.length ? 'var(--yellow)' : 'var(--green)' }), 'Necesita tu atención'),
        avisos.length ? h('span', { className: 'rz-at-num' }, avisos.length) : null),
      h('div', { className: 'rz-at-lista', ref: refLista }, avisos.length ? avisos.map(function (a) {
        return h('button', { key: a.tipo, className: 'rz-aviso', onClick: function () { ir(a.destino); } },
          h('span', { className: 'rz-aviso-ico ' + a.tono }, h(Ico, { name: ICONO_AVISO[a.tipo] || 'alert', size: 16, sw: 2 })),
          h('span', { style: { minWidth: 0 } },
            h('div', { className: 'rz-aviso-t' }, a.titulo),
            h('div', { className: 'rz-aviso-s' },
              a.dinero !== undefined && a.tipo === 'por_revisar' ? [h(Dual, Object.assign({ key: 'd', valor: a.dinero }, mon)), ' ' + a.detalle]
                : a.dinero !== undefined ? [a.detalle + ' · ', h(Dual, Object.assign({ key: 'd', valor: a.dinero, signo: true }, mon))] : a.detalle)),
          h('span', { className: 'rz-aviso-ir' }, 'Ver', h(Ico, { name: 'chevright', size: 13, sw: 2.2 })));
      }) : h('div', { className: 'rz-at-ok' }, h(Ico, { name: 'checkCircle', size: 22, color: 'var(--green)' }),
        h('div', null, h('div', { style: { fontWeight: 700 } }, 'Todo en orden'),
          h('div', { className: 'rz-aviso-s' }, 'Nada por revisar, asignar ni retirar, y nada publicado deja pérdida.')))));
  }

  // ── Por keko ──
  function porKeko() {
    var filasK = t.porKeko;
    var cuerpo = filasK.length ? h('table', { className: 'rz-kt' },
      h('colgroup', null, h('col'), h('col', { style: { width: '24%' } }), h('col', { style: { width: '21%' } }), h('col', { style: { width: '21%' } })),
      h('thead', null, h('tr', null, h('th', null, 'Keko'), h('th', null, 'Capital'), h('th', null, 'Por cobrar'), h('th', { title: 'Ganancia realizada · ' + tp.titulo }, 'Realizada'))),
      h('tbody', null, filasK.map(function (f) {
        var sel = keko === f.clave, otro = keko !== TODOS && !sel;
        var sub = f.origen === 'sniper' ? 'Sniper · ' + (f.inventario_en ? fmtHace(f.inventario_en) : 'sin inventario') : f.origen === 'sin' ? 'Lotes sin keko' : 'Manual';
        var elegir = function () { cambiar({ keko: sel ? TODOS : f.clave }); };
        return h('tr', { key: f.clave || '(sin)', className: (sel ? 'sel' : '') + (otro ? ' otro' : ''), tabIndex: 0, title: sel ? 'Quitar el filtro' : 'Ver solo ' + (f.clave ? f.nombre : 'lo sin keko'),
          onClick: elegir, onKeyDown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(); } } },
          h('td', null, h('div', { className: 'rz-k' }, h(AvatarKeko, { keko: { nombre: f.nombre || '', origen: f.origen }, tam: 30 }),
            h('div', { style: { minWidth: 0, flex: 1 } }, h('div', { className: 'n' }, f.clave ? f.nombre : 'Sin keko'), h('div', { className: 's', title: f.origen === 'sniper' && f.inventario_en ? 'Su último inventario llegó ' + fmtHace(f.inventario_en) : undefined }, sub),
              h('div', { className: 'rz-part', title: fmtPct(f.parte) + ' de tu capital' }, h('span', { style: { width: (f.parte * 100) + '%' } }))))),
          h('td', null, h(Cifra, Object.assign({ valor: f.capital, tam: 's', cero: true }, mon))),
          h('td', null, h(Cifra, Object.assign({ valor: f.porCobrar, tam: 's', signo: true, cero: true }, mon))),
          h('td', null, h(Cifra, Object.assign({ valor: f.realizada, tam: 's', signo: true, cero: true }, mon))));
      })))
      : h('div', { className: 'rz-vacio' }, h(Ico, { name: 'user', size: 22, color: 'var(--text3)' }), h('div', { className: 't' }, 'Todavía no tienes lotes'),
        h('div', null, 'Conecta un Sniper o registra una compra: cada keko tendrá aquí su fila.'));
    return h('div', { className: 'rz-caja entra' },
      h('div', { className: 'rz-caja-cab' }, h('span', { className: 'titulo' }, h(Ico, { name: 'user', size: 16, color: 'var(--blue)' }), 'Por keko'),
        h('span', { className: 'sub' }, filasK.length ? 'Clic en uno para ver solo ese keko' : '')),
      cuerpo);
  }

  // ── Destacados ──
  function destacados() {
    var d = t.destacados, cual = pref.destacados;
    var filasD, nota = null, vacio;
    var kekosTexto = function (ks) { return ks.map(function (k) { return k || 'sin keko'; }).join(', '); };
    if (cual === 'vendidos') {
      vacio = 'Sin ventas en este período.';
      filasD = d.vendidos.map(function (g) {
        return { clave: 'v' + g.furni_id, furni: g, ltds: [], sub: g.unidades + pl(g.unidades, ' vendida', ' vendidas') + ' · ' + kekosTexto(g.kekos), valor: g.valor, signo: true,
          abrir: function () { ir({ vista: 'historial', q: g.nombre }); } };
      });
    } else if (cual === 'dormido') {
      vacio = 'Nada lleva ' + DORMIDO_DIAS + ' días o más en mano. Tu stock se mueve.';
      if (d.dormido.lotes.length) nota = h('div', { className: 'rz-top-nota' }, h(Ico, { name: 'reloj', size: 14, color: 'var(--yellow)' }),
        h('span', null, d.dormido.lotes.length + pl(d.dormido.lotes.length, ' lote lleva ', ' lotes llevan ') + DORMIDO_DIAS + ' días o más en mano: ', h(Dual, Object.assign({ valor: d.dormido.costo }, mon)), ' quietos.'));
      filasD = d.dormido.lotes.map(function (x) {
        var l = x.lote;
        return { clave: 'd' + l.id, furni: l, ltds: l.numero_ltd ? [l.numero_ltd] : [], valor: Number(l.costo_total_cr) || 0,
          sub: h('span', null, h('span', { className: x.viejo ? 'rz-ambar' : '' }, x.dias + ' días'), ' en mano · ' + (l.keko || 'sin keko') + ' · ' + l.cantidad + ' und'),
          abrir: function () { ir({ vista: 'inventario', filtro: 'comprado', keko: l.keko || null, lotes: [l.id] }); } };
      });
    } else {
      vacio = 'Nada publicado todavía.';
      filasD = d.cobrar.map(function (g) {
        return { clave: 'c' + g.furni_id, furni: g, ltds: g.ltds, sub: kekosTexto(g.kekos) + ' · ' + g.unidades + ' und', valor: g.valor, signo: true,
          abrir: function () { if (props.onVerFurni) props.onVerFurni(g.furni_id); } };
      });
    }
    var tabs = [['cobrar', 'Más por cobrar', 'Lo publicado que más ganancia te dejaría'], ['vendidos', 'Más vendidos', 'Lo que más vendiste en el período: ' + tp.titulo.toLowerCase()], ['dormido', 'Capital dormido', 'Lo que lleva ' + DORMIDO_DIAS + ' días o más en mano']];
    return h('div', { className: 'rz-caja rz-dest entra' },
      h('div', { className: 'rz-caja-cab' }, h('span', { className: 'titulo' }, h(Ico, { name: 'trofeo', size: 16, color: 'var(--gold)' }), 'Destacados')),
      h('div', { className: 'segmento rz-seg', style: { display: 'flex', marginBottom: 10 }, role: 'tablist' }, tabs.map(function (x) {
        return h('button', { key: x[0], role: 'tab', 'aria-selected': cual === x[0], style: { flex: 1 }, className: cual === x[0] ? 'activo' : '', title: x[2], onClick: function () { cambiar({ destacados: x[0] }); } }, x[1]);
      })),
      nota,
      filasD.length ? h('div', { className: 'rz-top', ref: refDest }, filasD.slice(0, TOPE_DESTACADOS).map(function (x, i) {
        return h('button', { key: x.clave, className: 'rz-top-fila', onClick: x.abrir },
          h('span', { className: 'rz-top-n' }, i + 1),
          h(NombreFurni, { furni: x.furni, ltds: x.ltds, size: 32, sub: x.sub }),
          h(Cifra, Object.assign({ valor: x.valor, tam: 's', signo: x.signo }, mon)));
      })) : h('div', { className: 'rz-vacio', style: { padding: 16 } }, vacio));
  }

  return h('div', { className: 'contenedor fade-in rz' },
    barra,
    avisoTasa,
    tarjeta('Cifras principales', heroes),
    tarjeta('El ciclo de tus furnis', ciclo),
    h('div', { className: 'rz-fila2' }, tarjeta('Rendimiento', rendimiento), tarjeta('Necesita tu atención', atencion)),
    h('div', { className: 'rz-fila3' }, tarjeta('Por keko', porKeko), tarjeta('Destacados', destacados)),
    h('div', { className: 'rz-pie-datos' },
      h('span', null, h('b', null, t.pie.furnis), ' furnis distintos'),
      h('span', null, h('b', null, t.pie.conStock), ' con stock'),
      h('span', null, h('b', null, t.pie.compras), ' compras registradas'),
      nombreKeko ? h('span', null, 'solo ', h('b', null, nombreKeko)) : null,
      h('span', null, '1 L = ' + fmtLg(tasa) + ' cr')));
}
