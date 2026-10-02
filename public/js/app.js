// public/js/app.js — raiz de la interfaz: sesion, navegacion, datos, avisos y modales.
//
// Estructura heredada de Proyecto_Cartera (app-layout: sidebar + main-header +
// main-content, toast arriba, tema en data-theme de <html> guardado en localStorage).
// Tema OSCURO por defecto (decision de diseño aprobada).
//
// Flujo de datos: la App carga todo junto (resumen, furnis, lotes y huerfanos) y lo
// vuelve a cargar tras cada cambio. Las compras que llegan de los SniperMercadillo se
// anuncian por /api/eventos (Supabase Realtime -> servidor local -> aca): aviso +
// recarga, sin tocar nada.
//
// Si a la base le falta una migracion (una actualizacion de la app trajo una nueva y
// aun no se ejecuto en Supabase), un aviso arriba abre la misma lista del asistente.
//
// Errores visibles (v1.6.1): si la carga inicial falla o no responde en ESPERA_CARGA, en
// vez de un spinner infinito se abre ErroresModal con el detalle para copiar y
// «Reintentar». Cada error de la sesion queda en core/errores.js: el boton rojo de la
// cabecera y «Ver detalles» de un aviso abren la lista. Cada seccion va dentro de una
// Barrera: si falla al dibujarse, lo dice ella sola y el menu sigue funcionando.
//
// Carga por partes (v1.6.1, fase 2): resumen, furnis, lotes y «por revisar» llegan cada
// uno por su cuenta y cada seccion espera solo lo que usa (NECESITA). Si una parte falla,
// solo las secciones que la usan lo dicen; las demas siguen. Ajustes no espera nada: se
// abre siempre, aunque no llegue ningun dato.
//
// Ventas del Sniper (v1.7.0): las «por asignar» son una parte mas (ninguna seccion la
// espera; su numero va en azul junto a Inventario). Llegan en vivo con un aviso que dice
// lo vendido (y «Ver» si alguna quedo por asignar). Marcar «Vendido» a mano en un keko
// cuyo Sniper ya registra sus ventas pregunta antes: se contaria dos veces.

import { h, useState, useEffect, useCallback, useRef, createRoot } from './core/react.js';
import { API, setErrorHandler } from './core/api.js';
import { fmtLg, fmtCr } from './core/format.js';
import { Ico } from './componentes/iconos.js';
import { Spinner, Modal, Confirmar } from './componentes/base.js';
import { AccesoView, InstalarBase } from './vistas/Acceso.js';
import { ResumenView } from './vistas/Resumen.js';
import { MercadilloView } from './vistas/Mercadillo.js';
import { InventarioView } from './vistas/Inventario.js';
import { AjustesView } from './vistas/Ajustes.js';
import { AuditoriaView } from './vistas/Auditoria.js';
import { CompraModal } from './modales/CompraModal.js';
import { VenderModal } from './modales/VenderModal.js';
import { PublicarModal } from './modales/PublicarModal.js';
import { VenderFurniModal } from './modales/VenderFurniModal.js';
import { RetirarFurniModal } from './modales/RetirarFurniModal.js';
import { VentaManualModal } from './modales/VentaManualModal.js';
import { NovedadesModal } from './componentes/NovedadesModal.js';
import { novedadesAMostrar, previsualizacionPedida, CLAVE_VISTA } from './core/novedades.js';
import { LtdModal } from './modales/LtdModal.js';
import { AsignarVentaModal } from './modales/AsignarVentaModal.js';
import { esDelKeko } from './core/kekos.js';
import { kekoConVentasSniper, nombreVentaPendiente } from './core/ventas.js';
import { ErroresModal } from './componentes/ErroresModal.js';
import { Barrera } from './componentes/Barrera.js';
import { registrarError, erroresRegistrados, alCambiarErrores, limpiarErrores, describirEquipo } from './core/errores.js';

// Cuanto se espera cada peticion de la carga antes de darla por fallida.
var ESPERA_CARGA = 30000;
// Las partes de la carga y lo que necesita cada seccion para dibujarse.
var PARTES = {
  resumen: { ruta: '/api/resumen', nombre: 'el resumen' },
  furnis: { ruta: '/api/furnis', nombre: 'tus furnis' },
  compras: { ruta: '/api/compras', nombre: 'tus lotes' },
  pendientes: { ruta: '/api/pendientes', nombre: 'lo «por revisar»' },
  porAsignar: { ruta: '/api/ventas-por-asignar', nombre: 'las ventas por asignar' },
};
var NECESITA = {
  resumen: ['resumen'],
  mercadillo: ['furnis', 'compras'],
  inventario: ['compras', 'pendientes'],
  auditoria: ['furnis', 'compras'],
  ajustes: [],
};
function esDeSesion(e) { return e && (e.codigo === 'SIN_SESION' || e.codigo === 'SIN_CONFIG'); }

var NAV = [
  ['resumen', 'dashboard', 'Resumen'],
  ['mercadillo', 'store', 'Mercadillo'],
  ['inventario', 'box', 'Inventario'],
  ['auditoria', 'audit', 'Auditoría'],
  ['ajustes', 'plug', 'Ajustes'],
];

function leerTema() { try { return localStorage.getItem('tema') || 'dark'; } catch (_) { return 'dark'; } }

function App() {
  var sC = useState(null); var cuenta = sC[0]; var setCuenta = sC[1];
  var sV = useState('resumen'); var vista = sV[0]; var setVista = sV[1];
  // Las partes que ya llegaron (una clave de PARTES que falta = todavia no llego).
  var sD = useState({}); var datos = sD[0]; var setDatos = sD[1];
  var sT = useState(null); var toast = sT[0]; var setToast = sT[1];
  var sTe = useState(leerTema()); var tema = sTe[0]; var setTema = sTe[1];
  var sM = useState(null); var modal = sM[0]; var setModal = sM[1];
  var sMenu = useState(false); var menuPlegado = sMenu[0]; var setMenuPlegado = sMenu[1];
  var sEnf = useState(null); var enfocar = sEnf[0]; var setEnfocar = sEnf[1];
  var sFil = useState(''); var filtroFurni = sFil[0]; var setFiltroFurni = sFil[1];
  var sFilE = useState('comprado'); var filtroEstado = sFilE[0]; var setFiltroEstado = sFilE[1];
  var sMig = useState(null); var faltanMig = sMig[0]; var setFaltanMig = sMig[1];
  var sAud = useState(null); var resAuditoria = sAud[0]; var setResAuditoria = sAud[1];
  var sKek = useState(null); var kekos = sKek[0]; var setKekos = sKek[1];
  var sNov = useState(null); var novedades = sNov[0]; var setNovedades = sNov[1];
  // Auditoria en vivo: cada foto nueva del Sniper sube `senalAuditoria` (la vista se
  // recarga sola); el clic en una notificacion deja en `abrirAuditoria` el keko a abrir.
  var sSen = useState(0); var senalAuditoria = sSen[0]; var setSenalAuditoria = sSen[1];
  var sAbA = useState(null); var abrirAuditoria = sAbA[0]; var setAbrirAuditoria = sAbA[1];
  // Clic en el aviso de ventas del Sniper: la pestaña del Inventario a abrir ({ filtro, keko, vez }).
  var sAbI = useState(null); var abrirInventario = sAbI[0]; var setAbrirInventario = sAbI[1];
  // Errores de la sesion, el modal que los muestra ('carga' | 'registro') y las partes de
  // la carga que fallaron la ultima vez ({ clave: Error }).
  var sErr = useState(erroresRegistrados); var errores = sErr[0]; var setErrores = sErr[1];
  var sVE = useState(null); var verErrores = sVE[0]; var setVerErrores = sVE[1];
  var sFa = useState({}); var fallos = sFa[0]; var setFallos = sFa[1];
  var sEM = useState(null); var estadoMig = sEM[0]; var setEstadoMig = sEM[1];
  // Las partes que llegaron alguna vez en esta sesion (para distinguir una carga que falla
  // de una recarga que falla).
  var llegaron = useRef({});

  // `accion` ({ texto, fn }): un boton en el aviso (que entonces dura mas).
  var avisar = useCallback(function (msg, tipo, accion) {
    setToast({ msg: msg, tipo: tipo || 'ok', id: Date.now(), accion: accion || null });
  }, []);

  useEffect(function () {
    if (!toast) return;
    var t = setTimeout(function () { setToast(null); }, toast.tipo === 'error' || toast.accion ? 8000 : 2800);
    return function () { clearTimeout(t); };
  }, [toast]);

  useEffect(function () {
    document.documentElement.setAttribute('data-theme', tema);
    try { localStorage.setItem('tema', tema); } catch (_) { /* sin almacenamiento */ }
  }, [tema]);

  var cargarCuenta = useCallback(function () {
    return fetch('/api/cuenta').then(function (r) { return r.json(); }).then(setCuenta)
      .catch(function () { setCuenta({ estado: 'sin_configurar', error: true }); });
  }, []);

  useEffect(function () {
    setErrorHandler(function (err) {
      if (err && (err.codigo === 'SIN_SESION' || err.codigo === 'SIN_CONFIG')) { cargarCuenta(); return; }
      avisar(err && err.message ? err.message : String(err), 'error');
    });
    cargarCuenta();
  }, []);

  // El registro de errores de la sesion, al dia; y los errores de JavaScript sueltos (fuera
  // de React, p. ej. en una promesa) tambien quedan ahi.
  useEffect(function () {
    // Al archivo registro-errores.log (carpeta de datos) van los de la interfaz y las
    // peticiones que no llegaron a tener respuesta; los 5xx ya los anota el servidor.
    var anotados = 0;
    var quitar = alCambiarErrores(function (l) {
      setErrores(l);
      var nuevos = l.filter(function (e) { return e.id > anotados && (e.origen !== 'api' || !e.status); });
      if (l.length) anotados = Math.max(anotados, l[l.length - 1].id);
      if (nuevos.length) {
        fetch('/api/registro-errores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ errores: nuevos }) })
          .catch(function () { /* sin servidor: queda en pantalla igual */ });
      }
    });
    function suelto(e) { registrarError({ origen: 'interfaz', mensaje: e.message || 'Error de JavaScript', detalle: e.error && e.error.stack ? String(e.error.stack).split('\n').slice(0, 4).join('\n') : null }); }
    function promesa(e) { var r = e.reason; registrarError({ origen: 'interfaz', mensaje: r && r.message ? r.message : String(r), detalle: r && r.stack ? String(r.stack).split('\n').slice(0, 4).join('\n') : null }); }
    window.addEventListener('error', suelto);
    window.addEventListener('unhandledrejection', promesa);
    return function () { quitar(); window.removeEventListener('error', suelto); window.removeEventListener('unhandledrejection', promesa); };
  }, []);

  // Carga los datos por partes: cada una se guarda en cuanto llega. Si una falla o no
  // responde a tiempo: si nunca habia llegado, se abre el modal de la carga; si ya la
  // habia, se conserva la anterior y sale un aviso con «Ver detalles». La sesion vencida
  // no es un fallo: vuelve al acceso.
  var recargar = useCallback(function () {
    var antes = Object.assign({}, llegaron.current);
    return Promise.all(Object.keys(PARTES).map(function (clave) {
      return API.intentar('GET', PARTES[clave].ruta, null, { espera: ESPERA_CARGA }).then(function (r) {
        if (!r.error) {
          llegaron.current[clave] = true;
          setDatos(function (d) { var n = Object.assign({}, d); n[clave] = r.datos; return n; });
          setFallos(function (f) { if (!f[clave]) return f; var n = Object.assign({}, f); delete n[clave]; return n; });
        } else if (!esDeSesion(r.error)) {
          setFallos(function (f) { var n = Object.assign({}, f); n[clave] = r.error; return n; });
        }
        return { clave: clave, error: r.error };
      });
    })).then(function (r) {
      var malas = r.filter(function (x) { return x.error; });
      if (malas.some(function (x) { return esDeSesion(x.error); })) { cargarCuenta(); return; }
      if (malas.some(function (x) { return !antes[x.clave]; })) setVerErrores(function (v) { return v || 'carga'; });
      else if (malas.length) {
        avisar('No se pudo actualizar ' + malas.map(function (x) { return PARTES[x.clave].nombre; }).join(', ') + ': ' + malas[0].error.message, 'error');
      }
      // Diferencias de la auditoria y kekos (aparte: sin su migracion responden vacio).
      API.get('/api/auditoria/resumen').then(function (a) { if (a) setResAuditoria(a); });
      API.get('/api/kekos').then(function (k) { if (k) setKekos(k); });
    });
  }, []);

  var lista = cuenta && cuenta.estado === 'lista';
  useEffect(function () {
    if (lista) recargar();
    else { setDatos({}); llegaron.current = {}; setFallos({}); }
  }, [lista]);
  function reintentarCarga() { setVerErrores(null); recargar(); }

  // ── Novedades post-actualizacion (como Proyecto_Cartera) ──────────────────
  // Compara la version que corre con la ultima vista (localStorage.lastSeenVersion): si
  // difieren (tambien si no hay ninguna) y hay novedades para esa version, se muestran una
  // vez, y la version queda como vista. Espera a que la app este lista para no tapar el
  // asistente ni el acceso. `?novedades` (o --novedades al arrancar) la fuerza: ver
  // core/novedades.js.
  useEffect(function () {
    if (!lista || !cuenta.version) return;
    var vista = null;
    try { vista = localStorage.getItem(CLAVE_VISTA); } catch (_) { /* sin almacenamiento */ }
    var mostrar = novedadesAMostrar({ version: cuenta.version, vista: vista, forzar: previsualizacionPedida(window.location.search) });
    if (mostrar) setNovedades(mostrar);
    try { localStorage.setItem(CLAVE_VISTA, cuenta.version); } catch (_) { /* sin almacenamiento */ }
  }, [lista]);

  // Migraciones que faltan en la base (solo se avisa si se pudo comprobar).
  var revisarMigraciones = useCallback(function () {
    API.get('/api/instalacion').then(function (r) { setEstadoMig(r); setFaltanMig(r && !r.error && !r.completa ? r : null); });
  }, []);
  useEffect(function () { if (lista) revisarMigraciones(); else setFaltanMig(null); }, [lista]);

  // Compras del Sniper en vivo (y el catalogo, cuando se actualiza solo).
  useEffect(function () {
    if (!lista) return;
    var fuente = new EventSource('/api/eventos');
    fuente.addEventListener('eventos-sniper', function (e) {
      var ev = JSON.parse(e.data);
      var partes = [];
      if (ev.compras) partes.push(ev.compras + (ev.compras === 1 ? ' compra' : ' compras'));
      if (ev.publicaciones) partes.push(ev.publicaciones + (ev.publicaciones === 1 ? ' publicación' : ' publicaciones'));
      if (ev.recuperaciones) partes.push(ev.recuperaciones + (ev.recuperaciones === 1 ? ' recuperación' : ' recuperaciones'));
      if (ev.ventas) partes.push(ev.ventas + (ev.ventas === 1 ? ' venta' : ' ventas'));
      avisar('Sniper: ' + (partes.join(', ') || ev.total + ' evento(s)'), 'sniper');
      recargar();
    });
    // Ventas del Sniper (llega justo despues del aviso de eventos): lo vendido, por keko. Si
    // alguna quedo por asignar, «Ver» abre la bandeja.
    fuente.addEventListener('ventas', function (e) {
      var ev = JSON.parse(e.data);
      var a = (ev.avisos || [])[0];
      if (!a) return;
      var pendiente = (ev.avisos || []).some(function (x) { return x.por_asignar; });
      avisar(a.titulo + ': ' + a.cuerpo, 'sniper', pendiente ? { texto: 'Ver', fn: function () { abrirPestana({ filtro: 'por_asignar' }); } } : null);
    });
    // El catalogo de Habbo.es se actualizo solo (al abrir la app) y cambio algun nombre o
    // icono de tus furnis: se recargan los datos, sin aviso.
    fuente.addEventListener('catalogo', function () { recargar(); });
    // Llego la foto del inventario de un sniper (migracion 20261011000000): el numero del
    // menu y la Auditoria se ponen al dia solos. Si trae diferencias nuevas, tambien un
    // aviso aqui (la notificacion del sistema la decide Electron, si no estas mirando).
    fuente.addEventListener('auditoria', function (e) {
      var ev = JSON.parse(e.data);
      if (ev.resumen) setResAuditoria(ev.resumen);
      setSenalAuditoria(function (n) { return n + 1; });
      (ev.avisos || []).forEach(function (a) { avisar(a.breve, 'sniper'); });
    });
    return function () { fuente.close(); };
  }, [lista]);

  // Clic en una notificacion del sistema (solo en la app de escritorio): abre su destino.
  useEffect(function () {
    var api = window.electronAPI;
    if (!api || !api.alAbrir) return;
    return api.alAbrir(function (destino) {
      if (!destino) return;
      if (destino.vista === 'inventario') { abrirPestana(destino); return; }
      if (destino.vista !== 'auditoria') return;
      setModal(null);
      setAbrirAuditoria({ keko: destino.keko || null, vez: Date.now() });
      setVista('auditoria');
    });
  }, []);

  // Abre el Inventario en Vendido (en el bloque de un keko) o en «Por asignar».
  function abrirPestana(destino) {
    setModal(null);
    setToast(null);
    setFiltroFurni('');
    setAbrirInventario({ filtro: destino.filtro || 'vendido', keko: destino.keko || null, vez: Date.now() });
    setVista('inventario');
  }

  function cambio(msg) { setModal(null); if (msg) avisar(msg); recargar(); }

  function furniDe(id) { return (datos.furnis || []).find(function (f) { return f.id === id; }); }
  // Los bloques por keko publican, venden y retiran solo en su keko: `ambito` es { keko }
  // o { sin_keko: true } (core/kekos.js, ambitoDe). Sin ambito, todos los lotes.
  function delAmbito(c, ambito) { return !ambito || esDelKeko(c, ambito.sin_keko ? null : ambito.keko); }
  function ambitoDeLote(l) { return l.keko ? { keko: l.keko } : { sin_keko: true }; }
  // Lotes en mano de un furni (comprados y no "por revisar"), del mas antiguo al mas
  // nuevo: el mismo orden en que los toma publicar_furni.
  function enManoFifo(furniId, ambito) {
    return (datos.compras || []).filter(function (c) { return c.furni_id === furniId && c.estado === 'comprado' && !c.pendiente && delAmbito(c, ambito); })
      .sort(function (a, b) {
        if (a.fecha_compra !== b.fecha_compra) {
          if (!a.fecha_compra) return -1;
          if (!b.fecha_compra) return 1;
          return a.fecha_compra < b.fecha_compra ? -1 : 1;
        }
        return a.id - b.id;
      });
  }
  function publicadosDe(furniId, soloManual, ambito) {
    return (datos.compras || []).filter(function (c) { return c.furni_id === furniId && c.estado === 'publicado' && (!soloManual || c.publicado_por === 'manual') && delAmbito(c, ambito); });
  }
  // Abre el Inventario en una pestana, filtrado por el nombre del furni.
  function verLotes(nombre, estado) { setFiltroFurni(nombre); setFiltroEstado(estado); setVista('inventario'); }
  // Desde el Resumen: si el furni esta publicado, al Mercadillo; si no, a sus lotes en mano.
  function verFurni(id) {
    var f = furniDe(id);
    if (!f) return;
    if (f.unidades_publicadas > 0) navegar('mercadillo', id);
    else verLotes(f.nombre, 'comprado');
  }

  function navegar(v, furniId) {
    setVista(v);
    setEnfocar(v === 'mercadillo' && furniId ? furniId : null);
    if (v !== 'inventario') setFiltroFurni('');
    if (v === 'auditoria') setAbrirAuditoria(null);
  }

  function salir() {
    API.post('/api/cuenta/salir', {}).then(function (r) { if (r) { setCuenta(r); setVista('resumen'); } });
  }

  var colorToast = toast && toast.tipo === 'error' ? ['var(--red-bg)', 'var(--red-bd)', 'var(--red)']
    : toast && toast.tipo === 'sniper' ? ['var(--yellow-bg)', 'var(--yellow-bd)', 'var(--yellow)']
    : ['var(--green-bg)', 'var(--green-bd)', 'var(--green)'];
  var accionToast = toast && toast.accion ? toast.accion
    : toast && toast.tipo === 'error' && lista ? { texto: 'Ver detalles', fn: function () { setToast(null); setVerErrores('registro'); } } : null;
  var aviso = toast ? h('div', { key: toast.id, className: 'toast' + (accionToast ? ' con-accion' : ''), style: { background: colorToast[0], border: '1px solid ' + colorToast[1], color: colorToast[2] } },
    toast.msg,
    accionToast ? h('button', { className: 'toast-accion', onClick: accionToast.fn }, accionToast.texto) : null) : null;

  if (!cuenta) return h('div', { className: 'acceso', 'data-app-lista': '1' }, h(Spinner));
  // El aviso tambien se ve en el acceso (antes sus errores no se mostraban).
  if (!lista) return h('div', null, h(AccesoView, { cuenta: cuenta, onCuenta: setCuenta }), aviso);

  var nav = NAV.find(function (n) { return n[0] === vista; });
  var huerfanos = datos.pendientes ? datos.pendientes.length : 0;
  var ventasPendientes = datos.porAsignar && datos.porAsignar.disponible ? datos.porAsignar.ventas || [] : [];
  // «Vendido» a mano en un keko cuyo Sniper ya registra sus ventas: primero la pregunta.
  function venderConAviso(keko, abrir) {
    if (kekoConVentasSniper(datos.compras, ventasPendientes, keko)) setModal({ tipo: 'aviso-sniper', keko: keko, siguiente: abrir });
    else abrir();
  }
  var tasa = datos.resumen ? datos.resumen.tasa : 50;

  function abrirErrores() { setVerErrores('registro'); }
  var contenido;
  // Lo que esta seccion necesita y aun no llego: si fallo, el motivo y Reintentar (nunca un
  // spinner eterno); si sigue en camino, el spinner (como mucho ESPERA_CARGA).
  var faltanPartes = (NECESITA[vista] || []).filter(function (c) { return datos[c] === undefined; });
  var partesRotas = faltanPartes.filter(function (c) { return fallos[c]; });
  if (partesRotas.length) contenido = h('div', { className: 'contenedor fade-in' },
    h('div', { className: 'card panel-error' },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700, fontSize: 15 } },
        h(Ico, { name: 'alert', size: 18, color: 'var(--red)' }), 'Esta sección no pudo cargar sus datos'),
      h('p', { className: 'suave', style: { fontSize: 13, margin: '8px 0 10px', lineHeight: 1.55 } },
        'No se pudo cargar: ' + partesRotas.map(function (c) { return PARTES[c].nombre; }).join(' ni ') + '. Tus datos siguen guardados en tu Supabase y el resto de la app funciona. Mira el detalle, cópialo para enviarlo y prueba de nuevo.'),
      h('div', { className: 'aviso aviso-rojo', style: { fontSize: 13, wordBreak: 'break-word', marginBottom: 12 } }, fallos[partesRotas[0]].message),
      h('div', { style: { display: 'flex', gap: 8 } },
        h('button', { className: 'btn', onClick: function () { setVerErrores('carga'); } }, h(Ico, { name: 'copy', size: 14 }), 'Ver y copiar detalles'),
        h('button', { className: 'btn btn-verde', onClick: reintentarCarga }, h(Ico, { name: 'refresh', size: 14 }), 'Reintentar'))));
  else if (faltanPartes.length) contenido = h(Spinner);
  else if (vista === 'resumen') contenido = h(ResumenView, { resumen: datos.resumen, onNav: navegar, onVerFurni: verFurni, onCambio: cambio, onError: function (m) { avisar(m, 'error'); } });
  else if (vista === 'mercadillo') contenido = h(MercadilloView, {
    furnis: datos.furnis, compras: datos.compras, enfocar: enfocar, kekos: kekos, onVerErrores: abrirErrores,
    onVerLotes: function (f) { verLotes(f.nombre, 'publicado'); },
    // Desde el bloque de un keko: solo lo publicado en ese keko.
    onVender: function (f, ambito) {
      venderConAviso(ambito && ambito.keko, function () { setModal({ tipo: 'vender-furni', furni: f, lotes: publicadosDe(f.id, false, ambito), ambito: ambito }); });
    },
    onRetirar: function (f, ambito) {
      var todos = publicadosDe(f.id, false, ambito);
      var manual = todos.filter(function (c) { return c.publicado_por === 'manual'; });
      var sniper = todos.reduce(function (s, c) { return s + (c.publicado_por === 'manual' ? 0 : c.cantidad); }, 0);
      setModal({ tipo: 'retirar-furni', furni: f, lotes: manual, unidadesSniper: sniper, ambito: ambito });
    },
  });
  else if (vista === 'inventario') contenido = h(InventarioView, {
    compras: datos.compras, pendientes: datos.pendientes, tasa: tasa, filtroFurni: filtroFurni, filtroEstado: filtroEstado, kekos: kekos, onVerErrores: abrirErrores,
    furnis: datos.furnis || [], porAsignar: datos.porAsignar, abrir: abrirInventario,
    // «+ Compra» de un bloque llega con su keko ya elegido.
    onNueva: function (keko) { setModal({ tipo: 'compra', keko: keko || null }); },
    // Lo publicado se vende en el mercadillo (con comision); lo que esta en mano, con la
    // venta manual (tradeo u otro keko).
    onVender: function (l) {
      if (l.estado === 'publicado') venderConAviso(l.keko, function () { setModal({ tipo: 'vender', lote: l, furni: furniDe(l.furni_id) }); });
      else setModal({ tipo: 'venta-manual', furni: furniDe(l.furni_id), lote: l });
    },
    // Pestaña «Por asignar».
    onAsignarVenta: function (v) { setModal({ tipo: 'asignar-venta', venta: v }); },
    onDescartarVenta: function (v) { setModal({ tipo: 'descartar-venta', venta: v }); },
    onVentaManual: function () { setModal({ tipo: 'venta-manual' }); },
    onLtd: function (l) { setModal({ tipo: 'ltd', lote: l }); },
    // «Publicar» de una fila: las unidades en mano de ese furni en SU keko.
    onPublicar: function (l) {
      var ambito = ambitoDeLote(l);
      setModal({ tipo: 'publicar', furni: furniDe(l.furni_id), lotes: enManoFifo(l.furni_id, ambito), ambito: ambito });
    },
    onCambio: cambio,
  });
  else if (vista === 'auditoria') contenido = h(AuditoriaView, {
    furnis: datos.furnis, compras: datos.compras, demo: cuenta.demo, onCambio: cambio, onRecargar: recargar,
    senal: senalAuditoria, abrir: abrirAuditoria, onVerErrores: abrirErrores,
    onAviso: function (m) { avisar(m); }, onError: function (m) { avisar(m, 'error'); },
  });
  else contenido = h(AjustesView, {
    cuenta: cuenta, tema: tema, onTema: setTema, onSalir: salir, onCambio: cambio,
    kekos: kekos, compras: datos.compras, furnis: datos.furnis,
    onAviso: function (m) { avisar(m); }, onError: function (m) { avisar(m, 'error'); },
  });

  var faltan = faltanMig ? faltanMig.total - faltanMig.instaladas : 0;
  var avisoMigraciones = faltan ? h('div', { className: 'contenedor', style: { marginBottom: 14 } },
    h('div', { className: 'aviso aviso-ambar', style: { display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 } },
      h(Ico, { name: 'alert', size: 16 }),
      h('span', { style: { flex: 1 } }, 'A tu base de datos ' + (faltan === 1 ? 'le falta 1 migración' : 'le faltan ' + faltan + ' migraciones') + ' de esta versión: algunas funciones pueden fallar hasta que la instales.'),
      h('button', { className: 'btn btn-chico', onClick: function () { setModal({ tipo: 'instalar' }); } }, 'Instalar ahora'))) : null;

  return h('div', { className: 'app-layout', 'data-app-lista': '1' },
    h('div', { className: 'sidebar' + (menuPlegado ? ' collapsed' : '') },
      h('div', { className: 'sidebar-header' },
        h('img', { className: 'logo-app', src: '/img/icono.png', alt: '' }),
        h('div', null,
          h('div', { style: { fontWeight: 700, fontSize: 16 } }, 'Habbo Inventario'),
          h('div', { className: 'mono', style: { fontSize: 12, color: 'var(--text3)' } }, datos.furnis ? datos.furnis.length + ' furnis' : '…'))),
      h('div', { className: 'sidebar-nav' }, NAV.map(function (n) {
        return h('button', { key: n[0], className: 'nav-item' + (vista === n[0] ? ' active' : ''), onClick: function () { navegar(n[0]); } },
          h(Ico, { name: n[1], size: 18, color: vista === n[0] ? 'var(--green)' : 'var(--text3)' }),
          h('span', { style: { flex: 1 } }, n[2]),
          n[0] === 'inventario' && huerfanos ? h('span', { className: 'tag tag-ambar', title: 'Furnis del Sniper por revisar' }, huerfanos) : null,
          n[0] === 'inventario' && ventasPendientes.length ? h('span', { className: 'tag tag-azul', title: 'Ventas del Sniper por asignar' }, ventasPendientes.length) : null,
          n[0] === 'auditoria' && resAuditoria && resAuditoria.pendientes ? h('span', { className: 'tag tag-azul', title: 'Diferencias con el inventario de Habbo' }, resAuditoria.pendientes) : null);
      })),
      h('div', { className: 'sidebar-footer' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { width: 7, height: 7, borderRadius: 99, background: cuenta.demo ? 'var(--yellow)' : 'var(--green)' } }),
          cuenta.demo ? 'Modo demo (local)' : 'Conectado a Supabase'),
        h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cuenta.usuario ? cuenta.usuario.email : ''))),
    h('div', { className: 'main-area' },
      h('div', { className: 'main-header' },
        h('button', { onClick: function () { setMenuPlegado(!menuPlegado); }, style: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', color: 'var(--text)' }, 'aria-label': 'Menú' }, h(Ico, { name: 'menu', size: 22 })),
        h(Ico, { name: nav[1], size: 18, color: 'var(--green)' }),
        h('span', { style: { fontWeight: 700, fontSize: 16 } }, nav[2]),
        h('div', { style: { flex: 1 } }),
        errores.length ? h('button', { className: 'btn-errores', onClick: abrirErrores, title: 'Errores de esta sesión: ver y copiar los detalles' },
          h(Ico, { name: 'alert', size: 13 }), errores.length === 1 ? '1 error' : errores.length + ' errores') : null,
        h('span', { className: 'tag tag-morado', title: 'Tasa del Lingo en Habbo.es (valor fijo del juego)' }, h(Ico, { name: 'diamond', size: 12 }), '1 lingo = ' + fmtLg(tasa) + ' cr'),
        h('button', { className: 'btn-icono', onClick: function () { setTema(tema === 'dark' ? 'light' : 'dark'); }, title: tema === 'dark' ? 'Tema claro' : 'Tema oscuro' },
          h(Ico, { name: tema === 'dark' ? 'sun' : 'moon', size: 14, color: 'var(--text3)' }))),
      h('div', { className: 'main-content' }, avisoMigraciones, h(Barrera, { key: vista, seccion: nav[2], onVerErrores: abrirErrores }, contenido))),

    verErrores ? h(ErroresModal, { modo: verErrores, errores: errores,
      contexto: { version: cuenta.version, equipo: describirEquipo(navigator.userAgent), seccion: nav[2], migraciones: estadoMig },
      onReintentar: verErrores === 'carga' ? reintentarCarga : null,
      onLimpiar: function () { limpiarErrores(); setVerErrores(null); },
      onClose: function () { setVerErrores(null); } }) : null,
    novedades ? h(NovedadesModal, { version: novedades.version, items: novedades.items, onClose: function () { setNovedades(null); } }) : null,
    modal && modal.tipo === 'compra' ? h(CompraModal, { furni: modal.furni, keko: modal.keko, propios: datos.furnis || [], kekos: kekos, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'ltd' ? h(LtdModal, { lote: modal.lote, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'venta-manual' ? h(VentaManualModal, { furnis: datos.furnis || [], compras: datos.compras || [], furni: modal.furni, lote: modal.lote, tasa: tasa, kekos: kekos, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'vender-furni' ? h(VenderFurniModal, { furni: modal.furni, lotes: modal.lotes, ambito: modal.ambito, tasa: tasa, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'retirar-furni' ? h(RetirarFurniModal, { furni: modal.furni, lotes: modal.lotes, unidadesSniper: modal.unidadesSniper, ambito: modal.ambito, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'publicar' ? h(PublicarModal, { furni: modal.furni, lotes: modal.lotes, ambito: modal.ambito, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'vender' ? h(VenderModal, { lote: modal.lote, furni: modal.furni, tasa: tasa, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'aviso-sniper' ? h(Confirmar, { titulo: 'El Sniper registra las ventas de ' + modal.keko, peligro: true, icono: 'radar', textoBoton: 'Registrar a mano igual',
      mensaje: 'Las ventas de este keko las registra el Sniper solo. Si anotas esta a mano y el Sniper también la envía, se contará dos veces. Hazlo solo si el Sniper estaba apagado o no registró esta venta.',
      onClose: function () { setModal(null); }, onConfirmar: function () { modal.siguiente(); } }) : null,
    modal && modal.tipo === 'asignar-venta' ? h(AsignarVentaModal, { venta: modal.venta, compras: datos.compras || [], furnis: datos.furnis || [],
      onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); },
      onDescartar: function (v) { setModal({ tipo: 'descartar-venta', venta: v }); } }) : null,
    modal && modal.tipo === 'descartar-venta' ? h(Confirmar, { titulo: 'Descartar la venta', peligro: true, icono: 'trash', textoBoton: 'Descartar', enviando: !!modal.enviando,
      mensaje: h('span', null, '¿Descartar la venta de ', h('b', null, nombreVentaPendiente(modal.venta, datos.furnis).nombre),
        ' a ' + fmtCr(modal.venta.precio) + ' cr en ' + modal.venta.keko + '? No se registra en ningún lote y sale de la bandeja. El Sniper la conserva en su registro.'),
      onClose: function () { setModal(null); },
      onConfirmar: function () {
        if (modal.enviando) return;
        var v = modal.venta;
        setModal(Object.assign({}, modal, { enviando: true }));
        API.post('/api/ventas-por-asignar/' + v.id + '/descartar', {}).then(function (r) {
          if (r) cambio('Venta descartada: no se registró en ningún lote');
          else setModal(null);
        });
      } }) : null,

    modal && modal.tipo === 'instalar' ? h(Modal, { titulo: 'Instalar migraciones', ancho: 580, onClose: function () { setModal(null); revisarMigraciones(); } },
      h('div', { className: 'card-sub', style: { lineHeight: 1.5, marginTop: -4 } }, 'Copia cada archivo en el SQL Editor de tu proyecto y pulsa Run, en orden. La lista se actualiza sola.'),
      h(InstalarBase, { cuenta: cuenta, sinTitulo: true, textoListo: 'Listo', onListo: function () { setModal(null); setFaltanMig(null); avisar('Base de datos al día'); recargar(); } })) : null,

    aviso);
}

createRoot(document.getElementById('root')).render(h(App));
