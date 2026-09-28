// public/js/vistas/Inventario.js — tus lotes comprados (tabla `compras`; la hoja
// "Mercadillo" del Excel).
//
// Ciclo de un lote: Comprado -> Publicado (lo puso a la venta el Sniper en el mercadillo
// de Habbo; lleva candado y su precio de lista) -> Vendido, o de vuelta a Comprado si el
// Sniper lo recupera. Lo publicado no se edita ni se borra a mano: solo se registra su
// venta cuando se vende.
//
// Arriba, destacadas en ambar, las compras HUERFANAS que llegaron de los SniperMercadillo:
// agrupadas por furni, con el precio de venta listo para confirmar y la ganancia
// esperada calculada al escribir (neta de la comision del mercadillo). "Activar" fija el
// precio del furni y pasa sus lotes a "En venta". Debajo, la tabla de lotes con detalle
// al clic, Vender y Revertir.

import { h, useState, useMemo, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtCr, fmtLg, fmtPct, fmtD, fmtHace, leerNumero } from '../core/format.js';
import { normalizar, _submitGuard } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni, EtiquetaPublicado, AYUDA_PUBLICADO } from '../componentes/base.js';
import { calcularGananciaNeta, ingresoNeto, precioMinimoSinPerder } from '../core/comision.js';

function FilaHuerfana(props) {
  var g = props.grupo;
  var f = g.furni;
  // Sin precio propio, se propone el de lista con que el Sniper ya publico otras unidades.
  var sugerido = f.precio_venta !== null ? f.precio_venta
    : f.precio_lista_actual !== null && f.precio_lista_actual !== undefined && f.moneda_lista_actual === f.moneda_venta ? f.precio_lista_actual : null;
  var precioInicial = sugerido !== null ? String(sugerido).replace('.', ',') : '';
  var sP = useState(precioInicial); var precio = sP[0]; var setPrecio = sP[1];
  var sE = useState(''); var error = sE[0]; var setError = sE[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var costoU = g.unidades ? g.costo_cr / g.unidades : 0;
  var p = leerNumero(precio);
  var pCr = p !== null && !isNaN(p) ? (f.moneda_venta === 'lingos' ? p * props.tasa : p) : null;
  var lingos = f.moneda_venta === 'lingos';
  var gan = pCr !== null ? (lingos ? pCr - costoU : calcularGananciaNeta(pCr, costoU)) * g.unidades : null;
  var minimo = lingos ? Math.ceil(costoU) : precioMinimoSinPerder(costoU);

  function activar() {
    if (p === null || isNaN(p) || p <= 0) { setError('Pon un precio de venta a "' + f.nombre + '" antes de activarlo.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/pendientes/activar', { furni_id: f.id, precio_venta: p })
        .then(function (r) { if (r) props.onActivado(f.nombre + ': ' + r.activados + ' lote(s) en venta a ' + fmtLg(p) + (f.moneda_venta === 'lingos' ? ' lingos' : ' cr')); });
    });
  }

  return h('div', { className: 'huerfana-fila' },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h(NombreFurni, { furni: f, sub: h('span', null,
        g.unidades + ' und · pagaste ' + fmtLg(costoU) + ' c/u · ' + fmtHace(g.recibido_en) + (g.instancias.length ? ' · ' + g.instancias.join(', ') : ''),
        f.nuevo ? h('span', { className: 'tag tag-azul', style: { marginLeft: 8 } }, 'Nuevo en tu Mercadillo') : null) })),
    h('div', { style: { textAlign: 'right' } },
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' } },
        h('input', { className: 'inp inp-num' + (error ? ' error' : ''), style: { width: 96, padding: '6px 10px' }, value: precio, placeholder: 'Precio', inputMode: 'decimal',
          onChange: function (e) { setPrecio(e.target.value); setError(''); }, onKeyDown: function (e) { if (e.key === 'Enter') activar(); } }),
        h('span', { className: 'suave', style: { fontSize: 12 } }, f.moneda_venta === 'lingos' ? 'lingos' : 'cr'),
        h('button', { className: 'btn btn-verde', onClick: activar, disabled: enviando }, 'Activar')),
      h('div', { style: { fontSize: 11, marginTop: 4 }, className: error ? 'neg' : 'suave' },
        error || (gan === null ? 'Sin precio · mínimo para no perder ' + (minimo === null ? '-' : fmtCr(minimo) + ' cr')
          : h('span', null, 'Ganancia esperada ', h('b', { className: 'mono ' + (gan > 0 ? 'pos' : gan < 0 ? 'neg' : '') }, (gan > 0 ? '+' : '') + fmtCr(gan)),
              lingos ? null : ' (neta de comisión)',
              gan < 0 ? h('span', { className: 'neg' }, ' · debajo del costo') : null)))));
}

var FILTROS = [['comprado', 'Comprado'], ['publicado', 'Publicado'], ['vendido', 'Vendido'], ['todos', 'Todos']];
var ORIGEN = { excel: 'Excel', manual: 'Manual', sniper: 'Sniper' };

export function InventarioView(props) {
  var compras = props.compras;
  var pendientes = props.pendientes;
  var sQ = useState(props.filtroFurni || ''); var q = sQ[0]; var setQ = sQ[1];
  var sF = useState('comprado'); var filtro = sF[0]; var setFiltro = sF[1];
  var sA = useState(null); var abierto = sA[0]; var setAbierto = sA[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  useEffect(function () { if (props.filtroFurni) { setQ(props.filtroFurni); setFiltro('todos'); } }, [props.filtroFurni]);

  var cuenta = useMemo(function () {
    var c = { comprado: 0, publicado: 0, vendido: 0, todos: compras.length };
    compras.forEach(function (l) { c[l.estado]++; });
    return c;
  }, [compras]);

  var visibles = compras.filter(function (l) {
    return (filtro === 'todos' || l.estado === filtro) && (!q || normalizar(l.nombre).indexOf(normalizar(q)) !== -1);
  }).sort(function (a, b) { return (b.pendiente ? 1 : 0) - (a.pendiente ? 1 : 0) || b.id - a.id; });

  function revertir(l) {
    if (!window.confirm('¿Deshacer la venta del lote Nº ' + l.id + '?')) return;
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/compras/' + l.id + '/revertir', {}).then(function (r) { if (r) props.onCambio(r.fusionada ? 'Venta deshecha: las unidades volvieron a su lote' : 'Venta deshecha'); });
    });
  }
  function eliminar(l) {
    if (!window.confirm('¿Eliminar el lote Nº ' + l.id + ' (' + l.cantidad + ' × ' + l.nombre + ')? No se puede deshacer.')) return;
    _submitGuard(enviando, setEnviando, function () {
      return API.del('/api/compras/' + l.id).then(function (r) { if (r) { setAbierto(null); props.onCambio('Lote eliminado'); } });
    });
  }

  return h('div', { className: 'contenedor fade-in' },
    pendientes.length ? h('div', { className: 'huerfanas' },
      h('div', { className: 'huerfanas-cab' },
        h(Ico, { name: 'radar', size: 20, color: 'var(--yellow)' }),
        h('div', { style: { flex: 1 } },
          h('div', { style: { fontWeight: 700, color: 'var(--yellow)' } }, 'Llegaron del Sniper · ' + pendientes.length + (pendientes.length === 1 ? ' furni' : ' furnis') + ' por revisar'),
          h('div', { className: 'card-sub' }, 'Cuentan en tu stock, pero no están en venta hasta que les confirmes un precio.'))),
      pendientes.map(function (g) { return h(FilaHuerfana, { key: g.furni.id, grupo: g, tasa: props.tasa, onActivado: props.onCambio }); }))
      : null,

    h('div', { className: 'barra' },
      h('div', { style: { position: 'relative', flex: 1, minWidth: 200 } },
        h('span', { style: { position: 'absolute', left: 11, top: 10, color: 'var(--text3)' } }, h(Ico, { name: 'search', size: 15 })),
        h('input', { className: 'inp', style: { paddingLeft: 34 }, placeholder: 'Buscar lote por furni…', value: q, onChange: function (e) { setQ(e.target.value); } })),
      FILTROS.map(function (x) {
        return h('button', { key: x[0], className: 'chip' + (filtro === x[0] ? ' activo' : '') + (x[0] === 'publicado' ? ' morado' : ''), onClick: function () { setFiltro(x[0]); },
            title: x[0] === 'publicado' ? AYUDA_PUBLICADO : null },
          x[0] === 'publicado' ? h(Ico, { name: 'lock', size: 12, sw: 2.2 }) : null, x[1], h('span', { className: 'mono' }, cuenta[x[0]]));
      }),
      h('button', { className: 'btn btn-verde', onClick: props.onNueva }, h(Ico, { name: 'plus', size: 14, sw: 2.4 }), 'Compra')),

    h('div', { className: 'tabla-caja' },
      visibles.length === 0
        ? h('div', { className: 'vacio' }, compras.length ? 'Ningún lote coincide.' : 'Aún no hay compras. Registra una o importa tu Excel desde Ajustes.')
        : h('table', { className: 'tabla' },
            h('thead', null, h('tr', null,
              h('th', null, 'Nº'), h('th', null, 'Furni'), h('th', { className: 'r' }, 'Cant.'), h('th', { className: 'r' }, 'Precio'),
              h('th', { className: 'r' }, 'Costo'), h('th', { className: 'r' }, 'Ganancia'), h('th', { className: 'r' }, 'Margen'), h('th', null, 'Estado'), h('th', null))),
            h('tbody', null, visibles.map(function (l) {
              var abiertoEste = abierto === l.id;
              var publicado = l.estado === 'publicado';
              var clase = 'fila' + (abiertoEste ? ' abierta' : '') + (l.pendiente ? ' huerfana' : '') + (l.estado === 'vendido' ? ' vendida' : '') + (publicado ? ' publicada' : '');
              var g = l.ganancia_cr;
              var filas = [h('tr', { key: l.id, className: clase, onClick: function () { setAbierto(abiertoEste ? null : l.id); } },
                h('td', { className: 'mono', style: { color: l.pendiente ? 'var(--yellow)' : 'var(--text3)' } }, l.id),
                h('td', null, h(NombreFurni, { furni: l })),
                h('td', { className: 'r mono' }, l.cantidad),
                h('td', { className: 'r mono' }, l.moneda_compra === 'lingos' ? fmtLg(l.precio_compra) + ' lg' : fmtLg(l.precio_compra)),
                h('td', { className: 'r mono' }, fmtCr(l.costo_total_cr)),
                h('td', { className: 'r mono ' + (g > 0 ? 'pos' : g < 0 ? 'neg' : '') }, g === null ? '-' : (g > 0 ? '+' : '') + fmtCr(g)),
                h('td', { className: 'r mono ' + (g > 0 ? 'pos' : g < 0 ? 'neg' : '') }, l.margen === null ? '-' : fmtPct(l.margen)),
                h('td', null, l.pendiente ? h('span', { className: 'tag tag-ambar' }, h(Ico, { name: 'radar', size: 11 }), 'Por revisar')
                  : publicado ? h(EtiquetaPublicado, { texto: 'Publicado · ' + fmtLg(l.precio_lista) + (l.moneda_lista === 'lingos' ? ' lg' : ' cr') })
                  : l.estado === 'vendido' ? h('span', { className: 'tag tag-verde' }, 'Vendido') : h('span', { className: 'tag tag-azul' }, 'Comprado')),
                h('td', { className: 'r' }, publicado
                  ? h('button', { className: 'btn btn-chico', title: 'Registrar la venta de lo publicado', onClick: function (e) { e.stopPropagation(); props.onVender(l); } }, h(Ico, { name: 'lock', size: 11 }), 'Vendido')
                  : l.estado === 'comprado'
                  ? h('button', { className: 'btn btn-chico', onClick: function (e) { e.stopPropagation(); props.onVender(l); } }, 'Vender')
                  : h('button', { className: 'btn btn-chico', title: 'Deshacer la venta', onClick: function (e) { e.stopPropagation(); revertir(l); } }, h(Ico, { name: 'undo', size: 12 }))))];
              if (abiertoEste) {
                filas.push(h('tr', { key: l.id + '-d' }, h('td', { colSpan: 9, className: 'detalle' },
                  h('div', { className: 'detalle-grid' },
                    h('div', null, h('div', { className: 'dato-l' }, 'Origen'), h('div', { className: 'dato-v' }, (ORIGEN[l.fuente] || l.fuente) + (l.instancia ? ' · ' + l.instancia : ''))),
                    h('div', null, h('div', { className: 'dato-l' }, 'Fecha de compra'), h('div', { className: 'dato-v' }, fmtD(l.fecha_compra))),
                    h('div', null, h('div', { className: 'dato-l' }, 'Precio de compra en créditos'), h('div', { className: 'dato-v' }, fmtLg(l.precio_compra_cr) + ' cr')),
                    h('div', null, h('div', { className: 'dato-l' }, l.estado === 'vendido' ? (l.comision_venta !== null && l.comision_venta !== undefined ? 'Entró a tu monedero (neto, congelado)' : 'Vendido a (congelado)') : publicado ? 'Precio de lista' : 'Precio de venta actual'), h('div', { className: 'dato-v' }, l.precio_venta_cr === null ? 'sin precio' : fmtLg(l.precio_venta_cr) + ' cr')),
                    l.estado === 'vendido' && l.comision_pagada_cr !== null && l.comision_pagada_cr !== undefined ? h('div', null, h('div', { className: 'dato-l' }, 'Comisión del mercadillo pagada'),
                      h('div', { className: 'dato-v' }, fmtCr(l.comision_pagada_cr * l.cantidad) + ' cr', h('span', { className: 'tenue', style: { fontSize: 11 } }, ' · el comprador pagó ' + fmtLg(l.precio_venta_cr + l.comision_pagada_cr) + ' c/u'))) : null,
                    l.precio_lista !== null && l.estado === 'vendido' ? h('div', null, h('div', { className: 'dato-l' }, 'Estaba publicado a'), h('div', { className: 'dato-v' }, fmtLg(l.precio_lista) + (l.moneda_lista === 'lingos' ? ' lg' : ' cr'))) : null,
                    publicado && l.publicado_en ? h('div', null, h('div', { className: 'dato-l' }, 'Publicado'), h('div', { className: 'dato-v' }, fmtHace(l.publicado_en))) : null,
                    l.estado !== 'vendido' && l.comision_cr ? h('div', null, h('div', { className: 'dato-l' }, 'Recibes por unidad (tras comisión)'),
                      h('div', { className: 'dato-v' }, fmtLg(ingresoNeto(l.precio_venta_cr, l.moneda_precio)) + ' cr', h('span', { className: 'tenue', style: { fontSize: 11 } }, ' · comisión ' + fmtCr(l.comision_cr)))) : null,
                    l.estado === 'vendido' ? h('div', null, h('div', { className: 'dato-l' }, 'Fecha de venta'), h('div', { className: 'dato-v' }, fmtD(l.fecha_venta))) : null,
                    l.origen_id ? h('div', null, h('div', { className: 'dato-l' }, 'Dividido del lote'), h('div', { className: 'dato-v' }, 'Nº ' + l.origen_id)) : null),
                  l.notas ? h('div', { className: 'suave', style: { fontSize: 12, marginBottom: 10 } }, l.notas) : null,
                  publicado
                    ? h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center', background: 'var(--purple-bg)', color: 'var(--purple)' } },
                        h(Ico, { name: 'lock', size: 15 }), AYUDA_PUBLICADO)
                    : h('div', { style: { display: 'flex', gap: 8 } },
                        h('button', { className: 'btn btn-peligro', onClick: function (e) { e.stopPropagation(); eliminar(l); }, disabled: enviando }, h(Ico, { name: 'trash', size: 14 }), 'Eliminar lote')))));
              }
              return filas;
            })))),
    h('div', { className: 'tenue', style: { fontSize: 12, marginTop: 8 } }, 'La ganancia de lo comprado usa el precio actual del Mercadillo; la de lo publicado, su precio de lista; ambas descuentan la comisión del mercadillo de Habbo.es. La de lo vendido usa el precio real congelado al vender (si se vendió en el mercadillo, el neto que entró a tu monedero).'));
}
