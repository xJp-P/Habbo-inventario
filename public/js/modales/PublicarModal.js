// public/js/modales/PublicarModal.js — pasar un lote "Comprado" a "Publicado" a mano.
//
// Para lo que pusiste tu en el mercadillo de Habbo sin el Sniper (por ejemplo, lo que
// venia del Excel). Publicas todo el lote o una parte: si es una parte, el lote se
// divide y nace un lote "Publicado" con esas unidades. El precio de lista es en
// creditos (el mercadillo cobra en creditos) y se propone el del furni. La vista previa
// muestra lo que entraria a tu monedero y la ganancia, ya descontada la comision.
// Lo publicado a mano se puede retirar desde su detalle en el Inventario.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { leerNumero, fmtCr } from '../core/format.js';
import { Modal, Fld, NombreFurni } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';
import { calcularComision, calcularGananciaNeta } from '../core/comision.js';

export function PublicarModal(props) {
  var l = props.lote;
  var furni = props.furni || {};
  var sQ = useState(String(l.cantidad)); var cant = sQ[0]; var setCant = sQ[1];
  var precioBase = furni.moneda_venta === 'creditos' ? furni.precio_venta : null;
  var sP = useState(precioBase !== null && precioBase !== undefined ? String(precioBase).replace('.', ',') : ''); var precio = sP[0]; var setPrecio = sP[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  var q = leerNumero(cant);
  var p = leerNumero(precio);
  var qValida = q && !isNaN(q) && q >= 1 && q <= l.cantidad && Math.floor(q) === q;
  var pValido = p !== null && !isNaN(p) && p >= 0;
  var costoU = l.precio_compra_cr;
  var netoU = pValido ? p - calcularComision(p) : null;
  var ganancia = qValida && pValido ? calcularGananciaNeta(p, costoU) * q : null;

  function cambiarCant(d) { var n = (qValida ? q : 1) + d; setCant(String(Math.max(1, Math.min(l.cantidad, n)))); }

  function publicar() {
    if (!qValida) { setError('La cantidad debe estar entre 1 y ' + l.cantidad + '.'); return; }
    if (!pValido) { setError('Escribe el precio de lista con que lo publicaste (en créditos).'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/compras/' + l.id + '/publicar', { cantidad: q, precio_lista: p })
        .then(function (r) { if (r) props.onGuardado(r, q + ' und de ' + l.nombre + ' publicadas a ' + fmtCr(p) + ' cr · están en la pestaña Publicado'); });
    });
  }

  return h(Modal, { titulo: 'Publicar en el mercadillo · lote Nº ' + l.id, onClose: props.onClose },
    h(NombreFurni, { furni: l, sub: 'Lote de ' + l.cantidad + ' und a ' + fmtCr(costoU) + ' cr c/u' + (l.pendiente ? ' · por revisar' : '') }),
    h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center', background: 'var(--purple-bg)', color: 'var(--purple)' } },
      h(Ico, { name: 'store', size: 14 }), 'Úsalo para lo que ya pusiste tú en el mercadillo de Habbo. Lo que publica el Sniper llega solo.'),
    h(Fld, { label: '¿Cuántas publicaste?' },
      h('div', { style: { display: 'flex', gap: 6 } },
        h('button', { className: 'btn', onClick: function () { cambiarCant(-1); } }, '−'),
        h('input', { className: 'inp inp-num', style: { width: 80, textAlign: 'center' }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); } }),
        h('button', { className: 'btn', onClick: function () { cambiarCant(1); } }, '+'),
        h('button', { className: 'btn', onClick: function () { setCant(String(l.cantidad)); } }, 'Todo'))),
    h(Fld, { label: 'Precio de lista en el mercadillo (créditos, por unidad)' },
      h('input', { className: 'inp inp-num', value: precio, placeholder: '0', inputMode: 'decimal', autoFocus: true,
        onChange: function (e) { setPrecio(e.target.value); setError(''); }, onKeyDown: function (e) { if (e.key === 'Enter') publicar(); } })),
    qValida ? h('div', { className: 'aviso' },
      q < l.cantidad
        ? h('div', null, 'El lote Nº ', l.id, ' queda con ', h('b', { className: 'mono' }, l.cantidad - q), ' und en Comprado y nace un lote ',
            h('span', { className: 'tag tag-morado' }, h(Ico, { name: 'lock', size: 11, sw: 2.2 }), 'Publicado'), ' de ', h('b', { className: 'mono' }, q), ' und.')
        : h('div', null, 'El lote completo pasa a ', h('span', { className: 'tag tag-morado' }, h(Ico, { name: 'lock', size: 11, sw: 2.2 }), 'Publicado'), ' y sale de la lista de Comprado.'),
      pValido ? h('div', { style: { marginTop: 6 } }, 'Si se vende, entran a tu monedero ',
        h('b', { className: 'mono' }, fmtCr(netoU) + ' cr'), ' por unidad (comisión ' + fmtCr(p - netoU) + ' cr) · ganancia ',
        h('b', { className: 'mono ' + (ganancia > 0 ? 'pos' : ganancia < 0 ? 'neg' : '') }, (ganancia > 0 ? '+' : '') + fmtCr(ganancia) + ' cr')) : null,
      pValido && netoU < costoU ? h('div', { className: 'neg', style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' } }, h(Ico, { name: 'alert', size: 14 }), 'Tras la comisión no cubre el costo de este lote') : null) : null,
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: publicar, disabled: enviando }, h(Ico, { name: 'store', size: 14 }), 'Publicar')));
}
