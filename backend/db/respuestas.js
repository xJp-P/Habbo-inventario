// backend/db/respuestas.js — convierte respuestas de Supabase en datos o en errores
// entendibles para la interfaz.
//
// supabase-js no lanza: devuelve { data, error }. `datos()` devuelve `data` o lanza un
// ClientError con el codigo HTTP correcto. Las funciones SQL del esquema lanzan
// SQLSTATE 'PTxyz' (PostgREST lo convierte en HTTP xyz) con el mensaje ya en español.

const { ClientError } = require('../core/util');

function conCodigo(error, codigo) {
  return Object.assign(error, { codigo });
}

function traducirError(e) {
  const code = String((e && e.code) || '');
  const msg = (e && e.message) || 'Error de Supabase';
  const todo = msg + ' ' + ((e && e.details) || '');
  if (/^PT\d{3}$/.test(code)) return new ClientError(msg, Number(code.slice(2)));
  if (code === '23505') {
    return new ClientError(/furnis_nombre_unico/.test(todo) ? 'Ese furni ya esta en el Mercadillo.' : 'Ese registro ya existe.', 409);
  }
  if (code === '23503') return new ClientError('No se puede: hay registros que dependen de este.', 409);
  if (code === '23514') return new ClientError('Algun valor no es valido (revisa cantidades, precios y monedas).', 400);
  if (code === '22P02' || code === '22003') return new ClientError('Algun dato tiene un formato invalido.', 400);
  if (code === 'PGRST116') return new ClientError('No se encontro el registro.', 404);
  if (code === 'PGRST301' || code === 'PGRST303' || /jwt expired/i.test(msg)) {
    return conCodigo(new ClientError('La sesion expiro. Vuelve a iniciar sesion.', 401), 'SIN_SESION');
  }
  // Tabla, funcion o columna que no existe: la base no tiene todavia la migracion que la trae.
  if (code === '42P01' || code === '42883' || code === '42703' || code === 'PGRST202' || code === 'PGRST204' ||
      code === 'PGRST205' || /schema cache/i.test(msg)) {
    return conCodigo(new ClientError('Falta instalar el esquema en Supabase: pega supabase/migrations/*.sql en el SQL Editor.', 424), 'SIN_ESQUEMA');
  }
  // El servidor local dejo de esperar a Supabase (fetchConEspera en db/supabase.js) o no
  // pudo ni conectar: errores claros, no el «AbortError» / «fetch failed» de la libreria.
  if (/^AbortError: Supabase no respondió/.test(msg)) {
    return conCodigo(new ClientError(msg.replace(/^AbortError: /, '') + ' Revisa tu internet o si tu proyecto de Supabase está pausado o muy lento.', 504), 'SUPABASE_SIN_RESPUESTA');
  }
  if (/^(TypeError|FetchError): fetch failed/i.test(msg)) {
    return new ClientError('No se pudo conectar con Supabase. Revisa tu internet. (' + msg + ')', 503);
  }
  if (code === '42501') {
    return new ClientError('Sin permiso para esa operacion. Revisa que el esquema este instalado y que hayas iniciado sesion.', 403);
  }
  return new Error(`Supabase: ${msg}${code ? ` (${code})` : ''}`);
}

async function datos(consulta) {
  let r;
  try {
    r = await consulta;
  } catch (e) {
    throw new ClientError('No se pudo conectar con Supabase. Revisa tu internet. (' + e.message + ')', 503);
  }
  if (r.error) throw traducirError(r.error);
  return r.data;
}

// Todas las filas, pidiendo de a 1.000 (el tope por defecto de la API de Supabase).
// `construir` debe devolver una consulta NUEVA y ordenada en cada llamada.
async function todas(construir, pagina = 1000) {
  const filas = [];
  for (let desde = 0; ; desde += pagina) {
    const lote = await datos(construir().range(desde, desde + pagina - 1));
    filas.push(...lote);
    if (lote.length < pagina) return filas;
  }
}

module.exports = { datos, todas, traducirError };
