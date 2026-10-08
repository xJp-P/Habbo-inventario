// public/js/core/caducidad.js — cuanto le queda a cada oferta del Mercadillo (v1.10.0).
//
// Una oferta del Mercadillo de Habbo.es dura CADUCIDAD_MERCADILLO_H horas (168: el mismo
// numero que caducidad_mercadillo() de la base, migracion 20261017000000). Publicada hace
// eso o mas, ya no esta a la venta: la base la devuelve sola a Comprado cuando la foto del
// Sniper la trae en la mano, y desde la app se puede retirar aunque la haya publicado el
// Sniper. Sin fecha de publicacion (lotes muy antiguos) cuenta como caducada, igual que en
// la base (oferta_caducada). Puro: lo carga npm run verificar.

import { CADUCIDAD_MERCADILLO_H } from './lotes.js';

var MIN = 60000;
var H = 60 * MIN;
var CADUCA_MS = CADUCIDAD_MERCADILLO_H * H;

export var DIAS_CADUCIDAD = CADUCIDAD_MERCADILLO_H / 24;

function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
function instante(iso) { var t = iso ? new Date(iso).getTime() : NaN; return isNaN(t) ? null : t; }

// Lo que le falta a la oferta de un lote publicado para caducar, en ms (negativo: caduco
// hace tanto). null si no esta publicado o si no tiene fecha.
export function restante(l, ahora) {
  if (!l || l.estado !== 'publicado') return null;
  var t = instante(l.publicado_en);
  return t === null ? null : t + CADUCA_MS - ahora;
}

export function caducada(l, ahora) {
  if (!l || l.estado !== 'publicado') return false;
  var r = restante(l, ahora);
  return r === null || r <= 0;
}

// Lo publico el Sniper (un lote sin `publicado_por`, de antes de la publicacion a mano,
// tambien: como en la base).
export function delSniper(l) { return l.publicado_por !== 'manual'; }

// Se puede retirar desde la app: lo que publicaste tu, o lo del Sniper que ya caduco.
export function retirable(l, ahora) {
  return !!l && l.estado === 'publicado' && (l.publicado_por === 'manual' || caducada(l, ahora));
}

// El orden de retirar_furni: lo tuyo primero y despues lo del Sniper caducado; dentro, lo
// publicado hace mas tiempo (sin fecha primero) y luego el id.
export function ordenRetiro(lotes) {
  return (lotes || []).slice().sort(function (a, b) {
    var ma = a.publicado_por === 'manual' ? 0 : 1;
    var mb = b.publicado_por === 'manual' ? 0 : 1;
    if (ma !== mb) return ma - mb;
    var ta = instante(a.publicado_en), tb = instante(b.publicado_en);
    if (ta !== tb) {
      if (ta === null) return -1;
      if (tb === null) return 1;
      return ta - tb;
    }
    return a.id - b.id;
  });
}

// El orden de devolver_del_mercadillo («Volvió del Mercadillo» en la Auditoria), sobre los
// lotes de `publicadas` de una fila ({ lote_id, keko, caducada, publicado_en, cantidad,
// devolvible }): solo los devolvibles; primero los del keko y luego los sin keko; dentro,
// lo caducado antes, y lo publicado hace mas tiempo (sin fecha primero), luego el id.
export function ordenDevolver(lotes) {
  return (lotes || []).filter(function (l) { return l.devolvible; }).sort(function (a, b) {
    var ka = a.keko ? 0 : 1, kb = b.keko ? 0 : 1;
    if (ka !== kb) return ka - kb;
    var ca = a.caducada ? 0 : 1, cb = b.caducada ? 0 : 1;
    if (ca !== cb) return ca - cb;
    var ta = instante(a.publicado_en), tb = instante(b.publicado_en);
    if (ta !== tb) {
      if (ta === null) return -1;
      if (tb === null) return 1;
      return ta - tb;
    }
    return a.lote_id - b.lote_id;
  });
}

// Unidades caducadas de unos lotes (de cualquiera: la etiqueta «N caducadas»).
export function unidadesCaducadas(lotes, ahora) {
  return (lotes || []).reduce(function (s, l) { return s + (caducada(l, ahora) ? num(l.cantidad) : 0); }, 0);
}

// La columna «Caducidad» del Mercadillo (pedido del dueño, 08-10-2026): SOLO lo que publico
// el Sniper; lo que publicaste tu no lo sigue la app (fila sin dato).
//   unidades   las del Sniper en la fila
//   proxima    { lote, ms }: la oferta del Sniper aun vigente mas proxima a caducar
//   caducadas  unidades del Sniper ya caducadas
//   reciente   { lote, ms } de la que caduco hace menos (ms negativo), si no queda ninguna vigente
export function caducidadDeFila(lotes, ahora) {
  var r = { unidades: 0, caducadas: 0, proxima: null, reciente: null };
  (lotes || []).forEach(function (l) {
    if (l.estado !== 'publicado' || !delSniper(l)) return;
    r.unidades += num(l.cantidad);
    var x = restante(l, ahora);
    if (x === null || x <= 0) {
      r.caducadas += num(l.cantidad);
      if (x !== null && (!r.reciente || x > r.reciente.ms)) r.reciente = { lote: l, ms: x };
    } else if (!r.proxima || x < r.proxima.ms) {
      r.proxima = { lote: l, ms: x };
    }
  });
  if (r.proxima) r.reciente = null;
  return r;
}

// «3 d 4 h», «22 h 41 min», «41 min» o «menos de 1 min» (lo que falta o lo que paso).
export function textoTiempo(ms) {
  var m = Math.floor(Math.abs(num(ms)) / MIN);
  if (m < 1) return 'menos de 1 min';
  var d = Math.floor(m / 1440);
  var h = Math.floor((m % 1440) / 60);
  var mi = m % 60;
  if (d) return d + ' d' + (h ? ' ' + h + ' h' : '');
  if (h) return h + ' h' + (mi ? ' ' + mi + ' min' : '');
  return mi + ' min';
}

// El instante en que caduca (o caduco) la oferta de un lote publicado; null sin fecha.
export function vence(l) {
  var t = l ? instante(l.publicado_en) : null;
  return t === null ? null : t + CADUCA_MS;
}

// Pronto: le queda menos de un dia (la columna lo pinta en ambar).
export function pronto(ms) { return ms !== null && ms > 0 && ms < 24 * H; }
