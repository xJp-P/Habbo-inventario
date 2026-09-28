// public/js/vistas/Mercadillo.js — tus furnis con su precio de venta (tabla `furnis`;
// la hoja "Inventario" del Excel). Tabla comoda de 6 columnas; al hacer clic en una fila
// se abre el detalle con el resto de las cifras del Excel y las acciones.
//
// Precio: el tuyo; si el furni no tiene y el Sniper lo publico, el de lista (morado,
// con candado). Ganancia esp.: se proyecta lote por lote con la comision del mercadillo
// de Habbo.es (core/comision.js).

import { h, useState, useMemo, useEffect } from '../core/react.js';
import { fmtCr, fmtLg } from '../core/format.js';
import { normalizar } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni, EtiquetaEstado, AYUDA_PUBLICADO } from '../componentes/base.js';
import { gananciaEsperadaFurni } from '../core/comision.js';

var FILTROS = [['todos', 'Todos'], ['en_venta', 'En venta'], ['publicado', 'Publicados'], ['por_revisar', 'Por revisar'], ['agotado', 'Agotados'], ['sin_compras', 'Sin compras']];

function fmtLista(precio, moneda) { return moneda === 'lingos' ? fmtLg(precio) + ' lg' : fmtLg(precio) + ' cr'; }

function Dato(props) {
  return h('div', null, h('div', { className: 'dato-l' }, props.l), h('div', { className: 'dato-v ' + (props.c || '') }, props.v));
}

export function MercadilloView(props) {
  var furnis = props.furnis;
  var sQ = useState(''); var q = sQ[0]; var setQ = sQ[1];
  var sF = useState('todos'); var filtro = sF[0]; var setFiltro = sF[1];
  var sA = useState(props.enfocar || null); var abierto = sA[0]; var setAbierto = sA[1];
  useEffect(function () { if (props.enfocar) setAbierto(props.enfocar); }, [props.enfocar]);

  var lotesPorFurni = useMemo(function () {
    var m = {};
    (props.compras || []).forEach(function (l) { (m[l.furni_id] = m[l.furni_id] || []).push(l); });
    return m;
  }, [props.compras]);

  var cuenta = useMemo(function () {
    var c = { todos: furnis.length };
    furnis.forEach(function (f) { c[f.estado] = (c[f.estado] || 0) + 1; });
    return c;
  }, [furnis]);

  var visibles = furnis.filter(function (f) {
    return (filtro === 'todos' || f.estado === filtro) && (!q || normalizar(f.nombre).indexOf(normalizar(q)) !== -1);
  });

  return h('div', { className: 'contenedor fade-in' },
    h('div', { className: 'barra' },
      h('div', { style: { position: 'relative', flex: 1, minWidth: 200 } },
        h('span', { style: { position: 'absolute', left: 11, top: 10, color: 'var(--text3)' } }, h(Ico, { name: 'search', size: 15 })),
        h('input', { className: 'inp', style: { paddingLeft: 34 }, placeholder: 'Buscar furni…', value: q, onChange: function (e) { setQ(e.target.value); } })),
      FILTROS.map(function (x) {
        if (x[0] !== 'todos' && !cuenta[x[0]]) return null;
        return h('button', { key: x[0], className: 'chip' + (filtro === x[0] ? ' activo' : '') + (x[0] === 'por_revisar' ? ' ambar' : '') + (x[0] === 'publicado' ? ' morado' : ''), onClick: function () { setFiltro(x[0]); } },
          x[1], h('span', { className: 'mono' }, cuenta[x[0]] || 0));
      }),
      h('button', { className: 'btn btn-verde', onClick: props.onNuevo }, h(Ico, { name: 'plus', size: 14, sw: 2.4 }), 'Furni')),

    h('div', { className: 'tabla-caja' },
      visibles.length === 0
        ? h('div', { className: 'vacio' }, furnis.length ? 'Ningún furni coincide con la búsqueda.' : 'Aún no hay furnis. Agrega uno o importa tu Excel desde Ajustes.')
        : h('table', { className: 'tabla' },
            h('thead', null, h('tr', null,
              h('th', null, 'Furni'), h('th', { className: 'r' }, 'Precio'), h('th', { className: 'r' }, 'Stock'),
              h('th', { className: 'r' }, 'Costo prom.'), h('th', { className: 'r' }, 'Ganancia esp.'), h('th', null, 'Estado'))),
            h('tbody', null, visibles.map(function (f) {
              var abiertoEste = abierto === f.id;
              var gan = gananciaEsperadaFurni(f, lotesPorFurni[f.id] || []);
              var filas = [h('tr', { key: f.id, className: 'fila' + (abiertoEste ? ' abierta' : ''), onClick: function () { setAbierto(abiertoEste ? null : f.id); } },
                h('td', null, h(NombreFurni, { furni: f })),
                h('td', { className: 'r mono' + (f.en_perdida ? ' neg' : ''), title: f.en_perdida ? 'Menor que el costo promedio' : '' },
                  f.precio_venta === null
                    ? (f.unidades_publicadas > 0 && f.precio_lista_actual !== null
                        ? h('span', { className: 'morado', style: { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }, title: 'Precio de lista en el mercadillo (lo publicó el Sniper). Tu precio de venta aún está vacío.' },
                            h(Ico, { name: 'lock', size: 11, sw: 2.2 }), fmtLista(f.precio_lista_actual, f.moneda_lista_actual))
                        : h('span', { className: 'tenue' }, 'sin precio'))
                    : h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                        f.en_perdida ? h(Ico, { name: 'arrowDown', size: 13 }) : null,
                        f.moneda_venta === 'lingos' ? fmtLg(f.precio_venta) + ' lg' : fmtCr(f.precio_venta))),
                h('td', { className: 'r mono' }, f.stock,
                  f.unidades_publicadas > 0 && f.unidades_publicadas < f.stock ? h('span', { className: 'tag tag-morado', style: { marginLeft: 6 }, title: AYUDA_PUBLICADO }, h(Ico, { name: 'lock', size: 10, sw: 2.2 }), f.unidades_publicadas) : null,
                  f.unidades_pendientes > 0 ? h('span', { className: 'tag tag-ambar', style: { marginLeft: 6 }, title: 'Unidades del Sniper por revisar' }, '+' + f.unidades_pendientes) : null),
                h('td', { className: 'r mono' }, f.costo_promedio_cr === null ? '-' : fmtLg(f.costo_promedio_cr)),
                h('td', { className: 'r mono ' + (gan > 0 ? 'pos' : gan < 0 ? 'neg' : ''), title: gan !== null && f.comision_esperada_cr ? 'Ya descuenta ' + fmtCr(f.comision_esperada_cr) + ' cr de comisión del mercadillo' : '' },
                  gan === null ? '-' : (gan > 0 ? '+' : '') + fmtCr(gan)),
                h('td', null, h(EtiquetaEstado, { estado: f.estado })))];
              if (abiertoEste) {
                filas.push(h('tr', { key: f.id + '-d' }, h('td', { colSpan: 6, className: 'detalle' },
                  h('div', { className: 'detalle-grid' },
                    h(Dato, { l: 'Unidades compradas', v: f.unidades_compradas }),
                    h(Dato, { l: 'Unidades vendidas', v: f.unidades_vendidas }),
                    h(Dato, { l: 'Publicadas en el mercadillo', v: f.unidades_publicadas, c: f.unidades_publicadas > 0 ? 'morado' : '' }),
                    f.unidades_publicadas > 0 ? h(Dato, { l: 'Precio de lista', c: 'morado',
                      v: f.lista_min_cr !== f.lista_max_cr ? fmtLg(f.lista_min_cr) + ' – ' + fmtLg(f.lista_max_cr) + ' cr' : fmtLista(f.precio_lista_actual, f.moneda_lista_actual) }) : null,
                    h(Dato, { l: 'Nº de compras', v: f.n_compras }),
                    h(Dato, { l: 'Compra más barata', v: f.compra_min_cr === null ? '-' : fmtLg(f.compra_min_cr) + ' cr' }),
                    h(Dato, { l: 'Compra más cara', v: f.compra_max_cr === null ? '-' : fmtLg(f.compra_max_cr) + ' cr' }),
                    h(Dato, { l: 'Inversión en stock', v: fmtCr(f.inversion_cr) + ' cr' }),
                    h(Dato, { l: 'Venta esperada (neta)', v: f.venta_esperada_cr === null ? '-' : fmtCr(f.venta_esperada_cr) + ' cr' }),
                    h(Dato, { l: 'Comisión del mercadillo', v: f.comision_esperada_cr === null ? '-' : fmtCr(f.comision_esperada_cr) + ' cr' }),
                    h(Dato, { l: 'Precio mínimo para no perder', v: f.precio_minimo_cr === null ? '-' : fmtCr(f.precio_minimo_cr) + ' cr', c: f.en_perdida ? 'neg' : '' }),
                    h(Dato, { l: 'Precio en lingos', v: f.precio_venta_lg === null ? '-' : fmtLg(f.precio_venta_lg) }),
                    f.comision_pagada_cr > 0 ? h(Dato, { l: 'Comisión ya pagada', v: fmtCr(f.comision_pagada_cr) + ' cr' }) : null,
                    h(Dato, { l: 'Ganancia ya realizada', v: (f.ganancia_realizada_cr > 0 ? '+' : '') + fmtCr(f.ganancia_realizada_cr) + ' cr', c: f.ganancia_realizada_cr > 0 ? 'pos' : f.ganancia_realizada_cr < 0 ? 'neg' : '' })),
                  f.notas ? h('div', { className: 'suave', style: { fontSize: 12, marginBottom: 10 } }, 'Notas: ' + f.notas) : null,
                  h('div', { style: { display: 'flex', gap: 8 } },
                    h('button', { className: 'btn', onClick: function (e) { e.stopPropagation(); props.onEditar(f); } }, h(Ico, { name: 'edit', size: 14 }), 'Editar precio'),
                    h('button', { className: 'btn', onClick: function (e) { e.stopPropagation(); props.onComprar(f); } }, h(Ico, { name: 'plus', size: 14 }), 'Registrar compra'),
                    f.unidades_compradas > 0 ? h('button', { className: 'btn', onClick: function (e) { e.stopPropagation(); props.onVerLotes(f); } }, h(Ico, { name: 'box', size: 14 }), 'Ver lotes') : null))));
              }
              return filas;
            })))),
    h('div', { className: 'tenue', style: { fontSize: 12, marginTop: 8 } }, 'Clic en una fila para ver el detalle. La ganancia esperada ya descuenta la comisión del mercadillo de Habbo.es (precios en créditos). Los precios en rojo no cubren el costo promedio después de la comisión.'));
}
