// public/js/vistas/Mercadillo.js — lo que tienes PUBLICADO en el mercadillo de Habbo.es.
//
// Solo aparecen furnis con unidades publicadas (por el Sniper o por ti). Lo que tienes en
// mano (Comprado), lo "por revisar" del Sniper y lo vendido viven en el Inventario.
//
// Igual que el Inventario (v1.6.0), en un bloque por keko (componentes/BloquesKeko.js):
// primero los kekos manuales, luego los de los Snipers (cada grupo del mas antiguo al mas
// nuevo) y al final lo publicado sin keko. Ningun bloque se pliega ni se recorta. Cada
// fila resume SOLO lo publicado de ese furni EN ESE KEKO: precio de lista, unidades, costo
// promedio y ganancia esperada neta, lote por lote con la comision del mercadillo
// (core/comision.js, resumenPublicado). "Vendido" y "Retirar" (este solo si hay algo
// publicado por ti) abren un modal que pregunta cuantas unidades y, si hay varios precios
// de lista, de cual; se aplican FIFO y solo en ese keko (migracion 20261014000000). Clic
// en la fila: detalle. Desde la v1.8.0, la cabecera de cada bloque es el encabezado C del
// Inventario: su dona y su barra reparten lo que te entraria entre los furnis del keko.

import { h, useState, useMemo, useEffect } from '../core/react.js';
import { fmtCr, fmtLg } from '../core/format.js';
import { normalizar } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni } from '../componentes/base.js';
import { BloqueKeko, IndiceKekos, KekosVacios, Columnas, anchoMinimo, useAlineado, nombreBloque } from '../componentes/BloquesKeko.js';
import { Barrera, Dibujar } from '../componentes/Barrera.js';
import { agruparPorKeko, ambitoDe, claveKeko } from '../core/kekos.js';
import { resumenPublicado, precioMinimoSinPerder } from '../core/comision.js';
import { composicionMercadillo } from '../core/grupos.js';

// Anchos de las columnas (null = Furni). Con sitio para todos, fijos: los bloques quedan
// alineados entre si.
var ANCHOS = [null, 176, 84, 96, 104, 132, 188];

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

// Lo que dice la cabecera de un bloque (encabezado C, v1.8.0): la capsula «furnis · und ·
// ganancia esperada» y el globo con lo que te entraria por furni, el mismo `neto` del
// detalle de cada fila (core/grupos.js, composicionMercadillo).
function resumenBloque(filas) {
  var n = filas.length;
  return { n: n, nTexto: n === 1 ? 'furni' : 'furnis', und: filas.reduce(function (s, x) { return s + x.r.unidades; }, 0),
    dinero: { tipo: 'ganancia', valor: filas.reduce(function (s, x) { return s + x.r.ganancia; }, 0), texto: 'ganancia esperada', sufijo: 'esperada' } };
}
var TEXTOS_COMPOSICION = { titulo: 'Lo que te entraría, por furni',
  pie: 'Lo que te entraría tras la comisión si se vende todo lo publicado en este keko (el «neto» de cada fila).' };

export function MercadilloView(props) {
  var sQ = useState(''); var q = sQ[0]; var setQ = sQ[1];
  // La fila abierta: '<keko>:<furni>'. Desde el Resumen llega solo el furni (enfocar): se
  // abre en cada bloque donde este.
  var sA = useState(props.enfocar || null); var abierto = sA[0]; var setAbierto = sA[1];
  useEffect(function () { if (props.enfocar) setAbierto(props.enfocar); }, [props.enfocar]);
  var usaKekos = !!(props.kekos && props.kekos.disponible);
  var alineado = useAlineado(anchoMinimo(ANCHOS));

  // Un renglon por keko y furni con algo publicado, con el resumen de SOLO lo publicado
  // de ese furni en ese keko (y lo ya vendido alli, para el detalle).
  var filas = useMemo(function () {
    var grupos = {};
    var furniPorId = {};
    var posicion = {};
    props.furnis.forEach(function (f, i) { furniPorId[f.id] = f; posicion[f.id] = i; });
    (props.compras || []).forEach(function (l) {
      if ((l.estado !== 'publicado' && l.estado !== 'vendido') || !furniPorId[l.furni_id]) return;
      var clave = claveKeko(l.keko) + ':' + l.furni_id;
      var g = grupos[clave] = grupos[clave] || { clave: clave, keko: l.keko || null, f: furniPorId[l.furni_id], publicados: [], vendidos: [] };
      (l.estado === 'publicado' ? g.publicados : g.vendidos).push(l);
    });
    return Object.keys(grupos).map(function (c) { return grupos[c]; })
      .filter(function (g) { return g.publicados.length; })
      .map(function (g) { return Object.assign(g, { r: resumenPublicado(g.publicados) }); })
      .sort(function (a, b) { return posicion[a.f.id] - posicion[b.f.id]; });
  }, [props.furnis, props.compras]);

  var unidades = filas.reduce(function (s, x) { return s + x.r.unidades; }, 0);
  var furnis = Object.keys(filas.reduce(function (s, x) { s[x.f.id] = true; return s; }, {})).length;
  var visibles = filas.filter(function (x) { return !q || normalizar(x.f.nombre).indexOf(normalizar(q)) !== -1; });
  var agrupado = agruparPorKeko(visibles, usaKekos ? props.kekos.kekos : [], function (x) { return x.keko; });

  function filasDe(x, k) {
    var f = x.f; var r = x.r;
    var abiertoEste = abierto === x.clave || abierto === f.id;
    var minimo = precioMinimoSinPerder(r.costoPromedio);
    var realizada = x.vendidos.reduce(function (s, l) { return s + (l.ganancia_cr || 0); }, 0);
    var comisionPagada = x.vendidos.reduce(function (s, l) { return s + (l.comision_pagada_cr || 0) * l.cantidad; }, 0);
    var trs = [h('tr', { key: x.clave, className: 'fila' + (abiertoEste ? ' abierta' : ''), onClick: function () { setAbierto(abiertoEste ? null : x.clave); } },
      h('td', null, h(NombreFurni, { furni: f, ltds: r.ltds.slice().sort(function (a, b) { return a - b; }) })),
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
          h('button', { className: 'btn btn-chico', title: 'Registrar la venta de unidades publicadas en este keko', onClick: function (e) { e.stopPropagation(); props.onVender(f, ambitoDe(k)); } }, h(Ico, { name: 'lock', size: 11 }), 'Vendido'),
          r.manual ? h('button', { className: 'btn btn-chico', title: 'Quitaste del mercadillo lo que publicaste tú en este keko: vuelve a Comprado', onClick: function (e) { e.stopPropagation(); props.onRetirar(f, ambitoDe(k)); } }, h(Ico, { name: 'undo', size: 12 }), 'Retirar') : null)))];
    if (abiertoEste) {
      trs.push(h('tr', { key: x.clave + '-d' }, h('td', { colSpan: 7, className: 'detalle' },
        h('div', { className: 'detalle-grid' },
          h(Dato, { l: 'Unidades publicadas', v: r.unidades, c: 'morado' }),
          h(Dato, { l: 'Precio de lista', v: rangoLista(r), c: 'morado' }),
          h(Dato, { l: 'Costo promedio de lo publicado', v: fmtLg(r.costoPromedio) + ' cr' }),
          h(Dato, { l: 'Invertido en lo publicado', v: fmtCr(r.costo) + ' cr' }),
          h(Dato, { l: 'Te entraría al venderse (neto)', v: fmtCr(r.neto) + ' cr' }),
          h(Dato, { l: 'Comisión del mercadillo', v: fmtCr(r.comision) + ' cr' }),
          h(Dato, { l: 'Precio mínimo para no perder', v: minimo === null ? '-' : fmtCr(minimo) + ' cr', c: r.listaMin !== null && minimo !== null && r.listaMin < minimo ? 'neg' : '' }),
          h(Dato, { l: 'Publicado por', v: (r.sniper ? 'Sniper: ' + r.sniper + ' und' : '') + (r.sniper && r.manual ? ' · ' : '') + (r.manual ? 'Tú: ' + r.manual + ' und' : '') }),
          comisionPagada > 0 ? h(Dato, { l: 'Comisión ya pagada en este keko', v: fmtCr(comisionPagada) + ' cr' }) : null,
          x.vendidos.length ? h(Dato, { l: 'Ganancia ya realizada en este keko', v: (realizada > 0 ? '+' : '') + fmtCr(realizada) + ' cr', c: realizada > 0 ? 'pos' : realizada < 0 ? 'neg' : '' }) : null),
        f.notas ? h('div', { className: 'suave', style: { fontSize: 12, marginBottom: 10 } }, 'Notas: ' + f.notas) : null,
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { className: 'btn', onClick: function (e) { e.stopPropagation(); props.onVerLotes(f); } }, h(Ico, { name: 'box', size: 14 }), 'Ver lotes publicados')))));
    }
    return trs;
  }

  // La tarjeta de un keko y, dentro, una barrera por furni: si uno trae un dato raro, solo
  // su fila lo dice; si falla la tarjeta, los demas kekos siguen.
  function bloqueDe(b) {
    return h(BloqueKeko, { key: b.keko.clave, keko: b.keko, resumen: resumenBloque(b.items), composicion: composicionMercadillo(b.items),
        textos: TEXTOS_COMPOSICION },
      h('table', { className: 'tabla' },
        h(Columnas, { anchos: ANCHOS }),
        h('thead', null, h('tr', null,
          h('th', null, 'Furni'), h('th', { className: 'r' }, 'Precio de lista'), h('th', { className: 'r' }, 'Publicadas'),
          h('th', { className: 'r' }, 'Costo prom.'), h('th', { className: 'r' }, 'Ganancia esp.'), h('th', null, 'Publicado por'), h('th', null))),
        h('tbody', null, b.items.map(function (x) {
          var nombre = x.f && typeof x.f.nombre === 'string' ? x.f.nombre : 'este furni';
          return h(Barrera, { key: x.clave, tipo: 'fila', columnas: 7, etiqueta: '«' + nombre + '»',
              donde: 'Mercadillo › ' + nombreBloque(b.keko) + ' › ' + nombre, onVerErrores: props.onVerErrores },
            h(Dibujar, { dibujar: function () { return filasDe(x, b.keko); } }));
        }))));
  }

  return h('div', { className: 'contenedor fade-in' },
    h('div', { className: 'barra' },
      h('div', { style: { position: 'relative', flex: 1, minWidth: 200 } },
        h('span', { style: { position: 'absolute', left: 11, top: 10, color: 'var(--text3)' } }, h(Ico, { name: 'search', size: 15 })),
        h('input', { className: 'inp', style: { paddingLeft: 34 }, placeholder: 'Buscar furni publicado…', value: q, onChange: function (e) { setQ(e.target.value); } })),
      h('span', { className: 'chip morado activo', style: { cursor: 'default' } },
        h(Ico, { name: 'lock', size: 12, sw: 2.2 }), furnis + (furnis === 1 ? ' furni' : ' furnis'), h('span', { className: 'mono' }, unidades + ' und'))),

    visibles.length === 0
      ? h('div', { className: 'tabla-caja' }, h('div', { className: 'vacio' }, filas.length ? 'Ningún furni publicado coincide con la búsqueda.'
          : 'No tienes nada publicado en el mercadillo. Publica desde el Inventario (botón «Publicar») o deja que el Sniper lo haga.'))
      : h('div', null,
          h(IndiceKekos, { bloques: agrupado.bloques, cuenta: function (b) { return fmtCr(b.items.reduce(function (s, x) { return s + x.r.unidades; }, 0)); } }),
          h('div', { className: 'bk-lista' + (alineado.alineado ? ' alineado' : ''), ref: alineado.ref }, agrupado.bloques.map(function (b) {
            return h(Barrera, { key: b.keko.clave, tipo: 'bloque', etiqueta: 'El bloque de ' + nombreBloque(b.keko),
                donde: 'Mercadillo › ' + nombreBloque(b.keko), onVerErrores: props.onVerErrores },
              h(Dibujar, { dibujar: function () { return bloqueDe(b); } }));
          })),
          q ? null : h(KekosVacios, { nombres: agrupado.vacios, texto: 'Sin nada publicado: ' })),
    h('div', { className: 'tenue', style: { fontSize: 12, marginTop: 8 } }, 'Aquí solo está lo publicado en el mercadillo de Habbo.es. Lo que tienes en mano, lo «por revisar» del Sniper y lo vendido están en el Inventario. La ganancia esperada ya descuenta la comisión.'));
}
