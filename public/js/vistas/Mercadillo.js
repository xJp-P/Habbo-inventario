// public/js/vistas/Mercadillo.js — lo que tienes PUBLICADO en el mercadillo de Habbo.es.
//
// Solo aparecen furnis con unidades publicadas (por el Sniper o por ti). Lo que tienes en
// mano (Comprado), lo "por revisar" del Sniper y lo vendido viven en el Inventario. Cada
// fila resume SOLO lo publicado de ese furni: precio de lista, unidades, costo promedio y
// ganancia esperada neta, lote por lote con la comision del mercadillo
// (core/comision.js, resumenPublicado). En cada fila, "Vendido" y "Retirar" (este solo si
// hay algo publicado por ti) abren un modal que pregunta cuantas unidades y, si hay
// varios precios de lista, de cual; se aplican FIFO. Clic en la fila: detalle.

import { h, useState, useMemo, useEffect } from '../core/react.js';
import { fmtCr, fmtLg } from '../core/format.js';
import { normalizar } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni } from '../componentes/base.js';
import { resumenPublicado, precioMinimoSinPerder } from '../core/comision.js';

function rangoLista(r) {
  return r.listaMin === r.listaMax ? fmtLg(r.listaMin) + ' cr' : fmtLg(r.listaMin) + ' – ' + fmtLg(r.listaMax) + ' cr';
}

function Dato(props) {
  return h('div', null, h('div', { className: 'dato-l' }, props.l), h('div', { className: 'dato-v ' + (props.c || '') }, props.v));
}

// Quien publico lo de este furni: el Sniper, tu (a mano) o ambos.
function PublicadoPor(props) {
  var r = props.r;
  return h('span', { style: { display: 'inline-flex', gap: 4, flexWrap: 'wrap' } },
    r.sniper ? h('span', { className: 'tag tag-morado', title: r.sniper + ' und publicadas por el Sniper' }, h(Ico, { name: 'radar', size: 11 }), 'Sniper') : null,
    r.manual ? h('span', { className: 'tag tag-azul', title: r.manual + ' und publicadas por ti' }, h(Ico, { name: 'store', size: 11 }), 'Tú') : null);
}

export function MercadilloView(props) {
  var sQ = useState(''); var q = sQ[0]; var setQ = sQ[1];
  var sA = useState(props.enfocar || null); var abierto = sA[0]; var setAbierto = sA[1];
  useEffect(function () { if (props.enfocar) setAbierto(props.enfocar); }, [props.enfocar]);

  // Un renglon por furni con algo publicado, con el resumen de SOLO lo publicado.
  var filas = useMemo(function () {
    var porFurni = {};
    (props.compras || []).forEach(function (l) {
      if (l.estado === 'publicado') (porFurni[l.furni_id] = porFurni[l.furni_id] || []).push(l);
    });
    return props.furnis
      .filter(function (f) { return porFurni[f.id]; })
      .map(function (f) { return { f: f, r: resumenPublicado(porFurni[f.id]) }; });
  }, [props.furnis, props.compras]);

  var unidades = filas.reduce(function (s, x) { return s + x.r.unidades; }, 0);
  var visibles = filas.filter(function (x) { return !q || normalizar(x.f.nombre).indexOf(normalizar(q)) !== -1; });

  return h('div', { className: 'contenedor fade-in' },
    h('div', { className: 'barra' },
      h('div', { style: { position: 'relative', flex: 1, minWidth: 200 } },
        h('span', { style: { position: 'absolute', left: 11, top: 10, color: 'var(--text3)' } }, h(Ico, { name: 'search', size: 15 })),
        h('input', { className: 'inp', style: { paddingLeft: 34 }, placeholder: 'Buscar furni publicado…', value: q, onChange: function (e) { setQ(e.target.value); } })),
      h('span', { className: 'chip morado activo', style: { cursor: 'default' } },
        h(Ico, { name: 'lock', size: 12, sw: 2.2 }), filas.length + (filas.length === 1 ? ' furni' : ' furnis'), h('span', { className: 'mono' }, unidades + ' und'))),

    h('div', { className: 'tabla-caja' },
      visibles.length === 0
        ? h('div', { className: 'vacio' }, filas.length ? 'Ningún furni publicado coincide con la búsqueda.'
            : 'No tienes nada publicado en el mercadillo. Publica desde el Inventario (botón «Publicar») o deja que el Sniper lo haga.')
        : h('table', { className: 'tabla' },
            h('thead', null, h('tr', null,
              h('th', null, 'Furni'), h('th', { className: 'r' }, 'Precio de lista'), h('th', { className: 'r' }, 'Publicadas'),
              h('th', { className: 'r' }, 'Costo prom.'), h('th', { className: 'r' }, 'Ganancia esp.'), h('th', null, 'Publicado por'), h('th', null))),
            h('tbody', null, visibles.map(function (x) {
              var f = x.f; var r = x.r;
              var abiertoEste = abierto === f.id;
              var minimo = precioMinimoSinPerder(r.costoPromedio);
              var trs = [h('tr', { key: f.id, className: 'fila' + (abiertoEste ? ' abierta' : ''), onClick: function () { setAbierto(abiertoEste ? null : f.id); } },
                h('td', null, h(NombreFurni, { furni: f })),
                h('td', { className: 'r mono' },
                  h('span', { className: 'morado', style: { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' } },
                    h(Ico, { name: 'lock', size: 11, sw: 2.2 }), rangoLista(r))),
                h('td', { className: 'r mono' }, r.unidades),
                h('td', { className: 'r mono' }, r.costoPromedio === null ? '-' : fmtLg(r.costoPromedio)),
                h('td', { className: 'r mono ' + (r.ganancia > 0 ? 'pos' : r.ganancia < 0 ? 'neg' : ''), title: r.comision ? 'Ya descuenta ' + fmtCr(r.comision) + ' cr de comisión del mercadillo' : '' },
                  (r.ganancia > 0 ? '+' : '') + fmtCr(r.ganancia)),
                h('td', null, h(PublicadoPor, { r: r })),
                h('td', { className: 'r' },
                  h('span', { style: { display: 'inline-flex', gap: 6 } },
                    h('button', { className: 'btn btn-chico', title: 'Registrar la venta de unidades publicadas', onClick: function (e) { e.stopPropagation(); props.onVender(f); } }, h(Ico, { name: 'lock', size: 11 }), 'Vendido'),
                    r.manual ? h('button', { className: 'btn btn-chico', title: 'Quitaste del mercadillo lo que publicaste tú: vuelve a Comprado', onClick: function (e) { e.stopPropagation(); props.onRetirar(f); } }, h(Ico, { name: 'undo', size: 12 }), 'Retirar') : null)))];
              if (abiertoEste) {
                trs.push(h('tr', { key: f.id + '-d' }, h('td', { colSpan: 7, className: 'detalle' },
                  h('div', { className: 'detalle-grid' },
                    h(Dato, { l: 'Unidades publicadas', v: r.unidades, c: 'morado' }),
                    h(Dato, { l: 'Precio de lista', v: rangoLista(r), c: 'morado' }),
                    h(Dato, { l: 'Costo promedio de lo publicado', v: fmtLg(r.costoPromedio) + ' cr' }),
                    h(Dato, { l: 'Invertido en lo publicado', v: fmtCr(r.costo) + ' cr' }),
                    h(Dato, { l: 'Te entraría al venderse (neto)', v: fmtCr(r.neto) + ' cr' }),
                    h(Dato, { l: 'Comisión del mercadillo', v: fmtCr(r.comision) + ' cr' }),
                    h(Dato, { l: 'Precio mínimo para no perder', v: minimo === null ? '-' : fmtCr(minimo) + ' cr', c: r.listaMin !== null && minimo !== null && r.listaMin < minimo ? 'neg' : '' }),
                    h(Dato, { l: 'Publicado por', v: (r.sniper ? 'Sniper: ' + r.sniper + ' und' : '') + (r.sniper && r.manual ? ' · ' : '') + (r.manual ? 'Tú: ' + r.manual + ' und' : '') }),
                    f.comision_pagada_cr > 0 ? h(Dato, { l: 'Comisión ya pagada', v: fmtCr(f.comision_pagada_cr) + ' cr' }) : null,
                    h(Dato, { l: 'Ganancia ya realizada', v: (f.ganancia_realizada_cr > 0 ? '+' : '') + fmtCr(f.ganancia_realizada_cr) + ' cr', c: f.ganancia_realizada_cr > 0 ? 'pos' : f.ganancia_realizada_cr < 0 ? 'neg' : '' })),
                  f.notas ? h('div', { className: 'suave', style: { fontSize: 12, marginBottom: 10 } }, 'Notas: ' + f.notas) : null,
                  h('div', { style: { display: 'flex', gap: 8 } },
                    h('button', { className: 'btn', onClick: function (e) { e.stopPropagation(); props.onVerLotes(f); } }, h(Ico, { name: 'box', size: 14 }), 'Ver lotes publicados')))));
              }
              return trs;
            })))),
    h('div', { className: 'tenue', style: { fontSize: 12, marginTop: 8 } }, 'Aquí solo está lo publicado en el mercadillo de Habbo.es. Lo que tienes en mano, lo «por revisar» del Sniper y lo vendido están en el Inventario. La ganancia esperada ya descuenta la comisión.'));
}
