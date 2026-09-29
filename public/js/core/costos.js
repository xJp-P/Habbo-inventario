// public/js/core/costos.js — los costos que propone la bandeja de Auditoria al registrar la
// entrada de un sobrante o de un furni no registrado, a partir de lo que envia el Sniper
// (migraciones 20261009000000 y 20261010000000). Modulo aparte, sin React, para que npm
// run verificar lo pruebe.

// Dos costos son el mismo si coinciden al centimo (la caja de costo guarda dos decimales).
function centimos(n) { return Math.round(Number(n) * 100); }
export function mismoCosto(a, b) { return centimos(a) === centimos(b); }

// Los tramos de costo que el Sniper conoce de un furni de la foto, en el orden en que los
// mando (del lote mas antiguo al mas nuevo) y con los costos repetidos unidos. Con la
// migracion 20261010000000 llegan en `costos`; antes, solo el resumen (un unico tramo).
function tramosDeFoto(f) {
  var crudos = Array.isArray(f.costos) && f.costos.length ? f.costos
    : f.costo_unidad !== null && f.costo_unidad !== undefined && f.unidades_con_costo
      ? [{ costo_unidad: f.costo_unidad, unidades: f.unidades_con_costo, costo_medio: f.costo_medio }] : [];
  var tramos = [];
  crudos.forEach(function (t) {
    var costo = Number(t.costo_unidad);
    var n = Math.floor(Number(t.unidades) || 0);
    if (!isFinite(costo) || costo < 0 || n < 1) return;
    var igual = tramos.find(function (x) { return mismoCosto(x.costo, costo); });
    if (igual) { igual.unidades += n; igual.medio = igual.medio || !!t.costo_medio; }
    else tramos.push({ costo: costo, unidades: n, medio: !!t.costo_medio });
  });
  return tramos;
}

// Cuantas unidades del sobrante hay que registrar con una entrada: las que no explican los
// lotes sin keko de la app (esas las asigna «Son de este keko»).
export function porRegistrar(f) {
  var dif = f.diferencia || 0;
  return dif - Math.min(dif, f.sin_asignar || 0);
}

// Los tramos con costo conocido de las unidades que SOBRAN y hay que registrar:
// [{ costo, unidades, medio }], una linea (y una entrada) por cada uno. Las unidades sin
// keko que explican parte del sobrante no se proponen: esas las asigna «Son de este keko».
// Nunca se propone un costo para mas unidades de las que el bot garantiza:
//   1. Cada lote que la app ya tiene en este keko (y cada lote sin keko de los que explican
//      el sobrante) se descuenta del tramo con su mismo costo: son esas unidades,
//      normalmente compradas por el propio Sniper.
//   2. Lo demas que la app tiene (otro costo, lingos) se descuenta de los tramos en orden,
//      del mas antiguo al mas nuevo.
//   3. Lo que queda, hasta lo que falta registrar. Lo que sobra sin tramo va sin costo.
// Registrado un tramo con su costo, en la siguiente comparacion lo descuenta el paso 1 y
// la linea desaparece, aunque la foto del Sniper no haya cambiado.
export function tramosDelSniper(f) {
  var tramos = tramosDeFoto(f);
  var libre = porRegistrar(f);
  var sueltas = (f.diferencia || 0) - libre;
  if (!tramos.length || libre < 1) return [];
  var resto = tramos.map(function (t) { return t.unidades; });
  var porDescontar = [f.app || 0, sueltas];
  [f.costos_app, f.costos_sin_keko].forEach(function (lotes, j) {
    (lotes || []).forEach(function (a) {
      var quedan = Math.min(Number(a.unidades) || 0, porDescontar[j]);
      tramos.forEach(function (t, i) {
        if (quedan < 1 || !mismoCosto(a.costo_unidad, t.costo)) return;
        var m = Math.min(quedan, resto[i]);
        resto[i] -= m; quedan -= m; porDescontar[j] -= m;
      });
    });
  });
  var otras = porDescontar[0] + porDescontar[1];
  tramos.forEach(function (t, i) {
    var m = Math.min(otras, resto[i]);
    resto[i] -= m; otras -= m;
  });
  var salida = [];
  tramos.forEach(function (t, i) {
    var n = Math.min(resto[i], libre);
    if (n >= 1) { salida.push({ costo: t.costo, unidades: n, medio: t.medio }); libre -= n; }
  });
  return salida;
}

// El costo como se escribe en la caja (coma decimal, sin separador de miles: lo lee leerNumero).
export function textoCosto(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }
