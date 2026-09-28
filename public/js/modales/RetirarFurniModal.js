// public/js/modales/RetirarFurniModal.js — retirar desde el Mercadillo unidades que
// publicaste tu de un furni.
//
// Solo lo publicado a mano: lo que publico el Sniper lo mueve el Sniper. Si lo tuyo esta
// a mas de un precio de lista, se elige cual; dentro de ese precio salen primero las
// publicadas hace mas tiempo (FIFO, funcion retirar_furni). Las unidades vuelven a
// Comprado (a su lote de origen si sigue en mano al mismo costo); si sale una parte de
// un lote, el lote se divide.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { leerNumero, fmtLg } from '../core/format.js';
import { Modal, Fld, NombreFurni } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';
import { gruposPorPrecioLista, repartirFifo, etiquetaLote } from '../core/lotes.js';

function fmtLista(g) { return fmtLg(g.precio_lista) + (g.moneda_lista === 'lingos' ? ' lg' : ' cr'); }

export function RetirarFurniModal(props) {
  var furni = props.furni;
  var grupos = gruposPorPrecioLista(props.lotes || []);
  var sG = useState(0); var iGrupo = sG[0]; var setIGrupo = sG[1];
  var g = grupos[iGrupo] || grupos[0];
  var sQ = useState(String(g.unidades)); var cant = sQ[0]; var setCant = sQ[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  var q = leerNumero(cant);
  var qValida = q && !isNaN(q) && q >= 1 && q <= g.unidades && Math.floor(q) === q;
  var tomas = qValida ? repartirFifo(g.lotes, q) : [];
  var divide = tomas.length && tomas[tomas.length - 1].toma < tomas[tomas.length - 1].lote.cantidad;

  function elegirGrupo(i) { setIGrupo(i); setCant(String(grupos[i].unidades)); setError(''); }
  function cambiarCant(d) { var n = (qValida ? q : 1) + d; setCant(String(Math.max(1, Math.min(g.unidades, n)))); }

  function retirar() {
    if (!qValida) { setError('La cantidad debe estar entre 1 y ' + g.unidades + '.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/furnis/' + furni.id + '/retirar', { cantidad: q, precio_lista: g.precio_lista })
        .then(function (r) { if (r) props.onGuardado(r, 'Retiradas ' + r.cantidad + ' und de ' + furni.nombre + ': volvieron a Comprado'); });
    });
  }

  return h(Modal, { titulo: 'Retirar del mercadillo', onClose: props.onClose },
    h(NombreFurni, { furni: furni, sub: 'Publicado por ti: ' + (props.lotes || []).reduce(function (s, l) { return s + l.cantidad; }, 0) + ' und' }),
    grupos.length > 1 ? h(Fld, { label: '¿Las de qué precio de lista?' },
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, grupos.map(function (x, i) {
        return h('button', { key: i, className: 'chip' + (i === iGrupo ? ' activo morado' : ''), onClick: function () { elegirGrupo(i); } },
          fmtLista(x), h('span', { className: 'mono' }, x.unidades + ' und'));
      }))) : null,
    h(Fld, { label: '¿Cuántas quitaste del mercadillo?' },
      h('div', { style: { display: 'flex', gap: 6 } },
        h('button', { className: 'btn', onClick: function () { cambiarCant(-1); } }, '−'),
        h('input', { className: 'inp inp-num', style: { width: 80, textAlign: 'center' }, value: cant, inputMode: 'numeric', autoFocus: true,
          onChange: function (e) { setCant(e.target.value); setError(''); }, onKeyDown: function (e) { if (e.key === 'Enter') retirar(); } }),
        h('button', { className: 'btn', onClick: function () { cambiarCant(1); } }, '+'),
        h('button', { className: 'btn', onClick: function () { setCant(String(g.unidades)); } }, 'Todas (' + g.unidades + ')'))),
    qValida ? h('div', { className: 'aviso' },
      h('div', null, h('b', { className: 'mono' }, q), ' und publicadas a ', fmtLista(g), ' vuelven a ', h('span', { className: 'tag tag-azul' }, 'Comprado'), ' (en mano)',
        q < g.unidades ? ' y quedan ' + (g.unidades - q) + ' publicadas a ese precio' : '', '.'),
      h('div', { className: 'suave', style: { marginTop: 6, fontSize: 12 } }, 'Salen primero las publicadas hace más tiempo (',
        tomas.length === 1 ? 'lote ' + etiquetaLote(tomas[0].lote) : 'lotes ' + tomas.map(function (t) { return etiquetaLote(t.lote); }).join(', '),
        divide ? '; el último se divide' : '', ').')) : null,
    props.unidadesSniper > 0 ? h('div', { className: 'suave', style: { fontSize: 12 } },
      'Las ' + props.unidadesSniper + ' und que publicó el Sniper no se retiran aquí: se retiran desde el juego y el Sniper avisa.') : null,
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: retirar, disabled: enviando }, h(Ico, { name: 'undo', size: 14 }), 'Retirar')));
}
