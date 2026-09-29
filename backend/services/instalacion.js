// backend/services/instalacion.js — lo que usa el asistente de configuracion: la lista de
// migraciones de supabase/migrations, su SQL (para copiarlo desde la app al SQL Editor)
// y cuales estan instaladas en el proyecto de Supabase del usuario.
//
// DETECCION SIN CLAVE SECRETA: cada migracion deja algo propio (una funcion o una
// columna) y se consulta con la clave publica y un cliente SIN sesion (rol anon):
//   - no existe  -> PGRST202 (funcion, en Supabase) · 42883 (funcion, en Postgres)
//                   42703 / PGRST204 (columna) · PGRST205 / 42P01 (tabla o vista:
//                   un proyecto recien creado no tiene ninguna)          => falta
//   - existe     -> 42501 permiso denegado (las funciones de la app estan cerradas a
//                   anon) o un error propio de la funcion (PTxxx)       => instalada
//   - otra cosa  -> clave o URL mal, proyecto pausado, sin internet     => no se sabe
// Como anon no puede ejecutar las funciones de la app, las sondas nunca escriben nada;
// las dos funciones del sniper que anon si ejecuta reciben un token invalido y cortan.
//
// Cada migracion nueva DEBE sumar aqui su sonda: `npm run verificar` lo exige.

const fs = require('fs');
const path = require('path');
const { ClientError } = require('../core/util');

const DIR_MIGRACIONES = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const TOKEN_SONDA = 'hbi_sonda_del_asistente';

const funcion = (nombre, args) => (c) => c.rpc(nombre, args);
const columna = (tabla, col) => (c) => c.from(tabla).select(col).limit(0);

const MIGRACIONES = [
  { archivo: '20260927000000_esquema_inicial.sql', titulo: 'Tablas, vistas, seguridad por filas y tokens del sniper', sonda: funcion('estado_sniper', { p_token: TOKEN_SONDA }) },
  { archivo: '20260928000000_eventos_sniper.sql', titulo: 'Eventos del Sniper: compra, publicar y recuperar', sonda: funcion('registrar_eventos_sniper', { token_sniper: TOKEN_SONDA, eventos: [] }) },
  { archivo: '20260929000000_precio_lista_y_comision.sql', titulo: 'Comisión del mercadillo y precio de lista', sonda: funcion('comision_mercadillo', { p: 100 }) },
  { archivo: '20260930000000_venta_neta_mercadillo.sql', titulo: 'Las ventas en el mercadillo guardan el neto', sonda: columna('compras', 'comision_venta') },
  { archivo: '20261001000000_publicacion_manual.sql', titulo: 'Publicar y retirar a mano', sonda: funcion('retirar_lote', { p_id: -1 }) },
  { archivo: '20261002000000_publicar_furni.sql', titulo: 'Publicar un furni completo', sonda: funcion('publicar_furni', { p_furni_id: -1 }) },
  { archivo: '20261003000000_vender_retirar_furni.sql', titulo: 'Vendido y Retirar desde el Mercadillo', sonda: funcion('retirar_furni', { p_furni_id: -1 }) },
  { archivo: '20261004000000_venta_en_mano.sql', titulo: 'Ventas manuales (tradeos y otros kekos)', sonda: funcion('vender_en_mano', { p_furni_id: -1, p_cantidad: 1, p_precio: 1 }) },
  { archivo: '20261005000000_sin_precio_de_referencia.sql', titulo: 'Lo que está en mano solo tiene costo', sonda: columna('v_furnis', 'costo_publicado_cr') },
  { archivo: '20261006000000_numero_ltd.sql', titulo: 'Número de serie de los LTD', sonda: funcion('asignar_ltd', { p_id: -1, p_numero: 1 }) },
  { archivo: '20261007000000_auditoria_inventario.sql', titulo: 'Auditoría del inventario de Habbo (por keko)', sonda: funcion('auditoria_inventario', { p_keko: 'sonda' }) },
  { archivo: '20261008000000_kekos_manuales.sql', titulo: 'Kekos manuales (bodegas y kekos sin Sniper)', sonda: funcion('listar_kekos', {}) },
];

const FALTA = new Set(['PGRST202', '42883', '42703', 'PGRST204', 'PGRST205', '42P01']);

// 'si' | 'no' | { error } para la respuesta de una sonda.
function interpretar(r) {
  if (!r.error) return 'si';
  const codigo = String(r.error.code || '');
  if (FALTA.has(codigo)) return 'no';
  if (codigo === '42501' || /^P[T0-9]\d{3}$/.test(codigo)) return 'si';
  return { error: r.error.message || codigo || 'sin respuesta' };
}

function mensajeSinRespuesta(detalle) {
  if (/api key|apikey|jwt/i.test(detalle)) return 'Supabase no aceptó la clave pública. Revisa que sea la de este proyecto.';
  if (/invalid path|no route matched/i.test(detalle)) return 'La URL del proyecto no es correcta: usa solo la dirección base, por ejemplo https://abcd1234.supabase.co.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i.test(detalle)) return 'No se pudo contactar tu proyecto de Supabase. Revisa la URL, tu internet o si el proyecto está pausado.';
  return 'No se pudo comprobar la base de datos: ' + detalle;
}

function crearServicioInstalacion() {
  function listar() {
    return MIGRACIONES.map((m, i) => ({ numero: i + 1, archivo: m.archivo, titulo: m.titulo }));
  }

  function leerSql(archivo) {
    const m = MIGRACIONES.find((x) => x.archivo === archivo);
    if (!m) throw new ClientError('Esa migración no existe.', 404);
    return { archivo: m.archivo, sql: fs.readFileSync(path.join(DIR_MIGRACIONES, m.archivo), 'utf8') };
  }

  // Consulta todas las sondas a la vez con un cliente SIN sesion.
  async function comprobar(clienteAnon) {
    const respuestas = await Promise.all(MIGRACIONES.map(async (m) => {
      try { return interpretar(await m.sonda(clienteAnon)); } catch (e) { return { error: e.message }; }
    }));
    const dudosa = respuestas.find((r) => typeof r === 'object');
    if (dudosa) {
      return { migraciones: listar().map((m) => ({ ...m, instalada: null })), instaladas: 0, total: MIGRACIONES.length, completa: false, siguiente: null, error: mensajeSinRespuesta(dudosa.error) };
    }
    // Cada migracion exige la anterior: si una esta, todas las previas tambien.
    const ultima = respuestas.lastIndexOf('si');
    const migraciones = listar().map((m, i) => ({ ...m, instalada: i <= ultima }));
    const instaladas = ultima + 1;
    return {
      migraciones,
      instaladas,
      total: MIGRACIONES.length,
      completa: instaladas === MIGRACIONES.length,
      siguiente: instaladas < MIGRACIONES.length ? MIGRACIONES[instaladas].archivo : null,
      error: null,
    };
  }

  return { listar, leerSql, comprobar };
}

module.exports = { crearServicioInstalacion, MIGRACIONES, DIR_MIGRACIONES };
