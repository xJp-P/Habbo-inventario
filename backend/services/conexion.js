// backend/services/conexion.js — el cliente de Supabase, la sesion y el tiempo real.
//
// Estados:
//   sin_configurar  falta SUPABASE_URL / SUPABASE_ANON_KEY  -> pantalla de configuracion
//   sin_sesion      hay proyecto pero nadie inicio sesion  -> pantalla de acceso
//   lista           sesion activa: la API de datos funciona
//
// TIEMPO REAL: con la sesion activa se suscribe a los INSERT de `eventos_sniper` (una
// fila por cada compra, publicacion o recuperacion que envia un SniperMercadillo;
// Supabase Realtime respeta RLS: solo llegan las filas propias). Las rafagas se agrupan
// (~0,7 s); antes de avisar se corre `alRecibirEventos` (sincroniza con el catalogo los
// furnis nuevos que llegaron solo con sprite_id) y luego se publica un evento
// `eventos-sniper` en el bus que alimenta /api/eventos.
//
// AUDITORIA EN VIVO (migracion 20261011000000): la foto del inventario de cada sniper
// (inventario_habbo) tambien llega por Realtime, en un canal APARTE: sin esa migracion la
// tabla no esta publicada y Realtime rechazaria el canal, asi que primero se pregunta
// `auditoria_en_vivo()` y, si no, no se escucha. Antes de escuchar se corre
// `alEscucharInventario` (la base: lo que ya habia no se avisa); las fotos que llegan
// juntas (~1,5 s) se entregan a `alRecibirInventario(kekos)`.

const path = require('path');
const { ClientError } = require('../core/util');
const { leerConfiguracion, guardarConfiguracion, crearClienteSupabase } = require('../db/supabase');

// La version que corre, para la ventana de novedades (va en cada estado de la cuenta:
// al abrir, al iniciar sesion, al configurar y al salir). Del package.json solo se lee
// `version`: electron-builder quita `build` al empaquetar.
const VERSION = require('../../package.json').version;

const ESPERA_AGRUPAR_MS = 700;
const ESPERA_INVENTARIO_MS = 1500;

// Lo que la tarjeta «Conexion con SniperMercadillo» muestra para configurar un sniper: los
// mismos datos, y con los mismos nombres, que pide su ⚙️ Ajustes (URL del proyecto y clave
// publica; el token sale de la tabla de tokens). Antes solo se mostraba la direccion
// completa de registrar_eventos_sniper, y pegarla en «URL del proyecto» mandaba cada envio
// del bot a una ruta inexistente (404). La clave publica no es secreta: viaja en cada
// peticion del bot y de la app. En modo demo (url 'local') no hay nada que mostrar.
function datosParaSniper(config) {
  const base = config && config.url && config.url !== 'local' ? config.url : null;
  return {
    url_proyecto: base,
    clave_publica: base ? config.anonKey || null : null,
    url_eventos: base ? `${base}/rest/v1/rpc/registrar_eventos_sniper` : null,
    url_estado: base ? `${base}/rest/v1/rpc/estado_sniper` : null,
  };
}

function crearServicioConexion({
  raiz, dirDatos, eventos, log = () => {}, cifrado = null, clienteFijo = null, demo = false, alRecibirEventos = null,
  alEscucharInventario = null, alRecibirInventario = null, esperaInventarioMs = ESPERA_INVENTARIO_MS,
}) {
  let config = clienteFijo ? { url: 'local', anonKey: 'local', origen: 'demo' } : leerConfiguracion({ raiz, dirDatos });
  let cliente = clienteFijo || (config ? crearClienteSupabase({ ...config, dirDatos, cifrado }) : null);
  let anonimo = null;
  let usuario = null;
  let canal = null;
  let pendientesAviso = [];
  let temporizador = null;
  let canalInventario = null;
  let enVivo = false;
  let kekosRecibidos = new Set();
  let temporizadorInventario = null;

  async function avisarEventos() {
    const filas = pendientesAviso;
    pendientesAviso = [];
    temporizador = null;
    if (alRecibirEventos) {
      try { await alRecibirEventos(); } catch (e) { log('No se pudo sincronizar tras eventos del Sniper: ' + e.message); }
    }
    const cuenta = (t) => filas.filter((f) => f.tipo_evento === t).length;
    eventos.emit('evento', {
      tipo: 'eventos-sniper',
      total: filas.length,
      compras: cuenta('compra'),
      publicaciones: cuenta('publicar'),
      recuperaciones: cuenta('recuperar'),
      unidades: filas.reduce((s, f) => s + (Number(f.cantidad) || 0), 0),
    });
  }

  async function avisarInventario() {
    const kekos = [...kekosRecibidos];
    kekosRecibidos = new Set();
    temporizadorInventario = null;
    if (!alRecibirInventario || !usuario) return;
    try { await alRecibirInventario(kekos); } catch (e) { log('No se pudo revisar la auditoria en vivo: ' + e.message); }
  }

  async function escucharInventario() {
    let publicada = false;
    try {
      const r = await cliente.rpc('auditoria_en_vivo');
      publicada = !r.error && r.data === true;
    } catch (_) { /* sin la migracion o sin conexion: no se escucha */ }
    enVivo = publicada;
    if (!publicada || canalInventario || !usuario) return;
    if (alEscucharInventario) {
      try { await alEscucharInventario(); } catch (e) { log('No se pudo leer la auditoria inicial: ' + e.message); }
    }
    if (canalInventario || !usuario) return;
    canalInventario = cliente
      .channel('habbo-inventario-fotos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario_habbo' }, (carga) => {
        const keko = carga.new && carga.new.keko;
        if (!keko) return;
        kekosRecibidos.add(keko);
        if (!temporizadorInventario) temporizadorInventario = setTimeout(avisarInventario, esperaInventarioMs);
      })
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') log('Auditoria en vivo: escuchando el inventario de los snipers.');
        else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') log('Auditoria en vivo: ' + estado + ' (se reintenta solo).');
      });
  }

  function suscribir() {
    if (!cliente || canal) return;
    canal = cliente
      .channel('habbo-inventario-compras')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_sniper' }, (carga) => {
        pendientesAviso.push(carga.new || {});
        if (!temporizador) temporizador = setTimeout(avisarEventos, ESPERA_AGRUPAR_MS);
      })
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') log('Tiempo real activo: escuchando eventos del Sniper.');
        else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') log('Tiempo real: ' + estado + ' (se reintenta solo).');
      });
    escucharInventario();
  }

  async function desuscribir() {
    for (const c of [canal, canalInventario]) {
      if (c && cliente) { try { await cliente.removeChannel(c); } catch (_) { /* ya cerrado */ } }
    }
    canal = null;
    canalInventario = null;
    enVivo = false;
    if (temporizadorInventario) clearTimeout(temporizadorInventario);
    temporizadorInventario = null;
    kekosRecibidos = new Set();
  }

  async function refrescarSesion() {
    if (!cliente) { usuario = null; return; }
    const { data } = await cliente.auth.getSession();
    usuario = data && data.session ? data.session.user : null;
    if (usuario) suscribir();
  }

  async function iniciar() {
    if (!cliente) return estado();
    cliente.auth.onAuthStateChange((evento, sesion) => {
      usuario = sesion ? sesion.user : null;
      if (evento === 'SIGNED_OUT') desuscribir();
    });
    try { await refrescarSesion(); } catch (e) { log('No se pudo leer la sesion guardada: ' + e.message); }
    return estado();
  }

  // La conexion se puede cambiar desde la app si vive en el .env de la carpeta de datos
  // (lo que guarda el asistente); las variables de entorno y el .env de la raiz mandan.
  function configEditable() {
    if (clienteFijo) return false;
    if (!config) return true;
    return config.origen !== 'entorno' && !(raiz && config.origen === path.join(raiz, '.env'));
  }

  function estado() {
    return {
      estado: !cliente ? 'sin_configurar' : usuario ? 'lista' : 'sin_sesion',
      url: config ? config.url : null,
      origenConfig: config ? config.origen : null,
      configEditable: configEditable(),
      usuario: usuario ? { id: usuario.id, email: usuario.email } : null,
      demo,
      version: VERSION,
    };
  }

  async function configurar(datos) {
    if (clienteFijo) throw new ClientError('En modo demo la conexion es local.');
    config = guardarConfiguracion(dirDatos, datos);
    await desuscribir();
    cliente = crearClienteSupabase({ ...config, dirDatos, cifrado });
    anonimo = null;
    usuario = null;
    return iniciar();
  }

  async function iniciarSesion({ email, password }) {
    if (!cliente) throw new ClientError('Primero configura la conexion con Supabase.', 428);
    if (!email || !password) throw new ClientError('Escribe tu email y tu contraseña.');
    let r;
    try {
      r = await cliente.auth.signInWithPassword({ email: String(email).trim(), password: String(password) });
    } catch (e) {
      throw new ClientError('No se pudo conectar con Supabase. Revisa la URL y tu internet.', 503);
    }
    if (r.error) {
      const msg = /invalid login/i.test(r.error.message) ? 'Email o contraseña incorrectos.'
        : /email not confirmed/i.test(r.error.message) ? 'Ese usuario no esta confirmado. En Supabase → Authentication, confirmalo o crealo con "Auto Confirm".'
        : r.error.message;
      throw new ClientError(msg, 401);
    }
    usuario = r.data.user;
    suscribir();
    return estado();
  }

  async function cerrarSesion() {
    if (cliente) {
      await desuscribir();
      await cliente.auth.signOut();
    }
    usuario = null;
    return estado();
  }

  // Cliente listo para leer/escribir datos, o error claro para la interfaz.
  function clienteListo() {
    if (!cliente) throw Object.assign(new ClientError('Falta configurar la conexion con Supabase.', 428), { codigo: 'SIN_CONFIG' });
    if (!usuario) throw Object.assign(new ClientError('Inicia sesion para ver tus datos.', 401), { codigo: 'SIN_SESION' });
    return cliente;
  }

  // Cliente con la clave publica y SIN sesion (rol anon), aparte del de la sesion: el
  // asistente de configuracion lo usa para ver que migraciones estan instaladas.
  function clienteAnonimo() {
    if (!cliente) throw Object.assign(new ClientError('Falta configurar la conexion con Supabase.', 428), { codigo: 'SIN_CONFIG' });
    if (!anonimo) {
      anonimo = clienteFijo ? clienteFijo.comoAnon()
        : crearClienteSupabase({ ...config, dirDatos, cifrado, sinSesion: true });
    }
    return anonimo;
  }

  return {
    iniciar, estado, configurar, iniciarSesion, cerrarSesion, clienteListo, clienteAnonimo,
    datosSniper: () => datosParaSniper(config), cliente: () => cliente, detener: desuscribir,
    auditoriaEnVivo: () => enVivo,
  };
}

module.exports = { crearServicioConexion, datosParaSniper };
