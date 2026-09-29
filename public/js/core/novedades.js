// public/js/core/novedades.js — que novedades mostrar al abrir la app.
//
// La regla es la de Proyecto_Cartera (app.js, «Changelog post-actualizacion»): se muestran
// las de la version que corre si la ultima vista (`localStorage.lastSeenVersion`) es otra,
// incluida ninguna (primer arranque o datos borrados), y si esa version tiene entrada en
// CHANGELOGS. Despues se guarda la version como vista, asi que salen una sola vez.
//
// Lo propio de aqui es la PREVISUALIZACION para desarrollo: `?novedades` en la direccion
// (o `--novedades` al arrancar) la muestra aunque ya se haya visto; si la version que corre
// no tiene entrada, muestra la mas reciente, asi se puede revisar el texto de la proxima
// version antes de subirla. `?novedades=1.3.0` muestra una version concreta.
// Modulo aparte, sin React, para que npm run verificar lo pruebe.

import { CHANGELOGS } from '../datos/changelogs.js';

export var CLAVE_VISTA = 'lastSeenVersion';

function comparar(a, b) {
  var x = String(a).split('.').map(Number); var y = String(b).split('.').map(Number);
  for (var i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

export function ultimaVersionConNovedades(changelogs) {
  var versiones = Object.keys(changelogs || CHANGELOGS).sort(comparar);
  return versiones.length ? versiones[versiones.length - 1] : null;
}

// Lo que pide la direccion: null (nada), true (previsualizar) o una version concreta.
export function previsualizacionPedida(busqueda) {
  var m = /[?&]novedades(?:=([0-9]+\.[0-9]+\.[0-9]+))?(?:&|$)/.exec(busqueda || '');
  return m ? (m[1] || true) : null;
}

// { version, items } a mostrar, o null. `vista`: la ultima version vista (o null).
export function novedadesAMostrar(opciones) {
  var cl = opciones.changelogs || CHANGELOGS;
  var version = opciones.version;
  var forzar = opciones.forzar;
  if (forzar) {
    var elegida = typeof forzar === 'string' ? forzar : (cl[version] ? version : ultimaVersionConNovedades(cl));
    return elegida && cl[elegida] ? { version: elegida, items: cl[elegida] } : null;
  }
  if (!version || opciones.vista === version || !cl[version]) return null;
  return { version: version, items: cl[version] };
}
