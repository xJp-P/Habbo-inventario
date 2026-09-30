// backend/db/supabase.js — configuracion y cliente de Supabase para la app.
//
// CONFIGURACION (lo unico que el usuario pone): SUPABASE_URL y SUPABASE_ANON_KEY.
// Se buscan en este orden (gana el primero que las tenga):
//   1. Variables de entorno del proceso.
//   2. .env en la raiz del proyecto (modo desarrollo: npm start / npm run web).
//   3. .env en la carpeta de datos de la app (lo escribe la pantalla de configuracion
//      de la app instalada: %APPDATA%\Habbo Inventario\.env, etc.).
//
// SESION: la app entra con el usuario de Supabase Auth (email + contraseña) y guarda la
// sesion en `sesion-supabase.json` dentro de la carpeta de datos, para no pedir la
// contraseña en cada arranque. En la app de escritorio ese archivo va CIFRADO con la
// llave del sistema operativo (safeStorage de Electron: DPAPI en Windows, Llavero en Mac).
//
// La clave anon NO da acceso a los datos: las politicas RLS exigen sesion iniciada.
//
// TIEMPO MAXIMO (v1.6.1): cada peticion a Supabase espera como mucho ESPERA_SUPABASE_MS.
// Antes, si Supabase no contestaba, el servidor local esperaba sin fin y la interfaz se
// quedaba en un spinner. Se corta con un AbortError a proposito: postgrest-js no reintenta
// las peticiones canceladas (si reintentara, serian 4 esperas seguidas). 25 s: termina
// antes que la espera de la interfaz (30 s), asi el error que se ve dice la causa.

const fs = require('fs');
const path = require('path');
const { ClientError } = require('../core/util');

const ARCHIVO_ENV = '.env';
const ARCHIVO_SESION = 'sesion-supabase.json';

// Lector minimo de .env: CLAVE=valor, comillas opcionales, # comentarios.
function parsearEnv(texto) {
  const salida = {};
  for (const linea of String(texto).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(linea);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    salida[m[1]] = v.trim();
  }
  return salida;
}

function leerEnv(ruta) {
  try { return parsearEnv(fs.readFileSync(ruta, 'utf8')); } catch (_) { return {}; }
}

// El panel de Supabase muestra a veces la URL de un servicio (…/rest/v1/, …/auth/v1) en
// vez de la del proyecto. supabase-js agrega esas rutas por su cuenta, asi que con ellas
// las peticiones iban a /rest/v1/rest/v1/… ("Invalid path specified in request URL").
// Se deja solo la direccion base del proyecto.
function normalizarUrl(texto) {
  const t = String(texto || '').trim();
  let u;
  try { u = new URL(t); } catch (_) { return t.replace(/\/+$/, ''); }
  if (/\.supabase\.(co|in)$/i.test(u.hostname)) return u.origin;
  return (u.origin + u.pathname.replace(/\/(rest|auth|storage|realtime|functions|graphql)\/v1(\/.*)?$/i, '')).replace(/\/+$/, '');
}

function leerConfiguracion({ raiz, dirDatos }) {
  const fuentes = [
    { origen: 'entorno', vars: process.env },
    ...(raiz ? [{ origen: path.join(raiz, ARCHIVO_ENV), vars: leerEnv(path.join(raiz, ARCHIVO_ENV)) }] : []),
    { origen: path.join(dirDatos, ARCHIVO_ENV), vars: leerEnv(path.join(dirDatos, ARCHIVO_ENV)) },
  ];
  for (const f of fuentes) {
    if (f.vars.SUPABASE_URL && f.vars.SUPABASE_ANON_KEY) {
      return { url: normalizarUrl(f.vars.SUPABASE_URL), anonKey: f.vars.SUPABASE_ANON_KEY.trim(), origen: f.origen };
    }
  }
  return null;
}

function validarConfiguracion({ url, anonKey }) {
  const u = normalizarUrl(url);
  let host;
  try { host = new URL(u); } catch (_) { throw new ClientError('La URL de Supabase no es valida (ej: https://abcd1234.supabase.co).'); }
  const local = ['localhost', '127.0.0.1'].includes(host.hostname);
  if (host.protocol !== 'https:' && !local) throw new ClientError('La URL de Supabase debe empezar por https://');
  const k = String(anonKey || '').trim();
  // Primero la clave secreta (con su propio aviso), despues el formato: clasico (JWT
  // eyJ...) o las claves publicables nuevas (sb_publishable_...).
  if (/^sb_secret_/.test(k) || /service_role/.test(Buffer.from(k.split('.')[1] || '', 'base64').toString())) {
    throw new ClientError('Esa es la clave secreta (Secret key o service_role). Usa la clave pública: la secreta no debe ir en la app.');
  }
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k) && !/^sb_publishable_[\w-]+$/.test(k)) {
    throw new ClientError('La clave pública no parece válida. Cópiala de Supabase → Project Settings → API Keys.');
  }
  return { url: u, anonKey: k };
}

// Guarda URL y clave en el .env de la carpeta de datos (conserva otras variables).
function guardarConfiguracion(dirDatos, datos) {
  const { url, anonKey } = validarConfiguracion(datos);
  const ruta = path.join(dirDatos, ARCHIVO_ENV);
  const vars = { ...leerEnv(ruta), SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey };
  fs.mkdirSync(dirDatos, { recursive: true });
  const texto = '# Habbo Inventario — conexion con Supabase\n' +
    Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ruta, texto);
  return { url, anonKey, origen: ruta };
}

// Almacen de sesion para supabase-js en un archivo (opcionalmente cifrado).
function almacenSesion(ruta, cifrado = null) {
  const leer = () => {
    try {
      const crudo = fs.readFileSync(ruta, 'utf8');
      const obj = JSON.parse(crudo);
      if (obj && obj.cifrado && cifrado) return JSON.parse(cifrado.descifrar(obj.datos));
      if (obj && obj.cifrado) return {};   // cifrado en otra maquina/usuario: se ignora
      return obj || {};
    } catch (_) { return {}; }
  };
  const escribir = (obj) => {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const texto = JSON.stringify(obj);
    const contenido = cifrado ? JSON.stringify({ cifrado: true, datos: cifrado.cifrar(texto) }) : texto;
    fs.writeFileSync(ruta, contenido);
  };
  return {
    getItem: (clave) => { const v = leer()[clave]; return v === undefined ? null : v; },
    setItem: (clave, valor) => { const o = leer(); o[clave] = valor; escribir(o); },
    removeItem: (clave) => { const o = leer(); delete o[clave]; escribir(o); },
  };
}

const ESPERA_SUPABASE_MS = 25000;

// fetch con tiempo maximo. Si ya viene una senal (una cancelacion pedida), tambien la
// respeta. El reloj no retiene el proceso (unref).
function fetchConEspera(ms, fetchBase = globalThis.fetch) {
  return function (recurso, init = {}) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => {
      const e = new Error(`Supabase no respondió en ${Math.round(ms / 1000)} s.`);
      e.name = 'AbortError';
      e.codigo = 'SUPABASE_SIN_RESPUESTA';
      ctrl.abort(e);
    }, ms);
    if (reloj.unref) reloj.unref();
    if (init.signal) {
      if (init.signal.aborted) ctrl.abort(init.signal.reason);
      else init.signal.addEventListener('abort', () => ctrl.abort(init.signal.reason), { once: true });
    }
    return fetchBase(recurso, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(reloj));
  };
}

// `sinSesion`: cliente solo con la clave publica (rol anon), que no lee ni guarda la
// sesion del archivo.
function crearClienteSupabase({ url, anonKey, dirDatos, cifrado = null, sinSesion = false }) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, anonKey, {
    auth: sinSesion ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } : {
      storage: almacenSesion(path.join(dirDatos, ARCHIVO_SESION), cifrado),
      storageKey: 'habbo-inventario',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { headers: { 'X-Client-Info': 'habbo-inventario' }, fetch: fetchConEspera(ESPERA_SUPABASE_MS) },
  });
}

module.exports = { leerConfiguracion, validarConfiguracion, guardarConfiguracion, crearClienteSupabase, parsearEnv, normalizarUrl, ARCHIVO_SESION, fetchConEspera, ESPERA_SUPABASE_MS };
