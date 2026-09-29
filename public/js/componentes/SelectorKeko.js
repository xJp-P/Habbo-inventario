// public/js/componentes/SelectorKeko.js — el selector de keko de «+ Compra», «Venta» y
// «Asignar unidades sin keko»: primero los kekos de tus snipers, luego los manuales y, si
// se pide, «Nuevo keko manual…» con su caja de texto.
//
// Recuerda el ultimo keko usado, solo en este equipo: es una comodidad al registrar varias
// compras seguidas, no un dato (si ese keko ya no existe, no se preselecciona nada).

import { h } from '../core/react.js';

export var NUEVO_KEKO = '__nuevo__';
var CLAVE = 'hbi.ultimo-keko';

export function ultimoKeko(kekos) {
  var n = null;
  try { n = localStorage.getItem(CLAVE); } catch (_) { /* sin almacenamiento */ }
  return n && (kekos || []).some(function (k) { return k.nombre === n; }) ? n : '';
}

export function recordarKeko(nombre) {
  try { if (nombre) localStorage.setItem(CLAVE, nombre); } catch (_) { /* sin almacenamiento */ }
}

// props: kekos, valor, onChange(valor), conNuevo, nuevo, onNuevo(texto), etiqueta(k), error, autoFocus
export function SelectorKeko(props) {
  var kekos = props.kekos || [];
  var snipers = kekos.filter(function (k) { return k.origen === 'sniper'; });
  var manuales = kekos.filter(function (k) { return k.origen !== 'sniper'; });
  var texto = props.etiqueta || function (k) { return k.nombre; };
  var opcion = function (k) { return h('option', { key: k.nombre, value: k.nombre }, texto(k)); };
  return h('div', null,
    h('select', { className: 'inp' + (props.error ? ' error' : ''), value: props.valor || '', autoFocus: props.autoFocus,
      onChange: function (e) { props.onChange(e.target.value); } },
      h('option', { value: '', disabled: true }, kekos.length ? 'Elige el keko…' : 'Aún no tienes kekos'),
      snipers.length ? h('optgroup', { label: 'De tus snipers' }, snipers.map(opcion)) : null,
      manuales.length ? h('optgroup', { label: 'Manuales' }, manuales.map(opcion)) : null,
      props.conNuevo ? h('option', { value: NUEVO_KEKO }, '+ Nuevo keko manual…') : null),
    props.conNuevo && props.valor === NUEVO_KEKO
      ? h('input', { className: 'inp' + (props.error ? ' error' : ''), style: { marginTop: 6 }, autoFocus: true, maxLength: 60,
          placeholder: 'Nombre del keko (p. ej. MiKekoBodega)', value: props.nuevo || '',
          onChange: function (e) { props.onNuevo(e.target.value); } })
      : null);
}
