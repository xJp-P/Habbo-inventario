// public/js/modales/PublicarModal.js — pasar a "Publicado" a mano las unidades en mano de
// un furni.
//
// Para lo que pusiste tu en el mercadillo de Habbo sin el Sniper (por ejemplo, lo que
// venia del Excel). Trabaja con el FURNI, no con un lote suelto: por defecto publica
// todas sus unidades en mano, tomandolas de sus lotes del mas antiguo al mas nuevo
// (FIFO, igual que el Sniper), y el furni sale por completo de Comprado. Si publicas
// menos, el ultimo lote que entra se divide. Lo "por revisar" (recien comprado por el
// Sniper) no se toca: lo publica el Sniper. El precio de lista es en creditos y se pone
// aqui (lo en mano no tiene precio); si el furni ya tiene algo publicado, se propone ese
// mismo precio de lista. Con "Ingresar precio neto" escribes lo que quieres que te entre
// y se calcula el precio de lista (el menor que deja ese neto tras la comision). Siempre
// se ven los dos: lo que paga el comprador y lo que entra a tu monedero, y la ganancia.
// Lo publicado a mano se retira desde su fila.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { leerNumero, fmtCr, fmtLg } from '../core/format.js';
import { Modal, Fld, NombreFurni } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';
import { calcularComision, calcularGananciaNeta, calcularPrecioLista } from '../core/comision.js';
import { repartirFifo } from '../core/lotes.js';

function texto(n) { return String(n).replace('.', ','); }

export function PublicarModal(props) {
  var furni = props.furni || {};
  var lotes = props.lotes || [];
  var total = lotes.reduce(function (s, l) { return s + l.cantidad; }, 0);
  var costoTotal = lotes.reduce(function (s, l) { return s + l.precio_compra_cr * l.cantidad; }, 0);
  var sQ = useState(String(total)); var cant = sQ[0]; var setCant = sQ[1];
  var precioBase = furni.moneda_lista_actual === 'creditos' ? furni.precio_lista_actual : null;
  var sP = useState(precioBase !== null && precioBase !== undefined ? String(precioBase).replace('.', ',') : ''); var precio = sP[0]; var setPrecio = sP[1];
  var sNeto = useState(false); var modoNeto = sNeto[0]; var setModoNeto = sNeto[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  var q = leerNumero(cant);
  var entrada = leerNumero(precio);
  var qValida = q && !isNaN(q) && q >= 1 && q <= total && Math.floor(q) === q;
  var entradaValida = entrada !== null && !isNaN(entrada) && entrada >= 0;
  // p = precio de lista (lo que paga el comprador); netoU = lo que entra por unidad.
  var p = !entradaValida ? null : modoNeto ? calcularPrecioLista(entrada) : entrada;
  var pValido = p !== null;
  var tomas = qValida ? repartirFifo(lotes, q) : [];
  var costoTomado = tomas.reduce(function (s, t) { return s + t.lote.precio_compra_cr * t.toma; }, 0);
  var netoU = pValido ? p - calcularComision(p) : null;

  // Al cambiar de modo, el numero escrito se convierte para no perder lo que se veia.
  function cambiarModo(neto) {
    if (pValido) setPrecio(texto(neto ? netoU : p));
    setModoNeto(neto);
    setError('');
  }
  var ganancia = qValida && pValido ? tomas.reduce(function (s, t) { return s + calcularGananciaNeta(p, t.lote.precio_compra_cr) * t.toma; }, 0) : null;
  var divide = tomas.length && tomas[tomas.length - 1].toma < tomas[tomas.length - 1].lote.cantidad;

  function cambiarCant(d) { var n = (qValida ? q : 1) + d; setCant(String(Math.max(1, Math.min(total, n)))); }

  function publicar() {
    if (!qValida) { setError('La cantidad debe estar entre 1 y ' + total + '.'); return; }
    if (!pValido) {
      setError(modoNeto && entradaValida ? 'Ningún precio de lista deja ese neto: el máximo que puede entrar por unidad es 192.080 cr.'
        : modoNeto ? 'Escribe cuánto quieres que te entre por unidad (en créditos).' : 'Escribe el precio de lista con que lo publicaste (en créditos).');
      return;
    }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/furnis/' + furni.id + '/publicar', { cantidad: q, precio_lista: p })
        .then(function (r) {
          if (r) props.onGuardado(r, r.cantidad + ' und de ' + furni.nombre + ' publicadas a ' + fmtCr(p) + ' cr' + (r.en_mano ? ' · quedan ' + r.en_mano + ' en Comprado' : ' · el furni salió de Comprado'));
        });
    });
  }

  return h(Modal, { titulo: 'Publicar en el mercadillo', onClose: props.onClose },
    h(NombreFurni, { furni: furni, sub: total + ' und en mano en ' + lotes.length + (lotes.length === 1 ? ' lote' : ' lotes') + ' · costo promedio ' + fmtLg(total ? costoTotal / total : 0) + ' cr' }),
    h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center', background: 'var(--purple-bg)', color: 'var(--purple)' } },
      h(Ico, { name: 'store', size: 14 }), 'Úsalo para lo que ya pusiste tú en el mercadillo de Habbo. Lo que publica el Sniper llega solo.'),
    h(Fld, { label: '¿Cuántas publicaste?' },
      h('div', { style: { display: 'flex', gap: 6 } },
        h('button', { className: 'btn', onClick: function () { cambiarCant(-1); } }, '−'),
        h('input', { className: 'inp inp-num', style: { width: 80, textAlign: 'center' }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); setError(''); } }),
        h('button', { className: 'btn', onClick: function () { cambiarCant(1); } }, '+'),
        h('button', { className: 'btn', onClick: function () { setCant(String(total)); } }, 'Todas'))),
    h(Fld, { label: modoNeto ? 'Neto que quieres recibir (créditos, por unidad)' : 'Precio de lista en el mercadillo (créditos, por unidad)' },
      h('input', { className: 'inp inp-num', value: precio, placeholder: '0', inputMode: 'decimal', autoFocus: true,
        onChange: function (e) { setPrecio(e.target.value); setError(''); }, onKeyDown: function (e) { if (e.key === 'Enter') publicar(); } }),
      h('label', { className: 'check', style: { marginTop: 8 } },
        h('input', { type: 'checkbox', checked: modoNeto, onChange: function (e) { cambiarModo(e.target.checked); } }),
        'Ingresar precio neto (lo que quiero que me entre); la app calcula el precio de lista')),
    h('div', { className: 'par-precios' },
      h('div', { className: modoNeto ? 'calculado' : '' },
        h('div', { className: 'dato-l' }, 'Paga el comprador (precio de lista)', modoNeto ? h('span', { className: 'tag tag-gris', style: { marginLeft: 6 } }, 'calculado') : null),
        h('div', { className: 'par-valor mono' }, pValido ? fmtCr(p) + ' cr' : '-')),
      h('div', { className: modoNeto ? '' : 'calculado' },
        h('div', { className: 'dato-l' }, 'Entra a tu monedero (neto)', modoNeto ? null : h('span', { className: 'tag tag-gris', style: { marginLeft: 6 } }, 'calculado')),
        h('div', { className: 'par-valor mono pos' }, pValido ? fmtCr(netoU) + ' cr' : '-')),
      h('div', { className: 'par-nota suave' }, pValido ? 'Comisión de Habbo: ' + fmtCr(p - netoU) + ' cr por unidad' : 'Por unidad, en créditos')),
    qValida ? h('div', { className: 'aviso' },
      q === total
        ? h('div', null, 'Las ', h('b', { className: 'mono' }, total), ' und pasan a ',
            h('span', { className: 'tag tag-morado' }, h(Ico, { name: 'lock', size: 11, sw: 2.2 }), 'Publicado'), ' y el furni sale de Comprado.')
        : h('div', null, 'Se publican ', h('b', { className: 'mono' }, q), ' und de los lotes más antiguos y quedan ', h('b', { className: 'mono' }, total - q), ' en Comprado',
            divide ? ' (el lote Nº ' + tomas[tomas.length - 1].lote.id + ' se divide).' : '.'),
      pValido ? h('div', { style: { marginTop: 6 } }, 'Si se venden las ', q, ', entran ',
        h('b', { className: 'mono' }, fmtCr(netoU * q) + ' cr'), ' · ganancia ',
        h('b', { className: 'mono ' + (ganancia > 0 ? 'pos' : ganancia < 0 ? 'neg' : '') }, (ganancia > 0 ? '+' : '') + fmtCr(ganancia) + ' cr')) : null,
      pValido && netoU * q < costoTomado ? h('div', { className: 'neg', style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' } }, h(Ico, { name: 'alert', size: 14 }), 'Tras la comisión no cubre lo que costaron') : null) : null,
    furni.unidades_pendientes > 0 ? h('div', { className: 'suave', style: { fontSize: 12 } },
      'Las ' + furni.unidades_pendientes + ' und «por revisar» del Sniper no se incluyen: esas las publica el Sniper.') : null,
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: publicar, disabled: enviando }, h(Ico, { name: 'store', size: 14 }), 'Publicar')));
}
