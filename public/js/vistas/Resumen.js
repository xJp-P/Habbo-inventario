// public/js/vistas/Resumen.js — tablero: tasa del Lingo, compras del Sniper por revisar,
// lo publicado en el mercadillo (la UNICA fuente de ganancia esperada), lo que tienes en
// mano (solo lo que costo: aun no tiene precio), ventas realizadas, datos rapidos y
// alerta de lo publicado que deja perdida.
//
// TASA DEL LINGO (v1.5.1): en Habbo.es un Lingo vale 50 cr fijos, asi que la tarjeta la
// muestra como un dato fijo y ya no se edita. Todo lo de editarla SIGUE aqui (estado,
// guardarTasa y la ruta PUT /api/config/tasa) para darle otro uso mas adelante: basta con
// poner TASA_EDITABLE en true. Los calculos siempre usan la tasa guardada en tu base (50
// por defecto); si alguna vez guardaste otra, la tarjeta lo avisa y deja volver a 50.

import { h, useState, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtCr, fmtLg, fmtPct, leerNumero } from '../core/format.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni } from '../componentes/base.js';
import { precioMinimoSinPerder } from '../core/comision.js';

function Kpi(props) {
  return h('div', { className: 'kpi-card' },
    h('div', { className: 'kpi-label' }, props.icono ? h(Ico, { name: props.icono, size: 14 }) : null, props.label),
    h('div', { className: 'kpi-value ' + (props.clase || '') }, props.valor),
    props.sub ? h('div', { className: 'kpi-sub' }, props.sub) : null);
}

function signo(n) { return (n > 0 ? '+' : '') + fmtCr(n) + ' cr'; }

var TASA_EDITABLE = false;
var TASA_HABBO = 50;

export function ResumenView(props) {
  var r = props.resumen;
  var sT = useState(String(r.tasa).replace('.', ',')); var tasa = sT[0]; var setTasa = sT[1];
  useEffect(function () { setTasa(String(r.tasa).replace('.', ',')); }, [r.tasa]);

  function guardarTasa() {
    var n = leerNumero(tasa);
    if (n === r.tasa) return;
    if (!n || isNaN(n) || n <= 0) { setTasa(String(r.tasa).replace('.', ',')); props.onError('La tasa debe ser mayor que 0.'); return; }
    API.put('/api/config/tasa', { tasa_lingo: n }).then(function (x) { if (x) props.onCambio('Tasa del Lingo actualizada'); });
  }
  function volverATasaHabbo() {
    API.put('/api/config/tasa', { tasa_lingo: TASA_HABBO }).then(function (x) { if (x) props.onCambio('Tasa del Lingo: ' + TASA_HABBO + ' cr, la de Habbo.es'); });
  }

  var pb = r.publicado, mano = r.en_mano, vd = r.vendido, pr = r.por_revisar, d = r.datos;
  var tasaDistinta = !TASA_EDITABLE && r.tasa !== TASA_HABBO;
  return h('div', { className: 'contenedor fade-in' },
    h('div', { className: 'card', style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' } },
      h(Ico, { name: 'diamond', size: 22, color: 'var(--purple)' }),
      h('div', { style: { flex: 1, minWidth: 220 } },
        h('div', { className: 'card-titulo' }, 'Tasa del Lingo'),
        h('div', { className: 'card-sub' }, TASA_EDITABLE ? 'Créditos que vale 1 Lingo. Todo se recalcula al cambiarla.'
          : 'Créditos que vale 1 Lingo en Habbo.es. Es un valor fijo del juego.')),
      TASA_EDITABLE ? h('input', { className: 'inp inp-num', style: { width: 110 }, value: tasa, inputMode: 'decimal',
        onChange: function (e) { setTasa(e.target.value); }, onBlur: guardarTasa,
        onKeyDown: function (e) { if (e.key === 'Enter') e.target.blur(); } })
        : h('span', { className: 'tasa-fija', title: 'Valor fijo de Habbo.es' }, h(Ico, { name: 'lock', size: 13 }), h('b', { className: 'mono' }, fmtLg(r.tasa))),
      h('span', { className: 'suave' }, 'cr'),
      tasaDistinta ? h('div', { className: 'aviso aviso-ambar', style: { flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h('span', { style: { flex: 1, minWidth: 200 } }, 'Tienes guardada una tasa de ' + fmtLg(r.tasa) + ' cr y los cálculos la usan; en Habbo.es un Lingo vale ' + TASA_HABBO + ' cr.'),
        h('button', { className: 'btn btn-chico', onClick: volverATasaHabbo }, 'Usar ' + TASA_HABBO + ' cr')) : null),

    pr.unidades > 0 ? h('div', { className: 'huerfanas', style: { display: 'flex', alignItems: 'center', gap: 12 } },
      h(Ico, { name: 'radar', size: 22, color: 'var(--yellow)' }),
      h('div', { style: { flex: 1 } },
        h('div', { style: { fontWeight: 700, color: 'var(--yellow)' } }, 'Por revisar: ' + pr.unidades + ' und del Sniper'),
        h('div', { className: 'card-sub' }, fmtCr(pr.costo_cr) + ' cr invertidos, sin confirmar · ' + d.furnis_por_revisar + ' furni(s)')),
      h('button', { className: 'btn', onClick: function () { props.onNav('inventario'); } }, 'Revisar', h(Ico, { name: 'chevright', size: 14 }))) : null,

    h('div', { className: 'seccion-titulo' }, h(Ico, { name: 'store', size: 16, color: 'var(--purple)' }), 'En el mercadillo (publicado)'),
    h('div', { className: 'kpi-grid' },
      h(Kpi, { label: 'Unidades publicadas', valor: fmtCr(pb.unidades), sub: d.furnis_publicados + (d.furnis_publicados === 1 ? ' furni' : ' furnis') }),
      h(Kpi, { label: 'Inversión publicada', valor: fmtCr(pb.costo_cr) + ' cr', sub: fmtLg(pb.costo_lg) + ' lingos' }),
      h(Kpi, { label: 'Te entraría si se vende todo', valor: fmtCr(pb.retorno_cr) + ' cr', sub: pb.comision_cr ? 'Neto de ' + fmtCr(pb.comision_cr) + ' cr de comisión' : fmtLg(pb.retorno_lg) + ' lingos' }),
      h(Kpi, { label: 'Ganancia esperada', valor: signo(pb.ganancia_cr), clase: pb.ganancia_cr > 0 ? 'pos' : pb.ganancia_cr < 0 ? 'neg' : '', sub: pb.unidades ? 'Margen ' + fmtPct(pb.margen) + ' · tras comisión' : 'Nada publicado todavía' })),

    mano.unidades > 0 ? h('div', { className: 'card', style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 } },
      h(Ico, { name: 'box', size: 20, color: 'var(--text2)' }),
      h('div', { style: { flex: 1 } },
        h('div', { className: 'card-titulo' }, 'En mano: ' + fmtCr(mano.unidades) + ' und · ' + fmtCr(mano.costo_cr) + ' cr invertidos'),
        h('div', { className: 'card-sub' }, 'Sin precio ni ganancia hasta que lo publiques o lo vendas · ' + mano.lotes + (mano.lotes === 1 ? ' lote' : ' lotes'))),
      h('button', { className: 'btn', onClick: function () { props.onNav('inventario'); } }, 'Ver', h(Ico, { name: 'chevright', size: 14 }))) : null,

    h('div', { className: 'seccion-titulo' }, h(Ico, { name: 'tag', size: 16, color: 'var(--green)' }), 'Ventas realizadas'),
    h('div', { className: 'kpi-grid' },
      h(Kpi, { label: 'Unidades', valor: fmtCr(vd.unidades) }),
      h(Kpi, { label: 'Costo de lo vendido', valor: fmtCr(vd.costo_cr) + ' cr', sub: fmtLg(vd.costo_lg) + ' lingos' }),
      h(Kpi, { label: 'Ingresos reales', valor: fmtCr(vd.retorno_cr) + ' cr', sub: vd.comision_cr ? 'Neto de ' + fmtCr(vd.comision_cr) + ' cr de comisión pagada' : fmtLg(vd.retorno_lg) + ' lingos' }),
      h(Kpi, { label: 'Ganancia real', valor: signo(vd.ganancia_cr), clase: vd.ganancia_cr > 0 ? 'pos' : vd.ganancia_cr < 0 ? 'neg' : '', sub: 'Margen ' + fmtPct(vd.margen) })),

    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)', gap: 14 } },
      h('div', { className: 'card' },
        h('div', { className: 'card-titulo', style: { marginBottom: 10 } }, 'Datos rápidos'),
        [['Furnis distintos', d.furnis_distintos], ['Furnis con stock', d.furnis_con_stock], ['Furnis publicados', d.furnis_publicados], ['Furnis por revisar', d.furnis_por_revisar],
          ['Compras registradas', d.compras_registradas]].map(function (x) {
          return h('div', { key: x[0], style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' } },
            h('span', { className: 'suave', style: { fontSize: 13 } }, x[0]), h('span', { className: 'mono' }, x[1]));
        }),
        d.mayor_ganancia ? h('div', { style: { marginTop: 12 } },
          h('div', { className: 'dato-l', style: { marginBottom: 6 } }, 'Mayor ganancia esperada (publicado)'),
          h(NombreFurni, { furni: d.mayor_ganancia, sub: h('span', { className: 'mono pos' }, signo(d.mayor_ganancia.ganancia_esperada_cr)) })) : null),

      d.perdidas.length
        ? h('div', { className: 'card', style: { borderColor: 'var(--red-bd)', background: 'var(--red-bg)' } },
            h('div', { className: 'card-titulo', style: { color: 'var(--red)', marginBottom: 6 } }, h(Ico, { name: 'alert', size: 16 }),
              d.perdidas.length + ' furni' + (d.perdidas.length === 1 ? '' : 's') + ' publicado' + (d.perdidas.length === 1 ? '' : 's') + ' deja' + (d.perdidas.length === 1 ? '' : 'n') + ' pérdida'),
            d.perdidas.map(function (f) {
              return h('div', { key: f.id, style: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--red-bd)', cursor: 'pointer' },
                onClick: function () { props.onVerFurni(f.id); } },
                h('div', { style: { flex: 1, minWidth: 0 } }, h(NombreFurni, { furni: f,
                  sub: 'Publicado a ' + (f.lista_min_cr === f.lista_max_cr ? fmtCr(f.lista_min_cr) : fmtCr(f.lista_min_cr) + '–' + fmtCr(f.lista_max_cr)) + ' cr · costo prom. ' + fmtLg(f.costo_publicado_cr)
                    + ' · mínimo ' + fmtCr(precioMinimoSinPerder(f.costo_publicado_cr)) })),
                h('span', { className: 'mono neg', style: { fontWeight: 700 } }, fmtCr(f.ganancia_esperada_cr)));
            }))
        : h('div', { className: 'card', style: { display: 'flex', gap: 10, alignItems: 'center' } },
            h(Ico, { name: 'checkCircle', size: 20, color: 'var(--green)' }),
            h('div', null, h('div', { className: 'card-titulo' }, 'Nada publicado deja pérdida'), h('div', { className: 'card-sub' }, 'Todos los precios de lista cubren lo que costó lo publicado, tras la comisión.')))));
}
