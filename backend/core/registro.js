// backend/core/registro.js — archivo de registro de errores (v1.6.1).
//
// Cuando un usuario reporta un fallo y no tiene capturas, este archivo es lo que queda:
// `registro-errores.log` en la carpeta de datos de la app (junto a la configuracion y el
// catalogo). Anota:
//   - una linea al arrancar, con la version y el sistema;
//   - los errores del servidor local que no son del usuario: los inesperados (500) y los
//     5xx (sin conexion, Supabase sin respuesta), mas la base sin esquema;
//   - los que le envia la interfaz (secciones que no se dibujaron, peticiones sin
//     respuesta, errores de JavaScript), por POST /api/registro-errores.
// Nada personal: las rutas vienen recortadas (rastro) y se tachan tokens de Sniper y JWT.
// Al pasar de ~1 MB, el archivo pasa a `registro-errores.anterior.log` y empieza otro.
// Escribir nunca debe tumbar la app: cualquier fallo del disco se ignora.

const fs = require('fs');
const path = require('path');

const ARCHIVO = 'registro-errores.log';
const ANTERIOR = 'registro-errores.anterior.log';
const LARGO = 2000;

function dos(n) { return String(n).padStart(2, '0'); }
function fecha(d) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

// Recorta y tacha lo que nunca debe quedar en un archivo que se va a compartir.
function limpiar(texto) {
  return String(texto === undefined || texto === null ? '' : texto)
    .replace(/hbi_[A-Za-z0-9_-]{6,}/g, 'hbi_…')
    .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/g, '[jwt]')
    .slice(0, LARGO);
}

function crearRegistroErrores({ dirDatos, version, tope = 1024 * 1024, ahora = () => new Date() }) {
  const ruta = dirDatos ? path.join(dirDatos, ARCHIVO) : null;
  let cola = Promise.resolve();

  // En orden, de a una escritura (appendFile en paralelo podria mezclar lineas).
  function escribir(texto) {
    if (!ruta) return Promise.resolve();
    cola = cola.then(async () => {
      try {
        const info = await fs.promises.stat(ruta).catch(() => null);
        if (info && info.size > tope) await fs.promises.rename(ruta, path.join(dirDatos, ANTERIOR)).catch(() => {});
        await fs.promises.appendFile(ruta, texto, 'utf8');
      } catch (_) { /* sin carpeta o sin permiso: el registro nunca tumba la app */ }
    });
    return cola;
  }

  // Una entrada: «2026-09-30 14:22:05 · servidor · GET /api/compras · 500 · CODIGO», el
  // mensaje y, sangrado, el detalle (donde fallo).
  function anotar(e) {
    const cabecera = [fecha(ahora()), limpiar(e.origen || 'servidor'), limpiar([e.metodo, e.ruta].filter(Boolean).join(' ')), e.status, limpiar(e.codigo || '')]
      .filter(Boolean).join(' · ');
    let texto = cabecera + '\n    ' + limpiar(e.mensaje || 'Error sin mensaje') + '\n';
    if (e.detalle) texto += limpiar(e.detalle).split('\n').map((l) => '    ' + l).join('\n') + '\n';
    return escribir(texto);
  }

  function inicio(extra) {
    return escribir(`\n=== ${fecha(ahora())} · Habbo Inventario ${version || '¿?'} · ${process.platform}${extra ? ' · ' + extra : ''} ===\n`);
  }

  return { anotar, inicio, ruta, pendiente: () => cola };
}

module.exports = { crearRegistroErrores, ARCHIVO_REGISTRO: ARCHIVO };
