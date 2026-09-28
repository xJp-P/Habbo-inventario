// public/js/core/format.js — formato de numeros y parseo de inputs.
//
// Heredado de Proyecto_Cartera (public/js/core/format.js). Se conservan `fmtN`,
// `fmtNumInput`, `parseNum`, `parseDecimalInput`, `parseIntInput` y `fmtD` (con su
// anclaje a mediodia para que el huso horario no corra el dia). Se reemplazan los
// formatos de COP/USD por los de las monedas de Habbo: Creditos y Lingos.

export function fmtN(n) { return new Intl.NumberFormat('es-CO').format(Math.round(n||0)); }

// Creditos: enteros con separador de miles ("1.234").
export function fmtCr(n) { return n===null||n===undefined ? '-' : fmtN(n); }

// Lingos: hasta 2 decimales ("24,5").
export function fmtLg(n) { return n===null||n===undefined ? '-' : new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(n); }

// Porcentaje con 1 decimal ("34,8 %").
export function fmtPct(n) { return n===null||n===undefined ? '-' : new Intl.NumberFormat('es-CO',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(n); }

export function fmtMoneda(n, moneda) { return moneda==='lingos' ? fmtLg(n) : fmtCr(n); }

export var MONEDA_LABEL = { creditos: 'Créditos', lingos: 'Lingos' };

export function fmtD(s) { return s?new Date(s+'T12:00:00').toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}):'-'; }

export function fmtNumInput(v){
  if(!v&&v!==0)return '';
  var s=String(v).replace(/[^\d,]/g,'');
  var parts=s.split(',');
  var ent=parts[0].replace(/^0+(?=\d)/,'');
  if(!ent)ent='0';
  ent=ent.replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  return parts.length>1?ent+','+parts[1]:ent;
}

export function parseNum(v){
  if(!v)return '';
  var s=String(v).replace(/\./g,'').replace(',','.');
  return s;
}

export function parseDecimalInput(v){
  var s=String(v||'').replace(',','.').replace(/[^\d.]/g,'');
  var parts=s.split('.');
  if(parts.length>2) s=parts[0]+'.'+parts.slice(1).join('');
  return s;
}

// Solo deja digitos (para inputs enteros como la cantidad).
export function parseIntInput(v){return String(v||'').replace(/[^\d]/g,'');}

// "hace 3 min", "hace 2 h", "hace 4 d" a partir de una fecha ISO.
export function fmtHace(iso) {
  if (!iso) return '-';
  var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
  return 'hace ' + Math.round(s / 86400) + ' d';
}

// Número escrito por el usuario -> número (null si está vacío, NaN si no es número).
// "1.234" = mil doscientos treinta y cuatro; "24,5" y "24.5" = veinticuatro y medio.
export function leerNumero(v) {
  var t = String(v === undefined || v === null ? '' : v).trim().replace(/\s/g, '');
  if (!t) return null;
  var n;
  if (t.indexOf(',') !== -1) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d+\.\d{1,2}$/.test(t)) n = Number(t);
  else n = Number(t.replace(/\./g, ''));
  return Number.isFinite(n) ? n : NaN;
}
