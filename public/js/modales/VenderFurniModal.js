// public/js/modales/VenderFurniModal.js — registrar desde el Mercadillo la venta de
// unidades publicadas de un furni.
//
// Un furni puede tener lo publicado repartido en varios lotes y a distintos precios de
// lista. Si hay mas de un precio, primero se elige a cual se vendio (cada oferta del
// mercadillo tiene su precio); dentro de ese precio las unidades salen de los lotes
// publicados hace mas tiempo (FIFO, funcion vender_furni). El precio que se escribe es
// el del mercadillo (lo que pago el comprador) y se guarda lo que entro al monedero:
// precio menos comision. En lingos no hay comision (intercambio directo). Desde el bloque
// de un keko (props.ambito) solo se vende lo publicado en ese keko.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard, nowStr } from '../core/ui.js';
import { leerNumero, fmtCr, fmtLg, fmtPct } from '../core/format.js';
import { Modal, Fld, NombreFurni } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';
import { calcularComision } from '../core/comision.js';
import { gruposPorPrecioLista, repartirFifo, etiquetaLote } from '../core/lotes.js';
import { textoAmbito } from '../core/kekos.js';

function texto(n) { return String(n).replace('.', ','); }
function fmtLista(g) { return fmtLg(g.precio_lista) + (g.moneda_lista === 'lingos' ? ' lg' : ' cr'); }

export function VenderFurniModal(props) {
  var furni = props.furni;
  var tasa = props.tasa || 50;
  var grupos = gruposPorPrecioLista(props.lotes || []);
  var sG = useState(0); var iGrupo = sG[0]; var setIGrupo = sG[1];
  var g = grupos[iGrupo] || grupos[0];
  var sQ = useState('1'); var cant = sQ[0]; var setCant = sQ[1];
  var sP = useState(texto(g.precio_lista)); var precio = sP[0]; var setPrecio = sP[1];
  var sF = useState(nowStr()); var fecha = sF[0]; var setFecha = sF[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  var lingos = g.moneda_lista === 'lingos';
  var q = leerNumero(cant);
  var p = leerNumero(precio);
  var qValida = q && !isNaN(q) && q >= 1 && q <= g.unidades && Math.floor(q) === q;
  var pValido = p !== null && !isNaN(p) && p >= 0;
  var comisionU = pValido && !lingos ? calcularComision(p) : 0;
  var netoU = pValido ? p - comisionU : null;
  var netoUcr = pValido ? (lingos ? p * tasa : netoU) : null;
  var tomas = qValida ? repartirFifo(g.lotes, q) : [];
  var costo = tomas.reduce(function (s, t) { return s + t.lote.precio_compra_cr * t.toma; }, 0);
  var ganancia = qValida && pValido ? netoUcr * q - costo : null;

  function elegirGrupo(i) {
    setIGrupo(i);
    setPrecio(texto(grupos[i].precio_lista));
    setCant(String(Math.min(qValida ? q : 1, grupos[i].unidades)));
    setError('');
  }
  function cambiarCant(d) { var n = (qValida ? q : 1) + d; setCant(String(Math.max(1, Math.min(g.unidades, n)))); }

  function vender() {
    if (!qValida) { setError('La cantidad debe estar entre 1 y ' + g.unidades + '.'); return; }
    if (!pValido) { setError('Escribe el precio al que se vendió en el mercadillo.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/furnis/' + furni.id + '/vender', Object.assign({ cantidad: q, precio_lista: g.precio_lista, precio_venta: p, fecha_venta: fecha }, props.ambito))
        .then(function (r) {
          if (r) props.onGuardado(r, q + ' und de ' + furni.nombre + ' vendidas · entraron ' + (lingos ? fmtLg(netoU * q) + ' lingos' : fmtCr(netoU * q) + ' cr'));
        });
    });
  }

  return h(Modal, { titulo: 'Registrar venta', onClose: props.onClose },
    h(NombreFurni, { furni: furni, sub: g.unidades === (props.lotes || []).reduce(function (s, l) { return s + l.cantidad; }, 0)
      ? g.unidades + ' und publicadas' + textoAmbito(props.ambito) + ' a ' + fmtLista(g) : 'Publicado' + textoAmbito(props.ambito) + ' a varios precios' }),
    h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center', background: 'var(--purple-bg)', color: 'var(--purple)' } },
      h(Ico, { name: 'lock', size: 14 }), 'Regístralo cuando se haya vendido en el mercadillo. Se guarda lo que entró a tu monedero.'),
    grupos.length > 1 ? h(Fld, { label: '¿A qué precio de lista estaba?' },
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, grupos.map(function (x, i) {
        return h('button', { key: i, className: 'chip' + (i === iGrupo ? ' activo morado' : ''), onClick: function () { elegirGrupo(i); } },
          fmtLista(x), h('span', { className: 'mono' }, x.unidades + ' und'));
      }))) : null,
    h(Fld, { label: '¿Cuántas se vendieron?' },
      h('div', { style: { display: 'flex', gap: 6 } },
        h('button', { className: 'btn', onClick: function () { cambiarCant(-1); } }, '−'),
        h('input', { className: 'inp inp-num', style: { width: 80, textAlign: 'center' }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); setError(''); } }),
        h('button', { className: 'btn', onClick: function () { cambiarCant(1); } }, '+'),
        h('button', { className: 'btn', onClick: function () { setCant(String(g.unidades)); } }, 'Todas (' + g.unidades + ')'))),
    h('div', { className: 'fila-2' },
      h(Fld, { label: lingos ? 'Precio de venta (lingos)' : 'Precio en el mercadillo (lo que pagó el comprador)' },
        h('input', { className: 'inp inp-num', value: precio, placeholder: '0', inputMode: 'decimal', autoFocus: true,
          onChange: function (e) { setPrecio(e.target.value); setError(''); }, onKeyDown: function (e) { if (e.key === 'Enter') vender(); } })),
      h(Fld, { label: 'Fecha de venta' }, h('input', { className: 'inp', type: 'date', value: fecha, onChange: function (e) { setFecha(e.target.value); } }))),
    qValida && pValido ? h('div', { className: 'aviso' },
      lingos ? h('div', null, 'En lingos no hay comisión: se guarda ', h('b', { className: 'mono' }, fmtLg(p) + ' lingos'), ' por unidad.')
        : h('div', null, 'Entra a tu monedero: ', h('b', { className: 'mono' }, fmtCr(netoU) + ' cr'), ' por unidad (comisión ' + fmtCr(comisionU) + ' cr) · total ',
            h('b', { className: 'mono' }, fmtCr(netoU * q) + ' cr'), '. Se guarda ese neto.'),
      h('div', { style: { marginTop: 6 } }, tomas.length === 1 ? 'Sale del lote ' + etiquetaLote(tomas[0].lote) : 'Salen de ' + tomas.length + ' lotes (' + tomas.map(function (t) { return etiquetaLote(t.lote); }).join(', ') + ')',
        ', lo publicado hace más tiempo · ganancia real ',
        h('b', { className: 'mono ' + (ganancia > 0 ? 'pos' : ganancia < 0 ? 'neg' : '') }, (ganancia > 0 ? '+' : '') + fmtCr(ganancia) + ' cr'),
        ' · margen ', fmtPct(costo ? ganancia / costo : 0))) : null,
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: vender, disabled: enviando }, h(Ico, { name: 'tag', size: 14 }), 'Registrar venta')));
}
