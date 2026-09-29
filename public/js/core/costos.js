// public/js/core/costos.js — el costo que propone la bandeja de Auditoria al registrar la
// entrada de un sobrante o de un furni no registrado, a partir de lo que envia el Sniper
// (migracion 20261009000000). Modulo aparte, sin React, para que npm run verificar lo pruebe.

// El costo que el Sniper conoce para las unidades que SOBRAN, o null. La foto dice a cuantas
// de las unidades que hay en Habbo corresponde ese costo (unidades_con_costo); las que la
// app ya tiene en este keko se descuentan primero (lo normal es que sean justo esas: las
// compro el propio Sniper). Asi el costo nunca se propone para mas unidades de las que el
// bot garantiza: con 3 sobrando y costo de 2, se proponen 2; registradas esas, la que sigue
// sobrando ya no lleva costo (la foto no cambia hasta el siguiente envio del Sniper).
export function costoDelSniper(f) {
  if (f.costo_unidad === null || f.costo_unidad === undefined || !f.unidades_con_costo) return null;
  var n = Math.min(f.diferencia, Math.max(0, f.unidades_con_costo - (f.app || 0)));
  return n >= 1 ? { costo: Number(f.costo_unidad), unidades: n, medio: !!f.costo_medio } : null;
}

// El costo como se escribe en la caja (coma decimal, sin separador de miles: lo lee leerNumero).
export function textoCosto(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }
