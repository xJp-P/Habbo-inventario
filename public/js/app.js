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

import { h, useState, useEffect, useCallback, createRoot } from './core/react.js';
import { API, setErrorHandler } from './core/api.js';
import { fmtLg } from './core/format.js';
import { Ico } from './componentes/iconos.js';
import { Spinner } from './componentes/base.js';
import { AccesoView } from './vistas/Acceso.js';
import { ResumenView } from './vistas/Resumen.js';
import { MercadilloView } from './vistas/Mercadillo.js';
import { InventarioView } from './vistas/Inventario.js';
import { AjustesView } from './vistas/Ajustes.js';
import { FurniModal } from './modales/FurniModal.js';
import { CompraModal } from './modales/CompraModal.js';
import { VenderModal } from './modales/VenderModal.js';
import { PublicarModal } from './modales/PublicarModal.js';

var NAV = [
  ['resumen', 'dashboard', 'Resumen'],
  ['mercadillo', 'store', 'Mercadillo'],
  ['inventario', 'box', 'Inventario'],
  ['ajustes', 'plug', 'Ajustes'],
];

function leerTema() { try { return localStorage.getItem('tema') || 'dark'; } catch (_) { return 'dark'; } }

function App() {
  var sC = useState(null); var cuenta = sC[0]; var setCuenta = sC[1];
  var sV = useState('resumen'); var vista = sV[0]; var setVista = sV[1];
  var sD = useState(null); var datos = sD[0]; var setDatos = sD[1];
  var sT = useState(null); var toast = sT[0]; var setToast = sT[1];
  var sTe = useState(leerTema()); var tema = sTe[0]; var setTema = sTe[1];
  var sM = useState(null); var modal = sM[0]; var setModal = sM[1];
  var sMenu = useState(false); var menuPlegado = sMenu[0]; var setMenuPlegado = sMenu[1];
  var sEnf = useState(null); var enfocar = sEnf[0]; var setEnfocar = sEnf[1];
  var sFil = useState(''); var filtroFurni = sFil[0]; var setFiltroFurni = sFil[1];

  var avisar = useCallback(function (msg, tipo) {
    setToast({ msg: msg, tipo: tipo || 'ok', id: Date.now() });
  }, []);

  useEffect(function () {
    if (!toast) return;
    var t = setTimeout(function () { setToast(null); }, toast.tipo === 'error' ? 4500 : 2800);
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

  var recargar = useCallback(function () {
    return Promise.all([API.get('/api/resumen'), API.get('/api/furnis'), API.get('/api/compras'), API.get('/api/pendientes')])
      .then(function (r) {
        if (r.every(function (x) { return x; })) setDatos({ resumen: r[0], furnis: r[1], compras: r[2], pendientes: r[3] });
      });
  }, []);

  var lista = cuenta && cuenta.estado === 'lista';
  useEffect(function () { if (lista) recargar(); else setDatos(null); }, [lista]);

  // Compras del Sniper en vivo.
  useEffect(function () {
    if (!lista) return;
    var fuente = new EventSource('/api/eventos');
    fuente.addEventListener('eventos-sniper', function (e) {
      var ev = JSON.parse(e.data);
      var partes = [];
      if (ev.compras) partes.push(ev.compras + (ev.compras === 1 ? ' compra' : ' compras'));
      if (ev.publicaciones) partes.push(ev.publicaciones + (ev.publicaciones === 1 ? ' publicación' : ' publicaciones'));
      if (ev.recuperaciones) partes.push(ev.recuperaciones + (ev.recuperaciones === 1 ? ' recuperación' : ' recuperaciones'));
      avisar('Sniper: ' + (partes.join(', ') || ev.total + ' evento(s)'), 'sniper');
      recargar();
    });
    return function () { fuente.close(); };
  }, [lista]);

  function cambio(msg) { setModal(null); if (msg) avisar(msg); recargar(); }

  function navegar(v, furniId) {
    setVista(v);
    setEnfocar(v === 'mercadillo' && furniId ? furniId : null);
    if (v !== 'inventario') setFiltroFurni('');
  }

  function salir() {
    API.post('/api/cuenta/salir', {}).then(function (r) { if (r) { setCuenta(r); setVista('resumen'); } });
  }

  if (!cuenta) return h('div', { className: 'acceso', 'data-app-lista': '1' }, h(Spinner));
  if (!lista) return h(AccesoView, { cuenta: cuenta, onCuenta: setCuenta });

  var nav = NAV.find(function (n) { return n[0] === vista; });
  var huerfanos = datos ? datos.pendientes.length : 0;
  var tasa = datos ? datos.resumen.tasa : 50;

  var contenido;
  if (!datos) contenido = h(Spinner);
  else if (vista === 'resumen') contenido = h(ResumenView, { resumen: datos.resumen, onNav: navegar, onCambio: cambio, onError: function (m) { avisar(m, 'error'); } });
  else if (vista === 'mercadillo') contenido = h(MercadilloView, {
    furnis: datos.furnis, compras: datos.compras, enfocar: enfocar,
    onNuevo: function () { setModal({ tipo: 'furni' }); },
    onEditar: function (f) { setModal({ tipo: 'furni', furni: f }); },
    onComprar: function (f) { setModal({ tipo: 'compra', furni: f }); },
    onVerLotes: function (f) { setFiltroFurni(f.nombre); setVista('inventario'); },
  });
  else if (vista === 'inventario') contenido = h(InventarioView, {
    compras: datos.compras, pendientes: datos.pendientes, tasa: tasa, filtroFurni: filtroFurni,
    onNueva: function () { setModal({ tipo: 'compra' }); },
    onVender: function (l) { setModal({ tipo: 'vender', lote: l, furni: datos.furnis.find(function (f) { return f.id === l.furni_id; }) }); },
    onPublicar: function (l) { setModal({ tipo: 'publicar', lote: l, furni: datos.furnis.find(function (f) { return f.id === l.furni_id; }) }); },
    onCambio: cambio,
  });
  else contenido = h(AjustesView, {
    cuenta: cuenta, tema: tema, onTema: setTema, onSalir: salir, onCambio: cambio,
    onAviso: function (m) { avisar(m); }, onError: function (m) { avisar(m, 'error'); },
  });

  var colorToast = toast && toast.tipo === 'error' ? ['var(--red-bg)', 'var(--red-bd)', 'var(--red)']
    : toast && toast.tipo === 'sniper' ? ['var(--yellow-bg)', 'var(--yellow-bd)', 'var(--yellow)']
    : ['var(--green-bg)', 'var(--green-bd)', 'var(--green)'];

  return h('div', { className: 'app-layout', 'data-app-lista': '1' },
    h('div', { className: 'sidebar' + (menuPlegado ? ' collapsed' : '') },
      h('div', { className: 'sidebar-header' },
        h('img', { className: 'logo-app', src: '/img/icono.png', alt: '' }),
        h('div', null,
          h('div', { style: { fontWeight: 700, fontSize: 16 } }, 'Habbo Inventario'),
          h('div', { className: 'mono', style: { fontSize: 12, color: 'var(--text3)' } }, datos ? datos.furnis.length + ' furnis' : '…'))),
      h('div', { className: 'sidebar-nav' }, NAV.map(function (n) {
        return h('button', { key: n[0], className: 'nav-item' + (vista === n[0] ? ' active' : ''), onClick: function () { navegar(n[0]); } },
          h(Ico, { name: n[1], size: 18, color: vista === n[0] ? 'var(--green)' : 'var(--text3)' }),
          h('span', { style: { flex: 1 } }, n[2]),
          n[0] === 'inventario' && huerfanos ? h('span', { className: 'tag tag-ambar', title: 'Furnis del Sniper por revisar' }, huerfanos) : null);
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
        h('span', { className: 'tag tag-morado', title: 'Tasa del Lingo (cámbiala en Resumen)' }, h(Ico, { name: 'diamond', size: 12 }), '1 lingo = ' + fmtLg(tasa) + ' cr'),
        h('button', { className: 'btn-icono', onClick: function () { setTema(tema === 'dark' ? 'light' : 'dark'); }, title: tema === 'dark' ? 'Tema claro' : 'Tema oscuro' },
          h(Ico, { name: tema === 'dark' ? 'sun' : 'moon', size: 14, color: 'var(--text3)' }))),
      h('div', { className: 'main-content' }, contenido)),

    modal && modal.tipo === 'furni' ? h(FurniModal, { furni: modal.furni, propios: datos.furnis, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'compra' ? h(CompraModal, { furni: modal.furni, propios: datos.furnis, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'publicar' ? h(PublicarModal, { lote: modal.lote, furni: modal.furni, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'vender' ? h(VenderModal, { lote: modal.lote, furni: modal.furni, tasa: tasa, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,

    toast ? h('div', { key: toast.id, className: 'toast', style: { background: colorToast[0], border: '1px solid ' + colorToast[1], color: colorToast[2] } }, toast.msg) : null);
}

createRoot(document.getElementById('root')).render(h(App));
