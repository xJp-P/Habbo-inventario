// public/js/core/api.js — cliente HTTP del backend local y canal de errores de la UI.
//
// Heredado de Proyecto_Cartera (public/js/core/api.js) con el MISMO contrato: los
// helpers ATRAPAN el error y RESUELVEN `null`; nunca rechazan. Los llamadores comprueban
// `if (!r) return;`, y la guarda anti doble clic (`_submitGuard` en ui.js) libera su
// bandera en el `.then`, que siempre corre.
//
// Novedad: el error lleva `codigo` (SIN_SESION, SIN_CONFIG, SIN_ESQUEMA) para que la App
// sepa cuando mostrar la pantalla de acceso en vez de un aviso.

var _errorHandler = null;
export function setErrorHandler(fn) { _errorHandler = typeof fn === 'function' ? fn : null; }
export function showError(err) {
  if (_errorHandler) _errorHandler(err);
  else console.error(err);
}
export function handleApiError(err) {
  showError(err && err.message ? err : new Error('Error de conexión con el servidor'));
}
export function handleRes(r) {
  if (!r.ok) return r.text().then(function(t) {
    var j = null;
    try { j = JSON.parse(t); } catch (_) { /* no es JSON */ }
    var e = new Error(j && j.error ? j.error : 'Error del servidor (' + r.status + ')');
    e.status = r.status;
    e.codigo = j && j.codigo ? j.codigo : null;
    throw e;
  });
  return r.json();
}
function envio(metodo, b) { return { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }; }
export var API = {
  get:  function(url)   { return fetch(url).then(handleRes).catch(function(e){handleApiError(e);return null;}); },
  post: function(url,b) { return fetch(url,envio('POST',b)).then(handleRes).catch(function(e){handleApiError(e);return null;}); },
  put:  function(url,b) { return fetch(url,envio('PUT',b)).then(handleRes).catch(function(e){handleApiError(e);return null;}); },
  del:  function(url)   { return fetch(url,{method:'DELETE'}).then(handleRes).catch(function(e){handleApiError(e);return null;}); }
};
