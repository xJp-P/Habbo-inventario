// public/js/componentes/BloquesKeko.js — piezas del Inventario y del Mercadillo por keko
// (v1.6.0): la tarjeta de cada keko con su cabecera fija, su avatar y el indice «Ir a».
//
// Diseño aprobado por el dueño (maqueta del 29-sep-2026, diseño A): una tarjeta por keko,
// SIEMPRE abierta (nada se pliega ni se recorta: todo se ve haciendo scroll). Su cabecera
// y la fila de titulos se quedan arriba mientras recorres sus filas; la del siguiente keko
// la empuja. Con sitio para todas las columnas, anchos fijos: todos los bloques quedan
// alineados (useAlineado). El orden y el reparto viven en core/kekos.js.

import { h, useState, useEffect, useRef } from '../core/react.js';
import { fmtD } from '../core/format.js';
import { Ico } from './iconos.js';

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

// La tarjeta de un keko. `datos`: [[valor, etiqueta, clase?]] a la derecha de la cabecera;
// `aviso` y `accion` van junto a ellos. `children`: la tabla.
export function BloqueKeko(props) {
  var k = props.keko;
  return h('section', { className: 'bk' + (k.origen === 'sin' ? ' sin' : ''), id: 'bk-' + k.clave, 'data-keko': k.clave },
    h('div', { className: 'bk-cab ' + k.origen },
      h(AvatarKeko, { keko: k }),
      h('div', { className: 'bk-titulo' },
        h('div', { className: 'bk-nombre', title: nombreBloque(k) }, nombreBloque(k)),
        h(Subtitulo, { keko: k })),
      h('div', { className: 'bk-datos' },
        props.aviso || null,
        (props.datos || []).map(function (d, i) {
          return h('div', { key: i, className: 'bk-dato' }, h('b', { className: 'mono ' + (d[2] || '') }, d[0]), h('span', null, d[1]));
        }),
        props.accion || null)),
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
