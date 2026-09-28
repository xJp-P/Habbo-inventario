// electron/actualizaciones.js — actualizaciones automaticas desde GitHub Releases.
//
// Mismo esquema que Proyecto_Cartera (desktop/main.js), con sus arreglos ya probados:
//   - Windows: electron-updater lee latest.yml del Release y baja el instalador NSIS
//     COMPLETO (la descarga diferencial podia quedar corrupta al saltar varias
//     versiones), con un reintento y limpiando antes su carpeta `pending`.
//   - macOS: la app no esta firmada con un certificado de Apple y el actualizador de
//     Apple (Squirrel.Mac) exige firma. Se consulta la API de GitHub, se baja el .zip
//     de la arquitectura del equipo (arm64 o x64) y un script reemplaza la app cuando
//     esta se cierra.
//
// Solo cuentan los Releases PUBLICADOS: el workflow de GitHub deja cada version como
// borrador hasta que la publicas, asi que nada llega a los equipos por accidente.
//
// Estado que ven la pantalla de inicio y Ajustes: { fase, version, porcentaje, error, nota, manual }
//   fase: inactiva | desarrollo | buscando | al-dia | disponible | descargando | lista | error
//   manual: en Mac, la copia abierta no se puede reemplazar sola (desde el .dmg, o en
//           cuarentena sin moverla a Aplicaciones): hay que bajarla de GitHub.
//
// --simular-actualizacion (solo con npm start) recorre el flujo con una version 9.9.9
// ficticia sin descargar nada; con =error la descarga falla a mitad de camino.

const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync, spawn } = require('child_process');

const paquete = require('../package.json');

// Deben coincidir con "build.publish" y "build.mac.artifactName" del package.json.
// No se leen de ahi porque electron-builder quita "build" del package.json que va
// dentro de la app. scripts/verificar.js comprueba que coinciden.
const GITHUB = { owner: 'xJp-P', repo: 'Habbo-inventario' };
const zipMac = (version, arch) => `Habbo-Inventario-Mac-${version}-${arch}.zip`;

const { owner, repo } = GITHUB;
const URL_RELEASES = `https://github.com/${owner}/${repo}/releases`;
const ES_MAC = process.platform === 'darwin';
const LIMITE_BUSQUEDA_AL_ARRANCAR = 12000;

const argSimular = process.argv.find((a) => a.startsWith('--simular-actualizacion'));
const SIMULAR = !app.isPackaged && argSimular ? (argSimular.endsWith('=error') ? 'error' : 'ok') : null;

let estado = { fase: app.isPackaged || SIMULAR ? 'inactiva' : 'desarrollo' };
const oyentes = new Set();
let actualizador = null;
let scriptMac = null;

function cambiar(nuevo) {
  estado = nuevo;
  oyentes.forEach((f) => { try { f(estado); } catch (_) { /* un oyente roto no frena a los demas */ } });
  return estado;
}

function alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); }
function obtenerEstado() { return estado; }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function compararVersiones(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

// Sin Releases publicados (repo recien creado) GitHub responde 404: no es un error.
function sinVersiones(e) {
  return /\b404\b|No published versions|Unable to find latest version|Cannot find latest/i.test(String(e && e.message));
}

function mensajeError(e) {
  const m = String((e && e.message) || e || 'desconocido');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_|sin respuesta/i.test(m)) return 'Sin conexión con GitHub. Revisa tu internet.';
  if (/\b403\b|rate limit/i.test(m)) return 'GitHub limitó las consultas por un rato. Inténtalo más tarde.';
  return m.split('\n')[0].slice(0, 160);
}

// ── Windows (electron-updater) ───────────────────────────────────────────
function updater() {
  if (!actualizador) {
    actualizador = require('electron-updater').autoUpdater;
    actualizador.autoDownload = false;
    actualizador.autoInstallOnAppQuit = true;
    actualizador.disableDifferentialDownload = true;
    // Sin oyente de 'error', un fallo de red tumbaria el proceso principal: los errores
    // ya llegan como promesas rechazadas de checkForUpdates y downloadUpdate.
    actualizador.on('error', () => {});
  }
  return actualizador;
}

// %LOCALAPPDATA%\habbo-inventario-updater\pending guarda los temp-*.exe. Si uno quedo a
// medias de un intento anterior, el renombre final fallaba con ENOENT (Cartera v1.15.3).
// El nombre de la carpeta es el de electron-builder: `name` del package.json + -updater.
function limpiarPendientes() {
  try {
    const local = process.env.LOCALAPPDATA;
    if (local) fs.rmSync(path.join(local, paquete.name.toLowerCase() + '-updater', 'pending'), { recursive: true, force: true });
  } catch (_) { /* no impide la descarga */ }
}

async function descargarWindows(alAvanzar) {
  const u = updater();
  const intento = async () => {
    limpiarPendientes();
    const f = (p) => alAvanzar(Math.round(p.percent));
    u.on('download-progress', f);
    try { await u.downloadUpdate(); } finally { u.removeListener('download-progress', f); }
  };
  try { await intento(); } catch (_) { alAvanzar(0); await intento(); }
}

// ── macOS (actualizador propio, sin firma de Apple) ───────────────────────
function pedir(url, cabeceras, redirecciones = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': paquete.name }, cabeceras) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirecciones > 0) {
        res.resume();
        pedir(new URL(res.headers.location, url).toString(), cabeceras, redirecciones - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error('sin respuesta de GitHub')));
    req.on('error', reject);
  });
}

async function ultimaVersionMac() {
  const res = await pedir(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { Accept: 'application/vnd.github+json' });
  let cuerpo = '';
  res.setEncoding('utf8');
  for await (const trozo of res) cuerpo += trozo;
  return String(JSON.parse(cuerpo).tag_name || '').replace(/^v/, '');
}

// La carpeta .app instalada (…/Habbo Inventario.app/Contents/Resources/app.asar sube
// tres niveles), o null si no se puede reemplazar desde aqui.
function rutaAppMac() {
  const ruta = path.resolve(app.getAppPath(), '..', '..', '..');
  if (!ruta.endsWith('.app') || ruta.startsWith('/Volumes/') || ruta.includes('/AppTranslocation/')) return null;
  try { fs.accessSync(path.dirname(ruta), fs.constants.W_OK); return ruta; } catch (_) { return null; }
}

function guardar(res, archivo, alAvanzar) {
  return new Promise((resolve, reject) => {
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let bajado = 0;
    let ultimo = -1;
    const salida = fs.createWriteStream(archivo);
    res.on('data', (trozo) => {
      bajado += trozo.length;
      const p = total ? Math.floor((bajado * 100) / total) : 0;
      if (p !== ultimo) { ultimo = p; alAvanzar(p); }
    });
    res.on('error', reject);
    salida.on('error', reject);
    salida.on('close', resolve);
    res.pipe(salida);
  });
}

const comillas = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// Baja el .zip de la version, lo descomprime y deja listo el script que reemplaza la
// app: espera a que esta se cierre, guarda la copia vieja y la restaura si la copia
// nueva falla, quita la cuarentena y vuelve a abrir la app.
async function prepararMac(version, alAvanzar) {
  const destino = rutaAppMac();
  if (!destino) throw new Error('esta copia de la app no se puede reemplazar sola');
  const nombre = zipMac(version, process.arch === 'arm64' ? 'arm64' : 'x64');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), paquete.name + '-'));
  try {
    const zip = path.join(tmp, 'actualizacion.zip');
    await guardar(await pedir(`${URL_RELEASES}/download/v${version}/${nombre}`), zip, alAvanzar);
    execFileSync('unzip', ['-o', '-q', zip, '-d', tmp]);
    const nuevaApp = fs.readdirSync(tmp).find((n) => n.endsWith('.app'));
    if (!nuevaApp) throw new Error('el .zip no trae la app');
    const nueva = path.join(tmp, nuevaApp);
    execFileSync('xattr', ['-cr', nueva]);
    const script = path.join(tmp, 'instalar.sh');
    fs.writeFileSync(script, [
      '#!/bin/bash',
      `DESTINO=${comillas(destino)}`,
      `NUEVA=${comillas(nueva)}`,
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
      'rm -rf "$DESTINO.anterior"',
      'mv "$DESTINO" "$DESTINO.anterior" || exit 1',
      'if cp -R "$NUEVA" "$DESTINO"; then rm -rf "$DESTINO.anterior"; else rm -rf "$DESTINO"; mv "$DESTINO.anterior" "$DESTINO"; fi',
      'xattr -cr "$DESTINO"',
      'open "$DESTINO"',
      `rm -rf ${comillas(tmp)}`,
      '',
    ].join('\n'), { mode: 0o755 });
    return script;
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

// ── Lo que usan la pantalla de inicio y Ajustes ──────────────────────────
async function buscar() {
  if (!app.isPackaged && !SIMULAR) return cambiar({ fase: 'desarrollo' });
  if (['buscando', 'descargando', 'lista'].includes(estado.fase)) return estado;
  cambiar({ fase: 'buscando' });
  try {
    let version;
    if (SIMULAR) { await espera(1200); version = '9.9.9'; }
    else if (ES_MAC) version = await ultimaVersionMac();
    else {
      const r = await updater().checkForUpdates();
      version = r && r.updateInfo && r.updateInfo.version;
    }
    if (version && compararVersiones(version, app.getVersion()) > 0) {
      return cambiar({ fase: 'disponible', version, manual: ES_MAC && !SIMULAR && !rutaAppMac() });
    }
    return cambiar({ fase: 'al-dia' });
  } catch (e) {
    if (sinVersiones(e)) return cambiar({ fase: 'al-dia', nota: 'Aún no hay versiones publicadas en GitHub.' });
    return cambiar({ fase: 'error', error: mensajeError(e) });
  }
}

async function descargar() {
  if (estado.fase !== 'disponible' || estado.manual) return estado;
  const version = estado.version;
  const avance = (porcentaje) => cambiar({ fase: 'descargando', version, porcentaje });
  avance(0);
  try {
    if (SIMULAR) {
      for (let p = 0; p <= 100; p += 4) {
        if (SIMULAR === 'error' && p > 60) throw new Error('simulación: se cortó la descarga');
        avance(p);
        await espera(90);
      }
    } else if (ES_MAC) scriptMac = await prepararMac(version, avance);
    else await descargarWindows(avance);
    return cambiar({ fase: 'lista', version });
  } catch (e) {
    return cambiar({ fase: 'error', version, error: mensajeError(e) });
  }
}

// Cierra la app e instala. Windows: el instalador NSIS corre con --updated (se salta
// las paginas del asistente) y vuelve a abrir la app, como en Cartera.
function instalar() {
  if (estado.fase !== 'lista') return estado;
  if (SIMULAR) return cambiar({ fase: 'al-dia', nota: 'Simulación: aquí la app se cerraría para instalar la v' + estado.version + '.' });
  if (ES_MAC) {
    spawn('/bin/bash', [scriptMac], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
  } else {
    setTimeout(() => updater().quitAndInstall(false, true), 800);
  }
  return estado;
}

function abrirDescarga() {
  return shell.openExternal(`${URL_RELEASES}/latest`);
}

// Al arrancar, antes de abrir la ventana. `pantalla` es la ventana de inicio:
// { mostrar(estado), preguntar({ titulo, mensaje, botones }) → id del boton }.
// Devuelve 'seguir' (abrir la app), 'cerrar' o 'instalando' (la app se cierra sola).
// Sin internet, sin versiones publicadas o si GitHub tarda, la app abre igual: los
// datos viven en Supabase, no hay nada local que proteger de una version vieja.
async function alArrancar(pantalla) {
  if (!app.isPackaged && !SIMULAR) return 'seguir';
  pantalla.mostrar({ mensaje: 'Buscando actualizaciones…' });
  const encontrada = await Promise.race([buscar(), espera(LIMITE_BUSQUEDA_AL_ARRANCAR).then(() => null)]);
  if (!encontrada || encontrada.fase !== 'disponible') return 'seguir';

  const actual = 'Seguir con la v' + app.getVersion();
  if (encontrada.manual) {
    const id = await pantalla.preguntar({
      titulo: 'Hay una versión nueva: v' + encontrada.version,
      mensaje: 'Esta copia no se puede reemplazar sola (se abrió desde el instalador o sin moverla a Aplicaciones). Descarga la nueva desde GitHub.',
      botones: [{ id: 'descargar', texto: 'Abrir la descarga', primario: true }, { id: 'seguir', texto: actual }],
    });
    if (id === 'descargar') abrirDescarga();
    return id === 'descargar' ? 'cerrar' : id;
  }

  const quitar = alCambiar((s) => {
    if (s.fase === 'descargando') pantalla.mostrar({ mensaje: 'Descargando la v' + s.version, porcentaje: s.porcentaje });
  });
  const final = await descargar();
  quitar();
  if (final.fase === 'lista') {
    if (SIMULAR) {
      await pantalla.preguntar({ titulo: 'Simulación terminada', mensaje: 'Aquí la app se cerraría, instalaría la v' + final.version + ' y volvería a abrirse.', botones: [{ id: 'seguir', texto: 'Abrir la app', primario: true }] });
      cambiar({ fase: 'inactiva' });
      return 'seguir';
    }
    pantalla.mostrar({ mensaje: 'Instalando la v' + final.version, porcentaje: 100 });
    instalar();
    return 'instalando';
  }
  return pantalla.preguntar({
    titulo: 'No se pudo actualizar',
    mensaje: 'No se pudo descargar la v' + final.version + ' (' + final.error + '). Puedes seguir con la versión actual; se intentará de nuevo la próxima vez que abras la app.',
    botones: [{ id: 'seguir', texto: actual, primario: true }, { id: 'cerrar', texto: 'Cerrar' }],
  });
}

module.exports = { alArrancar, buscar, descargar, instalar, abrirDescarga, obtenerEstado, alCambiar, URL_RELEASES };
