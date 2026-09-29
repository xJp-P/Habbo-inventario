// backend/routes/api.js — API JSON local que usa la interfaz de la app.
//
// La interfaz nunca habla directo con Supabase: habla con este servidor local
// (127.0.0.1), que tiene la sesion y el cliente de Supabase. Las rutas son delgadas:
// validan forma, llaman al servicio y devuelven JSON. Express 5 lleva solo los errores
// de los manejadores async al middleware de errores de server.js.
//
// Rutas neutras: /api/furnis = vista MERCADILLO, /api/compras = vista INVENTARIO.
// Todas las rutas de datos exigen sesion (`conexion.clienteListo()` lanza 401/428).

const express = require('express');
const { ClientError } = require('../core/util');

function id(req) {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new ClientError('Id invalido.');
  return n;
}

module.exports = function crearRutasApi({ conexion, negocio, furnidata, eventos, importar, demo, instalacion }) {
  const r = express.Router();

  // ── Cuenta y conexion con Supabase ───────────────────────────────────────
  r.get('/api/cuenta', (_req, res) => res.json(conexion.estado()));
  r.post('/api/cuenta/configurar', async (req, res) => res.json(await conexion.configurar(req.body || {})));
  r.post('/api/cuenta/entrar', async (req, res) => {
    const estado = await conexion.iniciarSesion(req.body || {});
    negocio.sincronizarConCatalogo().catch(() => {});
    res.json(estado);
  });
  r.post('/api/cuenta/salir', async (_req, res) => res.json(await conexion.cerrarSesion()));

  // ── Asistente de configuracion: migraciones (sin sesion; la deteccion usa la clave publica) ──
  r.get('/api/instalacion', async (_req, res) => res.json(await instalacion.comprobar(conexion.clienteAnonimo())));
  r.get('/api/instalacion/sql/:archivo', (req, res) => res.json(instalacion.leerSql(req.params.archivo)));

  // ── Resumen y configuracion ──────────────────────────────────────────────
  r.get('/api/resumen', async (_req, res) => res.json(await negocio.resumen()));
  r.get('/api/config', async (_req, res) => res.json({ tasa_lingo: await negocio.tasa() }));
  r.put('/api/config/tasa', async (req, res) => res.json({ tasa_lingo: await negocio.fijarTasa((req.body || {}).tasa_lingo) }));

  // ── Furnis (vista Mercadillo) ────────────────────────────────────────────
  r.get('/api/furnis', async (_req, res) => res.json(await negocio.listarFurnis()));
  r.get('/api/furnis/:id', async (req, res) => res.json(await negocio.furniPorId(id(req))));
  r.post('/api/furnis', async (req, res) => res.status(201).json(await negocio.crearFurni(req.body || {})));
  r.put('/api/furnis/:id', async (req, res) => res.json(await negocio.actualizarFurni(id(req), req.body || {})));
  r.delete('/api/furnis/:id', async (req, res) => res.json(await negocio.eliminarFurni(id(req))));
  r.post('/api/furnis/:id/publicar', async (req, res) => res.json(await negocio.publicarFurni(id(req), req.body || {})));
  r.post('/api/furnis/:id/vender', async (req, res) => res.json(await negocio.venderFurni(id(req), req.body || {})));
  r.post('/api/furnis/:id/vender-en-mano', async (req, res) => res.json(await negocio.venderEnMano(id(req), req.body || {})));
  r.post('/api/furnis/:id/retirar', async (req, res) => res.json(await negocio.retirarFurni(id(req), req.body || {})));

  // ── Auditoria del inventario de Habbo (por keko) ─────────────────────────
  r.get('/api/auditoria', async (req, res) => res.json(await negocio.auditoria(req.query.keko)));
  r.get('/api/auditoria/resumen', async (_req, res) => res.json(await negocio.resumenAuditoria()));
  r.post('/api/auditoria/mover', async (req, res) => res.json(await negocio.moverAKeko(req.body || {})));
  r.post('/api/auditoria/baja', async (req, res) => res.json(await negocio.darDeBaja(req.body || {})));
  r.post('/api/auditoria/excluir', async (req, res) => res.json(await negocio.excluirDeAuditoria(req.body || {})));
  r.post('/api/auditoria/entrada', async (req, res) => res.status(201).json(await negocio.entradaAuditoria(req.body || {})));

  // ── Compras / lotes (vista Inventario) ───────────────────────────────────
  r.get('/api/compras', async (req, res) => res.json(await negocio.listarCompras({ pendientes: req.query.pendientes === '1' })));
  r.get('/api/compras/:id', async (req, res) => res.json(await negocio.compraPorId(id(req))));
  r.post('/api/compras', async (req, res) => res.status(201).json(await negocio.crearCompra(req.body || {})));
  r.put('/api/compras/:id', async (req, res) => res.json(await negocio.actualizarCompra(id(req), req.body || {})));
  r.delete('/api/compras/:id', async (req, res) => res.json(await negocio.eliminarCompra(id(req))));
  r.post('/api/compras/:id/vender', async (req, res) => res.json(await negocio.vender(id(req), req.body || {})));
  r.post('/api/compras/:id/revertir', async (req, res) => res.json(await negocio.revertirVenta(id(req))));
  r.put('/api/compras/:id/ltd', async (req, res) => res.json(await negocio.asignarLtd(id(req), (req.body || {}).numero_ltd)));
  r.post('/api/compras/:id/publicar', async (req, res) => res.json(await negocio.publicarLote(id(req), req.body || {})));
  r.post('/api/compras/:id/retirar', async (req, res) => res.json(await negocio.retirarLote(id(req))));

  // ── Lotes huerfanos (llegados del Sniper) ────────────────────────────────
  r.get('/api/pendientes', async (_req, res) => res.json(await negocio.pendientesPorFurni()));
  r.post('/api/pendientes/activar', async (req, res) => res.json(await negocio.activarPendientes(req.body || {})));

  // ── Tokens de los SniperMercadillo (uno por VPS) ─────────────────────────
  r.get('/api/sniper/conexion', (_req, res) => res.json({ ...conexion.datosSniper(), hotel: 'es', demo: !!demo }));
  r.get('/api/sniper/tokens', async (_req, res) => res.json(await negocio.listarTokens()));
  r.post('/api/sniper/tokens', async (req, res) => res.status(201).json(await negocio.crearToken((req.body || {}).nombre)));
  r.post('/api/sniper/tokens/:id/revocar', async (req, res) => res.json(await negocio.revocarToken(id(req))));
  r.post('/api/sniper/tokens/borrar-revocados', async (_req, res) => res.json(await negocio.borrarTokensRevocados()));
  r.delete('/api/sniper/tokens/:id', async (req, res) => res.json(await negocio.borrarToken(id(req))));

  // ── Kekos (de los snipers y manuales) ────────────────────────────────────
  r.get('/api/kekos', async (_req, res) => res.json(await negocio.listarKekos()));
  r.post('/api/kekos', async (req, res) => res.status(201).json(await negocio.crearKeko((req.body || {}).nombre)));
  r.post('/api/kekos/asignar', async (req, res) => res.json(await negocio.asignarSinKeko(req.body || {})));
  r.put('/api/kekos/:id', async (req, res) => res.json(await negocio.renombrarKeko(id(req), (req.body || {}).nombre)));
  r.delete('/api/kekos/:id', async (req, res) => res.json(await negocio.borrarKeko(id(req))));

  // ── Catalogo Habbo.es (furnidata, vive en tu equipo) ─────────────────────
  r.get('/api/furnidata/estado', (_req, res) => res.json(furnidata.estado()));
  r.get('/api/furnidata/buscar', (req, res) => {
    const limite = Math.min(Number(req.query.limite) || 15, 50);
    res.json(furnidata.buscar(String(req.query.q || ''), limite));
  });
  r.get('/api/furnidata/validar', (req, res) => res.json(furnidata.coincidencia(String(req.query.nombre || ''))));
  r.get('/api/furnidata/variantes', (req, res) => res.json(furnidata.variantesDe(String(req.query.nombre || ''))));
  r.post('/api/furnidata/actualizar', async (_req, res) => {
    const estado = await furnidata.actualizar({ forzar: true });
    let sincronizacion = null;
    try { sincronizacion = await negocio.sincronizarConCatalogo(); } catch (_) { /* sin sesion: se hara al entrar */ }
    res.json({ ...estado, sincronizacion });
  });

  // Icono PNG con cache en disco. `?r=<revision>` hace que el navegador lo cachee para
  // siempre: si Habbo cambia la revision, cambia la URL.
  r.get('/api/icono/:classname', async (req, res) => {
    const classname = String(req.params.classname);
    if (!/^[A-Za-z0-9_*\-]{1,120}$/.test(classname)) throw new ClientError('classname invalido.');
    try {
      const png = await furnidata.icono(classname, Number(req.query.r) || null);
      res.set('Cache-Control', 'public, max-age=31536000, immutable').type('png').send(png);
    } catch (_) {
      res.status(404).end();
    }
  });

  // ── Eventos en vivo (Server-Sent Events) ─────────────────────────────────
  // La interfaz se suscribe aca: cuando Supabase avisa (Realtime) de compras nuevas del
  // Sniper, el servidor lo reenvia al instante (aviso + contador de huerfanos).
  r.get('/api/eventos', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const enviar = (e) => res.write(`event: ${e.tipo}\ndata: ${JSON.stringify(e)}\n\n`);
    const latido = setInterval(() => res.write(': latido\n\n'), 25000);
    eventos.on('evento', enviar);
    req.on('close', () => {
      clearInterval(latido);
      eventos.off('evento', enviar);
    });
  });

  // ── Importar Excel (boton de Ajustes) ────────────────────────────────────
  r.post('/api/importar-excel', async (req, res) => {
    const { ruta, reemplazar, corregirNombres } = req.body || {};
    if (!ruta) throw new ClientError('Falta la ruta del archivo Excel.');
    res.json(await importar(ruta, { reemplazar: !!reemplazar, corregirNombres: corregirNombres !== false }));
  });

  // ── Solo modo demo: simula un evento de un SniperMercadillo ──────────────
  if (demo) {
    r.post('/api/demo/simular-sniper', async (req, res) => res.status(201).json(await demo.simularEvento((req.body || {}).tipo || 'compra')));
  }

  return r;
};
