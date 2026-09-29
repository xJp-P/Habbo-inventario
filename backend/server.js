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
const { crearDetectorAuditoria, avisoCatalogo } = require('./core/avisos');
const crearRutasApi = require('./routes/api');
const { ClientError } = require('./core/util');

const RAIZ = path.join(__dirname, '..');

async function crearApp({
  dirDatos, raiz = null, log = console.log, iniciarCatalogo = true, cifrado = null,
  clienteFijo = null, demo = null, esperaInventarioMs = undefined,
} = {}) {
  const eventos = new EventEmitter();
  eventos.setMaxListeners(50);

  let negocio = null;
  // Catalogo nuevo (se busca solo al abrir la app): tus furnis toman sus nombres, sprites
  // e iconos y, si algo cambio, la interfaz recarga sus datos en silencio. Si trae furnis
  // que antes no estaban, se avisa (`catalogo-nuevo`: notificacion del sistema en Electron).
  const furnidata = crearServicioFurnidata({
    dirDatos,
    log,
    alActualizar: (_api, info) => {
      const aviso = info ? avisoCatalogo(info) : null;
      if (aviso) eventos.emit('evento', { tipo: 'catalogo-nuevo', nuevos: info.nuevos, ...aviso });
      if (negocio) {
        negocio.sincronizarConCatalogo().then((r) => {
          if (r && (r.actualizados || r.vinculados || r.sprites || r.unidos)) eventos.emit('evento', { tipo: 'catalogo', ...r });
        }).catch(() => {});
      }
    },
  });

  // Auditoria en vivo (migracion 20261011000000): al llegar la foto del inventario de un
  // sniper se compara ese keko y se publica `auditoria` con el resumen (el numero del menu)
  // y los avisos de diferencias NUEVAS (core/avisos.js), que Electron muestra como
  // notificacion del sistema si no estas mirando la app.
  const detector = crearDetectorAuditoria();
  async function baseAuditoria() {
    detector.reiniciar();
    const resumen = await negocio.resumenAuditoria();
    for (const k of resumen.kekos || []) detector.base(k.keko, (await negocio.auditoria(k.keko)).filas);
  }
  async function revisarAuditoria(kekos) {
    const avisos = [];
    for (const keko of kekos) {
      let a;
      try { a = await negocio.auditoria(keko); } catch (e) { log('Auditoria en vivo de ' + keko + ': ' + e.message); continue; }
      const aviso = detector.revisar(a.keko, a.filas);
      if (aviso) avisos.push(aviso);
    }
    eventos.emit('evento', { tipo: 'auditoria', resumen: await negocio.resumenAuditoria(), avisos });
  }
  const conexion = crearServicioConexion({
    raiz, dirDatos, eventos, log, cifrado,
    clienteFijo: clienteFijo || (demo ? demo.cliente : null),
    demo: !!demo,
    // Los furnis que el Sniper crea solo con sprite_id reciben su nombre oficial antes
    // de que la interfaz los muestre.
    alRecibirEventos: () => negocio.sincronizarConCatalogo(),
    alEscucharInventario: baseAuditoria,
    alRecibirInventario: revisarAuditoria,
    esperaInventarioMs,
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
    furnidata.detener();
    await conexion.detener();
    if (demo) await demo.cliente.cerrar();
    else if (clienteFijo && clienteFijo.cerrar) await clienteFijo.cerrar();
  }

  return { app, conexion, negocio, furnidata, eventos, cerrar };
}

module.exports = { crearApp };
