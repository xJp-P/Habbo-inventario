// public/js/modales/VentaManualModal.js — registrar una venta hecha FUERA del Sniper: un
// tradeo, o una venta desde un keko que no tiene el Sniper conectado.
//
// Sale de lo que tienes en mano (Comprado). Se abre desde "Venta" en el Inventario (eliges
// el furni entre los que tienes en mano) o desde "Vender" en la fila de un lote (ese furni
// y ese lote ya elegidos). Las unidades salen de un lote concreto o, en automatico, de los
// lotes mas antiguos primero (FIFO; lo "por revisar" al final), igual que hace la base
// (funcion vender_en_mano).
//
// ¿Como se vendio?
//   - Tradeo o venta directa: sin comision; el precio es lo que recibiste, en creditos o
//     en lingos.
//   - Mercadillo (otro keko): el precio es lo que pago el comprador (en creditos) y se
//     guarda el neto, descontada la comision de Habbo.es.
// Lo publicado no se vende por aqui: eso se registra con "Vendido" (Mercadillo o pestana
// Publicado).
//
// De que keko salen (v1.2.0): desde "Venta" hay que elegirlo, y solo se ofrecen los furnis
// y lotes de ese keko (vender_en_mano con p_keko). Asi una venta desde la bodega no
// descuenta unidades de un keko con Sniper y no descuadra su auditoria. Desde "Vender" en
// un lote, el keko es el de ese lote. Sin la migracion 20261008000000 no hay selector.
//
// Desde «Vender» en la fila de un furni del Inventario agrupado (v1.8.0; props.furni +
// props.ambito): ese furni y su keko ya elegidos, y «Automatico» toma sus lotes mas
// antiguos. En «Sin keko» no hay automatico (vender_en_mano sin keko tomaria de todos los
// kekos): se elige el lote, empezando por el mas antiguo.

import { h, useState, useMemo } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard, nowStr, normalizar } from '../core/ui.js';
import { leerNumero, fmtCr, fmtLg, fmtPct } from '../core/format.js';
import { Modal, Fld, NombreFurni, IconoFurni, SelectorMoneda } from '../componentes/base.js';
import { SelectorKeko, ultimoKeko, recordarKeko } from '../componentes/SelectorKeko.js';
import { Ico } from '../componentes/iconos.js';
import { calcularComision } from '../core/comision.js';
import { repartirFifo, etiquetaLote } from '../core/lotes.js';
import { claveKeko } from '../core/kekos.js';

// Lotes en mano de un furni, en el orden en que los toma vender_en_mano.
function enMano(compras, furniId) {
  return compras.filter(function (c) { return c.furni_id === furniId && c.estado === 'comprado'; })
    .sort(function (a, b) {
      if (a.pendiente !== b.pendiente) return a.pendiente ? 1 : -1;
      if (a.fecha_compra !== b.fecha_compra) {
        if (!a.fecha_compra) return -1;
        if (!b.fecha_compra) return 1;
        return a.fecha_compra < b.fecha_compra ? -1 : 1;
      }
      return a.id - b.id;
    });
}

export function VentaManualModal(props) {
  var todas = props.compras || [];
  var tasa = props.tasa || 50;
  var fijo = !!props.lote;
  // Desde la fila de un furni: su furni y su keko, sin selector.
  var desdeFurni = !fijo && !!props.furni && !!props.ambito;
  var disponible = !!(props.kekos && props.kekos.disponible);
  var usaKekos = !fijo && !desdeFurni && disponible;
  var listaKekos = usaKekos ? props.kekos.kekos : [];
  var sK = useState(function () { return ultimoKeko(listaKekos); }); var keko = sK[0]; var setKeko = sK[1];
  // Desde un lote o un furni, el keko es el suyo (null = sin keko); undefined = sin filtro (base vieja).
  var kekoFijo = !disponible ? undefined
    : fijo ? (props.lote.keko || null)
    : desdeFurni ? (props.ambito.sin_keko ? null : props.ambito.keko || null) : undefined;
  // El keko que se nombra bajo el furni (aunque la base no conozca los kekos).
  var kekoMostrado = fijo ? props.lote.keko || null : desdeFurni ? (props.ambito.sin_keko ? null : props.ambito.keko || null) : null;
  // Sin keko no hay «Automatico» (vender_en_mano sin keko tomaria de todos): se elige el lote.
  var soloEseLote = disponible && (fijo || desdeFurni) && !kekoFijo;
  // Solo cuenta lo del keko elegido (con selector y sin keko elegido, nada).
  var compras = useMemo(function () {
    if (usaKekos) return todas.filter(function (c) { return c.keko === keko; });
    if (kekoFijo !== undefined) return todas.filter(function (c) { return claveKeko(c.keko) === claveKeko(kekoFijo); });
    return todas;
  }, [todas, usaKekos, keko, kekoFijo]);
  var sinKeko = usaKekos ? todas.reduce(function (s, c) { return s + (c.estado === 'comprado' && !c.keko ? c.cantidad : 0); }, 0) : 0;
  var inicial = props.furni || null;
  var sF = useState(inicial ? inicial.id : null); var furniId = sF[0]; var setFurniId = sF[1];
  var sB = useState(''); var busqueda = sB[0]; var setBusqueda = sB[1];
  var sL = useState(function () {
    if (props.lote) return String(props.lote.id);
    if (desdeFurni && soloEseLote) { var ls = enMano(compras, props.furni.id); return ls.length ? String(ls[0].id) : 'fifo'; }
    return 'fifo';
  }); var loteSel = sL[0]; var setLoteSel = sL[1];
  var sQ = useState(props.lote ? String(props.lote.cantidad) : '1'); var cant = sQ[0]; var setCant = sQ[1];
  var sD = useState('tradeo'); var donde = sD[0]; var setDonde = sD[1];
  var sM = useState('creditos'); var moneda = sM[0]; var setMoneda = sM[1];
  var sP = useState(''); var precio = sP[0]; var setPrecio = sP[1];
  var sFe = useState(nowStr()); var fecha = sFe[0]; var setFecha = sFe[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  // Furnis con unidades en mano (para elegir cuando se abre desde "Venta").
  var conStock = useMemo(function () {
    var unidades = {};
    compras.forEach(function (c) { if (c.estado === 'comprado') unidades[c.furni_id] = (unidades[c.furni_id] || 0) + c.cantidad; });
    return props.furnis.filter(function (f) { return unidades[f.id]; })
      .map(function (f) { return { f: f, unidades: unidades[f.id] }; })
      .sort(function (a, b) { return a.f.nombre.localeCompare(b.f.nombre); });
  }, [props.furnis, compras]);

  var furni = furniId ? props.furnis.find(function (f) { return f.id === furniId; }) : null;
  var lotes = furni ? enMano(compras, furni.id) : [];
  var total = lotes.reduce(function (s, l) { return s + l.cantidad; }, 0);
  var usables = loteSel === 'fifo' ? lotes : lotes.filter(function (l) { return String(l.id) === loteSel; });
  var maximo = usables.reduce(function (s, l) { return s + l.cantidad; }, 0);

  var mercado = donde === 'mercadillo';
  var monedaEf = mercado ? 'creditos' : moneda;
  var q = leerNumero(cant);
  var p = leerNumero(precio);
  var qValida = q && !isNaN(q) && q >= 1 && q <= maximo && Math.floor(q) === q;
  var pValido = p !== null && !isNaN(p) && p >= 0;
  var comisionU = mercado && pValido ? calcularComision(p) : 0;
  var netoU = pValido ? p - comisionU : null;
  var netoUcr = pValido ? (monedaEf === 'lingos' ? netoU * tasa : netoU) : null;
  var tomas = qValida ? repartirFifo(usables, q) : [];
  var costo = tomas.reduce(function (s, t) { return s + t.lote.precio_compra_cr * t.toma; }, 0);
  var ganancia = qValida && pValido ? netoUcr * q - costo : null;
  var fmtM = function (n) { return monedaEf === 'lingos' ? fmtLg(n) + ' lingos' : fmtCr(n) + ' cr'; };

  function elegirFurni(f) {
    setFurniId(f.id); setLoteSel('fifo'); setCant('1'); setError('');
  }
  function elegirKeko(k) {
    setKeko(k); setLoteSel('fifo'); setCant('1'); setError('');
  }
  function cambiarDonde(d) { setDonde(d); setError(''); }
  function cambiarCant(d) { var n = (qValida ? q : 1) + d; setCant(String(Math.max(1, Math.min(maximo, n)))); }

  function registrar() {
    if (usaKekos && !keko) { setError('Elige de qué keko salen las unidades.'); return; }
    if (!furni) { setError('Elige el furni que vendiste.'); return; }
    if (!qValida) { setError('La cantidad debe estar entre 1 y ' + maximo + '.'); return; }
    if (!pValido) { setError(mercado ? 'Escribe el precio al que se vendió en el mercadillo.' : 'Escribe cuánto recibiste por unidad.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/furnis/' + furni.id + '/vender-en-mano', {
        cantidad: q, precio: p, moneda: monedaEf, mercadillo: mercado, fecha: fecha, lote_id: loteSel === 'fifo' ? null : Number(loteSel),
        keko: usaKekos ? keko : kekoFijo || undefined,
      }).then(function (r) {
        if (r && usaKekos) recordarKeko(keko);
        if (r) props.onGuardado(r, 'Venta registrada: ' + q + ' und de ' + furni.nombre + (usaKekos ? ' desde ' + keko : '') + ' · entraron ' + fmtM(r.precio_neto * q));
      });
    });
  }

  var visibles = conStock.filter(function (x) { return !busqueda || normalizar(x.f.nombre).indexOf(normalizar(busqueda)) !== -1; }).slice(0, 8);

  return h(Modal, { titulo: 'Registrar venta manual', onClose: props.onClose },
    h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center' } },
      h(Ico, { name: 'tag', size: 14 }), 'Para ventas fuera del Sniper: un tradeo o una venta en el mercadillo desde un keko sin Sniper. Salen de lo que ese keko tiene en mano.'),

    usaKekos ? h(Fld, { label: '¿De qué keko salen?', ayuda: sinKeko ? 'Tienes ' + sinKeko + ' unidad(es) sin keko: véndelas con «Vender» en su lote o asígnalas en Ajustes → Kekos.' : null },
      h(SelectorKeko, { kekos: listaKekos, valor: keko, error: !!error && !keko, autoFocus: !keko, onChange: elegirKeko,
        etiqueta: function (k) { return k.nombre + ' · ' + k.en_mano + ' en mano'; } })) : null,

    furni
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('div', { style: { flex: 1, minWidth: 0 } }, h(NombreFurni, { furni: furni, sub: total + ' und en mano en ' + lotes.length + (lotes.length === 1 ? ' lote' : ' lotes') +
            (fijo || desdeFurni ? ' · ' + (kekoMostrado ? 'keko ' + kekoMostrado : 'sin keko') : usaKekos && keko ? ' · keko ' + keko : '') })),
          fijo || desdeFurni ? null : h('button', { className: 'btn btn-chico', onClick: function () { setFurniId(null); setBusqueda(''); } }, 'Cambiar'))
      : h(Fld, { label: '¿Qué furni vendiste?' },
          h('input', { className: 'inp', autoFocus: !usaKekos || !!keko, disabled: usaKekos && !keko, value: busqueda,
            placeholder: usaKekos && !keko ? 'Elige primero el keko' : conStock.length ? 'Busca entre lo que tienes en mano…' : usaKekos ? 'Ese keko no tiene nada en mano' : 'No tienes nada en mano',
            onChange: function (e) { setBusqueda(e.target.value); setError(''); } }),
          h('div', { className: 'lista-furnis' }, visibles.length ? visibles.map(function (x) {
            return h('button', { key: x.f.id, className: 'lista-furni', onClick: function () { elegirFurni(x.f); } },
              h(IconoFurni, { classname: x.f.classname, revision: x.f.revision, size: 28 }),
              h('span', { style: { flex: 1, textAlign: 'left' } }, x.f.nombre),
              h('span', { className: 'mono suave', style: { fontSize: 12 } }, x.unidades + ' und'));
          }) : h('div', { className: 'suave', style: { fontSize: 12, padding: '6px 2px' } }, usaKekos && !keko ? 'Primero elige de qué keko salen las unidades.' : conStock.length ? 'Ningún furni en mano coincide.' : 'Lo publicado se registra con «Vendido» en el Mercadillo.'))),

    furni ? [
      h(Fld, { key: 'lote', label: '¿De qué lote salen?' },
        h('select', { className: 'inp', value: loteSel, onChange: function (e) { setLoteSel(e.target.value); setCant('1'); setError(''); } },
          soloEseLote ? null : h('option', { value: 'fifo' }, 'Automático: los más antiguos primero (' + total + ' und)'),
          lotes.map(function (l) {
            return h('option', { key: l.id, value: String(l.id) }, 'Lote ' + etiquetaLote(l) + ' · ' + l.cantidad + ' und a ' + fmtLg(l.precio_compra_cr) + ' cr c/u' + (l.pendiente ? ' · por revisar' : ''));
          }))),
      h(Fld, { key: 'cant', label: '¿Cuántas vendiste?' },
        h('div', { style: { display: 'flex', gap: 6 } },
          h('button', { className: 'btn', onClick: function () { cambiarCant(-1); } }, '−'),
          h('input', { className: 'inp inp-num', style: { width: 80, textAlign: 'center' }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); setError(''); } }),
          h('button', { className: 'btn', onClick: function () { cambiarCant(1); } }, '+'),
          h('button', { className: 'btn', onClick: function () { setCant(String(maximo)); } }, 'Todas (' + maximo + ')'))),
      h(Fld, { key: 'donde', label: '¿Cómo se vendió?' },
        h('div', { className: 'segmento' },
          h('button', { type: 'button', className: donde === 'tradeo' ? 'activo' : '', onClick: function () { cambiarDonde('tradeo'); } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Ico, { name: 'refresh', size: 14 }), 'Tradeo o venta directa')),
          h('button', { type: 'button', className: donde === 'mercadillo' ? 'activo' : '', onClick: function () { cambiarDonde('mercadillo'); } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Ico, { name: 'store', size: 14 }), 'Mercadillo (keko sin Sniper)')))),
      mercado ? null : h(SelectorMoneda, { key: 'moneda', valor: moneda, onChange: setMoneda }),
      h('div', { key: 'precio', className: 'fila-2' },
        h(Fld, { label: mercado ? 'Precio en el mercadillo (lo que pagó el comprador)' : 'Precio por unidad (lo que recibiste)' },
          h('input', { className: 'inp inp-num', value: precio, placeholder: '0', inputMode: 'decimal',
            onChange: function (e) { setPrecio(e.target.value); setError(''); }, onKeyDown: function (e) { if (e.key === 'Enter') registrar(); } })),
        h(Fld, { label: 'Fecha de venta' }, h('input', { className: 'inp', type: 'date', value: fecha, onChange: function (e) { setFecha(e.target.value); } }))),
      qValida && pValido ? h('div', { key: 'prev', className: 'aviso' },
        mercado
          ? h('div', null, 'Entra a tu monedero: ', h('b', { className: 'mono' }, fmtCr(netoU) + ' cr'), ' por unidad (comisión ' + fmtCr(comisionU) + ' cr) · total ',
              h('b', { className: 'mono' }, fmtCr(netoU * q) + ' cr'), '. Se guarda ese neto.')
          : h('div', null, 'Sin comisión: se guarda ', h('b', { className: 'mono' }, fmtM(p)), ' por unidad · total ', h('b', { className: 'mono' }, fmtM(p * q)), '.'),
        h('div', { style: { marginTop: 6 } }, tomas.length === 1 ? 'Sale del lote ' + etiquetaLote(tomas[0].lote) : 'Salen de ' + tomas.length + ' lotes (' + tomas.map(function (t) { return etiquetaLote(t.lote); }).join(', ') + ')',
          ' · ganancia real ', h('b', { className: 'mono ' + (ganancia > 0 ? 'pos' : ganancia < 0 ? 'neg' : '') }, (ganancia > 0 ? '+' : '') + fmtCr(ganancia) + ' cr'),
          ' · margen ', fmtPct(costo ? ganancia / costo : 0)),
        ganancia < 0 ? h('div', { className: 'neg', style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' } }, h(Ico, { name: 'alert', size: 14 }), 'Por debajo de lo que costaron') : null) : null,
    ] : null,

    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, 'Cancelar'),
      h('button', { className: 'btn btn-verde', onClick: registrar, disabled: enviando || !furni }, h(Ico, { name: 'tag', size: 14 }), 'Registrar venta')));
}
