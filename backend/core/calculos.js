// backend/core/calculos.js — agregados del RESUMEN a partir de las vistas v_compras y
// v_furnis. Funcion pura (sin BD): recibe filas, devuelve numeros.
//
// Regla: lo que esta EN MANO no tiene precio ni ganancia esperada (solo lo que costo);
// el precio se fija al publicar o al vender.
//   Publicado (en venta) = lotes "publicado": costo, retorno neto (precio de lista menos
//                          la comision), ganancia esperada y margen. Es la UNICA fuente
//                          de ganancia esperada.
//   En mano              = lotes "comprado" ya revisados: unidades y costo.
//   Por revisar          = lotes "comprado" que llegaron del Sniper sin confirmar.
//   Stock                = en mano + por revisar + publicado (unidades y costo).
//   Ventas realizadas    = lotes "vendido" (neto si fue en el mercadillo).
//   Retorno / Ingresos   = costo + ganancia; Margen = ganancia / costo (0 sin costo).
//   Furnis con perdida   = lo publicado no cubre lo que costo.
// `comision_cr` de cada bloque suma la que falta cobrar (publicado) o la ya pagada
// (vendido).

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

// Solo costo y unidades (lo en mano no tiene precio).
function soloCosto(filas, tasa) {
  const costo = sumar(filas, 'costo_total_cr');
  return { lotes: filas.length, unidades: sumar(filas, 'cantidad'), costo_cr: costo, costo_lg: costo / tasa };
}

function resumenFurni(f) {
  return {
    id: f.id, nombre: f.nombre, classname: f.classname, revision: f.revision,
    stock: f.stock, unidades_publicadas: f.unidades_publicadas, lista_min_cr: f.lista_min_cr, lista_max_cr: f.lista_max_cr,
    costo_publicado_cr: f.costo_publicado_cr, precio_minimo_cr: f.precio_minimo_cr, ganancia_esperada_cr: f.ganancia_esperada_cr,
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
  const comprados = compras.filter((c) => c.estado === 'comprado');
  const publicados = compras.filter((c) => c.estado === 'publicado');

  return {
    tasa,
    publicado: bloque(publicados, tasa),
    en_mano: soloCosto(comprados.filter((c) => !c.pendiente), tasa),
    por_revisar: soloCosto(comprados.filter((c) => c.pendiente), tasa),
    stock: soloCosto([...comprados, ...publicados], tasa),
    vendido: bloque(compras.filter((c) => c.estado === 'vendido'), tasa),
    datos: {
      furnis_distintos: furnis.length,
      furnis_con_stock: furnis.filter((f) => f.estado === 'en_venta' || f.estado === 'publicado').length,
      furnis_publicados: furnis.filter((f) => f.unidades_publicadas > 0).length,
      furnis_por_revisar: furnis.filter((f) => f.unidades_pendientes > 0).length,
      compras_registradas: compras.filter((c) => c.origen_id === null || c.origen_id === undefined).length,
      mayor_ganancia: mayor ? resumenFurni(mayor) : null,
      perdidas,
    },
  };
}

module.exports = { calcularResumen };
