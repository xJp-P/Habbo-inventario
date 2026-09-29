// public/js/componentes/NovedadesModal.js — la ventana de novedades tras una actualizacion.
//
// Replica la de Proyecto_Cartera (app.js, «Changelog modal»): cabecera fija con el icono
// de destello, el titulo «Novedades de la version X» y cuantos cambios trae; en medio la
// lista, que es lo unico que se desplaza (altura maxima y scroll interno), con un check
// por novedad; y abajo el boton «Entendido», fijo. Un clic fuera tambien la cierra.
// Lo propio de aqui: una linea que empieza con «—» es un separador entre versiones (sin
// check), para cuando una actualizacion trae las novedades de varias.

import { h } from '../core/react.js';
import { Ico } from './iconos.js';

export function NovedadesModal(props) {
  var items = props.items || [];
  var cambios = items.filter(function (t) { return t.charAt(0) !== '—'; }).length;
  return h('div', { className: 'modal-overlay', onClick: props.onClose },
    h('div', { className: 'modal-sheet novedades', role: 'dialog', 'aria-label': 'Novedades de la versión ' + props.version,
      onClick: function (e) { e.stopPropagation(); } },
      h('div', { className: 'novedades-cab' },
        h('div', { style: { marginBottom: 6 } }, h(Ico, { name: 'sparkle', size: 28, color: 'var(--green)' })),
        h('div', { style: { fontWeight: 700, fontSize: 17 } }, 'Novedades de la versión ' + props.version),
        h('div', { className: 'tenue', style: { fontSize: 11, marginTop: 4, fontStyle: 'italic' } }, cambios + (cambios === 1 ? ' cambio' : ' cambios'))),
      h('div', { className: 'novedades-lista' }, items.map(function (item, i) {
        if (item.charAt(0) === '—') return h('div', { key: i, className: 'novedades-sep' }, item.replace(/^—\s*|\s*—$/g, ''));
        return h('div', { key: i, className: 'novedades-item' },
          h('div', { style: { flexShrink: 0, marginTop: 2 } }, h(Ico, { name: 'check', size: 14, color: 'var(--green)', sw: 2.4 })),
          h('span', null, item));
      })),
      h('button', { className: 'btn btn-verde novedades-ok', autoFocus: true, onClick: props.onClose }, 'Entendido')));
}
