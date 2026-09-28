// public/js/modales/CompraModal.js — registrar a mano una compra (un lote) en el Inventario.
//
// El furni se elige del catalogo de Habbo.es; si no estaba entre tus furnis, se agrega
// solo. Lo comprado queda en mano, sin precio: el precio se pone al publicar o al vender.
// Las compras del Sniper NO pasan por aca: llegan solas.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard, nowStr } from '../core/ui.js';
import { leerNumero } from '../core/format.js';
import { Modal, Fld, SelectorMoneda, NombreFurni } from '../componentes/base.js';
import { Autocompletar } from '../componentes/Autocompletar.js';
import { Ico } from '../componentes/iconos.js';

export function CompraModal(props) {
  var fijo = props.furni || null;
  var sE = useState(null); var elegido = sE[0]; var setElegido = sE[1];
  var sC = useState('1'); var cantidad = sC[0]; var setCantidad = sC[1];
  var sM = useState('creditos'); var moneda = sM[0]; var setMoneda = sM[1];
  var sP = useState(''); var precio = sP[0]; var setPrecio = sP[1];
  var sF = useState(nowStr()); var fecha = sF[0]; var setFecha = sF[1];
  var sN = useState(''); var notas = sN[0]; var setNotas = sN[1];
  var sL = useState(''); var ltd = sL[0]; var setLtd = sL[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  function guardar() {
    var q = leerNumero(cantidad);
    var p = leerNumero(precio);
    if (!fijo && !elegido) { setError('Elige el furni de la lista (nombres oficiales de Habbo.es).'); return; }
    if (!q || isNaN(q) || q < 1 || Math.floor(q) !== q) { setError('La cantidad debe ser un número entero mayor que 0.'); return; }
    if (p === null || isNaN(p) || p < 0) { setError('Escribe el precio que pagaste por unidad.'); return; }
    var numLtd = ltd.trim().replace(/^#\s*/, '');
    if (numLtd && (!/^[0-9]{1,9}$/.test(numLtd) || Number(numLtd) < 1)) { setError('El número LTD debe ser un entero mayor que 0 (p. ej. 45).'); return; }
    if (numLtd && q !== 1) { setError('Un LTD es una sola unidad: registra cada número como una compra de 1.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      var datos = { cantidad: q, moneda_compra: moneda, precio_compra: p, fecha_compra: fecha, notas: notas, numero_ltd: numLtd || null };
      if (fijo) datos.furni_id = fijo.id;
      else if (elegido.propio) datos.furni_id = elegido.propio.id;
      else { datos.nombre = elegido.item.nombre; datos.classname = elegido.item.classname; }
      return API.post('/api/compras', datos).then(function (r) { if (r) props.onGuardado(r, 'Compra registrada en el Inventario'); });
    });
  }

  var alEnter = function (e) { if (e.key === 'Enter') guardar(); };

  return h(Modal, { titulo: h('span', null, h(Ico, { name: 'plus', size: 16 }), ' Registrar compra'), onClose: props.onClose },
    fijo ? h(NombreFurni, { furni: fijo, sub: fijo.classname || '' })
      : h(Fld, { label: 'Furni (nombre oficial de Habbo.es)', ayuda: elegido && !elegido.propio ? 'Nuevo: se agregará a tus furnis.' : null },
          h(Autocompletar, { autoFocus: true, propios: props.propios, error: !!error && !elegido,
            onElegir: function (it, propio) { setElegido({ item: it, propio: propio }); setError(''); },
            onEscribir: function () { setElegido(null); } })),
    h('div', { className: 'fila-2' },
      h(Fld, { label: 'Cantidad' }, h('input', { className: 'inp inp-num', value: cantidad, inputMode: 'numeric', disabled: !!ltd.trim(), title: ltd.trim() ? 'Un LTD es una sola unidad' : '',
        onChange: function (e) { setCantidad(e.target.value); }, onKeyDown: alEnter })),
      h(Fld, { label: 'Precio por unidad' }, h('input', { className: 'inp inp-num', value: precio, placeholder: '0', inputMode: 'decimal', autoFocus: !!fijo, onChange: function (e) { setPrecio(e.target.value); }, onKeyDown: alEnter }))),
    h(Fld, { label: 'Moneda de compra' }, h(SelectorMoneda, { valor: moneda, onChange: setMoneda })),
    h(Fld, { label: 'Número LTD (opcional)', ayuda: 'Solo para rares LTD: su número de serie define su valor. Un LTD es una unidad, así que la cantidad queda en 1.' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('span', { className: 'mono suave', style: { fontSize: 16 } }, '#'),
        h('input', { className: 'inp inp-num', value: ltd, placeholder: '45', inputMode: 'numeric', style: { maxWidth: 160 },
          onChange: function (e) { setLtd(e.target.value); if (e.target.value.trim()) setCantidad('1'); setError(''); }, onKeyDown: alEnter }))),
    h('div', { className: 'fila-2' },
      h(Fld, { label: 'Fecha' }, h('input', { className: 'inp', type: 'date', value: fecha, onChange: function (e) { setFecha(e.target.value); } })),
      h(Fld, { label: 'Notas (opcional)' }, h('input', { className: 'inp', value: notas, onChange: function (e) { setNotas(e.target.value); } }))),
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: guardar, disabled: enviando }, h(Ico, { name: 'check', size: 14, sw: 2.4 }), 'Registrar')));
}
