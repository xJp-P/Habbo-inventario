// public/js/modales/AsignarVentaModal.js — asignar a un lote una venta del Sniper que
// quedo «por asignar» (v1.7.0, migracion 20261015000000).
//
// La base no pudo casarla sola (el lote se publico despues de la venta, solo hay LTD con
// otro numero, no sabia si era de suelo o de pared...). Aqui eliges de que lote salio:
// los publicados de ese furni en el keko de la venta o sin keko (core/ventas.js,
// candidatosDeVenta). Sin la regla de la hora: decides tu. Un LTD con otro numero no se
// puede elegir. Si la app no tiene ese furni, o no hay nada publicado, se explica y se
// ofrece descartarla.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { fmtCr, fmtHace } from '../core/format.js';
import { Modal, Fld, NombreFurni, EtiquetaLtd } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';
import { calcularComision } from '../core/comision.js';
import { candidatosDeVenta, cuandoVenta, nombreVentaPendiente } from '../core/ventas.js';

export function AsignarVentaModal(props) {
  var v = props.venta;
  var furni = nombreVentaPendiente(v, props.furnis);
  var candidatos = candidatosDeVenta(v, props.compras, props.furnis);
  var elegibles = candidatos.filter(function (c) { return !c.bloqueado; });
  var sE = useState(elegibles.length ? elegibles[0].lote.id : null); var elegido = sE[0]; var setElegido = sE[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var cand = candidatos.find(function (c) { return c.lote.id === elegido; });
  var l = cand ? cand.lote : null;
  var comision = calcularComision(Number(v.precio));
  var neto = Number(v.precio) - comision;
  var ganancia = l ? neto - Number(l.precio_compra_cr) : null;

  function registrar() {
    if (!l) return;
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/ventas-por-asignar/' + v.id + '/aplicar', { lote_id: l.id }).then(function (r) {
        if (r) props.onGuardado(r, 'Venta registrada: 1 × ' + (r.nombre || furni.nombre) + ' en ' + v.keko + ' · entraron ' + fmtCr(r.neto) + ' cr');
      });
    });
  }

  var mensaje = !furni.registrado
    ? 'La app no tiene este furni (sprite ' + v.sprite_id + '). Si la venta es tuya, registra su compra con «+ Compra» y publícala; después vuelve aquí. Si no, descártala.'
    : !candidatos.length ? 'No hay unidades publicadas de ' + furni.nombre + ' en ' + v.keko + ' ni sin keko. Si la venta es tuya, publica primero la unidad que se vendió; si no, descártala.'
    : null;

  return h(Modal, { titulo: 'Asignar la venta a un lote', ancho: 560, onClose: props.onClose },
    h(NombreFurni, { furni: { nombre: furni.nombre, classname: furni.classname, revision: furni.revision, numero_ltd: v.numero_ltd },
      sub: '1 und a ' + fmtCr(v.precio) + ' cr · ' + v.keko + ' · vendida ' + cuandoVenta(v.vendido_en) }),
    h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--blue-bg)', color: 'var(--blue)', lineHeight: 1.5 } },
      h(Ico, { name: 'radar', size: 15 }), h('span', null, 'Por qué no se asignó sola: ' + v.motivo)),
    mensaje ? h('div', { className: 'aviso aviso-ambar', style: { lineHeight: 1.5 } }, mensaje)
      : h(Fld, { label: '¿De qué lote salió?' }, h('div', { className: 'lista-lotes', role: 'radiogroup' }, candidatos.map(function (c) {
          var x = c.lote;
          var activa = elegido === x.id;
          return h('div', { key: x.id, role: 'radio', tabIndex: c.bloqueado ? -1 : 0, 'aria-checked': activa, 'aria-disabled': c.bloqueado,
              className: 'opcion-borrado' + (activa ? ' activa' : '') + (c.bloqueado ? ' deshabilitada' : ''),
              onClick: function () { if (!c.bloqueado) setElegido(x.id); },
              onKeyDown: function (e) { if (!c.bloqueado && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setElegido(x.id); } } },
            h('span', { className: 'radio' }),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { className: 'opcion-titulo', style: { fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' } },
                'Lote Nº ' + x.id, x.numero_ltd ? h(EtiquetaLtd, { numero: x.numero_ltd }) : null),
              h('div', { className: 'tenue', style: { fontSize: 12 } }, c.bloqueado ? c.motivo
                : x.cantidad + ' und publicadas a ' + fmtCr(x.precio_lista) + ' cr · ' + (x.keko || 'sin keko')
                  + (x.publicado_en ? ' · publicado ' + fmtHace(x.publicado_en) + ' (' + cuandoVenta(x.publicado_en) + ')' : ''))));
        }))),
    l ? h('div', { className: 'aviso' }, 'Se registra la venta de 1 und a ', h('b', { className: 'mono' }, fmtCr(v.precio) + ' cr'), ': entran ',
      h('b', { className: 'mono' }, fmtCr(neto) + ' cr'), ' (comisión ' + fmtCr(comision) + ')',
      ganancia !== null && !isNaN(ganancia) ? h('span', null, ' · ganancia ', h('b', { className: 'mono ' + (ganancia >= 0 ? 'pos' : 'neg') }, (ganancia >= 0 ? '+' : '') + fmtCr(ganancia) + ' cr')) : null,
      v.numero_ltd && !l.numero_ltd ? ' · la unidad queda con el número #' + v.numero_ltd : null) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      !elegibles.length ? h('button', { className: 'btn btn-peligro', onClick: function () { props.onDescartar(v); } }, h(Ico, { name: 'trash', size: 14 }), 'Descartar venta')
        : h('button', { className: 'btn btn-verde', disabled: !l || enviando, onClick: registrar }, h(Ico, { name: 'tag', size: 14 }), 'Registrar venta')));
}
