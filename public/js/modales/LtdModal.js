// public/js/modales/LtdModal.js — poner, cambiar o quitar el numero de serie de un LTD.
//
// Un LTD (Limited Edition Rare) es una sola unidad con su numero (#45), que define su
// valor. Si el lote tiene varias unidades (p. ej. lo que venia del Excel) y esta en mano,
// al guardar se separa UNA unidad en un lote propio con ese numero (funcion asignar_ltd);
// asi puedes numerar uno por uno los LTD que ya tenias.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { Modal, Fld, NombreFurni } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';

function limpiar(v) { return String(v || '').trim().replace(/^#\s*/, ''); }

export function LtdModal(props) {
  var l = props.lote;
  var sN = useState(l.numero_ltd ? String(l.numero_ltd) : ''); var numero = sN[0]; var setNumero = sN[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var varias = l.cantidad > 1;
  var bloqueado = varias && l.estado !== 'comprado';

  function enviar(valor, mensaje) {
    _submitGuard(enviando, setEnviando, function () {
      return API.put('/api/compras/' + l.id + '/ltd', { numero_ltd: valor })
        .then(function (r) { if (r) props.onGuardado(r, mensaje(r)); });
    });
  }
  function guardar() {
    var s = limpiar(numero);
    if (!/^[0-9]{1,9}$/.test(s) || Number(s) < 1) { setError('Escribe el número del LTD (p. ej. 45).'); return; }
    enviar(Number(s), function (r) { return r.separado ? 'LTD #' + s + ' separado en su propio lote (Nº ' + r.lote.id + ')' : 'Número LTD #' + s + ' guardado'; });
  }
  function quitar() { enviar(null, function () { return 'Número LTD quitado'; }); }

  return h(Modal, { titulo: 'Número LTD', onClose: props.onClose, ancho: 440 },
    h(NombreFurni, { furni: l, sub: 'Lote Nº ' + l.id + ' · ' + l.cantidad + ' und' }),
    bloqueado
      ? h('div', { className: 'aviso aviso-ambar' }, 'Este lote tiene ' + l.cantidad + ' unidades y no está en mano. Un LTD es una sola unidad: numera sus unidades mientras estén en Comprado.')
      : [
          varias ? h('div', { key: 'av', className: 'aviso' }, 'Este lote tiene ' + l.cantidad + ' unidades. Un LTD es una sola unidad: al guardar se separa 1 unidad en un lote propio con este número (quedan ' + (l.cantidad - 1) + ' en este lote).') : null,
          h(Fld, { key: 'num', label: 'Número de serie', ayuda: 'El número del rare (el que aparece como «#45» en Habbo).' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { className: 'mono suave', style: { fontSize: 16 } }, '#'),
              h('input', { className: 'inp inp-num', value: numero, placeholder: '45', inputMode: 'numeric', autoFocus: true, style: { maxWidth: 160 },
                onChange: function (e) { setNumero(e.target.value); setError(''); }, onKeyDown: function (e) { if (e.key === 'Enter') guardar(); } }))),
        ],
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
      l.numero_ltd ? h('button', { className: 'btn btn-peligro', onClick: quitar, disabled: enviando }, h(Ico, { name: 'x', size: 13 }), 'Quitar número') : null,
      h('div', { style: { flex: 1 } }),
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      bloqueado ? null : h('button', { className: 'btn btn-verde', onClick: guardar, disabled: enviando }, h(Ico, { name: 'check', size: 14, sw: 2.4 }), varias ? 'Separar y guardar' : 'Guardar')));
}
