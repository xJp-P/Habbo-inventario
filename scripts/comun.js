// scripts/comun.js — rutas y utilidades compartidas por los scripts de consola.

const fs = require('fs');
const os = require('os');
const path = require('path');
const pkg = require('../package.json');

const RAIZ = path.join(__dirname, '..');

// Carpeta de datos en modo desarrollo (npm start / npm run web sin empaquetar): cache del
// catalogo, iconos, sesion de Supabase y la base del modo demo.
const DIR_DATOS_DEV = path.join(RAIZ, 'data');

// Carpeta de datos de la app INSTALADA. Es la misma que Electron usa como `userData`
// (se nombra con productName de package.json).
function dirDatosApp() {
  const nombre = pkg.productName || pkg.name;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), nombre);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', nombre);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), nombre);
}

// El Excel original en la raiz del proyecto (inventario_habbo.xlsx, Furnis_en_venta.xlsx
// o el unico .xlsx que haya). null si no hay.
function buscarExcel() {
  for (const nombre of ['inventario_habbo.xlsx', 'Furnis_en_venta.xlsx']) {
    const ruta = path.join(RAIZ, nombre);
    if (fs.existsSync(ruta)) return ruta;
  }
  const candidatos = fs.readdirSync(RAIZ).filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'));
  return candidatos.length === 1 ? path.join(RAIZ, candidatos[0]) : null;
}

module.exports = { RAIZ, DIR_DATOS_DEV, dirDatosApp, buscarExcel };
