// public/js/modales/RetirarFurniModal.js — retirar desde el Mercadillo unidades de un furni
// que quitaste del mercadillo.
//
// Lo que publicaste tu y, desde la v1.10.0, lo que publico el Sniper si su oferta ya caduco
// (una oferta vencida ya no esta a la venta; migracion 20261017000000). Lo del Sniper aun
// vigente lo mueve el Sniper. Si hay mas de un precio de lista, se elige cual; dentro de ese
// precio salen primero las tuyas y despues las del Sniper caducadas, cada grupo de la
// publicada hace mas tiempo a la mas nueva (funcion retirar_furni; core/caducidad.js,
// ordenRetiro). Las unidades vuelven a Comprado (a su lote de origen si sigue en mano al
// mismo costo y en el mismo keko); si sale una parte de un lote, el lote se divide. Desde el
// bloque de un keko (props.ambito) solo se retira lo de ese keko.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { leerNumero, fmtLg } from '../core/format.js';
import { Modal, Fld, NombreFurni } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';
import { gruposPorPrecioLista, repartirFifo, etiquetaLote } from '../core/lotes.js';
import { ordenRetiro } from '../core/caducidad.js';
import { textoAmbito } from '../core/kekos.js';

function fmtLista(g) { return fmtLg(g.precio_lista) + (g.moneda_lista === 'lingos' ? ' lg' : ' cr'); }

export function RetirarFurniModal(props) {
  var furni = props.furni;
  var grupos = gruposPorPrecioLista(props.lotes || []);
  grupos.forEach(function (x) { x.lotes = ordenRetiro(x.lotes); });
  var tuyas = (props.lotes || []).reduce(function (s, l) { return s + (l.publicado_por === 'manual' ? l.cantidad : 0); }, 0);
  var caducadas = (props.lotes || []).reduce(function (s, l) { return s + (l.publicado_por === 'manual' ? 0 : l.cantidad); }, 0);
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
      return API.post('/api/furnis/' + furni.id + '/retirar', Object.assign({ cantidad: q, precio_lista: g.precio_lista }, props.ambito))
        .then(function (r) {
          if (r) props.onGuardado(r, (r.cantidad === 1 ? 'Retirada 1 und' : 'Retiradas ' + r.cantidad + ' und') + ' de ' + furni.nombre + ': ' + (r.cantidad === 1 ? 'volvió' : 'volvieron') + ' a Comprado');
        });
    });
  }

  return h(Modal, { titulo: 'Retirar del mercadillo', onClose: props.onClose },
    h(NombreFurni, { furni: furni, sub: h('span', null, 'Para retirar' + textoAmbito(props.ambito) + ': ',
      tuyas ? tuyas + ' und tuyas' : null, tuyas && caducadas ? ' y ' : null,
      caducadas ? h('span', { className: 'caduco' }, caducadas + ' und del Sniper con la oferta caducada') : null) }),
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
      h('div', null, h('b', { className: 'mono' }, q), q === 1 ? ' und publicada a ' : ' und publicadas a ', fmtLista(g), q === 1 ? ' vuelve a ' : ' vuelven a ', h('span', { className: 'tag tag-azul' }, 'Comprado'), ' (en mano)',
        q < g.unidades ? ' y quedan ' + (g.unidades - q) + ' publicadas a ese precio' : '', '.'),
      h('div', { className: 'suave', style: { marginTop: 6, fontSize: 12 } },
        tuyas && caducadas ? 'Salen primero las que publicaste tú; después, las del Sniper con la oferta caducada (' : 'Salen primero las publicadas hace más tiempo (',
        tomas.length === 1 ? 'lote ' + etiquetaLote(tomas[0].lote) : 'lotes ' + tomas.map(function (t) { return etiquetaLote(t.lote); }).join(', '),
        divide ? '; el último se divide' : '', ').')) : null,
    props.unidadesSniper > 0 ? h('div', { className: 'suave', style: { fontSize: 12 } },
      'Las ' + props.unidadesSniper + ' und que publicó el Sniper y siguen vigentes no se retiran aquí: se retiran desde el juego y el Sniper avisa.') : null,
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: retirar, disabled: enviando }, h(Ico, { name: 'undo', size: 14 }), 'Retirar')));
}
