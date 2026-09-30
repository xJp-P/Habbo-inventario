// public/js/core/api.js — cliente HTTP del backend local y canal de errores de la UI.
//
// Heredado de Proyecto_Cartera (public/js/core/api.js) con el MISMO contrato: los
// helpers ATRAPAN el error y RESUELVEN `null`; nunca rechazan. Los llamadores comprueban
// `if (!r) return;`, y la guarda anti doble clic (`_submitGuard` en ui.js) libera su
// bandera en el `.then`, que siempre corre.
//
// Novedad: el error lleva `codigo` (SIN_SESION, SIN_CONFIG, SIN_ESQUEMA) para que la App
// sepa cuando mostrar la pantalla de acceso en vez de un aviso.
//
// v1.6.1: el error lleva tambien metodo, ruta, status y `detalle` (donde fallo en el
// servidor) y queda en el registro de la sesion (core/errores.js) para verlo y copiarlo
// en ErroresModal. `API.intentar` resuelve { datos, error } sin avisar (la carga inicial
// decide que mostrar) y acepta `espera`: pasado ese tiempo sin respuesta, es un error
// visible (SIN_RESPUESTA) en vez de un spinner infinito.

import { registrarError, desdeError } from './errores.js';

var _errorHandler = null;
export function setErrorHandler(fn) { _errorHandler = typeof fn === 'function' ? fn : null; }
export function showError(err) {
  if (_errorHandler) _errorHandler(err);
  else console.error(err);
}
// La sesion vencida o sin configurar no es un fallo: la App muestra el acceso.
function esDeSesion(err) { return err && (err.codigo === 'SIN_SESION' || err.codigo === 'SIN_CONFIG'); }
function registrar(err) { if (!esDeSesion(err)) registrarError(desdeError(err, 'api')); }
export function handleApiError(err) {
  var e = err && err.message ? err : new Error('Error de conexión con el servidor');
  registrar(e);
  showError(e);
}
export function handleRes(r) {
  if (!r.ok) return r.text().then(function(t) {
    var j = null;
    try { j = JSON.parse(t); } catch (_) { /* no es JSON */ }
    var e = new Error(j && j.error ? j.error : 'Error del servidor (' + r.status + ')');
    e.status = r.status;
    e.codigo = j && j.codigo ? j.codigo : null;
    e.detalle = j && j.detalle ? j.detalle : null;
    throw e;
  });
  return r.json();
}
function envio(metodo, b) { return { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }; }

// Una peticion que rechaza con un Error completo (metodo, ruta, status, codigo, detalle).
function pedir(metodo, url, cuerpo, op) {
  var espera = op && op.espera;
  var ctrl = espera && typeof AbortController !== 'undefined' ? new AbortController() : null;
  var reloj = ctrl ? setTimeout(function () { ctrl.abort(); }, espera) : null;
  var init = metodo === 'GET' ? {} : metodo === 'DELETE' ? { method: 'DELETE' } : envio(metodo, cuerpo);
  if (ctrl) init.signal = ctrl.signal;
  return fetch(url, init).then(handleRes).then(function (d) { clearTimeout(reloj); return d; }, function (e) {
    clearTimeout(reloj);
    var err;
    if (e && e.name === 'AbortError') {
      err = new Error('Sin respuesta en ' + Math.round(espera / 1000) + ' s: el servidor local sigue esperando a Supabase o se quedó colgado.');
      err.codigo = 'SIN_RESPUESTA';
    } else {
      err = e && e.message ? e : new Error('Error de conexión con el servidor');
    }
    err.metodo = metodo;
    err.ruta = url;
    throw err;
  });
}

export var API = {
  get:  function(url)   { return pedir('GET', url).catch(function(e){handleApiError(e);return null;}); },
  post: function(url,b) { return pedir('POST', url, b).catch(function(e){handleApiError(e);return null;}); },
  put:  function(url,b) { return pedir('PUT', url, b).catch(function(e){handleApiError(e);return null;}); },
  del:  function(url)   { return pedir('DELETE', url).catch(function(e){handleApiError(e);return null;}); },
  // Sin aviso: resuelve { datos, error } y deja el error en el registro (salvo los de sesion).
  intentar: function(metodo, url, cuerpo, op) {
    return pedir(metodo, url, cuerpo, op).then(function (d) { return { datos: d, error: null }; },
      function (e) { registrar(e); return { datos: null, error: e }; });
  },
};
