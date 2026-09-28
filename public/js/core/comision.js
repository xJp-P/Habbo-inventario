// public/js/core/comision.js — comisión del mercadillo de Habbo.es.
//
// Vender a un precio p en el mercadillo cobra ⌈(p² + 16000·p) / 800000⌉ créditos. Se
// calcula con división entera para no arrastrar errores de coma flotante (0,02) y dar
// exactamente lo que cobra el juego:
//     2 cr -> 1 de comisión · 150 -> 4 · 2.500 -> 58 · 99.999 -> 14.500
//
// Solo aplica a precios en créditos (el mercadillo cobra en créditos); lo que se vende
// en lingos es un intercambio directo y no paga comisión.
//
// La base de datos usa la misma fórmula (supabase/migrations/20260929000000_...sql,
// función comision_mercadillo) y `npm run verificar` comprueba que ambas coinciden.
// Este archivo también lo cargan las pruebas en Node (public/js/package.json lo marca
// como módulo ES).

export function calcularComision(precioLista) {
  var p = Number(precioLista);
  return Math.floor((p * (p + 16000) + 799999) / 800000);
}

export function calcularGananciaNeta(precioLista, costo) {
  const p = Number(precioLista);
  // Truco de enteros para ⌈(p² + 16000p) / 800000⌉
  const comision = Math.floor((p * (p + 16000) + 799999) / 800000);
  const ingresoNeto = p - comision;
  return ingresoNeto - costo;
}

// Lo que recibes por unidad: el precio menos la comisión (sin comisión en lingos).
export function ingresoNeto(precio, moneda) {
  var p = Number(precio);
  return moneda === 'lingos' ? p : p - calcularComision(p);
}

// Menor precio entero en créditos cuyo neto cubre el costo. Parte de la raíz de
// p − (p² + 16000p)/800000 = costo y sube hasta el primer entero que alcanza. null si
// ningún precio lo cubre (el neto máximo es ~192.080).
export function precioMinimoSinPerder(costo) {
  if (costo === null || costo === undefined || isNaN(costo)) return null;
  var c = Number(costo);
  if (c <= 0) return 0;
  var disc = 784000 * 784000 - 3200000 * c;
  if (disc < 0) return null;
  var p = Math.max(0, Math.floor((784000 - Math.sqrt(disc)) / 2) - 1);
  while (p - calcularComision(p) < c) {
    p++;
    if (p > 392000) return null;
  }
  return p;
}

// Al reves: el precio de lista (lo que paga el comprador) para que te entre `neto`. Es el
// MENOR precio entero cuyo neto llega a esa cifra; como el neto sube de a 0 o 1 credito,
// con un neto entero da exacto (146 -> 150, 2.442 -> 2.500, 85.499 -> 99.999). null si
// ningun precio lo alcanza.
export function calcularPrecioLista(neto) {
  return precioMinimoSinPerder(neto);
}

// Ganancia esperada de un furni (columna "Ganancia esp." del Mercadillo): cada unidad en
// stock, comprada o publicada, vendida a su precio (el de lista si está publicada, el
// del furni si no) menos la comisión y menos lo que costó. `lotes` son las filas de
// v_compras de ese furni. null si no hay stock o algún lote en stock no tiene precio.
export function gananciaEsperadaFurni(furni, lotes) {
  if (!furni || !(furni.stock > 0)) return null;
  var total = 0;
  for (var i = 0; i < lotes.length; i++) {
    var l = lotes[i];
    if (l.estado !== 'comprado' && l.estado !== 'publicado') continue;
    if (l.precio_venta_cr === null || l.precio_venta_cr === undefined) return null;
    var porUnidad = l.moneda_precio === 'lingos'
      ? l.precio_venta_cr - l.precio_compra_cr
      : calcularGananciaNeta(l.precio_venta_cr, l.precio_compra_cr);
    total += porUnidad * l.cantidad;
  }
  return total;
}

// Lo PUBLICADO de un furni (vista Mercadillo): suma solo sus lotes 'publicado', cada uno a
// su precio de lista menos la comision (sin comision si la lista es en lingos). Devuelve
// unidades, costo, venta bruta y neta, comision, ganancia neta, costo promedio, rango de
// precios de lista y cuantas unidades publico el Sniper y cuantas tu.
export function resumenPublicado(lotes) {
  var r = { unidades: 0, costo: 0, bruto: 0, neto: 0, comision: 0, ganancia: 0, costoPromedio: null,
    listaMin: null, listaMax: null, sniper: 0, manual: 0 };
  for (var i = 0; i < lotes.length; i++) {
    var l = lotes[i];
    if (l.estado !== 'publicado') continue;
    var p = Number(l.precio_lista_cr);
    var com = l.moneda_lista === 'lingos' ? 0 : calcularComision(p);
    r.unidades += l.cantidad;
    r.costo += l.precio_compra_cr * l.cantidad;
    r.bruto += p * l.cantidad;
    r.comision += com * l.cantidad;
    r.neto += (p - com) * l.cantidad;
    r.ganancia += (l.moneda_lista === 'lingos' ? p - l.precio_compra_cr : calcularGananciaNeta(p, l.precio_compra_cr)) * l.cantidad;
    r.listaMin = r.listaMin === null ? p : Math.min(r.listaMin, p);
    r.listaMax = r.listaMax === null ? p : Math.max(r.listaMax, p);
    if (l.publicado_por === 'manual') r.manual += l.cantidad; else r.sniper += l.cantidad;
  }
  if (r.unidades) r.costoPromedio = r.costo / r.unidades;
  return r;
}
