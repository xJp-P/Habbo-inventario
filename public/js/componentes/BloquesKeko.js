// public/js/componentes/BloquesKeko.js — piezas del Inventario y del Mercadillo por keko
// (v1.6.0): la tarjeta de cada keko con su cabecera fija, su avatar y el indice «Ir a».
//
// Diseño aprobado por el dueño (maqueta del 29-sep-2026, diseño A): una tarjeta por keko,
// SIEMPRE abierta (nada se pliega ni se recorta: todo se ve haciendo scroll). Su cabecera
// y la fila de titulos se quedan arriba mientras recorres sus filas; la del siguiente keko
// la empuja. Con sitio para todas las columnas, anchos fijos: todos los bloques quedan
// alineados (useAlineado). El orden y el reparto viven en core/kekos.js.
//
// Encabezado C (v1.8.0, maqueta del 02-10-2026, en el Inventario y el Mercadillo): a la
// derecha, una dona con los furnis del keko, una capsula «lotes · und · dinero» y, al pasar
// el raton o con el teclado, un globo con «donde esta tu dinero» por furni; la misma
// composicion pinta la barra de colores del borde inferior. Misma altura que antes (62 px):
// la fila de titulos fija no se mueve. Los numeros salen de core/grupos.js.

import { h, useState, useEffect, useRef } from '../core/react.js';
import { fmtD, fmtCr } from '../core/format.js';
import { Ico } from './iconos.js';
import { IconoFurni } from './base.js';
import { cortesDona } from '../core/grupos.js';

// Cabeza del keko desde el generador de avatares oficial de Habbo.es (solo Habbo.es), en
// su tamaño grande: se reduce sin suavizar y queda muy nitida (styles.css, .av-keko).
export function urlAvatar(nombre) {
  return 'https://www.habbo.es/habbo-imaging/avatarimage?user=' + encodeURIComponent(nombre) + '&headonly=1&direction=2&head_direction=2&size=l';
}

// Sin internet, o si el nombre no existe en Habbo, su inicial.
export function AvatarKeko(props) {
  var k = props.keko;
  var tam = props.tam || 38;
  var s = useState(false); var fallo = s[0]; var setFallo = s[1];
  useEffect(function () { setFallo(false); }, [k.nombre]);
  return h('div', { className: 'av-keko ' + k.origen, style: { width: tam, height: tam, fontSize: Math.round(tam * 0.42) }, 'aria-hidden': true },
    k.origen === 'sin' ? h(Ico, { name: 'box', size: Math.round(tam * 0.5) })
      : !fallo ? h('img', { src: urlAvatar(k.nombre), alt: '', loading: 'lazy', onError: function () { setFallo(true); } })
      : k.nombre.charAt(0).toUpperCase());
}

export function nombreBloque(k) { return k.origen === 'sin' ? 'Sin keko asignado' : k.nombre; }

function EtiquetaOrigen(props) {
  var k = props.keko;
  if (k.origen === 'sniper') {
    var n = k.snipers || [];
    return h('span', { className: 'tag tag-verde', title: 'Keko de un SniperMercadillo: su inventario llega solo' }, h(Ico, { name: 'radar', size: 11 }),
      n.length ? 'Sniper · ' + n.slice(0, 2).join(', ') + (n.length > 2 ? ' +' + (n.length - 2) : '') : 'Sniper');
  }
  return h('span', { className: 'tag tag-gris', title: 'Keko que llevas a mano' }, h(Ico, { name: 'user', size: 11 }), 'Manual');
}

function Subtitulo(props) {
  var k = props.keko;
  if (k.origen === 'sin') return h('div', { className: 'bk-sub' }, 'Lotes del Excel o compras sin keko · asígnalos en Ajustes → Kekos');
  return h('div', { className: 'bk-sub' }, h(EtiquetaOrigen, { keko: k }),
    k.desde ? (k.origen === 'sniper' ? 'desde el ' : 'creado el ') + fmtD(String(k.desde).slice(0, 10)) : null);
}

// Colores de las partes de la composicion (por su `indice`; el 5º y «Otros», gris).
export var COLORES_COMPOSICION = ['var(--green)', 'var(--blue)', 'var(--purple)', 'var(--gold)', 'var(--text3)'];

function porcentaje(p) { var x = p * 100; return x > 0 && x < 1 ? '<1%' : Math.round(x) + '%'; }
function nombreParte(p) { return p.otros ? 'Otros ' + p.otros + (p.otros === 1 ? ' furni' : ' furnis') : p.nombre; }
function textoDinero(d) { return (d.tipo === 'ganancia' && d.valor > 0 ? '+' : '') + fmtCr(d.valor) + ' cr'; }

// La dona: cuantos furnis distintos hay y como se reparte el dinero entre ellos.
function Dona(props) {
  var c = props.composicion;
  return h('div', { className: 'dona', 'aria-hidden': true,
      style: { background: 'conic-gradient(' + cortesDona(c.partes, COLORES_COMPOSICION, 0.6, 'var(--bg2)') + ')' } },
    h('span', { className: 'mono' }, fmtCr(c.furnis)));
}

// «15 lotes · 65 und · 1.558 cr»: con la ventana angosta quedan los numeros (styles.css).
function Capsula(props) {
  var r = props.resumen;
  var d = r.dinero;
  var ganancia = d.tipo === 'ganancia';
  return h('div', { className: 'cap' },
    h('span', { title: fmtCr(r.n) + ' ' + r.nTexto }, h(Ico, { name: 'capas', size: 13 }),
      h('b', { className: 'mono' }, fmtCr(r.n)), h('span', { className: 'cap-txt' }, r.nTexto)),
    h('span', { title: fmtCr(r.und) + ' unidades' }, h(Ico, { name: 'cubos', size: 13 }),
      h('b', { className: 'mono' }, fmtCr(r.und)), h('span', { className: 'cap-txt' }, 'und')),
    h('span', { className: 'dinero' + (ganancia ? (d.valor > 0 ? ' pos' : d.valor < 0 ? ' neg' : '') : ''), title: textoDinero(d) + ' de ' + d.texto },
      h(Ico, { name: ganancia ? (d.valor < 0 ? 'bajando' : 'trending') : 'moneda', size: 13 }),
      h('b', { className: 'mono' }, textoDinero(d)), d.sufijo ? h('span', { className: 'cap-txt' }, d.sufijo) : null));
}

// El globo: «donde esta tu dinero» en este keko, furni por furni.
function GloboComposicion(props) {
  var c = props.composicion;
  var t = props.textos || {};
  return h('div', { className: 'globo', role: 'tooltip', id: props.id },
    h('div', { className: 'globo-t' }, t.titulo, h('span', { className: 'mono' }, fmtCr(c.total) + ' cr')),
    h('div', { className: 'globo-barra' }, c.partes.map(function (p, i) {
      return h('i', { key: i, style: { flexGrow: p.valor, background: COLORES_COMPOSICION[p.indice] } });
    })),
    c.partes.map(function (p, i) {
      return h('div', { key: i, className: 'globo-fila' },
        h('span', { className: 'globo-punto', style: { background: COLORES_COMPOSICION[p.indice] } }),
        p.otros ? h('span', { className: 'globo-otros' }, h(Ico, { name: 'box', size: 13 })) : h(IconoFurni, { classname: p.classname, revision: p.revision, size: 22 }),
        h('span', { className: 'globo-nom', title: nombreParte(p) }, nombreParte(p)),
        h('span', { className: 'mono' }, fmtCr(p.valor)),
        h('span', { className: 'mono globo-pc' }, porcentaje(p.porcentaje)));
    }),
    t.pie ? h('div', { className: 'globo-pie' }, t.pie) : null);
}

// La barra de colores del borde inferior de la cabecera (cada porcion, con su detalle).
function BarraComposicion(props) {
  return h('div', { className: 'comp', 'aria-hidden': true }, props.composicion.partes.map(function (p, i) {
    return h('i', { key: i, style: { flexGrow: p.valor, background: COLORES_COMPOSICION[p.indice] },
      title: nombreParte(p) + ' · ' + fmtCr(p.valor) + ' cr · ' + porcentaje(p.porcentaje) });
  }));
}

// La tarjeta de un keko. A la derecha de la cabecera: `aviso` (por ejemplo, «2 por revisar»),
// el encabezado C y `accion` (el «+ Compra»). `children`: la tabla.
//   resumen:     { n, nTexto, und, dinero: { tipo: 'costo' | 'ganancia', valor, texto, sufijo? } }
//   composicion: la de core/grupos.js (composicionLotes o composicionMercadillo)
//   textos:      { titulo, pie } del globo
// Sin dinero que repartir (todo en 0), solo la capsula: no hay dona, globo ni barra.
export function BloqueKeko(props) {
  var k = props.keko;
  var r = props.resumen;
  var c = props.composicion;
  var conComposicion = !!(c && c.partes && c.partes.length);
  // Un id valido y unico aunque el keko tenga espacios o simbolos (aria-describedby separa
  // los ids por espacios).
  var idGlobo = 'globo-' + (k.clave || 'sin-keko').replace(/[^a-z0-9]/gi, function (ch) { return '_' + ch.charCodeAt(0); });
  var etiqueta = r ? fmtCr(r.n) + ' ' + r.nTexto + ', ' + fmtCr(r.und) + ' unidades, ' + textoDinero(r.dinero) + ' de ' + r.dinero.texto : null;
  return h('section', { className: 'bk' + (k.origen === 'sin' ? ' sin' : ''), id: 'bk-' + k.clave, 'data-keko': k.clave },
    h('div', { className: 'bk-cab ' + k.origen },
      h(AvatarKeko, { keko: k }),
      h('div', { className: 'bk-titulo' },
        h('div', { className: 'bk-nombre', title: nombreBloque(k) }, nombreBloque(k)),
        h(Subtitulo, { keko: k })),
      h('div', { className: 'bk-datos' },
        props.aviso || null,
        r ? h('div', { className: 'zona' + (conComposicion ? ' con-globo' : ''), tabIndex: conComposicion ? 0 : undefined,
            'aria-label': etiqueta, 'aria-describedby': conComposicion ? idGlobo : undefined },
          conComposicion ? h(Dona, { composicion: c }) : null,
          h(Capsula, { resumen: r }),
          conComposicion ? h(GloboComposicion, { composicion: c, textos: props.textos, id: idGlobo }) : null) : null,
        props.accion || null),
      conComposicion ? h(BarraComposicion, { composicion: c }) : null),
    h('div', { className: 'bk-cuerpo' }, props.children));
}

// Indice «Ir a»: un boton por bloque que lleva a el (nada se pliega) y marca el keko que
// estas viendo. `cuenta(bloque)` es el numero pequeño de cada boton.
export function IndiceKekos(props) {
  var ref = useRef(null);
  var sA = useState(null); var activo = sA[0]; var setActivo = sA[1];
  var bloques = props.bloques;
  var claves = bloques.map(function (b) { return b.keko.clave; }).join('|');
  useEffect(function () {
    var nodo = ref.current;
    var scroller = nodo && nodo.closest('.main-content');
    if (!scroller) return undefined;
    function mirar() {
      var tope = scroller.getBoundingClientRect().top + 90;
      var actual = bloques.length ? bloques[0].keko.clave : null;
      scroller.querySelectorAll('.bk[data-keko]').forEach(function (b) {
        if (b.getBoundingClientRect().top <= tope) actual = b.getAttribute('data-keko');
      });
      setActivo(actual);
    }
    mirar();
    scroller.addEventListener('scroll', mirar, { passive: true });
    return function () { scroller.removeEventListener('scroll', mirar); };
  }, [claves]);
  if (bloques.length < 2) return null;
  return h('div', { className: 'ind-kekos', ref: ref },
    h('span', { className: 'tenue' }, 'Ir a:'),
    bloques.map(function (b) {
      var k = b.keko;
      return h('button', { key: k.clave, className: 'ind-chip' + (activo === k.clave ? ' activo' : ''), title: 'Ir al bloque de ' + nombreBloque(k),
          onClick: function () { var el = document.getElementById('bk-' + k.clave); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
        h(AvatarKeko, { keko: k, tam: 20 }), k.origen === 'sin' ? 'Sin keko' : k.nombre, h('span', { className: 'mono' }, props.cuenta(b)));
    }));
}

// Kekos sin nada en esta pestaña: no ocupan sitio, se nombran en una linea al final.
export function KekosVacios(props) {
  if (!props.nombres.length) return null;
  return h('div', { className: 'bk-vacios' }, props.texto + props.nombres.join(', ') + '.');
}

// Anchos de columna (null = la del furni, se queda con el resto: al menos 220px).
export function anchoMinimo(anchos) {
  return anchos.reduce(function (s, x) { return s + (x || 220); }, 0);
}
export function Columnas(props) {
  return h('colgroup', null, props.anchos.map(function (x, i) { return h('col', { key: i, style: x ? { width: x } : null }); }));
}

// ¿Caben las columnas con sus anchos fijos? Mide el contenedor de los bloques (ref) y
// decide: sí = todos los bloques alineados y la fila de titulos fija; no = anchos
// automaticos, como antes.
export function useAlineado(minimo) {
  var sN = useState(null); var nodo = sN[0]; var setNodo = sN[1];
  var sW = useState(0); var ancho = sW[0]; var setAncho = sW[1];
  useEffect(function () {
    if (!nodo || !window.ResizeObserver) return undefined;
    var ro = new ResizeObserver(function () { setAncho(nodo.clientWidth); });
    ro.observe(nodo);
    setAncho(nodo.clientWidth);
    return function () { ro.disconnect(); };
  }, [nodo]);
  return { ref: setNodo, alineado: ancho >= minimo };
}
