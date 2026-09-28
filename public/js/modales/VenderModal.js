// public/js/modales/VenderModal.js — registrar la venta de un lote (todo o una parte).
//
// Si vendes una parte, el lote se divide: queda con las unidades restantes y nace una
// fila "Vendido". El precio real de venta queda congelado en esa fila (cambiar despues
// el precio del furni no altera la ganancia de esta venta). La vista previa muestra
// exactamente eso antes de confirmar.
//
// Un lote PUBLICADO se vende en el mercadillo de Habbo.es: se escribe el precio del
// mercadillo (el de lista, por defecto) y la base guarda lo que entra al monedero
// (precio menos comision; vender_lote la descuenta). La vista previa muestra ese neto y
// la ganancia real con el. En lingos no hay comision (intercambio directo).

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard, nowStr } from '../core/ui.js';
import { leerNumero, fmtCr, fmtPct } from '../core/format.js';
import { Modal, Fld, SelectorMoneda, NombreFurni } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';
import { calcularComision } from '../core/comision.js';

export function VenderModal(props) {
  var l = props.lote;
  var furni = props.furni || {};
  var tasa = props.tasa || 50;
  var sQ = useState(String(l.cantidad)); var cant = sQ[0]; var setCant = sQ[1];
  // Se usa para lo publicado (lo en mano se vende con VentaManualModal): se propone su
  // precio de lista.
  var publicado = l.estado === 'publicado';
  var precioBase = publicado ? l.precio_lista : null;
  var sM = useState(publicado ? l.moneda_lista : 'creditos'); var moneda = sM[0]; var setMoneda = sM[1];
  var sP = useState(precioBase !== null && precioBase !== undefined ? String(precioBase).replace('.', ',') : ''); var precio = sP[0]; var setPrecio = sP[1];
  var sF = useState(nowStr()); var fecha = sF[0]; var setFecha = sF[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  var q = leerNumero(cant);
  var p = leerNumero(precio);
  var qValida = q && !isNaN(q) && q >= 1 && q <= l.cantidad && Math.floor(q) === q;
  var pValido = p !== null && !isNaN(p) && p >= 0;
  var mercado = publicado && moneda === 'creditos';
  var comisionU = mercado && pValido ? calcularComision(p) : 0;
  var pCr = pValido ? (moneda === 'lingos' ? p * tasa : p - comisionU) : null;
  var costoU = l.precio_compra_cr;
  var ganancia = qValida && pCr !== null ? (pCr - costoU) * q : null;

  function cambiarCant(d) { var n = (qValida ? q : 1) + d; setCant(String(Math.max(1, Math.min(l.cantidad, n)))); }

  function vender() {
    if (!qValida) { setError('La cantidad debe estar entre 1 y ' + l.cantidad + '.'); return; }
    if (!pValido) { setError(mercado ? 'Escribe el precio al que se vendió en el mercadillo.' : 'Escribe el precio real al que vendiste.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/compras/' + l.id + '/vender', { cantidad: q, moneda_venta: moneda, precio_venta: p, fecha_venta: fecha })
        .then(function (r) { if (r) props.onGuardado(r, r.dividida ? 'Venta registrada: el lote se dividió' : 'Lote vendido'); });
    });
  }

  return h(Modal, { titulo: (publicado ? 'Registrar venta del lote Nº ' : 'Vender del lote Nº ') + l.id, onClose: props.onClose },
    h(NombreFurni, { furni: l, sub: 'Lote de ' + l.cantidad + ' und a ' + fmtCr(costoU) + ' cr c/u' + (l.pendiente ? ' · por revisar' : '') + (publicado ? ' · publicado a ' + fmtCr(l.precio_lista) + (l.moneda_lista === 'lingos' ? ' lingos' : ' cr') : '') }),
    publicado ? h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center', background: 'var(--purple-bg)', color: 'var(--purple)' } },
      h(Ico, { name: 'lock', size: 14 }), 'Está publicado en el mercadillo. Regístralo aquí solo cuando se haya vendido.') : null,
    h(Fld, { label: '¿Cuántas vendiste?' },
      h('div', { style: { display: 'flex', gap: 6 } },
        h('button', { className: 'btn', onClick: function () { cambiarCant(-1); } }, '−'),
        h('input', { className: 'inp inp-num', style: { width: 80, textAlign: 'center' }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); } }),
        h('button', { className: 'btn', onClick: function () { cambiarCant(1); } }, '+'),
        h('button', { className: 'btn', onClick: function () { setCant(String(l.cantidad)); } }, 'Todo'))),
    h('div', { className: 'fila-2' },
      h(Fld, { label: mercado ? 'Precio en el mercadillo (lo que pagó el comprador)' : 'Precio real de venta (lo que recibiste)' },
        h('input', { className: 'inp inp-num', value: precio, placeholder: '0', inputMode: 'decimal', autoFocus: true, onChange: function (e) { setPrecio(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') vender(); } })),
      h(Fld, { label: 'Fecha de venta' }, h('input', { className: 'inp', type: 'date', value: fecha, onChange: function (e) { setFecha(e.target.value); } }))),
    h(SelectorMoneda, { valor: moneda, onChange: setMoneda }),
    qValida ? h('div', { className: 'aviso' },
      q < l.cantidad
        ? h('div', null, 'El lote Nº ', l.id, ' queda con ', h('b', { className: 'mono' }, l.cantidad - q), ' und en stock y nace una fila ', h('span', { className: 'tag tag-verde' }, 'Vendido'), ' de ', h('b', { className: 'mono' }, q), ' und.')
        : h('div', null, 'El lote completo pasa a ', h('span', { className: 'tag tag-verde' }, 'Vendido'), '.'),
      mercado && pValido ? h('div', { style: { marginTop: 6 } }, 'Entra a tu monedero: ',
        h('b', { className: 'mono' }, fmtCr(pCr) + ' cr'), ' por unidad (comisión del mercadillo ' + fmtCr(comisionU) + ' cr). Se guarda ese neto.') : null,
      ganancia !== null ? h('div', { style: { marginTop: 6 } }, 'Ganancia real: ',
        h('b', { className: 'mono ' + (ganancia > 0 ? 'pos' : ganancia < 0 ? 'neg' : '') }, (ganancia > 0 ? '+' : '') + fmtCr(ganancia) + ' cr'),
        ' · margen ', fmtPct(costoU ? (pCr - costoU) / costoU : 0)) : null,
      !publicado && moneda === 'creditos' && pValido && calcularComision(p) > 0 ? h('div', { className: 'suave', style: { marginTop: 6, fontSize: 12 } },
        'Si lo vendiste en el mercadillo de Habbo.es, a ' + fmtCr(p) + ' cr te llegaron ' + fmtCr(p - calcularComision(p)) + ' cr: anota esa cifra.') : null,
      pCr !== null && pCr < costoU ? h('div', { className: 'neg', style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' } }, h(Ico, { name: 'alert', size: 14 }), 'Por debajo del costo de este lote') : null) : null,
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: vender, disabled: enviando }, h(Ico, { name: 'tag', size: 14 }), 'Registrar venta')));
}
