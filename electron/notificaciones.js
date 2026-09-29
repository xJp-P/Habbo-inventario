// electron/notificaciones.js — notificaciones nativas del sistema (Windows; en Mac, ver
// abajo), decididas SOLO por el proceso principal.
//
// El servidor local corre dentro de este proceso y publica en su bus lo que llega en vivo
// (backend/server.js): `auditoria` (con los avisos de diferencias NUEVAS que arma
// backend/core/avisos.js) y `catalogo-nuevo`. Aca solo se decide si mostrarlo:
//   - nunca si estas mirando la app (ventana visible, no minimizada y enfocada): ahi ya lo
//     ves en la propia Auditoria;
//   - nunca si apagaste ese tipo en Ajustes (preferencias.json en la carpeta de datos);
//   - al hacer clic, la ventana se restaura, pasa al frente y abre la Auditoria del keko.
// La interfaz no puede disparar notificaciones: solo leer y cambiar las preferencias y
// pedir una de prueba.
//
// WINDOWS: el aviso sale con el nombre y el icono del acceso directo del menu Inicio. El
// instalador NSIS de electron-builder marca ese acceso con el `appId` como AUMID, y
// main.js pone el MISMO en el proceso (`APP_ID`, que npm run verificar compara con
// build.appId: electron-builder quita `build` del package.json empaquetado). Clic en un
// aviso ya archivado en el Centro de actividades: no garantizado (NSIS no escribe el
// ToastActivatorCLSID); son solo informativos.
// MAC: desde Electron 42 las notificaciones usan UNNotification, que exige firma de codigo,
// y la app no esta firmada (firmarla ad-hoc cambiaria la firma en cada version y el Llavero,
// donde vive la sesion, volveria a pedir permiso). Plan B: el icono del Dock rebota una vez
// y muestra un globo con los avisos sin ver. Al volver a la app (la ventana toma el foco o
// haces clic en el Dock) el globo desaparece y la ventana vuelve al frente.
//
// `Notification`, el Dock y la ventana se reciben por parametro: asi las pruebas usan unos
// falsos. `dock` es null fuera de Mac.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_ID = 'io.github.xjpp.habboinventario';
const ARCHIVO_PREFERENCIAS = 'preferencias.json';
const POR_DEFECTO = { inventario: true, catalogo: true };

// { inventario, catalogo }: ambas encendidas si nunca se tocaron.
function crearPreferencias(dirDatos) {
  const ruta = path.join(dirDatos, ARCHIVO_PREFERENCIAS);
  function archivo() {
    try { return JSON.parse(fs.readFileSync(ruta, 'utf8')) || {}; } catch (_) { return {}; }
  }
  function leer() {
    const n = archivo().notificaciones || {};
    const r = {};
    for (const k of Object.keys(POR_DEFECTO)) r[k] = typeof n[k] === 'boolean' ? n[k] : POR_DEFECTO[k];
    return r;
  }
  function guardar(cambios) {
    const r = leer();
    for (const k of Object.keys(POR_DEFECTO)) if (cambios && typeof cambios[k] === 'boolean') r[k] = cambios[k];
    const todo = archivo();
    todo.notificaciones = r;
    fs.mkdirSync(dirDatos, { recursive: true });
    fs.writeFileSync(ruta + '.tmp', JSON.stringify(todo, null, 2));
    fs.renameSync(ruta + '.tmp', ruta);
    return r;
  }
  return { leer, guardar };
}

// Un aviso por keko: el nuevo reemplaza al anterior. En Windows el id es la Tag del aviso,
// que admite pocos caracteres (16 en Windows 10 antiguo): una huella corta del keko.
function idAuditoria(keko) {
  return 'aud-' + crypto.createHash('sha1').update(String(keko)).digest('hex').slice(0, 10);
}

// Estas mirando la app: no hace falta avisarte fuera de ella.
function atendida(w) {
  return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused();
}

function traerAlFrente(w) {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

function crearNotificaciones({ Notification, ventana, preferencias, dock = null, alAbrir = () => {}, log = () => {} }) {
  // Referencias vivas hasta que el aviso se cierra: si el recolector se lleva el objeto,
  // el clic ya no llega.
  const vivas = new Set();
  // Mac: avisos sin ver (uno por id: el de un mismo keko cuenta una vez), el numero del globo.
  const sinVer = new Set();
  const ponerGlobo = () => { if (dock) dock.globo(sinVer.size); };

  function mostrar({ tipo, id, titulo, cuerpo, silencioso = false, destino = null, forzar = false }) {
    if (!forzar && !preferencias.leer()[tipo]) return 'apagada';
    if (!forzar && atendida(ventana())) return 'atendida';
    if (dock) {
      sinVer.add(id);
      ponerGlobo();
      if (!silencioso) dock.rebotar();
      return 'dock';
    }
    if (!Notification.isSupported()) return 'sin-soporte';
    const n = new Notification({ title: titulo, body: cuerpo, id, silent: !!silencioso });
    vivas.add(n);
    const soltar = () => vivas.delete(n);
    n.on('click', () => {
      soltar();
      traerAlFrente(ventana());
      if (destino) alAbrir(destino);
    });
    n.on('close', soltar);
    n.on('failed', (_e, error) => { soltar(); log('No se pudo mostrar la notificacion: ' + error); });
    n.show();
    return 'mostrada';
  }

  // Lo que llega por el bus del servidor.
  function alEvento(e) {
    if (!e) return;
    if (e.tipo === 'auditoria') {
      for (const a of e.avisos || []) {
        mostrar({ tipo: 'inventario', id: idAuditoria(a.keko), titulo: a.titulo, cuerpo: a.cuerpo, silencioso: a.silencioso,
          destino: { vista: 'auditoria', keko: a.keko } });
      }
    } else if (e.tipo === 'catalogo-nuevo') {
      mostrar({ tipo: 'catalogo', id: 'catalogo', titulo: e.titulo, cuerpo: e.cuerpo });
    }
  }

  // Volviste a la app (la ventana tomo el foco): el globo del Dock desaparece.
  function alVolver() {
    if (!sinVer.size) return;
    sinVer.clear();
    ponerGlobo();
  }

  // Clic en el icono del Dock: la ventana vuelve al frente y el globo desaparece.
  function alActivar() {
    traerAlFrente(ventana());
    alVolver();
  }

  // Desde Ajustes: una de prueba, aunque estes mirando la app y aunque esten apagadas. En
  // Mac, el globo con un aviso mas durante 5 segundos (con la app activa, el Dock no rebota).
  function probar() {
    if (dock) {
      dock.rebotar();
      dock.globo(sinVer.size + 1);
      setTimeout(ponerGlobo, 5000);
      return 'dock';
    }
    return mostrar({ tipo: 'prueba', id: 'prueba', forzar: true, titulo: 'Habbo Inventario',
      cuerpo: 'Así se verán tus avisos. Haz clic aquí para volver a la app.' });
  }

  return { mostrar, alEvento, probar, alVolver, alActivar, vivas: () => vivas.size, sinVer: () => sinVer.size };
}

module.exports = { APP_ID, crearPreferencias, crearNotificaciones, atendida, idAuditoria };
