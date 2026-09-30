// public/js/core/errores.js — registro de los errores de esta sesion (v1.6.1).
//
// Antes, un error solo se veia en un aviso de unos segundos y, si fallaba la carga
// inicial, la app se quedaba en un spinner sin decir nada. Ahora todo error que ve la
// interfaz queda aqui con su detalle: una peticion al servidor local que falla o no
// responde, una seccion que no se pudo dibujar o un error de JavaScript suelto.
// ErroresModal lo muestra fijo, seleccionable y con «Copiar detalles», para enviarlo o
// sacarle una foto con calma.
//
// Solo vive en memoria: se pierde al cerrar la app. textoInforme() arma el texto que se
// copia; es puro (sin React) y lo prueba scripts/verificar.js.

var MAXIMO = 30;
var lista = [];
var oyentes = [];
var siguiente = 1;

// origen: 'api' (una peticion), 'seccion' (una vista que no se pudo dibujar) o 'interfaz'
// (un error de JavaScript fuera de React).
export function registrarError(e) {
  var r = {
    id: siguiente++,
    hora: e.hora || new Date().toISOString(),
    origen: e.origen || 'api',
    metodo: e.metodo || null,
    ruta: e.ruta || null,
    status: e.status || null,
    codigo: e.codigo || null,
    mensaje: String(e.mensaje || 'Error desconocido'),
    detalle: e.detalle || null,
  };
  lista = lista.concat([r]).slice(-MAXIMO);
  oyentes.forEach(function (fn) { try { fn(lista); } catch (_) { /* un oyente roto no frena a los demas */ } });
  return r;
}

// Un Error de core/api.js (o cualquiera) al formato del registro.
export function desdeError(err, origen) {
  return {
    origen: origen || 'api', metodo: err && err.metodo, ruta: err && err.ruta, status: err && err.status,
    codigo: err && err.codigo, mensaje: err && err.message ? err.message : String(err), detalle: err && err.detalle,
  };
}

export function erroresRegistrados() { return lista; }

export function alCambiarErrores(fn) {
  oyentes.push(fn);
  return function () { oyentes = oyentes.filter(function (x) { return x !== fn; }); };
}

export function limpiarErrores() {
  lista = [];
  oyentes.forEach(function (fn) { try { fn(lista); } catch (_) { /* idem */ } });
}

function hora(iso) {
  var d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

var ORIGENES = { api: 'Petición', seccion: 'Sección', interfaz: 'Interfaz' };

// Titulo de una linea: «GET /api/compras · 500» o «Sección Inventario».
export function tituloError(e) {
  if (e.origen === 'api') return [e.metodo, e.ruta].filter(Boolean).join(' ') + (e.status ? ' · ' + e.status : e.codigo === 'SIN_RESPUESTA' ? ' · sin respuesta' : '');
  return ORIGENES[e.origen] + (e.ruta ? ' ' + e.ruta : '');
}

// El texto para copiar o fotografiar. `d`: { version, equipo, seccion, migraciones:
// { instaladas, total, siguiente } | null, errores, ahora }.
export function textoInforme(d) {
  var lineas = ['Habbo Inventario ' + (d.version || '¿?') + ' — informe de errores', 'Fecha: ' + hora(d.ahora || new Date().toISOString())];
  if (d.equipo) lineas.push('Equipo: ' + d.equipo);
  if (d.seccion) lineas.push('Sección abierta: ' + d.seccion);
  var m = d.migraciones;
  if (m && m.total) {
    lineas.push('Base de datos: ' + m.instaladas + ' de ' + m.total + ' migraciones' + (m.instaladas < m.total && m.siguiente ? ' (falta ' + m.siguiente + ')' : ''));
  } else if (m && m.error) {
    lineas.push('Base de datos: no se pudo comprobar (' + m.error + ')');
  }
  var errores = (d.errores || []).slice().reverse();
  lineas.push('', errores.length ? 'Errores (del más reciente al más antiguo):' : 'Sin errores registrados.');
  errores.forEach(function (e) {
    lineas.push('#' + e.id + ' · ' + hora(e.hora) + ' · ' + tituloError(e) + (e.codigo && e.codigo !== 'SIN_RESPUESTA' ? ' · ' + e.codigo : ''));
    lineas.push('    ' + e.mensaje);
    if (e.detalle) lineas.push('    Dónde: ' + String(e.detalle).split('\n').join('\n           '));
  });
  return lineas.join('\n');
}

// Los errores de React en produccion llegan cifrados («Minified React error #31; visit
// https://reactjs.org/docs/error-decoder.html?invariant=31&args[]=…»). Se traducen a algo
// legible, con el codigo y sus datos para el diagnostico.
var ERRORES_REACT = {
  31: 'un dato con formato inesperado (un objeto donde se esperaba texto o un número)',
  130: 'una pieza de la pantalla que no existe',
  185: 'demasiadas actualizaciones seguidas (un bucle)',
  301: 'demasiados redibujos seguidos (un bucle)',
  310: 'un cambio de estructura entre dos dibujos',
};
export function mensajeLegible(msg) {
  msg = String(msg || '');
  var m = msg.match(/Minified React error #(\d+)/);
  if (!m) return msg;
  var datos = [];
  var re = /args\[\]=([^&\s]+)/g;
  var x;
  while ((x = re.exec(msg))) { try { datos.push(decodeURIComponent(x[1])); } catch (_) { datos.push(x[1]); } }
  return 'Error al dibujar: ' + (ERRORES_REACT[m[1]] || 'error interno de React') + (datos.length ? ' — ' + datos.join(', ') : '') + ' (React #' + m[1] + ')';
}

// «Windows · Electron 38» a partir del navegador (sin datos personales).
export function describirEquipo(ua) {
  ua = String(ua || '');
  var so = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  var electron = ua.match(/Electron\/([\d.]+)/);
  var chrome = ua.match(/Chrome\/(\d+)/);
  return so + ' · ' + (electron ? 'app de escritorio (Electron ' + electron[1].split('.')[0] + ')' : chrome ? 'navegador (Chrome ' + chrome[1] + ')' : 'navegador');
}
