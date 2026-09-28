// public/js/componentes/base.js — primitivos de UI compartidos por todas las vistas.
//
// `Modal` y `Fld` vienen de Proyecto_Cartera (componentes/base.js) con la misma regla:
// el fondo oscuro NO cierra el modal (solo la X o los botones), para no perder un
// formulario a medio llenar por un clic. Se suman los propios del inventario: el icono
// del furni, las etiquetas de estado y el selector de moneda.

import { h, useState, useEffect } from '../core/react.js';
import { Ico } from './iconos.js';
import { iconoUrl } from '../core/ui.js';

export function Modal(props) {
  return h('div', { className: 'modal-overlay' },
    h('div', { className: 'modal-sheet', style: props.ancho ? { maxWidth: props.ancho } : null },
      h('div', { className: 'modal-cab' },
        h('div', { style: { fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 } }, props.titulo),
        h('button', { className: 'btn-icono', onClick: props.onClose, 'aria-label': 'Cerrar' }, h(Ico, { name: 'x', size: 14, sw: 2.5 }))),
      h('div', { className: 'modal-cuerpo' }, props.children)));
}

// Confirmacion con el diseno de la app (en lugar de window.confirm). Esc cancela.
//   titulo, mensaje, textoBoton, peligro (boton rojo), icono, enviando
//   onConfirmar, onClose
export function Confirmar(props) {
  useEffect(function () {
    function tecla(e) { if (e.key === 'Escape') props.onClose(); }
    document.addEventListener('keydown', tecla);
    return function () { document.removeEventListener('keydown', tecla); };
  }, [props.onClose]);
  return h(Modal, { titulo: props.titulo, onClose: props.onClose, ancho: 440 },
    h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
      h('div', { className: 'confirmar-ico' + (props.peligro ? ' peligro' : '') }, h(Ico, { name: props.icono || (props.peligro ? 'alert' : 'check'), size: 18 })),
      h('div', { style: { fontSize: 14, lineHeight: 1.5, paddingTop: 6 } }, props.mensaje)),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 } },
      h('button', { className: 'btn', onClick: props.onClose, autoFocus: !!props.peligro }, 'Cancelar'),
      h('button', { className: 'btn ' + (props.peligro ? 'btn-peligro' : 'btn-verde'), onClick: props.onConfirmar, disabled: props.enviando, autoFocus: !props.peligro },
        props.textoBoton || 'Confirmar')));
}

export function Fld(props) {
  return h('div', null, h('div', { className: 'fld-l' }, props.label), props.children,
    props.ayuda ? h('div', { className: 'tenue', style: { fontSize: 11, marginTop: 4 } }, props.ayuda) : null);
}

// Icono oficial del furni (servido y guardado en cache por el backend). Si no hay
// icono (furni sin vincular o sin internet) muestra una caja.
export function IconoFurni(props) {
  var s = useState(false); var fallo = s[0]; var setFallo = s[1];
  var url = iconoUrl(props.classname, props.revision);
  var tam = props.size || 36;
  return h('div', { className: 'furni-ico', style: { width: tam, height: tam } },
    url && !fallo
      ? h('img', { src: url, alt: '', loading: 'lazy', onError: function () { setFallo(true); } })
      : h(Ico, { name: 'box', size: Math.round(tam / 2), color: 'var(--text3)' }));
}

// Numero de serie de un LTD ("#45"), destacado.
export function EtiquetaLtd(props) {
  return h('span', { className: 'tag-ltd mono', title: 'LTD número ' + props.numero }, '#' + props.numero);
}

// Icono + nombre del furni. Si es un lote con numero LTD (furni.numero_ltd) o se pasan
// varios (props.ltds), se muestran junto al nombre.
export function NombreFurni(props) {
  var f = props.furni || {};
  var ltds = props.ltds || (f.numero_ltd ? [f.numero_ltd] : []);
  return h('div', { className: 'furni' },
    h(IconoFurni, { classname: f.classname, revision: f.revision, size: props.size }),
    h('div', { style: { minWidth: 0 } },
      h('div', { className: 'furni-linea' },
        h('div', { className: 'furni-nombre', title: f.nombre }, f.nombre),
        ltds.slice(0, 4).map(function (n) { return h(EtiquetaLtd, { key: n, numero: n }); }),
        ltds.length > 4 ? h('span', { className: 'tenue mono', style: { fontSize: 11 } }, '+' + (ltds.length - 4)) : null),
      props.sub ? h('div', { className: 'tenue', style: { fontSize: 11 } }, props.sub) : null));
}

var ESTADOS = {
  en_venta: ['tag-verde', 'En mano'],
  publicado: ['tag-morado', 'Publicado', 'lock'],
  por_revisar: ['tag-ambar', 'Por revisar'],
  agotado: ['tag-gris', 'Agotado'],
  sin_compras: ['tag-gris', 'Sin compras'],
};
export function EtiquetaEstado(props) {
  var e = ESTADOS[props.estado] || ['tag-gris', props.estado];
  return h('span', { className: 'tag ' + e[0] }, e[2] ? h(Ico, { name: e[2], size: 11, sw: 2.2 }) : null, e[1]);
}

// Candado de lo publicado en el mercadillo de Habbo: su stock lo mueve el Sniper.
export var AYUDA_PUBLICADO = 'Publicado en el mercadillo de Habbo: el Sniper controla este stock (publicar / recuperar). No lo cambies a mano; solo registra la venta cuando se venda.';
export var AYUDA_PUBLICADO_MANUAL = 'Lo publicaste tú en el mercadillo de Habbo. Cuando se venda, registra la venta con «Vendido»; si lo quitas del mercadillo, usa «Retirar».';
export function EtiquetaPublicado(props) {
  return h('span', { className: 'tag tag-morado', title: props.manual ? AYUDA_PUBLICADO_MANUAL : AYUDA_PUBLICADO },
    h(Ico, { name: 'lock', size: 11, sw: 2.2 }), props.texto || 'Publicado');
}

export function SelectorMoneda(props) {
  return h('div', { className: 'segmento' },
    [['creditos', 'Créditos', 'coin'], ['lingos', 'Lingos', 'diamond']].map(function (m) {
      return h('button', { key: m[0], type: 'button', className: props.valor === m[0] ? 'activo' : '', onClick: function () { props.onChange(m[0]); } },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Ico, { name: m[2], size: 14 }), m[1]));
    }));
}

export function Spinner() {
  return h('div', { style: { padding: 60 } }, h('div', { className: 'spinner' }));
}
