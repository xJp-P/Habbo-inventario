#!/usr/bin/env node
// scripts/migracion.js — pasa el Excel original a tu base de datos de Supabase.
//
// Uso:
//   npm run migrar                          (usa el unico .xlsx de la raiz del proyecto)
//   npm run migrar -- ruta\al\archivo.xlsx
//   npm run migrar -- --reemplazar          (borra tus furnis/lotes antes de importar)
//   npm run migrar -- --mantener-nombres    (no corrige nombres al oficial de Habbo.es)
//   npm run migrar -- --app                 (usa la sesion de la app INSTALADA)
//   npm run migrar -- --demo                (importa a la base local del modo demo)
//
// Conexion: usa SUPABASE_URL y SUPABASE_ANON_KEY del .env y la sesion guardada por la
// app (inicia sesion una vez con `npm start`). Tambien puedes poner SUPABASE_EMAIL y
// SUPABASE_PASSWORD en el .env para que el script entre solo.
//
// Tambien se puede importar desde la app: Ajustes → Importar desde Excel.
//
// Al terminar compara los totales con los que el Excel tenia calculados en su hoja
// "Resumen" y lista los furnis que dejan perdida al precio actual.

const path = require('path');
const { EventEmitter } = require('events');
const { crearServicioFurnidata } = require('../backend/services/furnidata');
const { crearServicioConexion } = require('../backend/services/conexion');
const { crearServicioNegocio } = require('../backend/services/negocio');
const { crearDemo } = require('../backend/services/demo');
const { leerExcel, importarDatos } = require('../backend/services/importarExcel');
const { parsearEnv } = require('../backend/db/supabase');
const { normalizar } = require('../backend/core/util');
const { RAIZ, DIR_DATOS_DEV, dirDatosApp, buscarExcel } = require('./comun');
const fs = require('fs');

function argumentos() {
  const a = process.argv.slice(2);
  const op = { excel: null, app: false, demo: false, reemplazar: false, mantenerNombres: false };
  for (const x of a) {
    if (x === '--app') op.app = true;
    else if (x === '--demo') op.demo = true;
    else if (x === '--reemplazar') op.reemplazar = true;
    else if (x === '--mantener-nombres') op.mantenerNombres = true;
    else if (!x.startsWith('--')) op.excel = x;
    else throw new Error(`Opcion desconocida: ${x}`);
  }
  return op;
}

function credencialesEnv(dirDatos) {
  const leer = (r) => { try { return parsearEnv(fs.readFileSync(r, 'utf8')); } catch (_) { return {}; } };
  const v = { ...leer(path.join(dirDatos, '.env')), ...leer(path.join(RAIZ, '.env')), ...process.env };
  return v.SUPABASE_EMAIL && v.SUPABASE_PASSWORD ? { email: v.SUPABASE_EMAIL, password: v.SUPABASE_PASSWORD } : null;
}

const cr = (n) => (n === null || n === undefined ? '-' : Math.round(n).toLocaleString('es-CO'));

function comparar(resumen, excel) {
  const e = (etiqueta) => excel[normalizar(etiqueta)];
  const filas = [
    ['Unidades en stock', resumen.stock.unidades, e('Unidades en venta')],
    ['Invertido (Créditos)', resumen.stock.costo_cr, e('Invertido')],
    ['Unidades vendidas', resumen.vendido.unidades, e('Unidades vendidas')],
    ['Ganancia realizada (Créditos)', resumen.vendido.ganancia_cr, e('Ganancia realizada')],
    ['Furnis distintos', resumen.datos.furnis_distintos, e('Furnis distintos en el Inventario')],
    ['Furnis con stock', resumen.datos.furnis_con_stock, e('Furnis con stock disponible')],
    ['Compras registradas', resumen.datos.compras_registradas, e('Compras registradas en el Mercadillo')],
  ];
  // La venta y la ganancia esperadas del Excel valoraban el stock en mano a un precio del
  // furni; la app ya no lo hace (solo lo publicado tiene precio), asi que no se comparan.
  let diferencias = 0;
  const tabla = filas.map(([concepto, app, xls]) => {
    const igual = xls === undefined ? null : Math.abs(Number(app) - Number(xls)) < 0.5;
    if (igual === false) diferencias++;
    return { Concepto: concepto, App: cr(app), Excel: xls === undefined ? '(no está)' : cr(xls), '¿Igual?': igual === null ? '-' : igual ? 'Sí' : 'NO' };
  });
  return { tabla, diferencias };
}

async function main() {
  const op = argumentos();
  const rutaExcel = path.resolve(op.excel || buscarExcel() || '');
  if (!op.excel && !buscarExcel()) throw new Error('No encontre el Excel. Pasa la ruta: npm run migrar -- ruta\\archivo.xlsx');
  const dirDatos = op.app ? dirDatosApp() : DIR_DATOS_DEV;

  const furnidata = crearServicioFurnidata({ dirDatos, log: (m) => console.log('  ' + m) });
  const demo = op.demo ? await crearDemo({ dirDatos: DIR_DATOS_DEV }) : null;
  const conexion = crearServicioConexion({ raiz: RAIZ, dirDatos, eventos: new EventEmitter(), clienteFijo: demo && demo.cliente, demo: !!demo });
  const negocio = crearServicioNegocio({ conexion, furnidata });

  let est = await conexion.iniciar();
  if (est.estado === 'sin_configurar') {
    throw new Error('Falta la conexion con Supabase: crea un .env con SUPABASE_URL y SUPABASE_ANON_KEY (ver .env.example).');
  }
  if (est.estado === 'sin_sesion') {
    const cred = credencialesEnv(dirDatos);
    if (!cred) throw new Error('No hay sesion. Inicia sesion una vez en la app (npm start) o pon SUPABASE_EMAIL y SUPABASE_PASSWORD en el .env.');
    est = await conexion.iniciarSesion(cred);
  }

  console.log(`\nExcel    : ${rutaExcel}`);
  console.log(`Destino  : ${op.demo ? 'base local del modo demo' : est.url} (${est.usuario.email})\n`);

  const cat = await furnidata.iniciar();
  if (!cat.disponible) console.log('  AVISO: no hay catalogo de Habbo.es (sin internet). Los nombres se importan tal cual, sin icono.\n');

  const datos = await leerExcel(rutaExcel);
  console.log(`Leido del Excel: ${datos.furnis.length} furnis, ${datos.compras.length} compras, tasa ${datos.tasa ?? '(no encontrada)'} Créditos por Lingo.\n`);

  const informe = await importarDatos(negocio, furnidata, datos, { reemplazar: op.reemplazar, corregirNombres: !op.mantenerNombres });
  await conexion.detener();
  if (demo) await demo.cliente.cerrar();

  console.log(`Importado: ${informe.furnis} furnis y ${informe.compras} lotes.\n`);
  if (informe.correcciones.length) {
    console.log('Nombres corregidos al oficial de Habbo.es:');
    console.table(informe.correcciones.map((c) => ({ 'En el Excel': c.excel, 'Oficial Habbo.es': c.oficial, Tipo: c.tipo === 'exacta' ? 'tildes/mayúsculas' : 'error de tipeo' })));
  }
  if (informe.sinVincular.length) {
    console.log('Sin vincular al catalogo (revisalos en la app):');
    console.table(informe.sinVincular.map((s) => ({ Nombre: s.nombre, Sugerencias: s.sugerencias.join(' | ') || '-' })));
  }
  if (informe.avisos.length) {
    console.log('Avisos:');
    informe.avisos.forEach((a) => console.log('  - ' + a));
    console.log('');
  }

  const r = informe.resumen;
  const { tabla, diferencias } = comparar(r, datos.resumenExcel);
  console.log('Comparacion con el Resumen del Excel:');
  console.table(tabla);
  console.log(`Tasa: ${r.tasa} Créditos por Lingo · lo importado queda en mano (sin precio): publícalo desde el Inventario.`);
  if (r.datos.perdidas.length) {
    console.log('\nFurnis publicados que dejan PERDIDA:');
    console.table(r.datos.perdidas.map((f) => ({
      Furni: f.nombre, Publicadas: f.unidades_publicadas, 'Precio de lista': cr(f.lista_min_cr),
      'Costo promedio': Number(f.costo_publicado_cr).toFixed(2).replace('.', ','),
      'Precio mínimo': cr(f.precio_minimo_cr), 'Pérdida esperada': cr(f.ganancia_esperada_cr),
    })));
  }
  console.log(diferencias === 0 ? '\nMigracion verificada: los totales coinciden con el Excel.\n'
    : `\nATENCION: ${diferencias} total(es) no coinciden con el Excel. Revisa la tabla de arriba.\n`);
  process.exitCode = diferencias === 0 ? 0 : 2;
}

main().catch((e) => {
  console.error('\nError: ' + e.message + '\n');
  process.exitCode = 1;
});
