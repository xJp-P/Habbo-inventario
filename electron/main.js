// electron/main.js — proceso principal de la app de escritorio.
//
// Mismo patron que Proyecto_Cartera: Electron arranca el servidor Express local en
// 127.0.0.1 (solo accesible desde este equipo) y la ventana carga la interfaz desde
// ahi. Ese servidor es el que habla con Supabase.
//
// DATOS LOCALES (la base de datos vive en Supabase; aca solo queda lo de este equipo):
//   - App instalada: carpeta `userData` del sistema
//       Windows: %APPDATA%\Habbo Inventario\
//       macOS:   ~/Library/Application Support/Habbo Inventario/
//   - Desarrollo (npm start): carpeta data/ del proyecto.
// Contiene: .env (URL y Anon Key de Supabase si se configuraron desde la app),
// sesion-supabase.json (CIFRADO con la llave del sistema operativo), la cache del
// catalogo de Habbo.es y los iconos.
//
// Opciones de linea de comandos:
//   --demo            usa el Postgres local del modo demo (sin Supabase)
//   --prueba-arranque abre la ventana, confirma que la interfaz cargo y se cierra
//                     (prueba automatica para CI y para verificar una instalacion)

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const http = require('http');
const { crearApp } = require('../backend/server');

const PUERTO_PREFERIDO = 3435;
const RAIZ = path.join(__dirname, '..');
const DEMO = process.argv.includes('--demo');
const PRUEBA_ARRANQUE = process.argv.includes('--prueba-arranque');

// Una sola instancia: abrir la app dos veces enfoca la ventana existente.
if (!PRUEBA_ARRANQUE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (ventana) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });
}

const dirDatos = app.isPackaged ? app.getPath('userData') : path.join(RAIZ, 'data');

let ventana = null;
let servidor = null;
let puerto = null;
let backend = null;

// Escucha en el puerto preferido; si esta ocupado, prueba los siguientes. Un puerto
// fijo mantiene el mismo origen entre sesiones (y con el, preferencias como el tema).
function escuchar(appExpress, inicial, intentos = 20) {
  return new Promise((resolve, reject) => {
    const probar = (p, quedan) => {
      const s = http.createServer(appExpress);
      s.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && quedan > 0) probar(p + 1, quedan - 1);
        else reject(e);
      });
      s.listen(p, '127.0.0.1', () => resolve({ servidor: s, puerto: p }));
    };
    probar(inicial, intentos);
  });
}

// La sesion de Supabase se guarda cifrada con la llave del sistema operativo (DPAPI en
// Windows, Llavero en macOS). Si el sistema no la ofrece, se guarda sin cifrar.
function cifradoDelSistema() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return {
    cifrar: (texto) => safeStorage.encryptString(texto).toString('base64'),
    descifrar: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
  };
}

async function iniciarBackend() {
  let demo = null;
  if (DEMO) {
    const { crearDemo } = require('../backend/services/demo');
    demo = await crearDemo({ dirDatos });
  }
  backend = await crearApp({
    dirDatos,
    raiz: app.isPackaged ? null : RAIZ,
    cifrado: cifradoDelSistema(),
    demo,
    log: (m) => console.log('[backend] ' + m),
  });
  ({ servidor, puerto } = await escuchar(backend.app, PUERTO_PREFERIDO));
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 680,
    title: 'Habbo Inventario',
    backgroundColor: '#0d1117',
    // Empaquetada, la ventana usa el icono del ejecutable; en desarrollo, el de build/.
    icon: app.isPackaged ? undefined : path.join(RAIZ, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  ventana.setMenu(null);

  // Los enlaces externos (Supabase, GitHub) se abren en el navegador del sistema.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${puerto}`)) e.preventDefault();
  });

  if (PRUEBA_ARRANQUE) {
    ventana.webContents.once('did-finish-load', async () => {
      // Espera a que React pinte y verifica que la interfaz arranco.
      await new Promise((r) => setTimeout(r, 2500));
      const ok = await ventana.webContents.executeJavaScript("!!document.querySelector('[data-app-lista]')");
      console.log(ok ? 'ARRANQUE_OK' : 'ARRANQUE_FALLO: la interfaz no se pinto');
      app.exit(ok ? 0 : 1);
    });
  }

  ventana.once('ready-to-show', () => {
    if (!PRUEBA_ARRANQUE) ventana.maximize();
    ventana.show();
  });
  ventana.on('closed', () => { ventana = null; });
  ventana.loadURL(`http://127.0.0.1:${puerto}`);
}

// ── IPC (lo que la interfaz puede pedirle al sistema) ────────────────────
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  plataforma: process.platform,
  dirDatos,
  empaquetada: app.isPackaged,
  demo: DEMO,
}));

ipcMain.handle('app:abrir-carpeta-datos', () => shell.openPath(dirDatos));

ipcMain.handle('app:elegir-excel', async () => {
  const r = await dialog.showOpenDialog(ventana, {
    title: 'Elegir el Excel a importar',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── Ciclo de vida ────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await iniciarBackend();
  } catch (e) {
    if (PRUEBA_ARRANQUE) { console.log('ARRANQUE_FALLO: ' + e.message); app.exit(1); return; }
    dialog.showErrorBox('Error de arranque',
      'No se pudo iniciar el servidor interno.\n\n' + e.message + '\n\nCarpeta de datos:\n' + dirDatos);
    app.quit();
    return;
  }
  crearVentana();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on('window-all-closed', async () => {
  if (servidor) servidor.close();
  if (backend) await backend.cerrar().catch(() => {});
  app.quit();
});
