// public/js/componentes/Autocompletar.js — buscador predictivo de furnis de Habbo.es.
//
// Sugiere nombres OFICIALES del catalogo (furnidata de Habbo.es) con su icono mientras
// escribes; marca los que ya estan entre tus furnis. Solo acepta un furni elegido de la
// lista: asi el nombre guardado siempre es el oficial exacto. Teclado: flechas, Enter
// para elegir, Escape para cerrar.

import { h, useState, useEffect, useRef } from '../core/react.js';
import { IconoFurni } from './base.js';
import { normalizar } from '../core/ui.js';

export function Autocompletar(props) {
  var sT = useState(props.inicial || ''); var texto = sT[0]; var setTexto = sT[1];
  var sL = useState([]); var lista = sL[0]; var setLista = sL[1];
  var sA = useState(false); var abierta = sA[0]; var setAbierta = sA[1];
  var sS = useState(0); var sel = sS[0]; var setSel = sS[1];
  var temporizador = useRef(null);
  var propios = props.propios || [];

  useEffect(function () {
    clearTimeout(temporizador.current);
    if (normalizar(texto).length < 2) { setLista([]); return; }
    temporizador.current = setTimeout(function () {
      fetch('/api/furnidata/buscar?limite=12&q=' + encodeURIComponent(texto))
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (r) { setLista(r || []); setSel(0); })
        .catch(function () { setLista([]); });
    }, 150);
    return function () { clearTimeout(temporizador.current); };
  }, [texto]);

  function propio(item) {
    return propios.find(function (f) { return (f.classname && f.classname === item.classname) || normalizar(f.nombre) === normalizar(item.nombre); });
  }

  function elegir(item) {
    setTexto(item.nombre);
    setAbierta(false);
    props.onElegir(item, propio(item) || null);
  }

  function teclas(e) {
    if (!abierta || !lista.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, lista.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); elegir(lista[sel]); }
    else if (e.key === 'Escape') setAbierta(false);
  }

  return h('div', { className: 'auto' },
    h('input', {
      className: 'inp' + (props.error ? ' error' : ''), value: texto, autoFocus: props.autoFocus,
      placeholder: props.placeholder || 'Escribe el nombre del furni…',
      onChange: function (e) { setTexto(e.target.value); setAbierta(true); if (props.onEscribir) props.onEscribir(); },
      onFocus: function () { setAbierta(true); }, onKeyDown: teclas,
      onBlur: function () { setTimeout(function () { setAbierta(false); }, 150); },
    }),
    abierta && lista.length ? h('div', { className: 'auto-lista' },
      lista.map(function (it, i) {
        var p = propio(it);
        return h('div', { key: it.classname, className: 'auto-item' + (i === sel ? ' sel' : ''), onMouseDown: function (e) { e.preventDefault(); elegir(it); } },
          h(IconoFurni, { classname: it.classname, revision: it.revision, size: 32 }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'furni-nombre', style: { fontSize: 13 } }, it.nombre),
            h('div', { className: 'tenue mono', style: { fontSize: 11 } }, it.classname)),
          p ? h('span', { className: 'tag tag-verde' }, 'Ya lo tienes') : null);
      })) : null);
}
