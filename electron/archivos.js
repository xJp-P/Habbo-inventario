// electron/archivos.js — guardar un archivo que arma la interfaz (v1.9.0: el CSV del
// Historial de ventas). En la app de escritorio no hay barra de descargas: se usa el
// dialogo «Guardar como» del sistema (propone Descargas y el nombre del archivo), y la
// interfaz dice donde quedo y ofrece «Mostrar» (solo para lo guardado en esta sesion).
//
// Las piezas del sistema llegan de fuera (dialogo, carpeta de descargas, escribir y
// mostrar): npm run verificar lo prueba con piezas falsas.

const path = require('path');
const fs = require('fs');

// Un CSV de miles de ventas pesa unos cientos de KB: el tope solo frena un abuso.
const TOPE_BYTES = 20 * 1024 * 1024;

// Solo el nombre (sin carpetas), sin caracteres que Windows no admite y con .csv.
function nombreSeguro(nombre) {
  // Las dos barras en cualquier sistema (en Mac, path.basename no corta en «\»).
  const base = String(nombre || '').split(/[\\/]/).pop().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
  const sinExt = base.replace(/\.csv$/i, '').replace(/^\.+/, '');
  return (sinExt || 'historial-ventas') + '.csv';
}

function crearArchivos({ dialogo, carpetaDescargas, escribir = fs.promises.writeFile, mostrar }) {
  const guardados = new Set();

  // { nombre, contenido } -> { ruta, nombre } o null si se cancelo el dialogo.
  async function guardarCsv(ventana, datos) {
    const contenido = String((datos && datos.contenido) || '');
    if (Buffer.byteLength(contenido, 'utf8') > TOPE_BYTES) throw new Error('El archivo es demasiado grande para guardarlo.');
    const r = await dialogo.showSaveDialog(ventana, {
      title: 'Guardar el historial de ventas',
      defaultPath: path.join(carpetaDescargas(), nombreSeguro(datos && datos.nombre)),
      filters: [{ name: 'CSV para Excel', extensions: ['csv'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const ruta = /\.csv$/i.test(r.filePath) ? r.filePath : r.filePath + '.csv';
    await escribir(ruta, contenido, 'utf8');
    guardados.add(ruta);
    return { ruta, nombre: path.basename(ruta) };
  }

  // «Mostrar» abre la carpeta con el archivo marcado; solo lo que se guardo aqui.
  function mostrarArchivo(ruta) {
    if (typeof ruta !== 'string' || !guardados.has(ruta)) return false;
    mostrar(ruta);
    return true;
  }

  return { guardarCsv, mostrarArchivo };
}

module.exports = { crearArchivos, nombreSeguro, TOPE_BYTES };
