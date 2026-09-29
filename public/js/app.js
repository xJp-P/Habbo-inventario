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

import { h, useState, useEffect, useCallback, createRoot } from './core/react.js';
import { API, setErrorHandler } from './core/api.js';
import { fmtLg } from './core/format.js';
import { Ico } from './componentes/iconos.js';
import { Spinner, Modal } from './componentes/base.js';
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
  var sD = useState(null); var datos = sD[0]; var setDatos = sD[1];
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
        // Diferencias de la auditoria y kekos (aparte: sin su migracion responden vacio).
        API.get('/api/auditoria/resumen').then(function (a) { if (a) setResAuditoria(a); });
        API.get('/api/kekos').then(function (k) { if (k) setKekos(k); });
      });
  }, []);

  var lista = cuenta && cuenta.estado === 'lista';
  useEffect(function () { if (lista) recargar(); else setDatos(null); }, [lista]);

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
    API.get('/api/instalacion').then(function (r) { setFaltanMig(r && !r.error && !r.completa ? r : null); });
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
      avisar('Sniper: ' + (partes.join(', ') || ev.total + ' evento(s)'), 'sniper');
      recargar();
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
      if (!destino || destino.vista !== 'auditoria') return;
      setModal(null);
      setAbrirAuditoria({ keko: destino.keko || null, vez: Date.now() });
      setVista('auditoria');
    });
  }, []);

  function cambio(msg) { setModal(null); if (msg) avisar(msg); recargar(); }

  function furniDe(id) { return datos.furnis.find(function (f) { return f.id === id; }); }
  // Lotes en mano de un furni (comprados y no "por revisar"), del mas antiguo al mas
  // nuevo: el mismo orden en que los toma publicar_furni.
  function enManoFifo(furniId) {
    return datos.compras.filter(function (c) { return c.furni_id === furniId && c.estado === 'comprado' && !c.pendiente; })
      .sort(function (a, b) {
        if (a.fecha_compra !== b.fecha_compra) {
          if (!a.fecha_compra) return -1;
          if (!b.fecha_compra) return 1;
          return a.fecha_compra < b.fecha_compra ? -1 : 1;
        }
        return a.id - b.id;
      });
  }
  function publicadosDe(furniId, soloManual) {
    return datos.compras.filter(function (c) { return c.furni_id === furniId && c.estado === 'publicado' && (!soloManual || c.publicado_por === 'manual'); });
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
  var aviso = toast ? h('div', { key: toast.id, className: 'toast', style: { background: colorToast[0], border: '1px solid ' + colorToast[1], color: colorToast[2] } }, toast.msg) : null;

  if (!cuenta) return h('div', { className: 'acceso', 'data-app-lista': '1' }, h(Spinner));
  // El aviso tambien se ve en el acceso (antes sus errores no se mostraban).
  if (!lista) return h('div', null, h(AccesoView, { cuenta: cuenta, onCuenta: setCuenta }), aviso);

  var nav = NAV.find(function (n) { return n[0] === vista; });
  var huerfanos = datos ? datos.pendientes.length : 0;
  var tasa = datos ? datos.resumen.tasa : 50;

  var contenido;
  if (!datos) contenido = h(Spinner);
  else if (vista === 'resumen') contenido = h(ResumenView, { resumen: datos.resumen, onNav: navegar, onVerFurni: verFurni, onCambio: cambio, onError: function (m) { avisar(m, 'error'); } });
  else if (vista === 'mercadillo') contenido = h(MercadilloView, {
    furnis: datos.furnis, compras: datos.compras, enfocar: enfocar,
    onVerLotes: function (f) { verLotes(f.nombre, 'publicado'); },
    onVender: function (f) { setModal({ tipo: 'vender-furni', furni: f, lotes: publicadosDe(f.id, false) }); },
    onRetirar: function (f) {
      var todos = publicadosDe(f.id, false);
      var manual = todos.filter(function (c) { return c.publicado_por === 'manual'; });
      var sniper = todos.reduce(function (s, c) { return s + (c.publicado_por === 'manual' ? 0 : c.cantidad); }, 0);
      setModal({ tipo: 'retirar-furni', furni: f, lotes: manual, unidadesSniper: sniper });
    },
  });
  else if (vista === 'inventario') contenido = h(InventarioView, {
    compras: datos.compras, pendientes: datos.pendientes, tasa: tasa, filtroFurni: filtroFurni, filtroEstado: filtroEstado,
    onNueva: function () { setModal({ tipo: 'compra' }); },
    // Lo publicado se vende en el mercadillo (con comision); lo que esta en mano, con la
    // venta manual (tradeo u otro keko).
    onVender: function (l) {
      if (l.estado === 'publicado') setModal({ tipo: 'vender', lote: l, furni: furniDe(l.furni_id) });
      else setModal({ tipo: 'venta-manual', furni: furniDe(l.furni_id), lote: l });
    },
    onVentaManual: function () { setModal({ tipo: 'venta-manual' }); },
    onLtd: function (l) { setModal({ tipo: 'ltd', lote: l }); },
    onPublicar: function (l) { setModal({ tipo: 'publicar', furni: furniDe(l.furni_id), lotes: enManoFifo(l.furni_id) }); },
    onCambio: cambio,
  });
  else if (vista === 'auditoria') contenido = h(AuditoriaView, {
    furnis: datos.furnis, compras: datos.compras, demo: cuenta.demo, onCambio: cambio, onRecargar: recargar,
    senal: senalAuditoria, abrir: abrirAuditoria,
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
          h('div', { className: 'mono', style: { fontSize: 12, color: 'var(--text3)' } }, datos ? datos.furnis.length + ' furnis' : '…'))),
      h('div', { className: 'sidebar-nav' }, NAV.map(function (n) {
        return h('button', { key: n[0], className: 'nav-item' + (vista === n[0] ? ' active' : ''), onClick: function () { navegar(n[0]); } },
          h(Ico, { name: n[1], size: 18, color: vista === n[0] ? 'var(--green)' : 'var(--text3)' }),
          h('span', { style: { flex: 1 } }, n[2]),
          n[0] === 'inventario' && huerfanos ? h('span', { className: 'tag tag-ambar', title: 'Furnis del Sniper por revisar' }, huerfanos) : null,
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
        h('span', { className: 'tag tag-morado', title: 'Tasa del Lingo (cámbiala en Resumen)' }, h(Ico, { name: 'diamond', size: 12 }), '1 lingo = ' + fmtLg(tasa) + ' cr'),
        h('button', { className: 'btn-icono', onClick: function () { setTema(tema === 'dark' ? 'light' : 'dark'); }, title: tema === 'dark' ? 'Tema claro' : 'Tema oscuro' },
          h(Ico, { name: tema === 'dark' ? 'sun' : 'moon', size: 14, color: 'var(--text3)' }))),
      h('div', { className: 'main-content' }, avisoMigraciones, contenido)),

    novedades ? h(NovedadesModal, { version: novedades.version, items: novedades.items, onClose: function () { setNovedades(null); } }) : null,
    modal && modal.tipo === 'compra' ? h(CompraModal, { furni: modal.furni, propios: datos.furnis, kekos: kekos, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'ltd' ? h(LtdModal, { lote: modal.lote, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'venta-manual' ? h(VentaManualModal, { furnis: datos.furnis, compras: datos.compras, furni: modal.furni, lote: modal.lote, tasa: tasa, kekos: kekos, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'vender-furni' ? h(VenderFurniModal, { furni: modal.furni, lotes: modal.lotes, tasa: tasa, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'retirar-furni' ? h(RetirarFurniModal, { furni: modal.furni, lotes: modal.lotes, unidadesSniper: modal.unidadesSniper, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'publicar' ? h(PublicarModal, { furni: modal.furni, lotes: modal.lotes, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,
    modal && modal.tipo === 'vender' ? h(VenderModal, { lote: modal.lote, furni: modal.furni, tasa: tasa, onClose: function () { setModal(null); }, onGuardado: function (_r, msg) { cambio(msg); } }) : null,

    modal && modal.tipo === 'instalar' ? h(Modal, { titulo: 'Instalar migraciones', ancho: 580, onClose: function () { setModal(null); revisarMigraciones(); } },
      h('div', { className: 'card-sub', style: { lineHeight: 1.5, marginTop: -4 } }, 'Copia cada archivo en el SQL Editor de tu proyecto y pulsa Run, en orden. La lista se actualiza sola.'),
      h(InstalarBase, { cuenta: cuenta, sinTitulo: true, textoListo: 'Listo', onListo: function () { setModal(null); setFaltanMig(null); avisar('Base de datos al día'); recargar(); } })) : null,

    aviso);
}

createRoot(document.getElementById('root')).render(h(App));
