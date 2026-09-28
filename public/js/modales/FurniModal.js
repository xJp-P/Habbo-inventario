// public/js/modales/FurniModal.js — agregar un furni al Mercadillo o editar su precio.
//
// Alta: el nombre se elige del buscador del catalogo de Habbo.es (nombre oficial).
// Edicion: nombre fijo; se cambian moneda, precio de venta y notas. Desde aca tambien
// se elimina el furni (solo si no tiene lotes en el Inventario).

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { leerNumero, fmtCr } from '../core/format.js';
import { Modal, Fld, SelectorMoneda, NombreFurni } from '../componentes/base.js';
import { Autocompletar } from '../componentes/Autocompletar.js';
import { Ico } from '../componentes/iconos.js';

export function FurniModal(props) {
  var f = props.furni;
  var sE = useState(null); var elegido = sE[0]; var setElegido = sE[1];
  var sM = useState(f ? f.moneda_venta : 'creditos'); var moneda = sM[0]; var setMoneda = sM[1];
  var sP = useState(f && f.precio_venta !== null ? String(f.precio_venta).replace('.', ',') : ''); var precio = sP[0]; var setPrecio = sP[1];
  var sN = useState(f && f.notas ? f.notas : ''); var notas = sN[0]; var setNotas = sN[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  function guardar() {
    var p = leerNumero(precio);
    if (!f && !elegido) { setError('Elige el furni de la lista (nombres oficiales de Habbo.es).'); return; }
    if (p !== null && (isNaN(p) || p < 0)) { setError('El precio de venta no es válido.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      var datos = { moneda_venta: moneda, precio_venta: p, notas: notas };
      var peticion = f ? API.put('/api/furnis/' + f.id, datos)
        : API.post('/api/furnis', Object.assign(datos, { nombre: elegido.nombre, classname: elegido.classname }));
      return peticion.then(function (r) { if (r) props.onGuardado(r, f ? 'Precio actualizado' : 'Furni agregado al Mercadillo'); });
    });
  }

  function eliminar() {
    if (!window.confirm('¿Eliminar "' + f.nombre + '" del Mercadillo?')) return;
    _submitGuard(enviando, setEnviando, function () {
      return API.del('/api/furnis/' + f.id).then(function (r) { if (r) props.onGuardado(null, 'Furni eliminado'); });
    });
  }

  return h(Modal, { titulo: f ? 'Editar furni' : 'Agregar furni al Mercadillo', onClose: props.onClose },
    f ? h(NombreFurni, { furni: f, sub: f.classname || 'Sin vincular al catálogo' })
      : h(Fld, { label: 'Furni (nombre oficial de Habbo.es)' },
          h(Autocompletar, { autoFocus: true, propios: props.propios, error: !!error && !elegido,
            onElegir: function (it, propio) {
              if (propio) { setError('"' + it.nombre + '" ya está en tu Mercadillo.'); setElegido(null); return; }
              setElegido(it); setError('');
            },
            onEscribir: function () { setElegido(null); } })),
    h(Fld, { label: 'Moneda de venta' }, h(SelectorMoneda, { valor: moneda, onChange: setMoneda })),
    h(Fld, { label: 'Precio de venta por unidad', ayuda: f && f.costo_promedio_cr ? 'Costo promedio: ' + fmtCr(f.costo_promedio_cr) + ' cr · mínimo para no perder: ' + fmtCr(f.precio_minimo_cr) + ' cr' : 'Puedes dejarlo vacío y ponerlo después.' },
      h('input', { className: 'inp inp-num', value: precio, placeholder: '0', inputMode: 'decimal',
        onChange: function (e) { setPrecio(e.target.value); },
        onKeyDown: function (e) { if (e.key === 'Enter') guardar(); } })),
    h(Fld, { label: 'Notas (opcional)' }, h('input', { className: 'inp', value: notas, onChange: function (e) { setNotas(e.target.value); } })),
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
      f ? h('button', { className: 'btn btn-peligro', onClick: eliminar, disabled: enviando || f.unidades_compradas > 0,
        title: f.unidades_compradas > 0 ? 'Tiene lotes en el Inventario' : '' }, h(Ico, { name: 'trash', size: 14 }), 'Eliminar') : null,
      h('div', { style: { flex: 1 } }),
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: guardar, disabled: enviando }, h(Ico, { name: 'check', size: 14, sw: 2.4 }), 'Guardar')));
}
