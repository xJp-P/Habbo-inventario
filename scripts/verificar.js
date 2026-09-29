#!/usr/bin/env node
// scripts/verificar.js — pruebas de la logica, la seguridad y la API, SIN nube.
//
//   npm run verificar
//
// Levanta Postgres local (PGlite) con el MISMO esquema de supabase/migrations y corre
// la app completa contra el: dos usuarios (para probar que RLS los aisla), la clave
// anon (lo unico que ve un sniper), el registro de compras del Sniper con token, los
// eventos unificados del Sniper (compra, publicar, recuperar con FIFO), los lotes
// huerfanos, la venta parcial, la comision del mercadillo (la funcion JS de la interfaz
// contra la de la base), la importacion de Excel (con una planilla de prueba que genera
// aqui), el asistente de configuracion, el aviso en tiempo real y las barreras de la API
// local. No toca tu Supabase ni tus datos.

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { crearApp } = require('../backend/server');
const { crearClienteLocal } = require('../backend/db/clienteLocal');
const { crearServicioConexion, datosParaSniper } = require('../backend/services/conexion');
const { crearServicioNegocio } = require('../backend/services/negocio');
const { crearServicioFurnidata } = require('../backend/services/furnidata');
const ExcelJS = require('exceljs');
const { leerExcel, importarDatos } = require('../backend/services/importarExcel');
const { crearServicioInstalacion, MIGRACIONES } = require('../backend/services/instalacion');
const { validarConfiguracion, leerConfiguracion } = require('../backend/db/supabase');
const { normalizar } = require('../backend/core/util');
const { DIR_DATOS_DEV } = require('./comun');

let pasos = 0;
function ok(msg) { pasos++; console.log('  ok  ' + msg); }
const cerca = (a, b) => Math.abs(a - b) < 1e-9;
async function rechaza(promesa, patron) {
  await assert.rejects(promesa, (e) => { assert.match(e.message, patron); return true; });
}

// Peticion HTTP cruda (permite forzar Host, Origin y Content-Type para las pruebas).
function pedir(puerto, metodo, ruta, { cuerpo, crudo, tipo, host, origin } = {}) {
  return new Promise((resolve, reject) => {
    const datos = crudo !== undefined ? crudo : cuerpo !== undefined ? JSON.stringify(cuerpo) : null;
    const headers = { Host: host || `127.0.0.1:${puerto}` };
    if (datos !== null) {
      headers['Content-Type'] = tipo || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(datos);
    }
    if (origin) headers.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(partes);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch (_) { /* no es JSON */ }
        resolve({ status: res.statusCode, json, bytes: buf.length });
      });
    });
    req.on('error', reject);
    if (datos !== null) req.write(datos);
    req.end();
  });
}

function esperarEvento(puerto, tipo, ms = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: puerto, path: '/api/eventos' }, (res) => {
      let buf = '';
      const t = setTimeout(() => { req.destroy(); reject(new Error('No llego el evento ' + tipo)); }, ms);
      res.on('data', (c) => {
        buf += c;
        const m = new RegExp(`event: ${tipo}\\ndata: (.+)\\n\\n`).exec(buf);
        if (m) { clearTimeout(t); req.destroy(); resolve(JSON.parse(m[1])); }
      });
    });
    req.on('error', () => {});
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habbo-inventario-'));
  const cache = path.join(DIR_DATOS_DEV, 'furnidata-es.json');
  if (fs.existsSync(cache)) fs.copyFileSync(cache, path.join(dir, 'furnidata-es.json'));

  // ── Empaquetado: lo que la app instalada necesita para actualizarse ──
  // electron-builder quita "build" del package.json que va dentro de la app: leerlo en
  // tiempo de ejecucion rompe el arranque de la app instalada.
  const paquete = require('../package.json');
  const codigoElectron = fs.readdirSync(path.join(__dirname, '..', 'electron')).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'electron', f), 'utf8'));
  assert.ok(codigoElectron.every((c) => !/paquete\.build|package\.json'\)\.build/.test(c)), 'electron/ no lee "build" del package.json');
  const actualizador = fs.readFileSync(path.join(__dirname, '..', 'electron', 'actualizaciones.js'), 'utf8');
  const { owner, repo } = paquete.build.publish;
  assert.ok(actualizador.includes(`{ owner: '${owner}', repo: '${repo}' }`), 'el actualizador apunta al repositorio de build.publish');
  assert.ok(actualizador.includes('`' + paquete.build.mac.artifactName.replace('${ext}', 'zip') + '`'), 'el .zip de Mac tiene el nombre que genera electron-builder');
  ok(`empaquetado: el actualizador apunta a ${owner}/${repo} y al .zip de Mac que genera electron-builder`);

  // ── Workflow de GitHub: publicar el borrador no dispara una segunda compilacion fallida ──
  // Al publicar el borrador, GitHub crea la etiqueta v<version> y el workflow corre otra vez:
  // el trabajo `revisar` debe cortarlo en verde, antes de compilar Windows y Mac.
  const flujo = require('js-yaml').load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8'));
  const revisarFlujo = flujo.jobs.revisar.steps.map((p) => p.run || '').join('\n');
  for (const so of ['windows', 'mac']) {
    assert.equal(flujo.jobs[so].needs, 'revisar', `${so} espera a revisar la version`);
    assert.equal(flujo.jobs[so].if, "needs.revisar.outputs.compilar == 'true'", `${so} no compila si la version ya esta publicada`);
  }
  assert.deepEqual(flujo.jobs.publicar.needs, ['windows', 'mac']);
  assert.ok(/releases\/tags\/\$TAG/.test(revisarFlujo) && /compilar=false/.test(revisarFlujo) && /compilar=true/.test(revisarFlujo),
    'revisar pregunta por el Release publicado de esa etiqueta y decide si compilar');
  assert.ok(/--paginate/.test(flujo.jobs.publicar.steps.map((p) => p.run || '').join('\n')), 'los borradores se buscan en todas las paginas');
  ok('workflow: la etiqueta que crea GitHub al publicar el borrador ya no recompila ni falla; una version ya publicada se detecta antes de compilar');

  // ── Notificaciones: cuando avisar (backend/core/avisos.js) ──
  const { crearDetectorAuditoria, avisoCatalogo } = require('../backend/core/avisos');
  let reloj = 0;
  const det = crearDetectorAuditoria({ ahora: () => reloj });
  const filaA = (sprite, categoria, diferencia) => ({ sprite_id: sprite, tipo: 'suelo', categoria, diferencia });
  det.base('K', [filaA(1, 'sobrante', 2)]);
  assert.equal(det.revisar('K', [filaA(1, 'sobrante', 2)]), null, 'lo que ya habia al abrir la app no se avisa');
  let avA = det.revisar('K', [filaA(1, 'sobrante', 2), filaA(2, 'faltante', -1), filaA(3, 'no_registrado', 5)]);
  assert.deepEqual([avA.nuevas, avA.pendientes, avA.silencioso, avA.titulo], [1, 2, false, 'Auditoría de K']);
  assert.equal(avA.cuerpo, '1 furni tiene una diferencia nueva en tu inventario de Habbo (1 con faltantes). Haz clic para revisarlas.');
  assert.equal(det.revisar('K', [filaA(1, 'sobrante', 1), filaA(2, 'faltante', -1)]), null, 'resolver o achicar una diferencia no avisa');
  reloj = 60 * 1000;
  avA = det.revisar('K', [filaA(1, 'sobrante', 3), filaA(2, 'faltante', -1), filaA(4, 'ltd', 0)]);
  assert.deepEqual([avA.nuevas, avA.silencioso], [2, true], 'crecio un sobrante y hay un LTD nuevo; al minuto del aviso anterior, sin sonido');
  assert.match(avA.cuerpo, /^2 furnis tienen diferencias nuevas .*\(1 con sobrantes y 1 LTD con otro número\)/);
  reloj = 10 * 60 * 1000;
  assert.equal(det.revisar('K', [filaA(1, 'sobrante', 3)]), null);
  assert.equal(det.revisar('K', [filaA(1, 'sobrante', 3), filaA(2, 'faltante', -2)]).silencioso, false);
  assert.equal(avisoCatalogo({ anterior: null, version: 'b', nuevos: 5 }), null, 'la primera descarga del catalogo no avisa');
  assert.equal(avisoCatalogo({ anterior: 'a', version: 'b', nuevos: 0 }), null, 'una version sin furnis nuevos no avisa');
  assert.equal(avisoCatalogo({ anterior: 'a', version: 'b', nuevos: 3 }).cuerpo, '3 furnis nuevos llegaron al catálogo. Ya puedes buscarlos en la app.');
  ok('avisos: solo diferencias nuevas de la Auditoria (no lo que ya habia, ni al resolver; seguidas, sin sonido) y catalogos con furnis nuevos');

  // ── Notificaciones del sistema (electron/notificaciones.js, con piezas falsas) ──
  const notif = require('../electron/notificaciones');
  assert.equal(notif.APP_ID, paquete.build.appId, 'el AUMID de Windows es el appId que el instalador pone en el acceso directo');
  const dirPref = fs.mkdtempSync(path.join(os.tmpdir(), 'habbo-pref-'));
  const pref = notif.crearPreferencias(dirPref);
  assert.deepEqual(pref.leer(), { inventario: true, catalogo: true }, 'encendidas si nunca se tocaron');
  assert.deepEqual(pref.guardar({ catalogo: false, inventario: 'si', raro: true }), { inventario: true, catalogo: false });
  assert.deepEqual(notif.crearPreferencias(dirPref).leer(), { inventario: true, catalogo: false }, 'quedan guardadas en la carpeta de datos');
  class NotificacionFalsa {
    constructor(o) { this.o = o; this.manejadores = {}; NotificacionFalsa.creadas.push(this); }
    static isSupported() { return true; }
    on(evento, cb) { this.manejadores[evento] = cb; return this; }
    show() { this.mostrada = true; }
  }
  NotificacionFalsa.creadas = [];
  const ventanaFalsa = {
    llamadas: [], min: false, foco: true,
    isDestroyed() { return false; }, isVisible() { return true; }, isMinimized() { return this.min; }, isFocused() { return this.foco; },
    restore() { this.llamadas.push('restore'); this.min = false; }, show() { this.llamadas.push('show'); }, focus() { this.llamadas.push('focus'); },
  };
  const abiertos = [];
  const avisador = notif.crearNotificaciones({ Notification: NotificacionFalsa, ventana: () => ventanaFalsa, preferencias: pref, alAbrir: (d) => abiertos.push(d) });
  const evAud = { tipo: 'auditoria', avisos: [{ keko: 'Un keko con un nombre muy largo', titulo: 'Auditoría de Un keko', cuerpo: 'Hay algo nuevo', silencioso: true }] };
  avisador.alEvento(evAud);
  assert.equal(NotificacionFalsa.creadas.length, 0, 'si estas mirando la app no sale la notificacion');
  ventanaFalsa.foco = false; ventanaFalsa.min = true;
  avisador.alEvento(evAud);
  const toast = NotificacionFalsa.creadas[0];
  assert.deepEqual([NotificacionFalsa.creadas.length, toast.o.title, toast.o.silent, toast.mostrada, avisador.vivas()], [1, 'Auditoría de Un keko', true, true, 1]);
  assert.ok(toast.o.id.length <= 16 && toast.o.id === notif.idAuditoria('Un keko con un nombre muy largo'), 'un id corto y fijo por keko (el aviso nuevo reemplaza al anterior)');
  toast.manejadores.click();
  assert.deepEqual([ventanaFalsa.llamadas, abiertos, avisador.vivas()], [['restore', 'show', 'focus'], [{ vista: 'auditoria', keko: 'Un keko con un nombre muy largo' }], 0],
    'el clic restaura la ventana, la trae al frente y abre la Auditoria de ese keko');
  ventanaFalsa.min = true;
  avisador.alEvento({ tipo: 'catalogo-nuevo', titulo: 'Catálogo', cuerpo: 'Nuevo' });
  assert.equal(NotificacionFalsa.creadas.length, 1, 'el aviso del catalogo esta apagado en las preferencias');
  ventanaFalsa.min = false; ventanaFalsa.foco = true;
  assert.equal(avisador.probar(), 'mostrada', 'la de prueba sale aunque estes mirando la app');
  ok('notificaciones: AUMID = appId, solo si no estas mirando la app, respetan tus preferencias y el clic abre la Auditoria del keko');

  // ── Mac (plan B): el Dock rebota y muestra un globo con los avisos sin ver ──
  const dockFalso = { rebotes: 0, globos: [], rebotar() { this.rebotes++; }, globo(n) { this.globos.push(n); } };
  const ventanaMac = { ...ventanaFalsa, llamadas: [], min: false, foco: false };
  pref.guardar({ catalogo: true });
  const avisadorMac = notif.crearNotificaciones({ Notification: NotificacionFalsa, dock: dockFalso, ventana: () => ventanaMac, preferencias: pref });
  const creadasAntes = NotificacionFalsa.creadas.length;
  const avisoKeko = (keko, silencioso) => ({ tipo: 'auditoria', avisos: [{ keko, titulo: 'Auditoría de ' + keko, cuerpo: '…', silencioso }] });
  avisadorMac.alEvento(avisoKeko('KekoA', false));
  avisadorMac.alEvento(avisoKeko('KekoA', true));
  avisadorMac.alEvento(avisoKeko('KekoB', false));
  avisadorMac.alEvento({ tipo: 'catalogo-nuevo', titulo: 'Catálogo', cuerpo: 'Nuevo' });
  assert.deepEqual([dockFalso.rebotes, dockFalso.globos, NotificacionFalsa.creadas.length], [3, [1, 1, 2, 3], creadasAntes],
    'sin notificacion del sistema: rebota (el aviso repetido del mismo keko, sin rebote) y el globo cuenta los avisos sin ver');
  avisadorMac.alActivar();
  assert.deepEqual([ventanaMac.llamadas, dockFalso.globos[dockFalso.globos.length - 1], avisadorMac.sinVer()], [['show', 'focus'], 0, 0],
    'clic en el Dock: la ventana vuelve al frente y el globo desaparece');
  avisadorMac.alEvento(avisoKeko('KekoA', false));
  avisadorMac.alVolver();
  assert.equal(dockFalso.globos[dockFalso.globos.length - 1], 0, 'volver a la app (la ventana toma el foco) tambien lo borra');
  ventanaMac.foco = true;
  const globosAntes = dockFalso.globos.length;
  avisadorMac.alEvento(avisoKeko('KekoC', false));
  assert.equal(dockFalso.globos.length, globosAntes, 'si estas mirando la app, el Dock no hace nada');
  ok('notificaciones en Mac (plan B): el Dock rebota y su globo cuenta los avisos sin ver; al volver a la app o hacer clic en el Dock, el globo desaparece');

  // ── Ventana de novedades (como Proyecto_Cartera) ──
  const { CHANGELOGS } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'datos', 'changelogs.js')).href);
  const nov = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'novedades.js')).href);
  const mayorQue = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  if (mayorQue(paquete.version, '1.2.0')) assert.ok(CHANGELOGS[paquete.version], `la version ${paquete.version} necesita sus novedades en public/js/datos/changelogs.js`);
  for (const [version, items] of Object.entries(CHANGELOGS)) {
    assert.ok(Array.isArray(items) && items.length && items.every((t) => typeof t === 'string' && t.trim()), `novedades ${version}: lista de textos`);
    const tecnico = items.find((t) => /\b(SQL|JSON|endpoint|RPC|Supabase|API|payload|backend|frontend|FIFO)\b|migraci|servidor|base de datos/i.test(t));
    assert.equal(tecnico, undefined, `novedades ${version}: sin tecnicismos («${tecnico}»)`);
  }
  assert.deepEqual(nov.novedadesAMostrar({ version: '1.3.0', vista: '1.2.0', changelogs: CHANGELOGS }), { version: '1.3.0', items: CHANGELOGS['1.3.0'] }, 'tras actualizar se muestran');
  assert.ok(nov.novedadesAMostrar({ version: '1.3.0', vista: null, changelogs: CHANGELOGS }), 'sin ninguna vista (primer arranque) tambien, como en Cartera');
  assert.equal(nov.novedadesAMostrar({ version: '1.3.0', vista: '1.3.0', changelogs: CHANGELOGS }), null, 'una sola vez por version');
  assert.equal(nov.novedadesAMostrar({ version: '9.9.9', vista: '1.3.0', changelogs: CHANGELOGS }), null, 'sin entrada para esa version no hay ventana');
  assert.deepEqual([nov.previsualizacionPedida('?novedades'), nov.previsualizacionPedida('?a=1&novedades=1.3.0'), nov.previsualizacionPedida('?novedadesx'), nov.previsualizacionPedida('')], [true, '1.3.0', null, null]);
  assert.equal(nov.novedadesAMostrar({ version: '1.2.0', vista: '1.2.0', forzar: true, changelogs: CHANGELOGS }).version, nov.ultimaVersionConNovedades(CHANGELOGS),
    'previsualizar sin entrada para la version que corre muestra la mas reciente');
  assert.equal(nov.novedadesAMostrar({ version: '1.3.0', vista: '1.3.0', forzar: '1.3.0', changelogs: CHANGELOGS }).version, '1.3.0', 'o la que se pida');
  ok('novedades: cada version publicada despues de la 1.2.0 trae las suyas, sin tecnicismos; salen una vez tras actualizar y ?novedades las previsualiza');

  // ── URL del proyecto: el panel de Supabase a veces la muestra con /rest/v1/ ──
  const claveEjemplo = 'sb_publishable_' + 'x'.repeat(24);
  for (const [entrada, esperada] of [
    ['https://abcd1234.supabase.co/rest/v1/', 'https://abcd1234.supabase.co'],
    ['  https://abcd1234.supabase.co/  ', 'https://abcd1234.supabase.co'],
    ['https://abcd1234.supabase.co/auth/v1', 'https://abcd1234.supabase.co'],
    ['http://127.0.0.1:54321/rest/v1/', 'http://127.0.0.1:54321'],
  ]) {
    assert.equal(validarConfiguracion({ url: entrada, anonKey: claveEjemplo }).url, esperada, entrada);
  }
  const dirEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'habbo-env-'));
  fs.writeFileSync(path.join(dirEnv, '.env'), `SUPABASE_URL=https://abcd1234.supabase.co/rest/v1/\nSUPABASE_ANON_KEY=${claveEjemplo}\n`);
  if (!process.env.SUPABASE_URL) assert.equal(leerConfiguracion({ raiz: null, dirDatos: dirEnv }).url, 'https://abcd1234.supabase.co', 'un .env ya guardado con /rest/v1/ tambien se corrige');
  fs.rmSync(dirEnv, { recursive: true, force: true });
  ok('URL del proyecto: acepta la que muestra el panel con /rest/v1/ (u otra ruta de servicio) y deja solo la base');

  // ── Ajustes → Conexion con SniperMercadillo: los mismos datos que pide el Sniper ──
  assert.deepEqual(datosParaSniper({ url: 'https://abcd1234.supabase.co', anonKey: claveEjemplo }), {
    url_proyecto: 'https://abcd1234.supabase.co',
    clave_publica: claveEjemplo,
    url_eventos: 'https://abcd1234.supabase.co/rest/v1/rpc/registrar_eventos_sniper',
    url_estado: 'https://abcd1234.supabase.co/rest/v1/rpc/estado_sniper',
  });
  assert.deepEqual(datosParaSniper({ url: 'local', anonKey: 'local' }), { url_proyecto: null, clave_publica: null, url_eventos: null, url_estado: null });
  assert.deepEqual(datosParaSniper(null).url_proyecto, null);
  ok('conexion del Sniper: la tarjeta da la URL del proyecto y la clave publica tal como las pide su ⚙️ Ajustes (la ruta completa queda para el ejemplo)');

  // ── Base: Postgres local con el esquema de Supabase y dos usuarios ──
  const clienteA = await crearClienteLocal();
  await clienteA.crearUsuario('ana@prueba.local', 'clave-ana');
  await clienteA.crearUsuario('beto@prueba.local', 'clave-beto');
  assert.equal((await clienteA.auth.signInWithPassword({ email: 'ana@prueba.local', password: 'clave-mala' })).error.message, 'Invalid login credentials');
  await clienteA.auth.signInWithPassword({ email: 'ana@prueba.local', password: 'clave-ana' });
  const anon = clienteA.comoAnon();
  ok('esquema de supabase/migrations instalado en Postgres local; login con usuario y contraseña');

  // ── Comision del mercadillo: la funcion de la interfaz y la de la base ──
  const comision = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'comision.js')).href);
  for (const [precio, com, neto] of [[2, 1, 1], [150, 4, 146], [2500, 58, 2442], [99999, 14500, 85499]]) {
    assert.equal(comision.calcularComision(precio), com, `comision de ${precio}`);
    assert.equal(comision.calcularGananciaNeta(precio, 0), neto, `neto de ${precio}`);
  }
  assert.equal(comision.calcularGananciaNeta(150, 100), 46);
  ok('comision exacta (JS): 2 -> 1 (neto 1), 150 -> 4 (neto 146), 2500 -> 58 (neto 2442), 99999 -> 14500 (neto 85499)');
  for (const [neto, lista] of [[1, 2], [146, 150], [2442, 2500], [85499, 99999]]) {
    assert.equal(comision.calcularPrecioLista(neto), lista, `precio de lista para recibir ${neto}`);
  }
  for (let n = 1; n <= 150000; n++) {
    const p = comision.calcularPrecioLista(n);
    if (p - comision.calcularComision(p) !== n || (p - 1) - comision.calcularComision(p - 1) >= n) assert.fail(`neto ${n}: lista ${p} no es la menor que lo deja exacto`);
  }
  ok('al reves (casilla "Ingresar precio neto"): 1 -> 2, 146 -> 150, 2442 -> 2500, 85499 -> 99999; exacto y el menor posible de 1 a 150.000');
  const barrido = (await clienteA.pg.query(
    'select p::int as p, public.comision_mercadillo(p)::int as c from generate_series(0, 200000) p order by p')).rows;
  assert.equal(barrido.length, 200001);
  for (const x of barrido) {
    if (x.c !== comision.calcularComision(x.p)) assert.fail(`SQL y JS difieren en ${x.p}: ${x.c} vs ${comision.calcularComision(x.p)}`);
  }
  const costos = [0, 0.5, 1, 24.84, 99.2, 146, 2442, 85499, 123456.7, 192080, 192081];
  for (let c = 3; c < 150000; c += 997) costos.push(c, c + 0.37);
  const minimos = (await clienteA.pg.query(
    'select c::float8 as c, public.precio_minimo_mercadillo(c)::float8 as p from unnest($1::numeric[]) c', [costos])).rows;
  assert.equal(minimos.length, costos.length);
  for (const x of minimos) {
    const js = comision.precioMinimoSinPerder(x.c);
    assert.equal(x.p, js, `precio minimo para costo ${x.c}`);
    if (js !== null && js > 0) {
      assert.ok(js - comision.calcularComision(js) >= x.c && (js - 1) - comision.calcularComision(js - 1) < x.c, `minimo exacto para ${x.c}`);
    }
  }
  assert.equal(comision.precioMinimoSinPerder(85499), 99999);
  assert.equal(comision.precioMinimoSinPerder(192081), null);
  ok('la base (comision_mercadillo) cobra lo mismo que la interfaz de 0 a 200.000 cr; precio minimo identico y exacto');

  const { app, negocio, furnidata, cerrar } = await crearApp({ dirDatos: dir, clienteFijo: clienteA, log: () => {} });
  assert.ok(furnidata.estado().disponible, 'El catalogo de Habbo.es deberia estar disponible');
  ok(`catalogo Habbo.es cargado (${furnidata.estado().total} furnis)`);

  // ── El catalogo se revisa solo cada vez que se abre la app ──
  if (fs.existsSync(path.join(dir, 'furnidata-es.json'))) {
    const dirCat = fs.mkdtempSync(path.join(os.tmpdir(), 'habbo-catalogo-'));
    fs.copyFileSync(path.join(dir, 'furnidata-es.json'), path.join(dirCat, 'furnidata-es.json'));
    const cat = crearServicioFurnidata({ dirDatos: dirCat });
    const est0 = await cat.iniciar();
    assert.ok(est0.disponible && est0.actualizando, 'con el catalogo guardado abre al instante y busca novedades en segundo plano');
    await cat.actualizar().catch(() => {});
    assert.equal(cat.estado().actualizando, false);
    cat.detener();
    ok('catalogo: al abrir la app se usa el guardado y se busca uno nuevo en segundo plano, sin pulsar nada');
  }

  // ── Seguridad: la clave anon no ve nada ──
  for (const t of ['furnis', 'compras', 'config', 'tokens_sniper', 'v_furnis', 'v_compras']) {
    const r = await anon.from(t).select('*');
    assert.equal(r.error && r.error.code, '42501', `anon no deberia leer ${t}`);
  }
  assert.equal((await anon.rpc('vender_lote', { p_id: 1 })).error.code, '42501');
  ok('la clave anon no puede leer ni una tabla ni usar las funciones de la app');

  // ── Nombres oficiales ──
  await rechaza(negocio.crearFurni({ nombre: 'Alas Brillante' }), /Quisiste decir "Alas Brillantes"/);
  const cara = await negocio.crearFurni({ nombre: 'cara con cicatrices' });
  assert.equal(cara.nombre, 'Cara con Cicatrices');
  assert.equal(cara.classname, 'clothing_r26_scarface');
  assert.equal(cara.estado, 'sin_compras');
  await rechaza(negocio.crearFurni({ nombre: 'Cara con Cicatrices' }), /ya esta en el Mercadillo/);
  ok('nombres oficiales de Habbo.es: sugiere, corrige y no deja repetir');

  // ── Lotes y calculos: lo que esta en mano solo tiene costo ──
  const lote = await negocio.crearCompra({ furni_id: cara.id, cantidad: 17, moneda_compra: 'creditos', precio_compra: 24 });
  await negocio.crearCompra({ nombre: 'Cara con Cicatrices', cantidad: 2, precio_compra: 32 });
  let f = await negocio.furniPorId(cara.id);
  assert.equal(f.stock, 19);
  assert.equal(f.inversion_cr, 17 * 24 + 2 * 32);
  assert.ok(cerca(f.costo_promedio_cr, 472 / 19));
  assert.equal(f.compra_min_cr, 24);
  assert.equal(f.compra_max_cr, 32);
  assert.equal(f.precio_minimo_cr, 26, 'a 25 la comision (1) deja 24 < 24,84: el minimo es 26');
  assert.equal(f.estado, 'en_venta');
  assert.equal(f.ganancia_esperada_cr, null, 'lo en mano no tiene ganancia esperada');
  assert.equal(f.en_perdida, false);
  const enManoCara = (await negocio.listarCompras()).filter((c) => c.furni_id === cara.id);
  assert.ok(enManoCara.every((c) => c.precio_venta_cr === null && c.ganancia_cr === null && c.margen === null && c.comision_cr === null),
    'un lote en mano no tiene precio, ganancia, margen ni comision');
  let r0 = await negocio.resumen();
  assert.equal(r0.publicado.ganancia_cr, 0);
  assert.equal(r0.en_mano.unidades, 19);
  assert.equal(r0.en_mano.costo_cr, 472);
  assert.equal(r0.datos.perdidas.length, 0);
  ok('lo en mano solo tiene costo: stock 19, costo promedio 24,84, compra mas barata/cara, precio minimo 26; sin ganancia esperada ni perdida');

  // ── La ganancia esperada sale SOLO de lo publicado ──
  await rechaza(negocio.publicarFurni(cara.id, {}), /Falta el precio de lista/);
  await negocio.publicarFurni(cara.id, { cantidad: 5, precio_lista: 30 });
  f = await negocio.furniPorId(cara.id);
  assert.equal(f.ganancia_esperada_cr, 5 * (29 - 24));
  assert.equal(f.comision_esperada_cr, 5);
  assert.equal(f.costo_publicado_cr, 24);
  assert.equal(f.en_perdida, false);
  assert.equal(comision.resumenPublicado((await negocio.listarCompras()).filter((c) => c.furni_id === cara.id)).ganancia, f.ganancia_esperada_cr);
  r0 = await negocio.resumen();
  assert.equal(r0.publicado.unidades, 5);
  assert.equal(r0.publicado.ganancia_cr, 25, 'solo lo publicado aporta ganancia esperada');
  assert.equal(r0.publicado.comision_cr, 5);
  assert.equal(r0.en_mano.unidades, 14);
  assert.equal(r0.stock.unidades, 19);
  assert.equal(r0.stock.costo_cr, 472);
  await negocio.retirarFurni(cara.id, {});
  await negocio.publicarFurni(cara.id, { cantidad: 2, precio_lista: 24 });
  f = await negocio.furniPorId(cara.id);
  assert.equal(f.ganancia_esperada_cr, 2 * (23 - 24));
  assert.equal(f.en_perdida, true, 'a 24 de lista entran 23: no cubre lo que costo');
  r0 = await negocio.resumen();
  assert.deepEqual(r0.datos.perdidas.map((x) => x.nombre), ['Cara con Cicatrices']);
  await negocio.retirarFurni(cara.id, {});
  assert.equal((await negocio.furniPorId(cara.id)).ganancia_esperada_cr, null);
  assert.equal((await negocio.compraPorId(lote.id)).cantidad, 17);
  ok('ganancia esperada, comision y perdida solo de lo publicado: 5 a 30 cr -> +25 (5 de comision); 2 a 24 cr -> perdida; al retirar desaparecen');

  // ── Venta parcial, precio congelado, reversion ──
  await rechaza(negocio.vender(lote.id, { cantidad: 5 }), /Falta el precio de venta/);
  const v = await negocio.vender(lote.id, { cantidad: 5, precio_venta: 30 });
  assert.equal(v.dividida, true);
  assert.equal(v.original.cantidad, 12);
  assert.equal(v.venta.cantidad, 5);
  assert.equal(v.venta.origen_id, lote.id);
  assert.equal(v.venta.precio_venta_real, 30);
  assert.equal(v.venta.ganancia_cr, 30);
  assert.equal((await negocio.furniPorId(cara.id)).n_compras, 2);
  ok('venta parcial: exige su precio (lo en mano no tiene uno); el lote de 17 queda en 12 y nace una fila "vendido" de 5 con el precio congelado');
  const r1 = await negocio.resumen();
  assert.equal(r1.vendido.retorno_cr, 150);
  assert.ok(cerca(r1.vendido.margen, 0.25));
  const rev = await negocio.revertirVenta(v.venta.id);
  assert.equal(rev.fusionada, true);
  assert.equal(rev.compra.cantidad, 17);
  ok('Resumen de ventas (ingresos 150, margen 25 %) y revertir devuelve las unidades');
  for (const c of await negocio.listarCompras()) await negocio.vender(c.id, { precio_venta: 40 });
  assert.equal((await negocio.furniPorId(cara.id)).estado, 'agotado');
  await rechaza(negocio.vender(lote.id), /ya esta vendido/);
  await rechaza(negocio.eliminarFurni(cara.id), /tiene 2 lote/);
  ok('vender todo deja "Agotado"; no deja vender dos veces ni borrar con lotes');

  // ── Lingos y tasa ──
  const corona = await negocio.crearFurni({ nombre: 'Corona de Oro de 24 kt' });
  const loteCorona = await negocio.crearCompra({ furni_id: corona.id, cantidad: 1, moneda_compra: 'lingos', precio_compra: 70 });
  await negocio.fijarTasa(60);
  assert.equal((await negocio.compraPorId(loteCorona.id)).precio_compra_cr, 4200);
  const ventaCorona = await negocio.vender(loteCorona.id, { moneda_venta: 'lingos', precio_venta: 100 });
  assert.equal(ventaCorona.venta.ganancia_cr, 1800);
  assert.ok(cerca(ventaCorona.venta.ganancia_lg, 30));
  await negocio.fijarTasa(50);
  ok('precios en Lingos se convierten con la tasa vigente (50 -> 60)');

  // ── Tokens de sniper y funcion registrar_eventos_sniper (clave anon) ──
  const tk = await negocio.crearToken('VPS de prueba 1');
  assert.match(tk.token, /^hbi_[\w-]{40,}$/);
  const lista = await negocio.listarTokens();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].token, undefined);
  assert.equal(lista[0].hash, undefined);
  ok('token de sniper: se muestra una vez; en la base solo queda su huella');

  const sniper = (eventos, token = tk.token) => anon.rpc('registrar_eventos_sniper', { token_sniper: token, eventos });
  const velo = furnidata.porClase('seaside_ltd26_sanddragon');
  const sakura = furnidata.porClase('val15_sakura');
  const compraVelo = (id, cantidad, precio, extra = {}) => ({ tipo_evento: 'compra', id_externo: id, sprite_id: velo.sprite_id, cantidad, precio, moneda: 'creditos', hotel: 'es', ...extra });
  const publicarVelo = (id, cantidad, lista) => ({ tipo_evento: 'publicar', id_externo: id, sprite_id: velo.sprite_id, cantidad, precio_lista: lista, moneda: 'creditos', hotel: 'es' });
  const recuperarVelo = (id, cantidad) => ({ tipo_evento: 'recuperar', id_externo: id, sprite_id: velo.sprite_id, cantidad, hotel: 'es' });
  const leerLote = (id) => negocio.compraPorId(id);

  let r = await sniper([compraVelo('x', 1, 5)], 'hbi_falso');
  assert.equal(r.error.code, 'PT401');
  r = await sniper([compraVelo('x', 1, 5, { hotel: 'origins' })]);
  assert.equal(r.data.procesados, 0);
  assert.match(r.data.errores[0].error, /Solo se aceptan eventos de Habbo\.es/);
  ok('token falso: 401 · un evento de otro hotel (Origins) se rechaza sin frenar el envio');

  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((res) => server.once('listening', res));
  const puerto = server.address().port;
  try {
    // ── CICLO COMPLETO: compra -> publicacion parcial del lote -> recuperacion de 1 ──
    let aviso = esperarEvento(puerto, 'eventos-sniper');
    await new Promise((res) => setTimeout(res, 150));
    r = await sniper([compraVelo('cmp_1', 5, 300, { notas: 'Costo extra: 10 diamantes' })]);
    assert.equal(r.data.procesados, 1);
    const idCompra = r.data.eventos[0].compra_id;
    let ev = await aviso;
    assert.equal(ev.compras, 1);
    let l1 = await leerLote(idCompra);
    assert.equal(l1.nombre, 'Dragón Velo de Arena', 'el furni que llego solo con sprite_id recibe su nombre oficial');
    assert.equal(l1.cantidad, 5);
    assert.equal(l1.estado, 'comprado');
    assert.equal(l1.pendiente, true);
    assert.equal(l1.notas, 'Costo extra: 10 diamantes');

    r = await sniper([publicarVelo('pub_1', 3, 360)]);
    assert.equal(r.data.procesados, 1);
    assert.equal(r.data.eventos[0].cantidad, 3);
    assert.equal(r.data.eventos[0].faltante, 0);
    const p1 = await leerLote(r.data.eventos[0].lotes[0].lote_id);
    l1 = await leerLote(idCompra);
    assert.equal(l1.cantidad, 2);
    assert.equal(l1.estado, 'comprado');
    assert.equal(p1.estado, 'publicado');
    assert.equal(p1.cantidad, 3);
    assert.equal(p1.precio_lista, 360);
    assert.equal(p1.origen_id, idCompra);
    assert.equal(p1.pendiente, false);
    assert.equal(r.data.eventos[0].precio_lista, 360, 'la respuesta devuelve el precio de lista guardado');
    assert.equal(p1.comision_cr, 8);
    assert.equal(p1.ganancia_cr, comision.calcularGananciaNeta(360, 300) * 3);
    assert.equal(p1.ganancia_cr, (352 - 300) * 3);

    r = await sniper([recuperarVelo('rec_1', 1)]);
    assert.equal(r.data.procesados, 1);
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    assert.equal((await leerLote(p1.id)).cantidad, 2);

    r = await sniper([compraVelo('cmp_1', 5, 300), publicarVelo('pub_1', 3, 360), recuperarVelo('rec_1', 1)]);
    assert.equal(r.data.duplicados, 3);
    assert.equal(r.data.procesados, 0);
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    assert.equal((await leerLote(p1.id)).cantidad, 2);
    let fv = (await negocio.listarFurnis()).find((f) => f.nombre === 'Dragón Velo de Arena');
    assert.equal(fv.stock, 5);
    assert.equal(fv.unidades_publicadas, 2);
    assert.equal(fv.unidades_pendientes, 3);
    assert.equal(fv.sprite_id, velo.sprite_id);
    assert.equal(fv.precio_lista_actual, 360, 'el furni sin precio propio expone su precio de lista');
    assert.equal(fv.moneda_lista_actual, 'creditos');
    ok('CICLO: compra de 5 -> publica 3 (el lote se divide: 2 + 3 publicados a 360) -> recupera 1 (vuelve a su lote: 3 + 2); reintentos ignorados');

    // ── FIFO entre lotes, faltante y eventos sin stock ──
    r = await sniper([compraVelo('cmp_2', 2, 280)]);
    const idCompra2 = r.data.eventos[0].compra_id;
    r = await sniper([publicarVelo('pub_2', 4, 350)]);
    const lotes2 = r.data.eventos[0].lotes;
    assert.equal(r.data.eventos[0].cantidad, 4);
    assert.deepEqual(lotes2.map((x) => [x.cantidad, x.dividido]), [[3, false], [1, true]]);
    assert.equal(lotes2[0].lote_id, idCompra, 'FIFO: primero el lote mas antiguo, entero');
    assert.equal(lotes2[1].origen_id, idCompra2, 'luego una parte del siguiente');
    assert.equal((await leerLote(idCompra)).estado, 'publicado');
    assert.equal((await leerLote(idCompra2)).cantidad, 1);
    r = await sniper([publicarVelo('pub_3', 5, '350,0')]);
    assert.equal(r.data.eventos[0].cantidad, 1);
    assert.equal(r.data.eventos[0].precio_lista, 350, 'precio_lista como texto con coma decimal');
    assert.equal(r.data.eventos[0].faltante, 4);
    r = await sniper([publicarVelo('pub_4', 1, 350)]);
    assert.equal(r.data.procesados, 0);
    assert.match(r.data.errores[0].error, /No hay stock disponible/);
    r = await sniper([publicarVelo('pub_x', 1, 'tres')]);
    assert.match(r.data.errores[0].error, /precio_lista no es un numero valido/);
    r = await sniper([{ ...publicarVelo('pub_x', 1, 0), precio_lista: undefined }]);
    assert.match(r.data.errores[0].error, /Falta precio_lista/);
    r = await sniper([compraVelo('cmp_3', 1, 250)]);
    const idCompra3 = r.data.eventos[0].compra_id;
    r = await sniper([publicarVelo('pub_4', 1, 350)]);
    assert.equal(r.data.procesados, 1, 'un evento que fallo no quedo registrado: el reintento funciona');
    assert.equal((await leerLote(idCompra3)).estado, 'publicado');
    fv = (await negocio.listarFurnis()).find((f) => f.nombre === 'Dragón Velo de Arena');
    assert.equal(fv.unidades_publicadas, 8);
    assert.equal(fv.estado, 'publicado');
    assert.equal(fv.lista_min_cr, 350);
    assert.equal(fv.lista_max_cr, 360);
    ok('FIFO entre lotes (el mas antiguo primero), faltante informado, y un evento sin stock falla sin registrarse');

    // ── Lotes publicados en la app: la venta guarda lo que entra al monedero ──
    const venta = await negocio.vender(idCompra, { cantidad: 1 });
    assert.equal(venta.venta.precio_venta_real, 342, 'sin precio explicito: lista 350 - comision 8 = 342 netos');
    assert.equal(venta.venta.comision_venta, 8);
    assert.equal(venta.venta.comision_pagada_cr, 8);
    assert.equal(venta.venta.precio_lista, 350, 'la fila vendida conserva el precio de lista');
    assert.equal(venta.venta.ganancia_cr, comision.calcularGananciaNeta(350, 300));
    assert.equal(venta.venta.ganancia_cr, 42);
    const rv = await negocio.resumen();
    assert.equal(rv.vendido.comision_cr, 8);
    assert.equal((await negocio.furniPorId(venta.venta.furni_id)).comision_pagada_cr, 8);
    assert.equal((await negocio.revertirVenta(venta.venta.id)).compra.estado, 'publicado');
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    for (const [precio, neto] of [[2, 1], [150, 146], [2500, 2442], [99999, 85499]]) {
      const v = await negocio.vender(idCompra, { cantidad: 1, precio_venta: precio });
      assert.equal(v.venta.precio_venta_real, neto, `vendido en el mercadillo a ${precio}: entran ${neto}`);
      assert.equal(v.venta.comision_venta, precio - neto);
      assert.equal(v.venta.ganancia_cr, comision.calcularGananciaNeta(precio, 300));
      await negocio.revertirVenta(v.venta.id);
    }
    const vLingos = await negocio.vender(idCompra, { cantidad: 1, moneda_venta: 'lingos', precio_venta: 8 });
    assert.equal(vLingos.venta.precio_venta_real, 8);
    assert.equal(vLingos.venta.comision_venta, null, 'en lingos no hay comision (intercambio directo)');
    await negocio.revertirVenta(vLingos.venta.id);
    const ventaTotal = await negocio.vender(idCompra3, {});
    assert.equal(ventaTotal.dividida, false);
    assert.equal(ventaTotal.venta.precio_venta_real, 342);
    const deshecha = await negocio.revertirVenta(idCompra3);
    assert.equal(deshecha.compra.estado, 'publicado');
    assert.equal(deshecha.compra.precio_venta_real, null);
    assert.equal(deshecha.compra.comision_venta, null, 'revertir borra la comision');
    ok('venta de lo publicado: guarda el NETO (350 -> 342; 2 -> 1, 150 -> 146, 2500 -> 2442, 99999 -> 85499) y la comision aparte; en lingos sin comision; revertir la limpia');

    // Una venta registrada antes de la migracion (precio bruto, sin comision) pasa a neto
    // al ejecutarla, una sola vez aunque se ejecute de nuevo.
    const vieja = await negocio.vender(idCompra, { cantidad: 1 });
    await clienteA.pg.query('update compras set precio_venta = 350, comision_venta = null where id = $1', [vieja.venta.id]);
    assert.equal((await leerLote(vieja.venta.id)).ganancia_cr, 50);
    const sqlVentaNeta = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260930000000_venta_neta_mercadillo.sql'), 'utf8');
    await clienteA.pg.exec(sqlVentaNeta);
    await clienteA.pg.exec(sqlVentaNeta);
    // Las migraciones posteriores recrean vistas y funciones: se vuelven a aplicar encima.
    const dirMig = path.join(__dirname, '..', 'supabase', 'migrations');
    for (const m of fs.readdirSync(dirMig).filter((x) => x.endsWith('.sql') && x > '20260930000000_venta_neta_mercadillo.sql').sort()) {
      await clienteA.pg.exec(fs.readFileSync(path.join(dirMig, m), 'utf8'));
    }
    const corregida = await leerLote(vieja.venta.id);
    assert.equal(corregida.precio_venta_real, 342);
    assert.equal(corregida.comision_venta, 8);
    assert.equal(corregida.ganancia_cr, 42);
    const excelVendido = (await negocio.listarCompras()).find((c) => c.estado === 'vendido' && c.precio_lista === null);
    assert.equal(excelVendido.comision_venta, null, 'lo vendido desde un lote comprado no se toca');
    await negocio.revertirVenta(vieja.venta.id);
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    ok('ventas antiguas desde Publicado: la migracion las pasa a neto (350 -> 342) una sola vez; las de lotes comprados no se tocan');
    await rechaza(negocio.actualizarCompra(idCompra, { cantidad: 9 }), /publicado en el mercadillo/);
    await rechaza(negocio.eliminarCompra(idCompra), /publicado en el mercadillo/);
    const res = await negocio.resumen();
    assert.equal(res.publicado.unidades, 8);
    assert.ok(res.stock.unidades >= 8);
    assert.equal(res.datos.furnis_publicados, 1);
    ok('lote publicado: no se edita ni se borra a mano y cuenta en el Resumen');

    // ── Furni que llega solo con sprite_id y ya existia sin sprite_id: se unen ──
    await negocio.crearCompra({ nombre: 'Árbol Sakura', cantidad: 2, precio_compra: 170 });
    aviso = esperarEvento(puerto, 'eventos-sniper');
    await new Promise((res2) => setTimeout(res2, 150));
    r = await sniper([{ tipo_evento: 'compra', id_externo: 'cmp_4', sprite_id: sakura.sprite_id, cantidad: 1, precio: 150, moneda: 'creditos', hotel: 'es' }]);
    assert.equal(r.data.procesados, 1);
    ev = await aviso;
    const furnis = await negocio.listarFurnis();
    const sak = furnis.filter((f) => f.nombre === 'Árbol Sakura');
    assert.equal(sak.length, 1);
    assert.equal(sak[0].stock, 3);
    assert.equal(sak[0].sprite_id, sakura.sprite_id);
    assert.equal(furnis.some((f) => /^Sprite \d+/.test(f.nombre)), false);
    ok('furni que llega solo con sprite_id: se une al que ya tenias (sin duplicados ni nombres provisionales)');
    const act = await negocio.activarPendientes({ furni_id: sak[0].id });
    assert.equal(act.activados, 1);
    ok('confirmar lo "por revisar" del Sniper lo pasa a en mano, sin pedir precio');

    // ── Publicar y retirar a mano (lo que ya estaba en el mercadillo, p. ej. del Excel) ──
    const lotesSak = (await negocio.listarCompras()).filter((c) => c.furni_id === sak[0].id && c.estado === 'comprado');
    const loteA = lotesSak.find((c) => c.fuente === 'manual');   // 2 und a 170
    const loteB = lotesSak.find((c) => c.fuente === 'sniper');   // 1 und a 150
    const pm = await negocio.publicarLote(loteA.id, { cantidad: 1, precio_lista: 200 });
    assert.equal(pm.dividida, true);
    assert.equal(pm.original.cantidad, 1);
    assert.equal(pm.publicado.estado, 'publicado');
    assert.equal(pm.publicado.publicado_por, 'manual');
    assert.equal(pm.publicado.precio_lista, 200);
    assert.equal(pm.publicado.moneda_lista, 'creditos');
    assert.equal(pm.publicado.origen_id, loteA.id);
    assert.equal(pm.publicado.ganancia_cr, comision.calcularGananciaNeta(200, 170));
    let rt = await negocio.retirarLote(pm.publicado.id);
    assert.equal(rt.fusionada, true);
    assert.equal((await leerLote(loteA.id)).cantidad, 2, 'retirar devuelve las unidades a su lote');
    const sinPrecio = await pedir(puerto, 'POST', `/api/compras/${loteA.id}/publicar`, { cuerpo: {} });
    assert.equal(sinPrecio.status, 400);
    assert.match(sinPrecio.json.error, /Falta el precio de lista/);
    const hp = await pedir(puerto, 'POST', `/api/compras/${loteA.id}/publicar`, { cuerpo: { precio_lista: 180 } });
    assert.equal(hp.status, 200);
    assert.equal(hp.json.dividida, false);
    assert.equal(hp.json.publicado.id, loteA.id);
    assert.equal(hp.json.publicado.precio_lista, 180);
    await rechaza(negocio.actualizarCompra(loteA.id, { cantidad: 9 }), /Retíralo primero/);
    await rechaza(negocio.eliminarCompra(loteA.id), /Retíralo primero/);
    await rechaza(negocio.publicarLote(loteA.id, { precio_lista: 10 }), /Solo se publica un lote comprado/);
    await rechaza(negocio.publicarLote(loteB.id, { cantidad: 5, precio_lista: 10 }), /Solo hay 1 unidad/);
    await rechaza(negocio.retirarLote(p1.id), /lo publico el Sniper/);
    ok('publicar a mano: exige precio de lista; una parte (el lote se divide) o todo; retirar lo devuelve; lo del Sniper no se retira desde la app');

    r = await sniper([{ tipo_evento: 'publicar', id_externo: 'pub_sak', sprite_id: sakura.sprite_id, cantidad: 1, precio_lista: 190, moneda: 'creditos', hotel: 'es' }]);
    assert.equal(r.data.procesados, 1);
    assert.equal((await leerLote(loteB.id)).publicado_por, 'sniper');
    r = await sniper([{ tipo_evento: 'recuperar', id_externo: 'rec_sak', sprite_id: sakura.sprite_id, cantidad: 1, hotel: 'es' }]);
    assert.equal(r.data.eventos[0].lotes[0].desde_lote, loteB.id, 'el Sniper recupera primero lo que publico el, aunque lo manual sea mas antiguo');
    assert.equal((await leerLote(loteA.id)).estado, 'publicado');
    const devueltoB = await leerLote(loteB.id);
    assert.equal(devueltoB.estado, 'comprado');
    assert.equal(devueltoB.publicado_por, null);
    const vm = await negocio.vender(loteA.id, { cantidad: 1 });
    assert.equal(vm.venta.precio_venta_real, 180 - comision.calcularComision(180), 'lo publicado a mano tambien se vende neto');
    assert.equal(vm.venta.publicado_por, 'manual');
    assert.equal((await negocio.revertirVenta(vm.venta.id)).compra.publicado_por, 'manual');
    rt = await negocio.retirarLote(loteA.id);
    assert.equal(rt.fusionada, false);
    assert.equal(rt.compra.estado, 'comprado');
    assert.equal(rt.compra.pendiente, false);
    assert.equal(rt.compra.precio_lista, null);
    ok('el Sniper recupera primero lo suyo; lo publicado a mano se vende neto, revertir lo deja publicado y retirar lo vuelve a Comprado');

    // ── Publicar el furni completo: todas sus unidades en mano, de todos sus lotes (FIFO) ──
    r = await sniper([{ tipo_evento: 'compra', id_externo: 'cmp_sak2', sprite_id: sakura.sprite_id, cantidad: 1, precio: 140, moneda: 'creditos', hotel: 'es' }]);
    assert.equal(r.data.procesados, 1);
    const lotesDeSak = async (estado) => (await negocio.listarCompras()).filter((c) => c.furni_id === sak[0].id && c.estado === estado);
    const pf = await negocio.publicarFurni(sak[0].id, { precio_lista: 210 });
    assert.equal(pf.cantidad, 3, 'las 3 und en mano; la "por revisar" del Sniper no entra');
    assert.equal(pf.en_mano, 0);
    assert.deepEqual(pf.lotes.map((x) => [x.lote_id, x.cantidad, x.dividido]), [[loteA.id, 2, false], [loteB.id, 1, false]]);
    assert.deepEqual((await lotesDeSak('comprado')).map((c) => c.pendiente), [true], 'en Comprado solo queda lo por revisar');
    const pubSak = await lotesDeSak('publicado');
    assert.ok(pubSak.every((c) => c.publicado_por === 'manual'));
    const rp = comision.resumenPublicado(pubSak);
    assert.equal(rp.unidades, 3);
    assert.equal(rp.manual, 3);
    assert.equal(rp.listaMin, 210);
    assert.equal(rp.ganancia, pubSak.reduce((s, c) => s + c.ganancia_cr, 0), 'el resumen del Mercadillo coincide con la vista de la base');
    assert.equal(rp.ganancia, comision.calcularGananciaNeta(210, 170) * 2 + comision.calcularGananciaNeta(210, 150));
    for (const c of pubSak) await negocio.retirarLote(c.id);
    const pf2 = await negocio.publicarFurni(sak[0].id, { cantidad: 1, precio_lista: 210 });
    assert.equal(pf2.en_mano, 2);
    assert.equal(pf2.lotes[0].origen_id, loteA.id, 'publicar menos divide el lote mas antiguo');
    assert.equal((await leerLote(loteA.id)).cantidad, 1);
    await negocio.retirarLote(pf2.lotes[0].lote_id);
    assert.equal((await leerLote(loteA.id)).cantidad, 2);
    await rechaza(negocio.publicarFurni(sak[0].id, { cantidad: 9, precio_lista: 5 }), /Solo tienes 3 unidad/);
    const hf = await pedir(puerto, 'POST', `/api/furnis/${sak[0].id}/publicar`, { cuerpo: { precio_lista: 205 } });
    assert.equal(hf.status, 200);
    assert.equal(hf.json.cantidad, 3);
    for (const c of await lotesDeSak('publicado')) await negocio.retirarLote(c.id);
    await negocio.activarPendientes({ furni_id: sak[0].id });
    assert.equal((await lotesDeSak('comprado')).reduce((s, c) => s + c.cantidad, 0), 4);
    ok('publicar el furni completo: toma sus unidades en mano de todos sus lotes (FIFO) y sale de Comprado; lo "por revisar" no entra; publicar menos divide el lote');

    // ── Desde el Mercadillo: vender y retirar lo publicado de un furni (FIFO, por precio de lista) ──
    const repartoLotes = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'lotes.js')).href);
    const loteC = (await negocio.listarCompras()).find((c) => c.id_externo === 'cmp_sak2');
    await negocio.publicarFurni(sak[0].id, { cantidad: 3, precio_lista: 210 });   // lotes A (2) y B (1)
    await negocio.publicarFurni(sak[0].id, { cantidad: 1, precio_lista: 250 });   // lote C
    const gruposSak = repartoLotes.gruposPorPrecioLista(await lotesDeSak('publicado'));
    assert.deepEqual(gruposSak.map((g) => [g.precio_lista, g.unidades]), [[210, 3], [250, 1]]);
    const previsto = repartoLotes.repartirFifo(gruposSak[0].lotes, 2).map((t) => [t.lote.id, t.toma]);
    assert.deepEqual(previsto, [[loteA.id, 2]]);
    const vf = await negocio.venderFurni(sak[0].id, { cantidad: 2, precio_lista: 210 });
    assert.deepEqual(vf.ventas.map((v) => [v.lote_id, v.cantidad]), previsto, 'la base toma los mismos lotes que muestra el modal');
    assert.equal(vf.ventas[0].precio_venta, 210 - comision.calcularComision(210), 'se guarda el neto');
    await rechaza(negocio.venderFurni(sak[0].id, { cantidad: 2, precio_lista: 210 }), /Solo hay 1 unidad/);
    const vf2 = await negocio.venderFurni(sak[0].id, { cantidad: 1, precio_venta: 230 });
    assert.equal(vf2.ventas[0].lote_id, loteB.id, 'sin precio de lista: FIFO sobre todo lo publicado');
    assert.equal(vf2.ventas[0].precio_venta, 230 - comision.calcularComision(230));
    const hv = await pedir(puerto, 'POST', `/api/furnis/${sak[0].id}/vender`, { cuerpo: { cantidad: 1, precio_lista: 250 } });
    assert.equal(hv.status, 200);
    assert.equal(hv.json.ventas[0].lote_id, loteC.id);
    for (const v of [...vf.ventas, ...vf2.ventas, ...hv.json.ventas]) await negocio.revertirVenta(v.venta_id);
    assert.equal((await lotesDeSak('publicado')).reduce((s, c) => s + c.cantidad, 0), 4);
    ok('Vendido desde el Mercadillo: elige el precio de lista y vende FIFO (los mismos lotes que muestra el modal), guardando el neto');

    let rf = await negocio.retirarFurni(sak[0].id, { cantidad: 1, precio_lista: 210 });
    assert.deepEqual(rf.lotes.map((x) => [x.desde_lote, x.cantidad]), [[loteA.id, 1]]);
    assert.equal((await leerLote(loteA.id)).cantidad, 1, 'retirar una parte divide el lote');
    assert.equal((await leerLote(rf.lotes[0].hacia_lote)).estado, 'comprado');
    rf = await negocio.retirarFurni(sak[0].id, {});
    assert.equal(rf.cantidad, 3);
    assert.equal((await lotesDeSak('publicado')).length, 0);
    assert.equal((await lotesDeSak('comprado')).reduce((s, c) => s + c.cantidad, 0), 4);
    const hr = await pedir(puerto, 'POST', `/api/furnis/${fv.id}/retirar`, { cuerpo: {} });
    assert.equal(hr.status, 400);
    assert.match(hr.json.error, /publicó el Sniper/);
    ok('Retirar desde el Mercadillo: solo lo publicado por ti, FIFO y por precio de lista; una parte divide el lote; lo del Sniper no');

    // ── Venta manual de lo que esta en mano (tradeo, o venta desde un keko sin Sniper) ──
    const loteX = (await lotesDeSak('comprado')).find((c) => c.origen_id === loteA.id);
    const vm1 = await negocio.venderEnMano(sak[0].id, { cantidad: 2, precio: 3, moneda: 'lingos' });
    assert.deepEqual(vm1.ventas.map((v) => [v.lote_id, v.cantidad]), [[loteA.id, 1], [loteB.id, 1]], 'FIFO entre los lotes en mano');
    assert.equal(vm1.comision, null);
    const vendida1 = await leerLote(vm1.ventas[0].venta_id);
    assert.equal(vendida1.precio_venta_real, 3);
    assert.equal(vendida1.moneda_venta_real, 'lingos');
    assert.equal(vendida1.comision_venta, null);
    assert.equal(vendida1.ganancia_cr, 3 * 50 - 170, 'tradeo en lingos: sin comision, a la tasa vigente');
    const vm2 = await negocio.venderEnMano(sak[0].id, { cantidad: 1, precio: 200, mercadillo: true, lote_id: loteX.id });
    assert.equal(vm2.ventas[0].lote_id, loteX.id, 'de un lote concreto');
    const vendida2 = await leerLote(vm2.ventas[0].venta_id);
    assert.equal(vendida2.precio_venta_real, 200 - comision.calcularComision(200), 'en el mercadillo de otro keko: se guarda el neto');
    assert.equal(vendida2.comision_venta, comision.calcularComision(200));
    await rechaza(negocio.venderEnMano(sak[0].id, { cantidad: 1, precio: 5, moneda: 'lingos', mercadillo: true }), /cobra en creditos/);
    await rechaza(negocio.venderEnMano(sak[0].id, { cantidad: 5, precio: 5 }), /Solo tienes 1 unidad/);
    await rechaza(negocio.venderEnMano(fv.id, { cantidad: 1, precio: 5, lote_id: idCompra }), /no esta en mano/);
    const hvm = await pedir(puerto, 'POST', `/api/furnis/${sak[0].id}/vender-en-mano`, { cuerpo: { cantidad: 1, precio: 180 } });
    assert.equal(hvm.status, 200);
    assert.equal(hvm.json.ventas[0].lote_id, loteC.id);
    for (const v of [...vm1.ventas, ...vm2.ventas, ...hvm.json.ventas]) await negocio.revertirVenta(v.venta_id);
    const enManoFinal = await lotesDeSak('comprado');
    assert.equal(enManoFinal.reduce((s, c) => s + c.cantidad, 0), 4);
    assert.ok(enManoFinal.every((c) => c.comision_venta === null && c.precio_venta_real === null));
    ok('venta manual (tradeo u otro keko): FIFO o de un lote; tradeo sin comision (creditos o lingos), mercadillo guarda el neto; revertir la deshace');

    // ── Numero de serie de los LTD ──
    const trono = await negocio.crearCompra({ nombre: 'Trono Dragón', cantidad: 1, precio_compra: 500, numero_ltd: '#45' });
    assert.equal(trono.numero_ltd, 45);
    await rechaza(negocio.crearCompra({ nombre: 'Trono Dragón', cantidad: 2, precio_compra: 500, numero_ltd: 46 }), /Un LTD es una sola unidad/);
    await rechaza(negocio.crearCompra({ nombre: 'Trono Dragón', cantidad: 1, precio_compra: 500, numero_ltd: 'abc' }), /numero LTD/);
    r = await sniper([compraVelo('cmp_ltd', 1, 900, { numero_ltd: '#77' })]);
    assert.equal(r.data.procesados, 1);
    assert.equal(r.data.eventos[0].numero_ltd, 77);
    const loteLtd = await leerLote(r.data.eventos[0].compra_id);
    assert.equal(loteLtd.numero_ltd, 77, 'v_compras expone el numero LTD');
    r = await sniper([compraVelo('cmp_ltd2', 2, 900, { numero_ltd: 78 }), compraVelo('cmp_ltd3', 1, 900, { numero_ltd: 'setenta' })]);
    assert.equal(r.data.procesados, 0);
    assert.match(r.data.errores[0].error, /Un LTD es una sola unidad/);
    assert.match(r.data.errores[1].error, /numero_ltd no valido/);
    await negocio.activarPendientes({ compra_ids: [loteLtd.id] });
    ok('numero LTD: en la compra manual ("#45") y en la del Sniper (numero_ltd "#77"); un LTD es una sola unidad; numeros invalidos se rechazan');

    const tres = await negocio.crearCompra({ nombre: 'Trono Dragón', cantidad: 3, precio_compra: 480 });
    let al = await negocio.asignarLtd(tres.id, '#12');
    assert.equal(al.separado, true, 'un lote de 3 en mano separa una unidad con el numero');
    assert.equal(al.lote.numero_ltd, 12);
    assert.equal(al.lote.cantidad, 1);
    assert.equal(al.lote.origen_id, null);
    assert.equal((await leerLote(tres.id)).cantidad, 2);
    al = await negocio.asignarLtd(al.lote.id, 13);
    assert.equal(al.separado, false);
    assert.equal(al.lote.numero_ltd, 13);
    al = await negocio.asignarLtd(al.lote.id, null);
    assert.equal(al.lote.numero_ltd, null);
    const hl = await pedir(puerto, 'PUT', `/api/compras/${al.lote.id}/ltd`, { cuerpo: { numero_ltd: 14 } });
    assert.equal(hl.status, 200);
    assert.equal(hl.json.lote.numero_ltd, 14);
    await rechaza(negocio.asignarLtd(p1.id, 5), /no esta en mano/);
    const vTrono = await negocio.vender(tres.id, { cantidad: 1, precio_venta: 600 });
    await negocio.asignarLtd(tres.id, 20);
    const rvTrono = await negocio.revertirVenta(vTrono.venta.id);
    assert.equal(rvTrono.fusionada, false, 'la venta deshecha no se une a un lote con numero LTD');
    assert.deepEqual([(await leerLote(tres.id)).numero_ltd, (await leerLote(tres.id)).cantidad], [20, 1]);
    await negocio.publicarLote(trono.id, { precio_lista: 1000 });
    const pubTrono = (await negocio.listarCompras()).filter((c) => c.furni_id === trono.furni_id && c.estado === 'publicado');
    assert.deepEqual(comision.resumenPublicado(pubTrono).ltds, [45], 'el Mercadillo sabe que LTD estan publicados');
    await negocio.retirarLote(trono.id);
    assert.equal((await leerLote(trono.id)).numero_ltd, 45, 'publicar y retirar conserva el numero');
    ok('asignar numero LTD: separa una unidad de un lote en mano, cambia o quita; lo publicado de varias no; un lote numerado no se fusiona al revertir y conserva su numero');

    // ── Auditoria del inventario de Habbo (por keko), con un usuario aparte ──
    await clienteA.crearUsuario('caro@prueba.local', 'clave-caro');
    const clienteC = clienteA.comoAnon();
    await clienteC.auth.signInWithPassword({ email: 'caro@prueba.local', password: 'clave-caro' });
    const conexC = crearServicioConexion({ eventos: new EventEmitter(), clienteFijo: clienteC });
    await conexC.iniciar();
    const negC = crearServicioNegocio({ conexion: conexC, furnidata });
    const veloC = await negC.crearCompra({ nombre: 'Dragón Velo de Arena', cantidad: 3, precio_compra: 700 });
    const caraC = await negC.crearCompra({ nombre: 'Cara con Cicatrices', cantidad: 2, precio_compra: 30, keko: 'KekoC' });
    const tronoC = await negC.crearCompra({ nombre: 'Trono Dragón', cantidad: 1, precio_compra: 500, numero_ltd: 45, keko: 'KekoC' });
    assert.deepEqual([veloC.keko, caraC.keko], [null, 'KekoC'], 'la compra manual guarda su keko (o queda sin asignar)');
    const spr = async (lote) => { const f = await negC.furniPorId(lote.furni_id); assert.ok(f.sprite_id, 'crear_compra guarda el sprite del catalogo'); return { sprite_id: f.sprite_id, tipo: f.tipo }; };
    const sV = await spr(veloC); const sCa = await spr(caraC); const sT = await spr(tronoC);
    const deco = furnidata.porClase('val15_sakura');
    const tkC = await negC.crearToken('VPS de prueba C');
    const anonC = clienteA.comoAnon();
    const enviarInv = (inventario) => anonC.rpc('auditar_inventario', { token_sniper: tkC.token, keko: 'KekoC', hotel: 'es', inventario });
    r = await enviarInv([{ ...sV, cantidad: 5 }, { ...sCa }, { ...sT, numero_ltd: '#46' },
      { sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 40 }, { nombre: 'No existe' }]);
    assert.equal(r.error, null);
    assert.deepEqual([r.data.furnis, r.data.unidades, r.data.errores.length], [4, 47, 1]);
    let audC = await negC.auditoria();
    const filaC = (sp) => audC.filas.find((x) => x.sprite_id === sp.sprite_id && x.tipo === sp.tipo);
    assert.equal(audC.keko, 'KekoC');
    assert.deepEqual([filaC(sV).categoria, filaC(sV).diferencia, filaC(sV).sin_asignar], ['sobrante', 5, 3]);
    assert.deepEqual([filaC(sCa).categoria, filaC(sCa).diferencia], ['faltante', -1]);
    assert.deepEqual([filaC(sT).categoria, filaC(sT).ltds_faltantes, filaC(sT).ltds_nuevos, filaC(sT).lotes_ltd_faltantes[0].lote_id], ['ltd', [45], [46], tronoC.id]);
    const decoC = filaC({ sprite_id: deco.sprite_id, tipo: deco.tipo });
    assert.deepEqual([decoC.categoria, decoC.diferencia, decoC.catalogo.nombre], ['no_registrado', 40, deco.nombre]);
    ok('auditoria: el Sniper envia el inventario de su keko (por sprite o nombre; errores aparte) y la app ve sobrantes, faltantes, LTD con otro numero y furnis sin registrar');

    await negC.moverAKeko({ furni_id: veloC.furni_id, cantidad: 3, desde: null, hacia: 'KekoC' });
    await negC.entradaAuditoria({ furni_id: veloC.furni_id, cantidad: 2, precio: 650, moneda: 'creditos', keko: 'KekoC' });
    await negC.venderEnMano(caraC.furni_id, { cantidad: 1, precio: 45, moneda: 'creditos', keko: 'KekoC' });
    await negC.asignarLtd(tronoC.id, 46);
    await negC.excluirDeAuditoria({ keko: 'KekoC', sprite_id: deco.sprite_id, tipo: deco.tipo, unidades: 40, habbo: 40, app: 0 });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual([audC.filas.length, audC.resumen.coinciden, audC.resumen.excluidos], [0, 3, 1], 'todo resuelto');
    assert.equal((await negC.resumenAuditoria()).pendientes, 0);
    ok('auditoria: se resuelve asignando lo sin keko, con una entrada a costo, una venta desde ese keko, corrigiendo el LTD y quitando la decoracion');

    await negC.moverAKeko({ furni_id: caraC.furni_id, cantidad: 1, desde: 'KekoC', hacia: 'KekoD' });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual([filaC(sCa).diferencia, filaC(sCa).otros], [1, [{ keko: 'KekoD', unidades: 1 }]], 'lo movido a otro keko se ofrece como «volvieron de»');
    await negC.moverAKeko({ furni_id: caraC.furni_id, cantidad: 1, desde: 'KekoD', hacia: 'KekoC' });
    r = await enviarInv([{ ...sV, cantidad: 5 }, { ...sCa }, { ...sT, ltds: [46] }, { sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 41 }]);
    audC = await negC.auditoria('KekoC');
    const sak2 = filaC({ sprite_id: deco.sprite_id, tipo: deco.tipo });
    assert.deepEqual([sak2.categoria, sak2.diferencia, sak2.exclusion_vencida], ['no_registrado', 41, true], 'si llega otra unidad, la exclusion se cae y se decide de nuevo');
    await negC.entradaAuditoria({ sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 41, precio: 0, keko: 'KekoC' });
    await negC.excluirDeAuditoria({ keko: 'KekoC', sprite_id: deco.sprite_id, tipo: deco.tipo, unidades: 0 });
    await negC.darDeBaja({ furni_id: veloC.furni_id, cantidad: 1, keko: 'KekoC' });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual(audC.filas.map((x) => [x.sprite_id, x.categoria, x.diferencia]), [[sV.sprite_id, 'sobrante', 1]], 'la baja borra unidades; el furni no registrado se agrego con su sprite y ya coincide');
    await negC.entradaAuditoria({ furni_id: veloC.furni_id, cantidad: 1, precio: 700, keko: 'KekoC' });
    r = await anonC.rpc('registrar_eventos_sniper', { token_sniper: tkC.token, eventos: [{ tipo_evento: 'compra', id_externo: 'aud_1', ...sV, cantidad: 1, precio: 600, hotel: 'es' }] });
    assert.equal((await negC.compraPorId(r.data.eventos[0].compra_id)).keko, 'KekoC', 'lo que compra el sniper queda en su keko');
    ok('auditoria: otro keko (mover y volver), la exclusion se cae si cambia la cantidad, alta de un furni no registrado, baja, y las compras del sniper heredan su keko');

    assert.equal((await anonC.rpc('auditoria_inventario', { p_keko: 'KekoC' })).error.code, '42501');
    assert.equal((await anonC.from('inventario_habbo').select('keko').limit(1)).error.code, '42501');
    assert.equal((await anonC.rpc('auditar_inventario', { token_sniper: 'hbi_falso', keko: 'KekoC', hotel: 'es', inventario: [] })).error.code, 'PT401');
    assert.match((await anonC.rpc('auditar_inventario', { token_sniper: tkC.token, keko: 'KekoC', hotel: 'origins', inventario: [] })).error.message, /Habbo\.es/);
    await rechaza(negocio.auditoria('KekoC'), /No hay inventario del keko KekoC/);
    ok('auditoria: la clave anon no la lee, token falso 401, solo Habbo.es, y cada usuario ve solo sus kekos');
    await negC.crearCompra({ furni_id: caraC.furni_id, cantidad: 1, precio_compra: 30 });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual([filaC(sCa).categoria, filaC(sCa).sin_asignar], ['sin_keko', 1], 'una unidad sin keko que aqui no hace falta se muestra aparte');
    await negC.moverAKeko({ furni_id: caraC.furni_id, cantidad: 1, desde: null, hacia: 'KekoE' });
    audC = await negC.auditoria('KekoC');
    assert.equal(filaC(sCa), undefined);
    ok('auditoria: las unidades sin keko que sobran aparecen aparte y se mueven al keko donde estan');
    assert.equal((await negC.listarTokens()).find((t) => t.id === tkC.id).keko, 'KekoC', 'la tabla de tokens muestra el keko que aprendio cada sniper');

    // ── Kekos manuales (migracion 20261008000000) ──
    let kk = await negC.listarKekos();
    const nombresK = (origen) => kk.kekos.filter((k) => k.origen === origen).map((k) => k.nombre);
    assert.equal(kk.disponible, true);
    assert.deepEqual([nombresK('sniper'), nombresK('manual')], [['KekoC'], ['KekoD', 'KekoE']],
      'el keko del sniper se detecta; lo escrito en «¿En que keko estan?» de la Auditoria queda como manual');
    assert.deepEqual(kk.kekos.find((k) => k.nombre === 'KekoC').snipers, ['VPS de prueba C']);
    const bodega = await negC.crearKeko('  MiBodega ');
    assert.equal(bodega.nombre, 'MiBodega');
    await rechaza(negC.crearKeko('mibodega'), /Ya tienes un keko llamado «MiBodega»/);
    await rechaza(negC.crearKeko('kekoc'), /ya es el keko de uno de tus snipers/);
    await rechaza(negC.crearKeko('x'.repeat(61)), /entre 1 y 60/);
    // Antes, una compra manual sin keko salia como «Sin keko asignado» en la auditoria del sniper.
    const enBodega = await negC.crearCompra({ furni_id: caraC.furni_id, cantidad: 2, precio_compra: 30, keko: 'MiBodega' });
    audC = await negC.auditoria('KekoC');
    assert.equal(filaC(sCa), undefined, 'lo de la bodega no ensucia la auditoria del sniper');
    kk = await negC.listarKekos();
    assert.equal(kk.kekos.find((k) => k.nombre === 'MiBodega').en_mano, 2);
    ok('kekos manuales: se crean (sin repetir ni pisar el de un sniper) y una compra manual en la bodega no sale en la auditoria del sniper');

    let ren = await negC.renombrarKeko(bodega.id, 'Bodega Principal');
    assert.deepEqual([ren.antes, ren.nombre, ren.lotes], ['MiBodega', 'Bodega Principal', 1]);
    assert.equal((await negC.compraPorId(enBodega.id)).keko, 'Bodega Principal', 'renombrar lleva sus lotes');
    await rechaza(negC.renombrarKeko(bodega.id, 'kekod'), /Ya tienes un keko llamado «KekoD»/);
    await rechaza(negC.renombrarKeko(bodega.id, 'KekoC'), /es el keko de uno de tus snipers/);
    ren = await negC.renombrarKeko(bodega.id, 'bodega principal');
    assert.equal(ren.nombre, 'bodega principal', 'cambiar solo las mayusculas se permite');
    await rechaza(negC.borrarKeko(bodega.id), /todavía tiene 2 unidad/);

    await negC.crearCompra({ furni_id: veloC.furni_id, cantidad: 3, precio_compra: 650 });
    await negC.crearCompra({ furni_id: tronoC.furni_id, cantidad: 1, precio_compra: 480 });
    const sueltos = async () => (await negC.listarCompras()).filter((c) => c.estado === 'comprado' && !c.keko)
      .map((c) => [c.furni_id, c.cantidad]).sort((a, b) => a[0] - b[0]);
    const enKeko = async (keko, furniId) => (await negC.listarCompras())
      .filter((c) => c.estado === 'comprado' && c.keko === keko && c.furni_id === furniId).reduce((s, c) => s + c.cantidad, 0);
    const sueltosAntes = await sueltos();
    assert.deepEqual(sueltosAntes, [[veloC.furni_id, 3], [tronoC.furni_id, 1]].sort((a, b) => a[0] - b[0]));
    const asg = await negC.asignarSinKeko({ hacia: 'KekoD', items: [{ furni_id: veloC.furni_id, cantidad: 2 }] });
    assert.deepEqual([asg.hacia, asg.unidades, asg.furnis], ['KekoD', 2, 1]);
    assert.equal(await enKeko('KekoD', veloC.furni_id), 2);
    await rechaza(negC.asignarSinKeko({ hacia: 'bodega principal', items: [{ furni_id: tronoC.furni_id, cantidad: 1 }, { furni_id: veloC.furni_id, cantidad: 5 }] }), /Solo hay 1 unidad/);
    assert.deepEqual((await sueltos()).find((x) => x[0] === tronoC.furni_id), [tronoC.furni_id, 1], 'todo o nada: si un furni no alcanza, no se mueve ninguno');
    await rechaza(negC.asignarSinKeko({ hacia: 'KekoD', items: [] }), /Marca al menos un furni/);
    await negC.asignarSinKeko({ hacia: 'Tradeos', items: [{ furni_id: veloC.furni_id, cantidad: 1 }, { furni_id: tronoC.furni_id, cantidad: 1 }] });
    assert.deepEqual(await sueltos(), [], 'ya no queda nada sin keko');
    kk = await negC.listarKekos();
    assert.ok(kk.kekos.some((k) => k.nombre === 'Tradeos' && k.origen === 'manual' && k.en_mano === 2), 'un keko de destino nuevo queda registrado como manual');

    const veloEnC = await enKeko('KekoC', veloC.furni_id);
    await negC.venderEnMano(veloC.furni_id, { cantidad: 2, precio: 800, keko: 'KekoD' });
    await rechaza(negC.venderEnMano(veloC.furni_id, { cantidad: 1, precio: 800, keko: 'KekoD' }), /en el keko KekoD/);
    assert.equal(await enKeko('KekoC', veloC.furni_id), veloEnC, 'la venta desde un keko no toca las unidades de otro');
    await negC.moverAKeko({ furni_id: caraC.furni_id, cantidad: 2, desde: 'bodega principal', hacia: 'KekoD' });
    await negC.borrarKeko(bodega.id);
    assert.ok(!(await negC.listarKekos()).kekos.some((k) => k.nombre === 'bodega principal'));
    ok('kekos manuales: renombrar lleva sus lotes, borrar exige que no le queden unidades, lo sin keko se asigna por furni (todo o nada) y la venta sale solo del keko elegido');

    // ── Costos del Sniper en la auditoria (migracion 20261009000000) ──
    const veloK = await enKeko('KekoC', veloC.furni_id);
    const deco2 = furnidata.porClase('statue_dragon');
    r = await enviarInv([
      { ...sV, cantidad: veloK + 3, costo_unidad: 25, unidades_con_costo: veloK + 2, costo_medio: true },
      { sprite_id: deco2.sprite_id, tipo: deco2.tipo, cantidad: 1, costo_unidad: 10 },
      { sprite_id: deco2.sprite_id, tipo: deco2.tipo, cantidad: 1, costo_unidad: '20' },
      { sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 4, costo_unidad: -5, unidades_con_costo: 2 },
      { ...sCa, cantidad: 1 }, { ...sT, numero_ltd: 46 },
    ]);
    assert.equal(r.error, null);
    assert.equal(r.data.con_costo, 2, 'la respuesta cuenta los furnis que traen costo');
    audC = await negC.auditoria('KekoC');
    const costoDe = (sp) => { const x = filaC(sp); return x && [x.categoria, x.diferencia, x.costo_unidad, x.unidades_con_costo, x.costo_medio]; };
    assert.deepEqual(costoDe(sV), ['sobrante', 3, 25, veloK + 2, true], 'el sobrante trae el costo que conoce el Sniper');
    assert.deepEqual(costoDe({ sprite_id: deco2.sprite_id, tipo: deco2.tipo }), ['no_registrado', 2, 15, 2, true],
      'un elemento por unidad: se suman las unidades con costo y el costo es el promedio (medio si no coinciden)');
    assert.deepEqual(costoDe({ sprite_id: deco.sprite_id, tipo: deco.tipo }).slice(2), [null, null, null], 'un costo invalido se ignora sin perder el furni');
    const costos = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'costos.js')).href);
    assert.deepEqual(costos.tramosDelSniper(filaC(sV)), [{ costo: 25, unidades: 2, medio: true }], 'sobran 3 y el Sniper conoce 2: se proponen 2 a ese costo');
    await negC.entradaAuditoria({ furni_id: veloC.furni_id, cantidad: 2, precio: 25, keko: 'KekoC' });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual([filaC(sV).diferencia, costos.tramosDelSniper(filaC(sV))], [1, []], 'registradas esas 2, la que sigue sobrando ya no lleva costo');
    assert.deepEqual(costos.tramosDelSniper({ diferencia: 2, app: 0, costo_unidad: null, unidades_con_costo: null }), []);
    assert.equal(costos.textoCosto(3.4), '3,4');
    ok('costos del Sniper: la foto guarda y devuelve el costo (promedio y medio si hay varios; lo invalido se ignora) y la entrada lo propone solo para las unidades que el Sniper conoce');

    // ── Costos por tramo (migracion 20261010000000): un elemento por cada precio de compra ──
    const sD2 = { sprite_id: deco2.sprite_id, tipo: deco2.tipo };
    const d2 = filaC(sD2);
    assert.deepEqual(d2.costos.map((t) => [t.costo_unidad, t.unidades, t.costo_medio]), [[10, 1, false], [20, 1, false]],
      'la foto guarda cada costo como un tramo, en el orden en que llegaron');
    assert.deepEqual(costos.tramosDelSniper(d2), [{ costo: 10, unidades: 1, medio: false }, { costo: 20, unidades: 1, medio: false }], 'una linea por tramo, cada una con su costo exacto');
    await negC.entradaAuditoria({ sprite_id: deco2.sprite_id, tipo: deco2.tipo, cantidad: 1, precio: 20, keko: 'KekoC' });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual([filaC(sD2).categoria, filaC(sD2).costos_app], ['sobrante', [{ costo_unidad: 20, unidades: 1 }]]);
    assert.deepEqual(costos.tramosDelSniper(filaC(sD2)), [{ costo: 10, unidades: 1, medio: false }],
      'registrado el tramo de 20 (el segundo), queda el de 10: cada lote de la app descuenta el tramo de su mismo costo');
    const d2Id = filaC(sD2).furni_id;
    await negC.crearCompra({ furni_id: d2Id, cantidad: 1, precio_compra: 10 });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual([filaC(sD2).sin_asignar, filaC(sD2).costos_sin_keko, costos.porRegistrar(filaC(sD2)), costos.tramosDelSniper(filaC(sD2))],
      [1, [{ costo_unidad: 10, unidades: 1 }], 0, []], 'lo que explican las unidades sin keko no se propone: eso es «Son de este keko»');
    await negC.moverAKeko({ furni_id: d2Id, cantidad: 1, desde: null, hacia: 'KekoC' });
    audC = await negC.auditoria('KekoC');
    assert.equal(filaC(sD2), undefined, 'asignada, el furni cuadra');
    const mezcla = { diferencia: 4, app: 2, sin_asignar: 0, costos_app: [{ costo_unidad: 90, unidades: 2 }],
      costos: [{ costo_unidad: 100, unidades: 2, costo_medio: false }, { costo_unidad: 150, unidades: 3, costo_medio: false }] };
    assert.deepEqual(costos.tramosDelSniper(mezcla), [{ costo: 150, unidades: 3, medio: false }],
      'lo de la app a otro costo se descuenta del tramo mas antiguo; la unidad que sobra sin tramo va sin costo');
    assert.ok(costos.mismoCosto(3.333333, 3.33) && !costos.mismoCosto(3.33, 3.34), 'los costos se comparan al centimo');
    ok('costos por tramo: el Sniper manda un elemento por cada precio de compra, la bandeja muestra una linea por tramo y cada entrada usa su costo exacto');

    // ── Contrato del Sniper: lote fundido (costo_medio) y todos los LTD en el primer objeto ──
    const ltdF = furnidata.porClase('spyro');
    const sL = { sprite_id: ltdF.sprite_id, tipo: ltdF.tipo };
    r = await enviarInv([
      { ...sL, cantidad: 1, costo_unidad: 1033.3333, unidades_con_costo: 1, costo_medio: true, ltds: [11, '#12', 13] },
      { ...sL, cantidad: 1, costo_unidad: 1100, unidades_con_costo: 1, costo_medio: false },
      { ...sL, cantidad: 1, costo_unidad: 1250, unidades_con_costo: 1, costo_medio: false },
    ]);
    assert.equal(r.error, null);
    audC = await negC.auditoria('KekoC');
    const fL = filaC(sL);
    assert.deepEqual([fL.categoria, fL.habbo, fL.ltds_nuevos], ['no_registrado', 3, [11, 12, 13]], 'los numeros LTD que llegan juntos en el primer objeto valen para todo el furni');
    assert.deepEqual(fL.costos.map((t) => [t.costo_unidad, t.unidades, t.costo_medio]), [[1033.3333, 1, true], [1100, 1, false], [1250, 1, false]]);
    assert.deepEqual(costos.tramosDelSniper(fL).map((t) => [t.unidades, t.medio]), [[1, true], [1, false], [1, false]], 'el aviso de promedio sale solo en el tramo fundido');
    await negC.entradaAuditoria({ sprite_id: sL.sprite_id, tipo: sL.tipo, cantidad: 1, precio: 1033.33, numero_ltd: 12, keko: 'KekoC' });
    audC = await negC.auditoria('KekoC');
    assert.deepEqual([filaC(sL).categoria, filaC(sL).ltds_nuevos, costos.tramosDelSniper(filaC(sL)).map((t) => [t.costo, t.medio])],
      ['sobrante', [11, 13], [[1100, false], [1250, false]]], 'registrado el fundido (con el costo al centimo), quedan los otros dos tramos y los otros dos numeros');
    ok('contrato del Sniper: el lote fundido lleva el aviso de promedio solo en su linea y los LTD que llegan juntos en el primer objeto se eligen en cada tramo');

    // ── App actualizada sobre una base que aun no tiene la migracion 20261007000000 ──
    const sinAuditoria = await crearClienteLocal({ omitir: ['20261007000000_auditoria_inventario.sql', '20261008000000_kekos_manuales.sql', '20261009000000_costos_auditoria.sql', '20261010000000_costos_por_tramo.sql', '20261011000000_inventario_en_vivo.sql', '20261012000000_limpieza_tokens.sql'] });
    await sinAuditoria.crearUsuario('dani@prueba.local', 'clave-dani');
    await sinAuditoria.auth.signInWithPassword({ email: 'dani@prueba.local', password: 'clave-dani' });
    const conexD = crearServicioConexion({ eventos: new EventEmitter(), clienteFijo: sinAuditoria });
    await conexD.iniciar();
    const negD = crearServicioNegocio({ conexion: conexD, furnidata });
    const compraD = await negD.crearCompra({ nombre: 'Cara con Cicatrices', cantidad: 2, precio_compra: 30 });
    await negD.crearCompra({ furni_id: compraD.furni_id, cantidad: 1, precio_compra: 31 });
    const ventaD = await negD.venderEnMano(compraD.furni_id, { cantidad: 1, precio: 50 });
    assert.equal(ventaD.cantidad, 1);
    assert.deepEqual(await negD.resumenAuditoria(), { pendientes: 0, kekos: [], sin_migracion: true });
    await negD.crearToken('VPS de dani');
    assert.deepEqual((await negD.listarTokens()).map((t) => [t.nombre, t.keko]), [['VPS de dani', undefined]], 'sin la migracion, los tokens se listan sin keko');
    assert.deepEqual(await negD.listarKekos(), { disponible: false, kekos: [] });
    await rechaza(negD.auditoria(), /Falta instalar la migracion 20261007000000/);
    await sinAuditoria.cerrar();
    ok('app 1.1 sobre una base sin la migracion de auditoria: + Compra, la venta manual y los tokens siguen funcionando; la auditoria pide instalarla');

    // ── App 1.2 sobre una base con la migracion 11 pero sin la 12 ──
    const sinKekos = await crearClienteLocal({ omitir: ['20261008000000_kekos_manuales.sql', '20261009000000_costos_auditoria.sql', '20261010000000_costos_por_tramo.sql', '20261011000000_inventario_en_vivo.sql', '20261012000000_limpieza_tokens.sql'] });
    await sinKekos.crearUsuario('eva@prueba.local', 'clave-eva');
    await sinKekos.auth.signInWithPassword({ email: 'eva@prueba.local', password: 'clave-eva' });
    const conexE = crearServicioConexion({ eventos: new EventEmitter(), clienteFijo: sinKekos });
    await conexE.iniciar();
    const negE = crearServicioNegocio({ conexion: conexE, furnidata });
    assert.deepEqual(await negE.listarKekos(), { disponible: false, kekos: [] });
    assert.equal((await negE.crearCompra({ nombre: 'Cara con Cicatrices', cantidad: 1, precio_compra: 30, keko: 'Bodega' })).keko, 'Bodega');
    await rechaza(negE.crearKeko('Bodega'), /Falta instalar el esquema/);
    await sinKekos.cerrar();
    ok('app 1.2 sobre una base sin la migracion de kekos: no hay lista (el formulario no pide keko) y la compra con keko sigue funcionando');

    // ── Base con la 12 pero sin la 13: el Sniper ya manda costos y la base los ignora ──
    const sinCostos = await crearClienteLocal({ omitir: ['20261009000000_costos_auditoria.sql', '20261010000000_costos_por_tramo.sql', '20261011000000_inventario_en_vivo.sql', '20261012000000_limpieza_tokens.sql'] });
    await sinCostos.crearUsuario('fede@prueba.local', 'clave-fede');
    await sinCostos.auth.signInWithPassword({ email: 'fede@prueba.local', password: 'clave-fede' });
    const conexF = crearServicioConexion({ eventos: new EventEmitter(), clienteFijo: sinCostos });
    await conexF.iniciar();
    const negF = crearServicioNegocio({ conexion: conexF, furnidata });
    const tkF = await negF.crearToken('VPS de fede');
    r = await sinCostos.comoAnon().rpc('auditar_inventario', { token_sniper: tkF.token, keko: 'KekoF', hotel: 'es',
      inventario: [{ sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 3, costo_unidad: 25, unidades_con_costo: 2, costo_medio: true }] });
    assert.equal(r.error, null);
    const filaF = (await negF.auditoria('KekoF')).filas[0];
    assert.deepEqual([filaF.categoria, filaF.costo_unidad], ['no_registrado', undefined]);
    assert.deepEqual((await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'costos.js')).href)).tramosDelSniper(filaF), []);
    await sinCostos.cerrar();
    ok('base sin la migracion de costos: el inventario del Sniper con costos entra igual (los ignora) y la bandeja no propone costo');

    // ── Base con la 13 pero sin la 14: el Sniper ya manda un elemento por costo ──
    const sinTramos = await crearClienteLocal({ omitir: ['20261010000000_costos_por_tramo.sql', '20261011000000_inventario_en_vivo.sql', '20261012000000_limpieza_tokens.sql'] });
    await sinTramos.crearUsuario('gabi@prueba.local', 'clave-gabi');
    await sinTramos.auth.signInWithPassword({ email: 'gabi@prueba.local', password: 'clave-gabi' });
    const conexG = crearServicioConexion({ eventos: new EventEmitter(), clienteFijo: sinTramos });
    await conexG.iniciar();
    const negG = crearServicioNegocio({ conexion: conexG, furnidata });
    const tkG = await negG.crearToken('VPS de gabi');
    r = await sinTramos.comoAnon().rpc('auditar_inventario', { token_sniper: tkG.token, keko: 'KekoG', hotel: 'es',
      inventario: [{ sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 1, costo_unidad: 10 }, { sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 1, costo_unidad: 20 }] });
    assert.equal(r.error, null);
    const filaG = (await negG.auditoria('KekoG')).filas[0];
    assert.equal(filaG.costos, undefined);
    await new Promise((listo) => setTimeout(listo, 50));
    assert.equal(conexG.auditoriaEnVivo(), false, 'sin la migracion 20261011000000 la app no escucha la foto en vivo (y no se suscribe)');
    await negG.revocarToken(tkG.id);
    assert.deepEqual(await negG.vistaLimpieza([tkG.id]), { disponible: false }, 'sin la migracion 20261012000000 no hay vista previa de la limpieza');
    await rechaza(negG.borrarToken(tkG.id, { limpieza: true }), /20261012000000_limpieza_tokens/);
    assert.deepEqual(await negG.borrarToken(tkG.id), { borrados: 1 }, 'el borrado simple sigue funcionando sin la migracion');
    assert.deepEqual((await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'costos.js')).href)).tramosDelSniper(filaG),
      [{ costo: 15, unidades: 2, medio: true }], 'sin la migracion, un solo tramo: el promedio, marcado como tal');
    await sinTramos.cerrar();
    ok('base sin la migracion de tramos: los elementos por costo entran y la bandeja propone su promedio como en la 1.3.0');

    // ── Auditoria en vivo (migracion 20261011000000): la foto del Sniper llega por Realtime ──
    const vivo = await crearClienteLocal();
    await vivo.crearUsuario('vivi@prueba.local', 'clave-vivi');
    await vivo.auth.signInWithPassword({ email: 'vivi@prueba.local', password: 'clave-vivi' });
    const appVivo = await crearApp({ dirDatos: dir, clienteFijo: vivo, iniciarCatalogo: false, log: () => {}, esperaInventarioMs: 20 });
    const finVivo = Date.now() + 3000;
    while (!appVivo.conexion.auditoriaEnVivo()) {
      assert.ok(Date.now() < finVivo, 'con la migracion 20261011000000 la app escucha la foto en vivo');
      await new Promise((listo) => setTimeout(listo, 20));
    }
    const caraV = await appVivo.negocio.crearCompra({ nombre: 'Cara con Cicatrices', cantidad: 2, precio_compra: 30, keko: 'KekoV' });
    const furniV = await appVivo.negocio.furniPorId(caraV.furni_id);
    const tkV = await appVivo.negocio.crearToken('VPS en vivo');
    const siguienteAuditoria = () => new Promise((resolve, reject) => {
      const espera = setTimeout(() => { appVivo.eventos.off('evento', alLlegar); reject(new Error('no llego la auditoria en vivo')); }, 3000);
      function alLlegar(e) {
        if (e.tipo !== 'auditoria') return;
        clearTimeout(espera);
        appVivo.eventos.off('evento', alLlegar);
        resolve(e);
      }
      appVivo.eventos.on('evento', alLlegar);
    });
    const fotoV = async (cantidad) => {
      const llega = siguienteAuditoria();
      const rr = await vivo.comoAnon().rpc('auditar_inventario', { token_sniper: tkV.token, keko: 'KekoV', hotel: 'es',
        inventario: [{ sprite_id: furniV.sprite_id, tipo: furniV.tipo, cantidad }] });
      assert.equal(rr.error, null);
      return llega;
    };
    let evV = await fotoV(2);
    assert.deepEqual([evV.avisos, evV.resumen.pendientes], [[], 0], 'la primera foto cuadra: sin aviso');
    evV = await fotoV(3);
    assert.deepEqual([evV.resumen.pendientes, evV.avisos.length, evV.avisos[0].keko, evV.avisos[0].silencioso], [1, 1, 'KekoV', false], 'una unidad de mas: aviso');
    assert.equal(evV.avisos[0].breve, 'Auditoría de KekoV: 1 furni con una diferencia nueva');
    evV = await fotoV(3);
    assert.deepEqual(evV.avisos, [], 'la misma foto otra vez (el Sniper la reenvia tras cada tanda): sin aviso');
    evV = await fotoV(2);
    assert.deepEqual([evV.avisos, evV.resumen.pendientes], [[], 0], 'resuelto: sin aviso y el numero del menu vuelve a 0');
    await appVivo.cerrar();
    ok('auditoria en vivo: la foto del Sniper llega al instante, el numero del menu se pone al dia y solo se avisa de diferencias nuevas');

    const est = await anon.rpc('estado_sniper', { p_token: tk.token });
    assert.equal(est.data.ok, true);
    assert.equal(est.data.pendientes, 0);
    await negocio.revocarToken(tk.id);
    r = await sniper([compraVelo('cmp_9', 1, 1)]);
    assert.equal(r.error.code, 'PT401');
    ok('estado_sniper responde; un token revocado deja de funcionar al instante');

    const eventosDe = async () => (await clienteA.pg.query('select count(*)::int as n from public.eventos_sniper where token_id is null or token_id = $1', [tk.id])).rows[0].n;
    const eventosAntes = await eventosDe();
    assert.ok(eventosAntes > 0);
    const tkActivo = await negocio.crearToken('VPS activo');
    await rechaza(negocio.borrarToken(tkActivo.id), /revócalo primero/);
    assert.deepEqual(await negocio.borrarToken(tk.id), { borrados: 1 });
    assert.ok(!(await negocio.listarTokens()).some((t) => t.id === tk.id), 'el token eliminado ya no esta en la tabla');
    assert.equal(await eventosDe(), eventosAntes, 'los eventos que envio ese sniper se conservan (sin token)');
    await rechaza(negocio.borrarToken(tk.id), /no existe/);
    const tkViejo = await negocio.crearToken('VPS viejo');
    await negocio.revocarToken(tkViejo.id);
    await negocio.revocarToken(tkActivo.id);
    assert.deepEqual(await negocio.borrarTokensRevocados(), { borrados: 2 });
    assert.ok((await negocio.listarTokens()).every((t) => !t.revocado), 'solo quedan los activos');
    ok('tokens: uno revocado se elimina de la base (uno activo no), tambien todos los revocados a la vez, y lo que envio ese sniper se conserva');

    // ── Limpieza profunda (migracion 20261012000000): el token Y los datos de su keko ──
    const kL = 'KekoLimpio';
    const tkL1 = await negocio.crearToken('VPS limpieza 1');
    const tkL2 = await negocio.crearToken('VPS limpieza 2');
    const fotoL = (token, keko, cantidad) => anon.rpc('auditar_inventario', { token_sniper: token, keko, hotel: 'es', inventario: [{ sprite_id: velo.sprite_id, tipo: velo.tipo, cantidad }] });
    assert.equal((await fotoL(tkL1.token, kL, 4)).error, null);
    assert.equal((await sniper([compraVelo('limp_1', 3, 40)], tkL1.token)).error, null);
    const veloIdL = (await negocio.listarFurnis()).find((f) => f.sprite_id === velo.sprite_id && f.tipo === velo.tipo).id;
    const ventaL = await negocio.crearCompra({ furni_id: veloIdL, cantidad: 1, precio_compra: 50, keko: 'kekolimpio' });
    await negocio.venderEnMano(veloIdL, { cantidad: 1, precio: 80, keko: 'kekolimpio', lote_id: ventaL.id });
    await negocio.excluirDeAuditoria({ keko: kL, sprite_id: velo.sprite_id, tipo: velo.tipo, unidades: 1, habbo: 4, app: 3 });
    const otroL = await negocio.crearCompra({ furni_id: veloIdL, cantidad: 2, precio_compra: 45, keko: 'OtroKeko' });
    assert.equal((await fotoL(tkL2.token, 'kekolimpio', 4)).error, null);
    await negocio.revocarToken(tkL1.id);
    let vistaL = await negocio.vistaLimpieza([tkL1.id]);
    assert.deepEqual([vistaL.disponible, vistaL.bloqueada, vistaL.kekos.map((k) => [k.keko, k.activos])], [true, true, [[kL, ['VPS limpieza 2']]]],
      'el keko tiene un token activo (el mismo keko de Habbo, sin distinguir mayusculas): la limpieza esta bloqueada');
    await rechaza(negocio.borrarToken(tkL1.id, { limpieza: true }), /token activo «VPS limpieza 2»/);
    assert.ok((await negocio.listarTokens()).some((t) => t.id === tkL1.id), 'bloqueada, no se borra nada: ni siquiera el token');
    await negocio.revocarToken(tkL2.id);
    vistaL = await negocio.vistaLimpieza([tkL1.id]);
    const kVista = vistaL.kekos[0];
    assert.deepEqual([vistaL.bloqueada, kVista.lotes_en_mano, kVista.en_mano, kVista.ventas, kVista.vendidas, !!kVista.foto, kVista.exclusiones, vistaL.eventos],
      [false, 1, 3, 1, 1, true, 1, 1], 'sin tokens activos, la vista previa dice exactamente lo que se borra');
    const limpio = await negocio.borrarToken(tkL1.id, { limpieza: true });
    assert.deepEqual([limpio.borrados, limpio.kekos, limpio.lotes, limpio.eventos], [1, [kL], 2, 1]);
    const quedaL = async (sql) => (await clienteA.pg.query(sql)).rows[0].n;
    assert.equal(await quedaL("select count(*)::int as n from public.compras where lower(keko) = 'kekolimpio'"), 0, 'se borran sus lotes en mano, publicados y vendidos');
    assert.equal(await quedaL("select count(*)::int as n from public.inventario_habbo where lower(keko) = 'kekolimpio'"), 0, 'y la foto de su inventario');
    assert.equal(await quedaL("select count(*)::int as n from public.exclusiones_auditoria where lower(keko) = 'kekolimpio'"), 0, 'y sus exclusiones');
    assert.equal((await negocio.compraPorId(otroL.id)).cantidad, 2, 'lo de otros kekos no se toca');
    assert.equal((await negocio.listarTokens()).find((t) => t.id === tkL2.id).keko, null, 'el otro token revocado olvida ese keko');
    assert.ok(!(await negocio.listarKekos()).kekos.some((k) => k.nombre.toLowerCase() === 'kekolimpio'), 'el keko desaparece de la app');
    await negocio.borrarTokensRevocados({ limpieza: true });
    assert.ok((await negocio.listarTokens()).every((t) => !t.revocado), 'tambien todos los revocados a la vez (sin keko no hay datos que borrar)');
    const tkVivo = await negocio.crearToken('VPS vivo');
    await rechaza(negocio.vistaLimpieza([tkVivo.id]), /revócalo primero/);
    ok('limpieza profunda: borra el token y todos los datos de su keko (lotes, ventas, foto, exclusiones, historial) salvo que el keko tenga un token activo; se ve antes lo que se borra');

    // ── Aislamiento entre usuarios + importacion de Excel ──
    const clienteB = clienteA.comoAnon();
    await clienteB.auth.signInWithPassword({ email: 'beto@prueba.local', password: 'clave-beto' });
    const conexB = crearServicioConexion({ eventos: new EventEmitter(), clienteFijo: clienteB });
    await conexB.iniciar();
    const negB = crearServicioNegocio({ conexion: conexB, furnidata });
    assert.equal((await negB.listarFurnis()).length, 0);
    assert.deepEqual((await negB.listarKekos()).kekos, [], 'los kekos tambien son de cada usuario');
    ok('RLS: el segundo usuario no ve nada del primero');
    // Planilla de prueba con la misma estructura que la plantilla del usuario (hojas
    // Inventario, Mercadillo y Resumen), generada aqui: el repositorio no guarda Excels.
    const rutaExcel = path.join(dir, 'planilla-de-prueba.xlsx');
    const libro = new ExcelJS.Workbook();
    const hInv = libro.addWorksheet('Inventario');
    hInv.addRow(['Furni', 'Moneda de venta', 'Precio venta x und']);
    hInv.addRow(['Dragón Velo de Arena', 'Créditos', 900]);
    hInv.addRow(['cara con cicatrices', 'Créditos', 40]);
    hInv.addRow(['Furni Inventado XYZ', 'Créditos', 10]);
    const hMer = libro.addWorksheet('Mercadillo');
    hMer.addRow(['Estado', 'Furni', 'Cantidad', 'Moneda de compra', 'Precio compra x und']);
    hMer.addRow(['En venta', 'Dragón Velo de Arena', 2, 'Créditos', 700]);
    hMer.addRow(['Vendido', 'Dragón Velo de Arena', 1, 'Créditos', 650]);
    hMer.addRow(['En venta', 'cara con cicatrices', 3, 'Lingos', 1]);
    hMer.addRow(['Vendido', 'Furni Inventado XYZ', 1, 'Créditos', 6]);
    hMer.addRow(['En venta', 'Furni Inventado XYZ', 0, 'Créditos', 5]);
    const hRes = libro.addWorksheet('Resumen');
    hRes.addRow(['Creditos por 1 Lingo:', 50]);
    hRes.addRow(['Unidades en venta', 5]);
    hRes.addRow(['Invertido', 2 * 700 + 3 * 50]);
    hRes.addRow(['Ganancia realizada', (900 - 650) + (10 - 6)]);
    await libro.xlsx.writeFile(rutaExcel);

    const datosExcel = await leerExcel(rutaExcel);
    const inf = await importarDatos(negB, furnidata, datosExcel, {});
    const e = (k) => datosExcel.resumenExcel[normalizar(k)];
    assert.deepEqual([inf.furnis, inf.compras, inf.tasa], [3, 4, 50]);
    assert.deepEqual(inf.correcciones.map((c) => [c.excel, c.oficial]), [['cara con cicatrices', 'Cara con Cicatrices']]);
    assert.deepEqual(inf.sinVincular.map((x) => x.nombre), ['Furni Inventado XYZ']);
    assert.ok(inf.avisos.some((a) => /cantidad invalida/.test(a)), 'la fila con cantidad 0 se omite con aviso');
    // Lo importado queda en mano: sin precio ni ganancia esperada (el precio de la hoja
    // Inventario solo congela las ventas que el Excel ya tenia). 3 lingos a 50 = 150 cr.
    assert.equal(inf.resumen.stock.unidades, e('Unidades en venta'));
    assert.equal(inf.resumen.stock.costo_cr, e('Invertido'));
    assert.equal(inf.resumen.vendido.ganancia_cr, e('Ganancia realizada'));
    assert.equal(inf.resumen.publicado.unidades, 0);
    assert.equal(inf.resumen.publicado.ganancia_cr, 0);
    assert.equal(inf.resumen.datos.perdidas.length, 0);
    const furnisB = await negB.listarFurnis();
    assert.ok(furnisB.every((fb) => fb.ganancia_esperada_cr === null), 'nada importado tiene ganancia esperada');
    const precioGuardado = (await clienteA.pg.query('select count(*)::int as n from public.furnis f join auth.users u on u.id = f.propietario where u.email = $1 and f.precio_venta is not null', ['beto@prueba.local'])).rows[0].n;
    assert.equal(precioGuardado, 0, 'el importador ya no guarda un precio en el furni');
    await rechaza(importarDatos(negB, furnidata, datosExcel, {}), /ya tiene furnis/);
    assert.equal((await negocio.listarFurnis()).some((x) => x.nombre === 'Furni Inventado XYZ'), false, 'lo importado por otro usuario no se ve');
    ok('Excel importado en UNA transaccion (planilla de prueba): 3 furnis y 4 lotes; nombre corregido al oficial, uno sin vincular, fila invalida avisada, lingos a 50; stock, inversion y ganancia realizada iguales a la hoja Resumen; queda en mano');

    // ── Base de produccion a la que le falta 20260930000000 (caso real): la migracion
    //    20261001000000 se aplica sola, completa lo que faltaba y pasa a neto la venta vieja ──
    const posteriores = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations')).filter((x) => x >= '20260930000000');
    const sinVentaNeta = await crearClienteLocal({ omitir: posteriores });
    const pgS = sinVentaNeta.pg;
    const uidS = await sinVentaNeta.crearUsuario('sin-venta-neta@prueba.local', 'clave');
    const furniS = (await pgS.query("insert into public.furnis (propietario, nombre, precio_venta) values ($1, 'Furni de prueba', 400) returning id", [uidS])).rows[0].id;
    const loteS = (await pgS.query(
      "insert into public.compras (propietario, furni_id, cantidad, precio_compra, estado, precio_lista, moneda_lista, publicado_en) values ($1, $2, 2, 300, 'publicado', 350, 'creditos', now()) returning id",
      [uidS, furniS])).rows[0].id;
    const ventaS = (await pgS.query('select public.vender_lote($1, 1) as r', [loteS])).rows[0].r;
    assert.equal((await pgS.query('select precio_venta from public.compras where id = $1', [ventaS.venta_id])).rows[0].precio_venta, 350, 'antes: se guardaba el bruto');
    const sqlPublicacion = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261001000000_publicacion_manual.sql'), 'utf8');
    await pgS.exec(sqlPublicacion);
    await pgS.exec(sqlPublicacion);
    const filaS = (await pgS.query('select precio_venta_real, comision_venta, comision_pagada_cr, publicado_por, ganancia_cr from public.v_compras where id = $1', [ventaS.venta_id])).rows[0];
    assert.deepEqual(filaS, { precio_venta_real: 342, comision_venta: 8, comision_pagada_cr: 8, publicado_por: 'sniper', ganancia_cr: 42 });
    assert.equal((await pgS.query('select publicado_por from public.compras where id = $1', [loteS])).rows[0].publicado_por, 'sniper');
    const revS = (await pgS.query('select public.revertir_venta($1) as r', [ventaS.venta_id])).rows[0].r;
    assert.equal(revS.fusionada, true);
    const nuevaS = (await pgS.query('select public.vender_lote($1, 1) as r', [loteS])).rows[0].r;
    assert.equal(nuevaS.precio_venta, 342, 'despues: se guarda el neto');
    assert.ok((await pgS.query("select to_regprocedure('public.publicar_lote(bigint, integer, numeric)') as f")).rows[0].f);
    await sinVentaNeta.cerrar();
    ok('migracion 20261001000000 en una base SIN la 20260930000000: se aplica (dos veces), completa comision_venta y pasa a neto la venta vieja (350 -> 342)');

    // ── API local ──
    let h = await pedir(puerto, 'GET', '/api/cuenta');
    assert.equal(h.json.estado, 'lista');
    assert.equal(h.json.version, paquete.version, 'la cuenta dice que version corre (ventana de novedades)');
    h = await pedir(puerto, 'GET', '/api/furnidata/buscar?q=' + encodeURIComponent('dragon velo'));
    assert.equal(h.json[0].nombre, 'Dragón Velo de Arena');
    h = await pedir(puerto, 'POST', '/api/furnis', { cuerpo: { nombre: 'Furni Inventado XYZ' } });
    assert.equal(h.status, 422);
    h = await pedir(puerto, 'GET', '/api/pendientes');
    assert.equal(h.json.length, (await negocio.pendientesPorFurni()).length);
    ok('API local: cuenta, buscador, validacion y pendientes');
    h = await pedir(puerto, 'POST', `/api/compras/${lote.id}/revertir`, { crudo: 'x=1', tipo: 'application/x-www-form-urlencoded' });
    assert.equal(h.status, 415);
    h = await pedir(puerto, 'GET', '/api/resumen', { origin: 'https://sitio-malicioso.com' });
    assert.equal(h.status, 403);
    h = await pedir(puerto, 'GET', '/api/resumen', { host: 'atacante.com' });
    assert.equal(h.status, 403);
    h = await pedir(puerto, 'GET', '/api/resumen', { origin: `http://127.0.0.1:${puerto}` });
    assert.equal(h.status, 200);
    ok('API local blindada: formularios 415, otro sitio 403, DNS rebinding 403; la app entra');
    h = await pedir(puerto, 'POST', '/api/sniper/tokens', { cuerpo: { nombre: 'VPS de prueba 2' } });
    assert.equal(h.status, 201);
    assert.match(h.json.token, /^hbi_/);
    const idTk2 = h.json.id;
    h = await pedir(puerto, 'DELETE', `/api/sniper/tokens/${idTk2}`);
    assert.equal(h.status, 409, 'un token activo no se elimina');
    await pedir(puerto, 'POST', `/api/sniper/tokens/${idTk2}/revocar`, { cuerpo: {} });
    h = await pedir(puerto, 'DELETE', `/api/sniper/tokens/${idTk2}`);
    assert.deepEqual([h.status, h.json.borrados], [200, 1]);
    h = await pedir(puerto, 'POST', '/api/sniper/tokens/borrar-revocados', { cuerpo: {} });
    assert.deepEqual([h.status, h.json.borrados], [200, 0]);
    h = await pedir(puerto, 'POST', '/api/sniper/tokens', { cuerpo: { nombre: 'VPS de prueba 3' } });
    const idTk3 = h.json.id;
    await pedir(puerto, 'POST', `/api/sniper/tokens/${idTk3}/revocar`, { cuerpo: {} });
    h = await pedir(puerto, 'GET', `/api/sniper/tokens/limpieza?ids=${idTk3}`);
    assert.deepEqual([h.status, h.json.disponible, h.json.kekos, h.json.tokens.map((t) => t.nombre)], [200, true, [], ['VPS de prueba 3']]);
    h = await pedir(puerto, 'DELETE', `/api/sniper/tokens/${idTk3}?limpieza=1`);
    assert.deepEqual([h.status, h.json.borrados, h.json.limpieza], [200, 1, true]);
    ok('crear, revocar y eliminar tokens desde la API de la app');
    h = await pedir(puerto, 'POST', '/api/kekos', { cuerpo: { nombre: 'Bodega de Ana' } });
    assert.equal(h.status, 201);
    h = await pedir(puerto, 'GET', '/api/kekos');
    const bodegaAna = h.json.kekos.find((k) => k.nombre === 'Bodega de Ana');
    assert.ok(h.json.disponible && bodegaAna && bodegaAna.origen === 'manual');
    h = await pedir(puerto, 'POST', '/api/kekos', { cuerpo: { nombre: 'bodega de ana' } });
    assert.equal(h.status, 409);
    h = await pedir(puerto, 'PUT', `/api/kekos/${bodegaAna.id}`, { cuerpo: { nombre: 'Bodega Ana' } });
    assert.equal(h.json.nombre, 'Bodega Ana');
    h = await pedir(puerto, 'POST', '/api/kekos/asignar', { cuerpo: { hacia: 'Bodega Ana', items: [{ furni_id: 1, cantidad: 0 }] } });
    assert.equal(h.status, 400);
    h = await pedir(puerto, 'DELETE', `/api/kekos/${bodegaAna.id}`);
    assert.equal(h.status, 200);
    ok('kekos desde la API de la app: crear, repetido 409, renombrar, validar lo que se asigna y borrar');

    const sinSesion = await crearApp({ dirDatos: dir, clienteFijo: clienteA.comoAnon(), iniciarCatalogo: false, log: () => {} });
    const s2 = http.createServer(sinSesion.app).listen(0, '127.0.0.1');
    await new Promise((res2) => s2.once('listening', res2));
    h = await pedir(s2.address().port, 'GET', '/api/resumen');
    assert.equal(h.status, 401);
    assert.equal(h.json.codigo, 'SIN_SESION');
    ok('sin sesion, la API de datos responde 401 SIN_SESION (la app muestra el acceso)');

    // ── Asistente de configuracion: que migraciones tiene la base, solo con la clave publica ──
    const archivosMig = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations')).filter((x) => x.endsWith('.sql')).sort();
    assert.deepEqual(MIGRACIONES.map((m) => m.archivo), archivosMig, 'cada migracion de supabase/migrations tiene su sonda en backend/services/instalacion.js');
    const instalacion = crearServicioInstalacion();
    const filasBase = async () => (await clienteA.pg.query('select (select count(*) from public.compras) + (select count(*) from public.eventos_sniper) as n')).rows[0].n;
    const filasAntes = await filasBase();
    let estMig = await instalacion.comprobar(clienteA.comoAnon());
    assert.deepEqual([estMig.instaladas, estMig.completa, estMig.siguiente, estMig.error], [archivosMig.length, true, null, null]);
    assert.equal(await filasBase(), filasAntes, 'las sondas no escriben nada');
    for (const [desde, instaladas] of [['00000000000000', 0], ['20260928000000', 1], ['20260930000000', 3], ['20261005000000', 8]]) {
      const parcial = await crearClienteLocal({ omitir: archivosMig.filter((x) => x >= desde) });
      estMig = await instalacion.comprobar(parcial.comoAnon());
      assert.deepEqual([estMig.instaladas, estMig.siguiente, estMig.completa], [instaladas, archivosMig[instaladas], false], `base sin ${desde} y posteriores`);
      assert.deepEqual(estMig.migraciones.map((m) => m.instalada), archivosMig.map((_, i) => i < instaladas));
      await parcial.cerrar();
    }
    h = await pedir(s2.address().port, 'GET', '/api/instalacion');
    assert.deepEqual([h.status, h.json.completa, h.json.total], [200, true, archivosMig.length]);
    h = await pedir(s2.address().port, 'GET', '/api/instalacion/sql/' + archivosMig[0]);
    assert.ok(h.status === 200 && /create table/i.test(h.json.sql));
    h = await pedir(s2.address().port, 'GET', '/api/instalacion/sql/' + encodeURIComponent('../../package.json'));
    assert.equal(h.status, 404);
    s2.close();
    ok(`asistente: detecta que migraciones faltan con la clave publica (0 en un proyecto recien creado, 1, 3, 8 y ${archivosMig.length} de ${archivosMig.length}) sin escribir nada; copia el SQL sin sesion y solo de supabase/migrations`);

    h = await pedir(puerto, 'GET', '/api/icono/clothing_r26_scarface');
    if (h.status === 200) ok(`icono PNG servido desde cache (${h.bytes} bytes)`);
    else console.log('  --  icono no descargado (¿sin internet?), se omite');
  } finally {
    server.close();
    await cerrar();
  }

  console.log(`\n${pasos} verificaciones correctas.\n`);
}

// Un fallo termina el proceso: si una prueba corta a mitad, algun servidor de prueba
// queda escuchando y la suite parecia colgada en vez de avisar.
main().catch((e) => { console.error('\nFALLO: ' + (e && e.stack || e)); process.exit(1); });
