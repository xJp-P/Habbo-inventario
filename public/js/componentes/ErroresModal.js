// public/js/componentes/ErroresModal.js — los errores de esta sesion, fijos en pantalla
// (v1.6.1).
//
// Pedido del dueño: que un error se pueda leer, copiar o fotografiar con calma, no en un
// aviso que desaparece. Muestra el ultimo error destacado y, debajo, el informe completo
// (version, equipo, estado de la base y cada error con su detalle) en un recuadro
// seleccionable, con «Copiar detalles». Modos: 'carga' (no llegaron tus datos: ofrece
// Reintentar) y 'registro' (el boton rojo de la cabecera o «Ver detalles» de un aviso).

import { h, useState } from '../core/react.js';
import { Modal } from './base.js';
import { Ico } from './iconos.js';
import { textoInforme, tituloError } from '../core/errores.js';

// Copia al portapapeles: en la app de escritorio, el del sistema (Electron); si no, el del
// navegador; y si no deja, selecciona el texto para Ctrl+C.
function copiar(texto, area) {
  var respaldo = function () {
    if (!area) return false;
    area.focus(); area.select();
    try { return document.execCommand('copy'); } catch (_) { return false; }
  };
  var electron = window.electronAPI && window.electronAPI.copiar;
  if (electron) return electron(texto).then(function () { return true; }, respaldo);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(texto).then(function () { return true; }, respaldo);
  }
  return Promise.resolve(respaldo());
}

export function ErroresModal(props) {
  var errores = props.errores || [];
  var ultimo = errores[errores.length - 1] || null;
  var texto = textoInforme(Object.assign({ errores: errores }, props.contexto));
  var sC = useState(null); var copiado = sC[0]; var setCopiado = sC[1];
  var sA = useState(null); var area = sA[0]; var setArea = sA[1];
  var carga = props.modo === 'carga';

  function alCopiar() {
    copiar(texto, area).then(function (ok) {
      setCopiado(ok ? 'ok' : 'manual');
      setTimeout(function () { setCopiado(null); }, 2500);
    });
  }

  return h(Modal, { titulo: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
      h(Ico, { name: 'alert', size: 18, color: 'var(--red)' }), carga ? 'No se pudieron cargar tus datos' : 'Errores de esta sesión'),
    ancho: 680, onClose: props.onClose },
    h('p', { className: 'suave', style: { fontSize: 13, marginBottom: 12, lineHeight: 1.55 } }, carga
      ? 'La app no pudo leer tus datos. No se perdió nada: siguen guardados en tu Supabase. Copia estos detalles (o sácales una foto) y envíalos para revisarlo; luego prueba «Reintentar».'
      : 'Estos son los errores que ocurrieron desde que abriste la app. Copia los detalles o sácales una foto para enviarlos.'),
    ultimo ? h('div', { className: 'aviso aviso-rojo', style: { marginBottom: 12 } },
      h('div', { className: 'mono', style: { fontSize: 12, opacity: .85, marginBottom: 2 } }, tituloError(ultimo)),
      h('div', { style: { fontSize: 14, fontWeight: 600, wordBreak: 'break-word' } }, ultimo.mensaje)) : null,
    h('div', { className: 'dato-l', style: { marginBottom: 4 } }, 'Detalles para enviar'),
    h('textarea', { className: 'inp mono informe-errores', readOnly: true, value: texto, ref: setArea, spellCheck: false,
      rows: Math.min(14, texto.split('\n').length + 1), onFocus: function (e) { e.target.select(); } }),
    copiado === 'manual' ? h('div', { className: 'suave', style: { fontSize: 12, marginTop: 6 } }, 'El texto quedó seleccionado: cópialo con Ctrl+C.') : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' } },
      !carga && errores.length && props.onLimpiar ? h('button', { className: 'btn', style: { marginRight: 'auto' }, onClick: props.onLimpiar, title: 'Vacía la lista de errores de esta sesión' }, h(Ico, { name: 'trash', size: 14 }), 'Vaciar lista') : null,
      h('button', { className: 'btn', onClick: alCopiar }, h(Ico, { name: copiado === 'ok' ? 'check' : 'copy', size: 14 }), copiado === 'ok' ? '¡Copiado!' : 'Copiar detalles'),
      props.onReintentar ? h('button', { className: 'btn btn-verde', onClick: props.onReintentar }, h(Ico, { name: 'refresh', size: 14 }), 'Reintentar') : null,
      h('button', { className: 'btn', onClick: props.onClose }, 'Cerrar')));
}
