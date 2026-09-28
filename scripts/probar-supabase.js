#!/usr/bin/env node
// scripts/probar-supabase.js — comprueba tu proyecto REAL de Supabase paso a paso.
//
//   npm run supabase:probar
//   npm run supabase:probar -- --token hbi_xxx   (prueba ademas el token de un sniper)
//
// Revisa: que el .env tenga URL y Anon Key, que el proyecto responda, que el esquema
// este instalado, que la clave anon NO pueda leer tus datos y, si hay sesion guardada
// (o SUPABASE_EMAIL/SUPABASE_PASSWORD en el .env), que tu usuario entre y lea la tasa.
// No escribe nada en la base de datos.

const fs = require('fs');
const path = require('path');
const { leerConfiguracion, crearClienteSupabase, parsearEnv } = require('../backend/db/supabase');
const { RAIZ, DIR_DATOS_DEV } = require('./comun');

const args = process.argv.slice(2);
const token = args[args.indexOf('--token') + 1] && args.includes('--token') ? args[args.indexOf('--token') + 1] : null;
let fallos = 0;
const ok = (m) => console.log('  ✔ ' + m);
const mal = (m) => { fallos++; console.log('  ✘ ' + m); };

function credenciales() {
  const leer = (r) => { try { return parsearEnv(fs.readFileSync(r, 'utf8')); } catch (_) { return {}; } };
  const v = { ...leer(path.join(DIR_DATOS_DEV, '.env')), ...leer(path.join(RAIZ, '.env')), ...process.env };
  return v.SUPABASE_EMAIL && v.SUPABASE_PASSWORD ? { email: v.SUPABASE_EMAIL, password: v.SUPABASE_PASSWORD } : null;
}

async function main() {
  console.log('\nHabbo Inventario — prueba de Supabase\n');
  const config = leerConfiguracion({ raiz: RAIZ, dirDatos: DIR_DATOS_DEV });
  if (!config) {
    mal('No encontre SUPABASE_URL y SUPABASE_ANON_KEY. Copia .env.example como .env y completalo.');
    return;
  }
  ok(`Configuracion leida de ${config.origen}: ${config.url}`);
  const cliente = crearClienteSupabase({ ...config, dirDatos: DIR_DATOS_DEV });

  const r = await cliente.rpc('estado_sniper', { p_token: 'hbi_token_de_prueba_invalido' });
  if (r.error && r.error.code === 'PT401') ok('El proyecto responde y el esquema esta instalado (funciones del sniper presentes).');
  else if (r.error && /PGRST202|42883/.test(r.error.code || '')) { mal('Falta instalar el esquema: pega supabase/migrations/*.sql en el SQL Editor de Supabase.'); return; }
  else if (r.error) { mal(`Respuesta inesperada: ${r.error.message} (${r.error.code || 'sin codigo'}). ¿URL y Anon Key correctas?`); return; }
  else mal('Un token inventado fue aceptado: revisa que el esquema sea el de este proyecto.');

  const anon = await cliente.from('furnis').select('id').limit(1);
  if (anon.error && anon.error.code === '42501') ok('La clave anon NO puede leer tus datos (RLS y permisos correctos).');
  else mal('La clave anon pudo consultar la tabla furnis. Vuelve a correr el SQL del esquema completo.');

  let sesion = (await cliente.auth.getSession()).data.session;
  if (!sesion && credenciales()) {
    const e = await cliente.auth.signInWithPassword(credenciales());
    if (e.error) mal('No se pudo entrar con SUPABASE_EMAIL/SUPABASE_PASSWORD: ' + e.error.message);
    sesion = e.data && e.data.session;
  }
  if (sesion) {
    const t = await cliente.from('v_tasa').select('tasa').single();
    if (t.error) mal('Sesion iniciada pero no se pudo leer v_tasa: ' + t.error.message);
    else ok(`Sesion de ${sesion.user.email}: lectura OK (tasa del Lingo = ${t.data.tasa}).`);
  } else {
    console.log('  – Sin sesion: inicia sesion una vez en la app (npm start) para probar la lectura de datos.');
  }

  if (token) {
    const s = await cliente.rpc('estado_sniper', { p_token: token });
    if (s.error) mal(`El token del sniper no funciona: ${s.error.message}`);
    else ok(`Token del sniper valido ("${s.data.token}"), ${s.data.pendientes} compra(s) por revisar.`);
  }
}

main()
  .catch((e) => { fallos++; console.error('  ✘ Error: ' + e.message); })
  .finally(() => {
    console.log(fallos ? `\n${fallos} problema(s). Revisa los puntos marcados con ✘.\n` : '\nTodo en orden.\n');
    process.exit(fallos ? 1 : 0);
  });
