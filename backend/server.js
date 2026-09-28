// backend/server.js — arma la app Express: conexion con Supabase, catalogo de Habbo.es,
// API local y archivos de la interfaz.
//
// Es una FACTORY async. La usan:
//   - electron/main.js        -> la app de escritorio
//   - scripts/servidor-web.js -> modo navegador (desarrollo) y modo demo
//   - scripts/verificar.js    -> pruebas, con `clienteFijo` (Postgres local PGlite)
//
// Arquitectura: la interfaz (navegador de Electron) habla SOLO con este servidor local
// en 127.0.0.1. Este servidor tiene la sesion de Supabase y hace las consultas. Los
// SniperMercadillo de los VPS no pasan por aca: envian sus eventos (compra, publicar,
// recuperar) directo a Supabase con su token, y Supabase Realtime avisa a este
// servidor, que lo reenvia a la interfaz.

const express = require('express');
const path = require('path');
const { EventEmitter } = require('events');
const { crearServicioFurnidata } = require('./services/furnidata');
const { crearServicioConexion } = require('./services/conexion');
const { crearServicioNegocio } = require('./services/negocio');
const { crearServicioInstalacion } = require('./services/instalacion');
const { importarExcel } = require('./services/importarExcel');
const { protegerApiLocal } = require('./core/seguridad');
const crearRutasApi = require('./routes/api');
const { ClientError } = require('./core/util');

const RAIZ = path.join(__dirname, '..');

async function crearApp({
  dirDatos, raiz = null, log = console.log, iniciarCatalogo = true, cifrado = null,
  clienteFijo = null, demo = null,
} = {}) {
  const eventos = new EventEmitter();
  eventos.setMaxListeners(50);

  let negocio = null;
  const furnidata = crearServicioFurnidata({
    dirDatos,
    log,
    alActualizar: () => negocio && negocio.sincronizarConCatalogo().catch(() => {}),
  });
  const conexion = crearServicioConexion({
    raiz, dirDatos, eventos, log, cifrado,
    clienteFijo: clienteFijo || (demo ? demo.cliente : null),
    demo: !!demo,
    // Los furnis que el Sniper crea solo con sprite_id reciben su nombre oficial antes
    // de que la interfaz los muestre.
    alRecibirEventos: () => negocio.sincronizarConCatalogo(),
  });
  negocio = crearServicioNegocio({ conexion, furnidata });

  if (iniciarCatalogo) await furnidata.iniciar();
  else furnidata.cargarCache();
  await conexion.iniciar();
  if (demo) await demo.preparar({ negocio, furnidata });
  if (conexion.estado().estado === 'lista') negocio.sincronizarConCatalogo().catch(() => {});

  const app = express();
  app.disable('x-powered-by');
  app.use(protegerApiLocal());

  // React 18 UMD servido desde node_modules (sin internet ni bundler), heredado de Cartera.
  app.get('/vendor/react.js', (_req, res) => {
    res.sendFile(path.join(path.dirname(require.resolve('react/package.json')), 'umd', 'react.production.min.js'));
  });
  app.get('/vendor/react-dom.js', (_req, res) => {
    res.sendFile(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd', 'react-dom.production.min.js'));
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(RAIZ, 'public')));

  app.use(crearRutasApi({
    conexion,
    negocio,
    furnidata,
    eventos,
    demo,
    instalacion: crearServicioInstalacion(),
    importar: (ruta, opciones) => importarExcel(negocio, furnidata, ruta, opciones),
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ClientError) return res.status(err.code).json({ error: err.message, codigo: err.codigo || null });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalido.' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Envio demasiado grande.' });
    log('Error inesperado: ' + (err && err.stack || err));
    res.status(500).json({ error: err && err.message ? err.message : 'Error interno del servidor.' });
  });

  async function cerrar() {
    await conexion.detener();
    if (demo) await demo.cliente.cerrar();
    else if (clienteFijo && clienteFijo.cerrar) await clienteFijo.cerrar();
  }

  return { app, conexion, negocio, furnidata, eventos, cerrar };
}

module.exports = { crearApp };
