// backend/core/calculos.js — agregados del RESUMEN a partir de las vistas v_compras y
// v_furnis. Funcion pura (sin BD): recibe filas, devuelve numeros.
//
// Replica las formulas de la hoja "Resumen" del Excel original:
//   Mercancia en venta  = lotes "comprado" ACTIVOS + lotes "publicado" (en el mercadillo)
//   Publicado           = la parte de la mercancia que ya esta listada en Habbo (a su
//                         precio de lista)
//   Por revisar         = lotes "comprado" HUERFANOS (llegaron del Sniper, sin activar).
//                         Van aparte para no inflar la inversion sin su ganancia.
//   Ventas realizadas   = lotes "vendido"
//   Retorno / Ingresos  = costo + ganancia
//   Margen              = ganancia / costo (0 si no hay costo)
//   Furnis con perdida  = ganancia esperada < 0
//
// La ganancia esperada (lo que sigue en stock) viene NETA de la comision del mercadillo
// de Habbo.es desde las vistas (comision_cr por unidad en v_compras), y la realizada
// tambien: lo vendido desde el mercadillo guarda el neto (comision_pagada_cr por unidad).
// `comision_cr` de cada bloque suma la que falta cobrar o la ya pagada. El Excel no la
// descontaba: `sin_comision` guarda las cifras a su manera, solo para comparar con el.

function sumar(filas, campo) {
  return filas.reduce((s, f) => s + (Number(f[campo]) || 0), 0);
}

function bloque(filas, tasa) {
  const unidades = sumar(filas, 'cantidad');
  const costo = sumar(filas, 'costo_total_cr');
  const ganancia = sumar(filas, 'ganancia_cr');
  const comision = filas.reduce((s, f) => s + ((Number(f.comision_cr) || 0) + (Number(f.comision_pagada_cr) || 0)) * (Number(f.cantidad) || 0), 0);
  const retorno = costo + ganancia;
  return {
    lotes: filas.length,
    unidades,
    costo_cr: costo, costo_lg: costo / tasa,
    comision_cr: comision, comision_lg: comision / tasa,
    retorno_cr: retorno, retorno_lg: retorno / tasa,
    ganancia_cr: ganancia, ganancia_lg: ganancia / tasa,
    margen: costo ? ganancia / costo : 0,
  };
}

function resumenFurni(f) {
  return {
    id: f.id, nombre: f.nombre, classname: f.classname, revision: f.revision,
    stock: f.stock, precio_venta_cr: f.precio_venta_cr, costo_promedio_cr: f.costo_promedio_cr,
    precio_minimo_cr: f.precio_minimo_cr, ganancia_esperada_cr: f.ganancia_esperada_cr,
    unidades_pendientes: f.unidades_pendientes,
  };
}

function calcularResumen({ compras, furnis, tasa }) {
  const conGanancia = furnis.filter((f) => f.ganancia_esperada_cr !== null && f.ganancia_esperada_cr !== undefined);
  const mayor = conGanancia.reduce((m, f) => (!m || f.ganancia_esperada_cr > m.ganancia_esperada_cr ? f : m), null);
  const perdidas = conGanancia
    .filter((f) => f.ganancia_esperada_cr < 0)
    .sort((a, b) => a.ganancia_esperada_cr - b.ganancia_esperada_cr)
    .map(resumenFurni);
  const sinPrecio = furnis
    .filter((f) => f.stock - (f.unidades_publicadas || 0) > 0 && (f.precio_venta === null || f.precio_venta === undefined))
    .map(resumenFurni);
  const enStock = compras.filter((c) => c.estado === 'comprado' || c.estado === 'publicado');
  const activos = enStock.filter((c) => !c.pendiente);
  const brutas = furnis.filter((f) => f.ganancia_esperada_bruta_cr !== null && f.ganancia_esperada_bruta_cr !== undefined);

  return {
    tasa,
    en_venta: bloque(activos, tasa),
    publicado: bloque(compras.filter((c) => c.estado === 'publicado'), tasa),
    por_revisar: bloque(enStock.filter((c) => c.pendiente), tasa),
    vendido: bloque(compras.filter((c) => c.estado === 'vendido'), tasa),
    datos: {
      furnis_distintos: furnis.length,
      furnis_con_stock: furnis.filter((f) => f.estado === 'en_venta' || f.estado === 'publicado').length,
      furnis_publicados: furnis.filter((f) => f.unidades_publicadas > 0).length,
      furnis_por_revisar: furnis.filter((f) => f.unidades_pendientes > 0).length,
      compras_registradas: compras.filter((c) => c.origen_id === null || c.origen_id === undefined).length,
      mayor_ganancia: mayor ? resumenFurni(mayor) : null,
      perdidas,
      sin_precio: sinPrecio,
    },
    sin_comision: {
      retorno_cr: sumar(activos, 'costo_total_cr') + sumar(activos, 'ganancia_bruta_cr'),
      ganancia_cr: sumar(activos, 'ganancia_bruta_cr'),
      mayor_ganancia_cr: brutas.length ? Math.max(...brutas.map((f) => f.ganancia_esperada_bruta_cr)) : null,
      perdidas: brutas.filter((f) => f.ganancia_esperada_bruta_cr < 0).map((f) => f.nombre),
    },
  };
}

module.exports = { calcularResumen };
