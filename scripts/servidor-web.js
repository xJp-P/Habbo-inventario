#!/usr/bin/env node
// scripts/servidor-web.js — corre la app en el navegador, sin Electron.
//
//   npm run web            -> http://127.0.0.1:3435, contra TU Supabase (.env)
//   npm run demo           -> http://127.0.0.1:3435, con Postgres local (si la base esta vacia
//                             y hay un unico .xlsx en la raiz, lo importa)
//   npm run web -- 4000    -> otro puerto
//   npm run demo -- --novedades[=1.3.0]  -> ademas imprime la direccion que abre la
//                             ventana de novedades (para revisarla antes de publicar)
//
// Sirve para desarrollar la interfaz con recarga rapida en cualquier navegador.

const http = require('http');
const { crearApp } = require('../backend/server');
const { crearDemo, USUARIO_DEMO } = require('../backend/services/demo');
const { importarExcel } = require('../backend/services/importarExcel');
const { RAIZ, DIR_DATOS_DEV, buscarExcel } = require('./comun');

const args = process.argv.slice(2);
const esDemo = args.includes('--demo');
const puerto = Number(args.find((a) => /^\d+$/.test(a))) || 3435;
const argNovedades = args.find((a) => /^--novedades(=\d+\.\d+\.\d+)?$/.test(a));

async function main() {
  const demo = esDemo ? await crearDemo({ dirDatos: DIR_DATOS_DEV }) : null;
  const { app, negocio, furnidata } = await crearApp({ dirDatos: DIR_DATOS_DEV, raiz: RAIZ, demo });

  if (demo && (await negocio.listarFurnis()).length === 0) {
    const excel = buscarExcel();
    if (excel) {
      const inf = await importarExcel(negocio, furnidata, excel, {});
      console.log(`Demo: importados ${inf.furnis} furnis y ${inf.compras} lotes desde ${excel}`);
    }
  }

  http.createServer(app).listen(puerto, '127.0.0.1', () => {
    console.log(`Habbo Inventario (${esDemo ? 'modo demo, Postgres local' : 'modo navegador'}): http://127.0.0.1:${puerto}`);
    if (demo) console.log(`Usuario demo: ${USUARIO_DEMO.email} / ${USUARIO_DEMO.password} (ya con sesion iniciada)`);
    if (argNovedades) console.log(`Ventana de novedades: http://127.0.0.1:${puerto}/?${argNovedades.slice(2)}`);
  });
}

main().catch((e) => {
  console.error('No se pudo iniciar: ' + (e && e.stack || e));
  process.exitCode = 1;
});
