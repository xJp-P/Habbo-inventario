// public/js/core/ventas.js — las ventas que registra el Sniper en la interfaz (v1.7.0,
// migracion 20261015000000). Sin React ni red: npm run verificar lo prueba.
//
//   - ventaDelSniper(l): un lote vendido que registro el Sniper (la marca «Vendido · Sniper»).
//   - kekoConVentasSniper: si el Sniper de ese keko ya registra sus ventas. Ahi, marcar
//     «Vendido» a mano pregunta antes (decision del dueño en la maqueta): si el Sniper
//     tambien la envia, se contaria dos veces.
//   - candidatosDeVenta: los lotes a los que se puede asignar una venta «por asignar»
//     (publicados de ese furni en ese keko o sin keko; un LTD con otro numero, bloqueado),
//     en el mismo orden en que los elegiria la base.
//   - cuandoVenta: «hoy a las 04:19», «ayer a las 04:19», «30 sept a las 04:19».

import { claveKeko } from './kekos.js';
import { fmtD } from './format.js';

export function ventaDelSniper(l) {
  return !!l && l.estado === 'vendido' && l.vendido_por === 'sniper';
}

// ventas: los lotes (compras); pendientes: las ventas por asignar.
export function kekoConVentasSniper(compras, pendientes, keko) {
  var c = claveKeko(keko);
  if (!c) return false;
  return (compras || []).some(function (l) { return ventaDelSniper(l) && claveKeko(l.keko) === c; })
    || (pendientes || []).some(function (v) { return claveKeko(v.keko) === c; });
}

// Los furnis que pueden ser el de la venta: el suyo o, si la app no lo tenia al llegar,
// los de ese sprite (y espacio, si se sabe).
function furnisDeVenta(venta, furnis) {
  if (venta.furni_id) return [venta.furni_id];
  return (furnis || []).filter(function (f) {
    return venta.sprite_id !== null && venta.sprite_id !== undefined && f.sprite_id === venta.sprite_id && (!venta.tipo || f.tipo === venta.tipo);
  }).map(function (f) { return f.id; });
}

function tiempo(x) { return x ? new Date(x).getTime() : -Infinity; }

// [{ lote, bloqueado, motivo }]: lotes publicados del mismo furni en el keko de la venta o
// sin keko, nunca de otro keko. Primero el mismo numero LTD, el keko antes que lo sin keko,
// el mismo precio de lista y lo publicado hace mas tiempo (como la base).
export function candidatosDeVenta(venta, compras, furnis) {
  var ids = furnisDeVenta(venta, furnis);
  var k = claveKeko(venta.keko);
  return (compras || []).filter(function (l) {
    return l.estado === 'publicado' && ids.indexOf(l.furni_id) !== -1 && (!l.keko || claveKeko(l.keko) === k);
  }).map(function (l) {
    var otroLtd = venta.numero_ltd && l.numero_ltd && l.numero_ltd !== venta.numero_ltd;
    return { lote: l, bloqueado: !!otroLtd, motivo: otroLtd ? 'Es el LTD #' + l.numero_ltd + ' y la venta fue del #' + venta.numero_ltd + ': no puede ser este.' : null };
  }).sort(function (a, b) {
    var la = a.lote, lb = b.lote;
    var p = function (l) {
      return [venta.numero_ltd && l.numero_ltd === venta.numero_ltd ? 0 : 1, l.keko ? 0 : 1, l.numero_ltd ? 1 : 0,
        (l.moneda_lista || 'creditos') === 'creditos' && Number(l.precio_lista) === Number(venta.precio) ? 0 : 1];
    };
    var pa = p(la), pb = p(lb);
    for (var i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return (a.bloqueado ? 1 : 0) - (b.bloqueado ? 1 : 0) || tiempo(la.publicado_en) - tiempo(lb.publicado_en) || la.id - lb.id;
  });
}

function dia(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function horaDe(iso) { var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
// El dia (en tu hora local) de un instante: para mostrar la fecha de una venta con hora.
export function diaDe(iso) { return dia(new Date(iso)); }

export function cuandoVenta(iso, ahora) {
  if (!iso) return '';
  var hoy = new Date(ahora === undefined ? Date.now() : ahora);
  var ayer = new Date(hoy.getTime() - 86400000);
  var d = diaDe(iso);
  return (d === dia(hoy) ? 'hoy' : d === dia(ayer) ? 'ayer' : fmtD(d)) + ' a las ' + horaDe(iso);
}

// El nombre a mostrar de una venta por asignar: el del furni, el del catalogo o el sprite.
export function nombreVentaPendiente(v, furnis) {
  var lista = furnis || [];
  var f = v.furni_id ? lista.find(function (x) { return x.id === v.furni_id; }) : null;
  if (!f && !v.furni_id) {
    // Lo registraste despues de que llegara la venta.
    var mismos = lista.filter(function (x) { return x.sprite_id === v.sprite_id && (!v.tipo || x.tipo === v.tipo); });
    if (mismos.length === 1) f = mismos[0];
  }
  if (f) return { nombre: f.nombre, classname: f.classname, revision: f.revision, registrado: true };
  if (v.catalogo) return { nombre: v.catalogo.nombre, classname: v.catalogo.classname, revision: v.catalogo.revision, registrado: false };
  return { nombre: 'Sprite ' + v.sprite_id, classname: null, revision: null, registrado: false };
}
