// public/js/vistas/Resumen.js — tablero: tasa del Lingo, mercancia en venta, compras
// del Sniper por revisar, ventas realizadas, datos rapidos y alerta de perdidas.
// Replica la hoja "Resumen" del Excel (mismas cifras, verificadas en la migracion).

import { h, useState, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtCr, fmtLg, fmtPct, leerNumero } from '../core/format.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni } from '../componentes/base.js';

function Kpi(props) {
  return h('div', { className: 'kpi-card' },
    h('div', { className: 'kpi-label' }, props.icono ? h(Ico, { name: props.icono, size: 14 }) : null, props.label),
    h('div', { className: 'kpi-value ' + (props.clase || '') }, props.valor),
    props.sub ? h('div', { className: 'kpi-sub' }, props.sub) : null);
}

function signo(n) { return (n > 0 ? '+' : '') + fmtCr(n) + ' cr'; }

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

  var ev = r.en_venta, vd = r.vendido, pr = r.por_revisar, d = r.datos;
  return h('div', { className: 'contenedor fade-in' },
    h('div', { className: 'card', style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 } },
      h(Ico, { name: 'diamond', size: 22, color: 'var(--purple)' }),
      h('div', { style: { flex: 1 } },
        h('div', { className: 'card-titulo' }, 'Tasa del Lingo'),
        h('div', { className: 'card-sub' }, 'Créditos que vale 1 Lingo. Todo se recalcula al cambiarla.')),
      h('input', { className: 'inp inp-num', style: { width: 110 }, value: tasa, inputMode: 'decimal',
        onChange: function (e) { setTasa(e.target.value); }, onBlur: guardarTasa,
        onKeyDown: function (e) { if (e.key === 'Enter') e.target.blur(); } }),
      h('span', { className: 'suave' }, 'cr')),

    pr.unidades > 0 ? h('div', { className: 'huerfanas', style: { display: 'flex', alignItems: 'center', gap: 12 } },
      h(Ico, { name: 'radar', size: 22, color: 'var(--yellow)' }),
      h('div', { style: { flex: 1 } },
        h('div', { style: { fontWeight: 700, color: 'var(--yellow)' } }, 'Por revisar: ' + pr.unidades + ' und del Sniper'),
        h('div', { className: 'card-sub' }, fmtCr(pr.costo_cr) + ' cr invertidos que aún no están en venta · ' + d.furnis_por_revisar + ' furni(s)')),
      h('button', { className: 'btn', onClick: function () { props.onNav('inventario'); } }, 'Revisar', h(Ico, { name: 'chevright', size: 14 }))) : null,

    h('div', { className: 'seccion-titulo' }, h(Ico, { name: 'store', size: 16, color: 'var(--green)' }), 'Mercancía en venta'),
    h('div', { className: 'kpi-grid' },
      h(Kpi, { label: 'Unidades', valor: fmtCr(ev.unidades), sub: r.publicado.unidades
        ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--purple)' } }, h(Ico, { name: 'lock', size: 11 }), r.publicado.unidades + ' publicadas en el mercadillo')
        : d.furnis_con_stock + ' furnis con stock' }),
      h(Kpi, { label: 'Inversión', valor: fmtCr(ev.costo_cr) + ' cr', sub: fmtLg(ev.costo_lg) + ' lingos' }),
      h(Kpi, { label: 'Retorno si vendes todo', valor: fmtCr(ev.retorno_cr) + ' cr', sub: ev.comision_cr ? 'Neto de ' + fmtCr(ev.comision_cr) + ' cr de comisión' : fmtLg(ev.retorno_lg) + ' lingos' }),
      h(Kpi, { label: 'Ganancia esperada', valor: signo(ev.ganancia_cr), clase: ev.ganancia_cr >= 0 ? 'pos' : 'neg', sub: 'Margen ' + fmtPct(ev.margen) + ' · tras comisión' })),

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
          ['Compras registradas', d.compras_registradas], ['Furnis sin precio', d.sin_precio.length]].map(function (x) {
          return h('div', { key: x[0], style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' } },
            h('span', { className: 'suave', style: { fontSize: 13 } }, x[0]), h('span', { className: 'mono' }, x[1]));
        }),
        d.mayor_ganancia ? h('div', { style: { marginTop: 12 } },
          h('div', { className: 'dato-l', style: { marginBottom: 6 } }, 'Mayor ganancia esperada'),
          h(NombreFurni, { furni: d.mayor_ganancia, sub: h('span', { className: 'mono pos' }, signo(d.mayor_ganancia.ganancia_esperada_cr)) })) : null),

      d.perdidas.length
        ? h('div', { className: 'card', style: { borderColor: 'var(--red-bd)', background: 'var(--red-bg)' } },
            h('div', { className: 'card-titulo', style: { color: 'var(--red)', marginBottom: 6 } }, h(Ico, { name: 'alert', size: 16 }),
              d.perdidas.length + ' furni' + (d.perdidas.length === 1 ? '' : 's') + ' deja' + (d.perdidas.length === 1 ? '' : 'n') + ' pérdida al precio actual'),
            d.perdidas.map(function (f) {
              return h('div', { key: f.id, style: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--red-bd)', cursor: 'pointer' },
                onClick: function () { props.onVerFurni(f.id); } },
                h('div', { style: { flex: 1, minWidth: 0 } }, h(NombreFurni, { furni: f,
                  sub: 'Vendes a ' + fmtCr(f.precio_venta_cr) + ' · costo prom. ' + fmtLg(f.costo_promedio_cr) + ' · mínimo ' + fmtCr(f.precio_minimo_cr) })),
                h('span', { className: 'mono neg', style: { fontWeight: 700 } }, fmtCr(f.ganancia_esperada_cr)));
            }))
        : h('div', { className: 'card', style: { display: 'flex', gap: 10, alignItems: 'center' } },
            h(Ico, { name: 'checkCircle', size: 20, color: 'var(--green)' }),
            h('div', null, h('div', { className: 'card-titulo' }, 'Ningún furni deja pérdida'), h('div', { className: 'card-sub' }, 'Todos los precios de venta cubren su costo promedio.')))));
}
