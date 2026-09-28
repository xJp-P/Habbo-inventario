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

const { ClientError } = require('../core/util');
const { leerConfiguracion, guardarConfiguracion, crearClienteSupabase } = require('../db/supabase');

const ESPERA_AGRUPAR_MS = 700;

function crearServicioConexion({ raiz, dirDatos, eventos, log = () => {}, cifrado = null, clienteFijo = null, demo = false, alRecibirEventos = null }) {
  let config = clienteFijo ? { url: 'local', anonKey: 'local', origen: 'demo' } : leerConfiguracion({ raiz, dirDatos });
  let cliente = clienteFijo || (config ? crearClienteSupabase({ ...config, dirDatos, cifrado }) : null);
  let usuario = null;
  let canal = null;
  let pendientesAviso = [];
  let temporizador = null;

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
  }

  async function desuscribir() {
    if (canal && cliente) { try { await cliente.removeChannel(canal); } catch (_) { /* ya cerrado */ } }
    canal = null;
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

  function estado() {
    return {
      estado: !cliente ? 'sin_configurar' : usuario ? 'lista' : 'sin_sesion',
      url: config ? config.url : null,
      origenConfig: config ? config.origen : null,
      usuario: usuario ? { id: usuario.id, email: usuario.email } : null,
      demo,
    };
  }

  async function configurar(datos) {
    if (clienteFijo) throw new ClientError('En modo demo la conexion es local.');
    config = guardarConfiguracion(dirDatos, datos);
    await desuscribir();
    cliente = crearClienteSupabase({ ...config, dirDatos, cifrado });
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

  return { iniciar, estado, configurar, iniciarSesion, cerrarSesion, clienteListo, cliente: () => cliente, detener: desuscribir };
}

module.exports = { crearServicioConexion };
