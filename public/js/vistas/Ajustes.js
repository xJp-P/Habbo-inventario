// public/js/vistas/Ajustes.js — conexion con los SniperMercadillo, kekos, importar Excel,
// catalogo de Habbo.es, tema y cuenta.
//
// Cada sniper (cada VPS) usa su PROPIO token: si un VPS se compromete, se revoca solo
// ese. El token se muestra una unica vez al crearlo; en Supabase queda solo su huella.
//
// Kekos (v1.2.0): los de los snipers se detectan solos; los manuales (una bodega, un keko
// sin Sniper) se registran aqui y nunca se auditan. Desde aqui tambien se ordena lo que
// quedo en mano sin keko, que ensuciaba las auditorias de los snipers.
//
// Notificaciones (v1.4.0): que avisos quieres cuando la app esta minimizada o en segundo
// plano. Los decide el proceso principal (electron/notificaciones.js); aqui solo se leen y
// cambian las preferencias y se pide uno de prueba. En Mac el aviso es el Dock.

import { h, useState, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtHace, fmtD } from '../core/format.js';
import { _submitGuard } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { Confirmar } from '../componentes/base.js';
import { SelectorKeko } from '../componentes/SelectorKeko.js';
import { AsignarKekoModal } from '../modales/AsignarKekoModal.js';

function copiar(texto, alListo) {
  var hecho = function () { if (alListo) alListo(); };
  if (navigator.clipboard) navigator.clipboard.writeText(texto).then(hecho, hecho);
  else hecho();
}

function Campo(props) {
  return h('div', { style: { display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, alignItems: 'center', padding: '6px 0' } },
    h('span', { className: 'suave', style: { fontSize: 13 } }, props.l), h('div', { style: { minWidth: 0 } }, props.children));
}

// Version instalada y actualizaciones (solo en la app de escritorio). Al abrirse, la app
// ya busca sola; aqui se busca a mano, por ejemplo si lleva dias abierta.
function Actualizaciones() {
  var api = window.electronAPI;
  var sI = useState(null); var info = sI[0]; var setInfo = sI[1];
  var sE = useState(null); var est = sE[0]; var setEst = sE[1];
  useEffect(function () {
    api.info().then(setInfo);
    api.actualizacion.estado().then(setEst);
    return api.actualizacion.alCambiar(setEst);
  }, []);
  if (!info || !est) return null;

  var a = api.actualizacion;
  function boton(texto, accion, icono, clase) {
    return h('button', { className: 'btn btn-chico' + (clase ? ' ' + clase : ''), onClick: function () { accion(); } }, h(Ico, { name: icono, size: 12 }), texto);
  }
  var texto = null; var clase = 'suave'; var accion = null; var avance = null;
  switch (est.fase) {
    case 'desarrollo': texto = 'Se actualiza sola en la app instalada.'; break;
    case 'inactiva': accion = boton('Buscar actualizaciones', a.buscar, 'refresh'); break;
    case 'buscando': texto = 'Buscando actualizaciones…'; break;
    case 'al-dia': texto = est.nota || 'Tienes la última versión.'; accion = boton('Buscar de nuevo', a.buscar, 'refresh'); break;
    case 'disponible':
      texto = 'Hay una versión nueva: v' + est.version; clase = 'pos';
      accion = est.manual ? boton('Abrir la descarga', a.abrirDescarga, 'download', 'btn-verde') : boton('Descargar e instalar', a.descargar, 'download', 'btn-verde');
      break;
    case 'descargando': texto = 'Descargando la v' + est.version + '… ' + (est.porcentaje || 0) + '%'; avance = est.porcentaje || 0; break;
    case 'lista': texto = 'La v' + est.version + ' está lista para instalarse.'; clase = 'pos'; accion = boton('Reiniciar e instalar', a.instalar, 'refresh', 'btn-verde'); break;
    default: texto = est.error || 'No se pudo buscar.'; clase = 'neg'; accion = boton('Reintentar', a.buscar, 'refresh');
  }
  return h(Campo, { l: 'Versión' },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' } },
      h('span', { className: 'mono' }, 'v' + info.version),
      texto ? h('span', { className: clase, style: { fontSize: 12 } }, texto) : null,
      avance !== null ? h('div', { className: 'barra-avance' }, h('div', { style: { width: avance + '%' } })) : null,
      accion));
}

// Interruptor de encendido/apagado (accesible como switch).
function Interruptor(props) {
  return h('button', { type: 'button', role: 'switch', 'aria-checked': props.valor ? 'true' : 'false', 'aria-label': props.etiqueta,
    className: 'interruptor' + (props.valor ? ' on' : ''), onClick: function () { props.onChange(!props.valor); } });
}

// Tarjeta «Notificaciones». `enVivo`: si la app escucha la foto del inventario del Sniper
// (true), si falta la migracion 20261011000000 (false) o si aun no se sabe (null).
function Notificaciones(props) {
  var api = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.notificaciones;
  var sP = useState(null); var pref = sP[0]; var setPref = sP[1];
  var sPr = useState(false); var probando = sPr[0]; var setProbando = sPr[1];
  useEffect(function () { if (api) api.leer().then(setPref); }, []);
  var mac = !!(pref && pref.dock);

  function cambiar(tipo, valor) {
    var cambio = {}; cambio[tipo] = valor;
    setPref(Object.assign({}, pref, cambio));
    api.guardar(cambio).then(function (r) { setPref(function (p) { return Object.assign({}, p, r); }); });
  }
  function probar() {
    if (probando) return;
    setProbando(true);
    api.probar().then(function (r) {
      setProbando(false);
      if (r === 'dock') props.onAviso('Mira el Dock: el ícono de la app muestra un globo durante unos segundos');
      else if (r === 'mostrada') props.onAviso('Aviso de prueba enviado: sale abajo a la derecha, con el nombre y el ícono de Habbo Inventario');
      else props.onError('Este equipo no admite notificaciones del sistema');
    }, function () { setProbando(false); });
  }
  function fila(tipo, titulo, detalle) {
    return h('div', { key: tipo, className: 'fila-aviso' },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontSize: 14 } }, titulo),
        h('div', { className: 'suave', style: { fontSize: 12, lineHeight: 1.5 } }, detalle)),
      h(Interruptor, { valor: pref[tipo], etiqueta: titulo, onChange: function (v) { cambiar(tipo, v); } }));
  }

  var vivo = props.enVivo === true ? h('span', { className: 'estado-vivo' }, h('span', { className: 'punto' }), 'Auditoría en vivo: activa') : null;
  var faltaMigracion = props.enVivo === false ? h('div', { className: 'aviso aviso-ambar', style: { fontSize: 12, marginTop: 10 } },
    'Para recibir los avisos de la Auditoría instala la migración 20261011000000_inventario_en_vivo.sql (aviso ámbar de arriba).') : null;
  var plataforma = pref ? (mac ? 'Mac' : pref.plataforma === 'win32' ? 'Windows' : 'Linux') : null;

  var cuerpo;
  if (!api) {
    cuerpo = [
      h('div', { key: 's', className: 'card-sub', style: { marginBottom: 8 } }, 'Solo en la app de escritorio. La Auditoría igual se actualiza sola.'),
      vivo ? h('div', { key: 'v' }, vivo) : null, faltaMigracion ? h('div', { key: 'f' }, faltaMigracion) : null,
    ];
  } else if (!pref) {
    cuerpo = h('div', { className: 'card-sub' }, 'Cargando…');
  } else {
    cuerpo = [
      h('div', { key: 's', className: 'card-sub', style: { marginBottom: 8, lineHeight: 1.5 } }, mac
        ? 'Cuando la app está en segundo plano, su ícono rebota en el Dock y muestra un globo con los avisos sin ver. Si la estás mirando, no te interrumpimos.'
        : 'Te avisamos cuando la app está minimizada o en segundo plano. Si la estás mirando, no te interrumpimos.'),
      fila('inventario', 'Diferencias nuevas en la Auditoría', mac
        ? 'Cuando el inventario que envía tu Sniper deja de cuadrar. El globo desaparece al volver a la app.'
        : 'Cuando el inventario que envía tu Sniper deja de cuadrar. Al hacer clic se abre la Auditoría de ese keko.'),
      fila('catalogo', 'Furnis nuevos en el catálogo', 'Cuando Habbo.es agrega furnis nuevos al catálogo.'),
      faltaMigracion ? h('div', { key: 'f' }, faltaMigracion) : null,
      h('div', { key: 'p', className: 'fila-aviso', style: { alignItems: 'center', flexWrap: 'wrap' } },
        vivo,
        h('button', { className: 'btn btn-chico', style: { marginLeft: 'auto' }, onClick: probar, disabled: probando },
          h(Ico, { name: 'bell', size: 12 }), probando ? 'Enviando…' : 'Enviar una de prueba')),
    ];
  }

  return h('div', { className: 'card' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
      h(Ico, { name: 'bell', size: 16, color: 'var(--green)' }),
      h('div', { className: 'card-titulo' }, 'Notificaciones'),
      plataforma ? h('span', { className: 'tag tag-verde', style: { marginLeft: 'auto' } }, plataforma) : null),
    cuerpo);
}

export function AjustesView(props) {
  var cuenta = props.cuenta;
  var sC = useState(null); var conexion = sC[0]; var setConexion = sC[1];
  var sT = useState([]); var tokens = sT[0]; var setTokens = sT[1];
  var sN = useState(''); var nombre = sN[0]; var setNombre = sN[1];
  var sNuevo = useState(null); var nuevo = sNuevo[0]; var setNuevo = sNuevo[1];
  var sCat = useState(null); var catalogo = sCat[0]; var setCatalogo = sCat[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var sRuta = useState(''); var rutaExcel = sRuta[0]; var setRutaExcel = sRuta[1];
  var sInf = useState(null); var informe = sInf[0]; var setInforme = sInf[1];
  var sConf = useState(null); var confirmacion = sConf[0]; var setConfirmacion = sConf[1];
  var sKn = useState(''); var kekoNuevo = sKn[0]; var setKekoNuevo = sKn[1];
  var sKe = useState(null); var editando = sKe[0]; var setEditando = sKe[1];   // { id, nombre }
  var sKa = useState(''); var haciaSinKeko = sKa[0]; var setHaciaSinKeko = sKa[1];
  var sKm = useState(false); var asignando = sKm[0]; var setAsignando = sKm[1];
  var electron = typeof window !== 'undefined' && window.electronAPI;
  var kekos = props.kekos || { disponible: false, kekos: [] };
  var kekosSniper = kekos.kekos.filter(function (k) { return k.origen === 'sniper'; });
  var kekosManuales = kekos.kekos.filter(function (k) { return k.origen !== 'sniper'; });
  var sinKeko = (props.compras || []).reduce(function (s, c) { return s + (c.estado === 'comprado' && !c.keko ? c.cantidad : 0); }, 0);
  var revocados = tokens.filter(function (t) { return t.revocado; }).length;

  function cargar() {
    API.get('/api/sniper/conexion').then(function (r) { if (r) setConexion(r); });
    API.get('/api/sniper/tokens').then(function (r) { if (r) setTokens(r); });
    API.get('/api/furnidata/estado').then(function (r) { if (r) setCatalogo(r); });
  }
  useEffect(cargar, []);
  // El catalogo se revisa solo al abrir la app: si esa revision sigue en curso, se vuelve a
  // preguntar hasta que termine.
  useEffect(function () {
    if (!catalogo || !catalogo.actualizando) return;
    var t = setTimeout(function () { API.get('/api/furnidata/estado').then(function (r) { if (r) setCatalogo(r); }); }, 1500);
    return function () { clearTimeout(t); };
  }, [catalogo]);

  // Un dato del Sniper con su boton de copiar (la clave es larga: se corta con … y se copia entera).
  function filaCopiable(etiqueta, valor, aviso) {
    return h(Campo, { l: etiqueta },
      h('div', { style: { display: 'flex', gap: 6 } },
        h('span', { className: 'codigo', style: { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, valor),
        h('button', { className: 'btn', title: 'Copiar', onClick: function () { copiar(valor, function () { props.onAviso(aviso); }); } }, h(Ico, { name: 'copy', size: 14 }))));
  }

  function crearToken() {
    if (!nombre.trim()) { props.onError('Ponle un nombre al token (p. ej. "VPS 1").'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/sniper/tokens', { nombre: nombre }).then(function (r) { if (r) { setNuevo(r); setNombre(''); cargar(); } });
    });
  }
  function revocar(t) {
    setConfirmacion({ titulo: 'Revocar token', peligro: true, icono: 'key', textoBoton: 'Revocar',
      mensaje: h('span', null, '¿Revocar el token ', h('b', null, '«' + t.nombre + '»'), '? El sniper que lo use dejará de poder enviar eventos al instante.'),
      accion: function () { API.post('/api/sniper/tokens/' + t.id + '/revocar', {}).then(function (r) { if (r) { props.onAviso('Token revocado'); cargar(); } }); } });
  }
  // Un token revocado ya no sirve: se puede borrar de la base para limpiar la tabla. Lo
  // que envio ese sniper se conserva.
  function eliminarToken(t) {
    setConfirmacion({ titulo: 'Eliminar token', peligro: true, icono: 'trash', textoBoton: 'Eliminar',
      mensaje: h('span', null, '¿Eliminar para siempre el token revocado ', h('b', null, '«' + t.nombre + '»'), '? Se borra de la base de datos; las compras y el inventario que envió ese sniper se conservan.'),
      accion: function () { API.del('/api/sniper/tokens/' + t.id).then(function (r) { if (r) { props.onAviso('Token «' + t.nombre + '» eliminado'); cargar(); } }); } });
  }
  function eliminarRevocados(n) {
    setConfirmacion({ titulo: 'Eliminar tokens revocados', peligro: true, icono: 'trash', textoBoton: 'Eliminar ' + n,
      mensaje: h('span', null, '¿Eliminar para siempre los ', h('b', null, n + ' tokens revocados'), '? Se borran de la base de datos; los activos no se tocan y lo que enviaron esos snipers se conserva.'),
      accion: function () { API.post('/api/sniper/tokens/borrar-revocados', {}).then(function (r) { if (r) { props.onAviso(r.borrados + (r.borrados === 1 ? ' token revocado eliminado' : ' tokens revocados eliminados')); cargar(); } }); } });
  }
  function agregarKeko() {
    if (!kekoNuevo.trim()) { props.onError('Escribe el nombre del keko (p. ej. MiKekoBodega).'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/kekos', { nombre: kekoNuevo }).then(function (r) {
        if (r) { setKekoNuevo(''); props.onCambio('Keko «' + r.nombre + '» agregado'); }
      });
    });
  }
  function guardarNombreKeko() {
    if (!editando.nombre.trim()) { props.onError('El nombre del keko no puede quedar vacío.'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.put('/api/kekos/' + editando.id, { nombre: editando.nombre }).then(function (r) {
        if (r) { setEditando(null); props.onCambio('Keko renombrado a «' + r.nombre + '»' + (r.lotes ? ' (' + r.lotes + (r.lotes === 1 ? ' lote)' : ' lotes)') : '')); }
      });
    });
  }
  function borrarKeko(k) {
    setConfirmacion({ titulo: 'Borrar keko', peligro: true, icono: 'trash', textoBoton: 'Borrar',
      mensaje: h('span', null, '¿Borrar el keko ', h('b', null, '«' + k.nombre + '»'), '? Solo se puede si no le quedan unidades; sus ventas conservan el nombre.'),
      accion: function () { API.del('/api/kekos/' + k.id).then(function (r) { if (r) props.onCambio('Keko «' + k.nombre + '» borrado'); }); } });
  }
  function filaKeko(k) {
    var cifras = k.en_mano + ' en mano' + (k.publicadas ? ' · ' + k.publicadas + ' publicadas' : '');
    if (editando && editando.id === k.id) {
      return h('div', { key: k.nombre, className: 'fila-keko' },
        h('input', { className: 'inp', style: { flex: 1 }, autoFocus: true, maxLength: 60, value: editando.nombre,
          onChange: function (e) { setEditando({ id: k.id, nombre: e.target.value }); },
          onKeyDown: function (e) { if (e.key === 'Enter') guardarNombreKeko(); if (e.key === 'Escape') setEditando(null); } }),
        h('button', { className: 'btn btn-chico btn-verde', onClick: guardarNombreKeko, disabled: enviando }, 'Guardar'),
        h('button', { className: 'btn btn-chico', onClick: function () { setEditando(null); } }, 'Cancelar'));
    }
    return h('div', { key: k.nombre, className: 'fila-keko' },
      h('span', { style: { flex: 1, minWidth: 0 } }, k.nombre,
        k.origen === 'sniper' && k.snipers.length ? h('span', { className: 'tenue' }, ' · ' + k.snipers.join(', ')) : null),
      h('span', { className: 'suave mono', style: { fontSize: 12 } }, cifras),
      k.origen === 'sniper' ? null : h('button', { className: 'btn-icono', title: 'Renombrar', 'aria-label': 'Renombrar ' + k.nombre,
        onClick: function () { setEditando({ id: k.id, nombre: k.nombre }); } }, h(Ico, { name: 'edit', size: 14 })),
      k.origen === 'sniper' ? null : h('button', { className: 'btn-icono', title: 'Borrar', 'aria-label': 'Borrar ' + k.nombre,
        onClick: function () { borrarKeko(k); } }, h(Ico, { name: 'trash', size: 14, color: 'var(--red)' })));
  }

  function actualizarCatalogo() {
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/furnidata/actualizar', {}).then(function (r) { if (r) { setCatalogo(r); props.onAviso('Catálogo de Habbo.es actualizado'); } });
    });
  }
  function importar(ruta, reemplazar) {
    if (!ruta) { props.onError('Indica la ruta del archivo .xlsx'); return; }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/importar-excel', { ruta: ruta, reemplazar: reemplazar }).then(function (r) {
        if (r) { setInforme(r); props.onCambio('Excel importado: ' + r.furnis + ' furnis y ' + r.compras + ' lotes'); }
      });
    });
  }
  function elegirExcel(reemplazar) {
    if (!electron) { importar(rutaExcel, reemplazar); return; }
    window.electronAPI.elegirExcel().then(function (ruta) { if (ruta) importar(ruta, reemplazar); });
  }
  function simular(tipo) {
    API.post('/api/demo/simular-sniper', { tipo: tipo }).then(function (r) {
      if (r && r.errores && r.errores.length) props.onError(r.errores[0].error);
      if (r && tipo === 'inventario') props.onCambio('Inventario de ' + r.keko + ' recibido: revisa Auditoría');
      cargar();
    });
  }

  var ejemplo = conexion && conexion.url_eventos ? 'POST ' + conexion.url_eventos + '\napikey: <SUPABASE_ANON_KEY>\nAuthorization: Bearer <SUPABASE_ANON_KEY>\nContent-Type: application/json\n\n{ "token_sniper": "hbi_…",\n  "eventos": [\n    { "tipo_evento": "compra",    "id_externo": "…", "sprite_id": 4623, "cantidad": 1, "precio": 100, "moneda": "creditos", "hotel": "es", "notas": "…" },\n    { "tipo_evento": "publicar",  "id_externo": "pub_…", "sprite_id": 4623, "cantidad": 1, "precio_lista": 125, "moneda": "creditos", "hotel": "es" },\n    { "tipo_evento": "recuperar", "id_externo": "rec_…", "sprite_id": 4623, "cantidad": 1, "hotel": "es" } ] }' : null;

  return h('div', { className: 'contenedor fade-in', style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    confirmacion ? h(Confirmar, Object.assign({}, confirmacion, {
      onClose: function () { setConfirmacion(null); },
      onConfirmar: function () { var a = confirmacion.accion; setConfirmacion(null); a(); } })) : null,
    h('div', { className: 'card' },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 } },
        h(Ico, { name: 'plug', size: 20, color: 'var(--green)' }),
        h('div', { style: { flex: 1 } },
          h('div', { className: 'card-titulo' }, 'Conexión con SniperMercadillo'),
          h('div', { className: 'card-sub' }, 'Copia estos tres datos en ⚙️ Ajustes del Sniper de cada VPS, en los campos del mismo nombre. Solo Habbo.es; cada VPS con su propio token.')),
        h('span', { className: 'tag tag-verde' }, 'Habbo.es')),
      conexion && conexion.url_proyecto ? filaCopiable('URL del proyecto', conexion.url_proyecto, 'URL del proyecto copiada') : null,
      conexion && conexion.clave_publica ? filaCopiable('Clave pública (anon o publishable)', conexion.clave_publica, 'Clave pública copiada') : null,
      conexion && conexion.url_proyecto ? h(Campo, { l: 'Token de este VPS' },
        h('span', { className: 'suave', style: { fontSize: 13 } }, 'Uno por VPS: créalo abajo y cópialo en ese momento (no se vuelve a mostrar).')) : null,
      conexion && conexion.demo ? h('div', { className: 'aviso aviso-ambar', style: { margin: '6px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { style: { flex: 1, minWidth: 200 } }, 'Modo demo: la base es local. Simula lo que envía el Sniper:'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('compra'); } }, h(Ico, { name: 'cart', size: 12 }), 'Compra'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('publicar'); } }, h(Ico, { name: 'lock', size: 12 }), 'Publicar'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('recuperar'); } }, h(Ico, { name: 'undo', size: 12 }), 'Recuperar'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('inventario'); } }, h(Ico, { name: 'audit', size: 12 }), 'Inventario')) : null,

      nuevo ? h('div', { className: 'token-nuevo', style: { margin: '10px 0' } },
        h('div', { style: { fontWeight: 700, color: 'var(--green)', marginBottom: 6 } }, 'Token de "' + nuevo.nombre + '" — cópialo ahora, no se vuelve a mostrar'),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('span', { className: 'codigo', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, nuevo.token),
          h('button', { className: 'btn btn-verde', onClick: function () { copiar(nuevo.token, function () { props.onAviso('Token copiado'); }); } }, h(Ico, { name: 'copy', size: 14 }), 'Copiar')),
        h('div', { className: 'suave', style: { fontSize: 12, marginTop: 6 } }, 'Pégalo en la configuración del sniper de ese VPS. Si lo pierdes, revoca este y crea otro.')) : null,

      h('div', { style: { marginTop: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('div', { className: 'fld-l', style: { flex: 1 } }, 'Tokens de tus snipers'),
          revocados > 1 ? h('button', { className: 'btn btn-chico', onClick: function () { eliminarRevocados(revocados); } },
            h(Ico, { name: 'trash', size: 12, color: 'var(--red)' }), 'Eliminar los ' + revocados + ' revocados') : null),
        tokens.length === 0 ? h('div', { className: 'suave', style: { fontSize: 13, padding: '6px 0' } }, 'Aún no hay tokens. Crea uno por cada VPS.')
          : h('table', { className: 'tabla', style: { marginBottom: 10 } },
              h('thead', null, h('tr', null, h('th', null, 'Nombre'), h('th', null, 'Keko'), h('th', null, 'Token'), h('th', null, 'Creado'), h('th', null, 'Último uso'), h('th', null, 'Estado'), h('th', null))),
              h('tbody', null, tokens.map(function (t) {
                return h('tr', { key: t.id },
                  h('td', null, t.nombre),
                  h('td', { className: t.keko ? null : 'tenue', title: t.keko ? null : 'Lo aprende al enviar su primer inventario' }, t.keko || '—'),
                  h('td', { className: 'mono tenue' }, t.prefijo + '…'),
                  h('td', { className: 'suave' }, fmtD(String(t.creado_en).slice(0, 10))),
                  h('td', { className: 'suave' }, t.ultimo_uso ? fmtHace(t.ultimo_uso) : 'nunca'),
                  h('td', null, t.revocado ? h('span', { className: 'tag tag-gris' }, 'Revocado') : h('span', { className: 'tag tag-verde' }, 'Activo')),
                  h('td', { className: 'r' }, t.revocado
                    ? h('button', { className: 'btn-icono', style: { marginLeft: 'auto' }, title: 'Eliminar de la base de datos', 'aria-label': 'Eliminar el token ' + t.nombre,
                        onClick: function () { eliminarToken(t); } }, h(Ico, { name: 'trash', size: 14, color: 'var(--red)' }))
                    : h('button', { className: 'btn btn-chico btn-peligro', onClick: function () { revocar(t); } }, 'Revocar')));
              }))),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { className: 'inp', placeholder: 'Nombre del VPS (p. ej. VPS 1)', value: nombre, onChange: function (e) { setNombre(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') crearToken(); } }),
          h('button', { className: 'btn btn-verde', onClick: crearToken, disabled: enviando }, h(Ico, { name: 'key', size: 14 }), 'Crear token'))),
      ejemplo ? h('details', { style: { marginTop: 12 } },
        h('summary', { className: 'suave', style: { cursor: 'pointer', fontSize: 13 } }, 'Ejemplo de envío (para configurar el sniper)'),
        h('div', { className: 'codigo', style: { marginTop: 8 } }, ejemplo)) : null),

    h('div', { className: 'card' },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 } },
        h(Ico, { name: 'user', size: 20, color: 'var(--green)' }),
        h('div', { className: 'card-titulo' }, 'Kekos')),
      h('div', { className: 'card-sub', style: { marginBottom: 10 } }, 'Dónde están tus furnis. Los de tus snipers se detectan solos; los manuales (una bodega, un keko sin Sniper) nunca se auditan.'),
      !kekos.disponible
        ? h('div', { className: 'aviso aviso-ambar', style: { fontSize: 13 } }, 'Para registrar kekos manuales instala la migración 20261008000000_kekos_manuales.sql (aviso ámbar de arriba).')
        : [
            h('div', { key: 'ls', className: 'fld-l' }, 'De tus snipers'),
            kekosSniper.length ? h('div', { key: 's' }, kekosSniper.map(filaKeko))
              : h('div', { key: 's', className: 'suave', style: { fontSize: 13, padding: '4px 0 8px' } }, 'Aparecen cuando un sniper envía su primer inventario.'),
            h('div', { key: 'lm', className: 'fld-l', style: { marginTop: 10 } }, 'Manuales'),
            kekosManuales.length ? h('div', { key: 'm' }, kekosManuales.map(filaKeko))
              : h('div', { key: 'm', className: 'suave', style: { fontSize: 13, padding: '4px 0 8px' } }, 'Aún no tienes kekos manuales.'),
            h('div', { key: 'nuevo', style: { display: 'flex', gap: 8, marginTop: 10 } },
              h('input', { className: 'inp', placeholder: 'Nombre del keko (p. ej. MiKekoBodega)', maxLength: 60, value: kekoNuevo,
                onChange: function (e) { setKekoNuevo(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') agregarKeko(); } }),
              h('button', { className: 'btn', onClick: agregarKeko, disabled: enviando }, h(Ico, { name: 'plus', size: 14 }), 'Agregar')),
            sinKeko ? h('div', { key: 'sin', className: 'aviso aviso-ambar', style: { marginTop: 14, fontSize: 13 } },
              h('div', { style: { marginBottom: 8 } }, sinKeko + (sinKeko === 1 ? ' unidad en mano sin keko' : ' unidades en mano sin keko') +
                ' (compras manuales, Excel o del Sniper antes de su primer inventario). Salen en las auditorías de tus snipers.'),
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', null, 'Asignarlas a'),
                h('div', { style: { flex: 1, minWidth: 180 } }, h(SelectorKeko, { kekos: kekos.kekos, valor: haciaSinKeko, onChange: setHaciaSinKeko })),
                h('button', { className: 'btn btn-chico', onClick: function () { setAsignando(true); } }, 'Revisar y asignar'))) : null,
          ]),
    asignando ? h(AsignarKekoModal, { compras: props.compras, furnis: props.furnis, kekos: kekos.kekos, hacia: haciaSinKeko,
      onClose: function () { setAsignando(false); }, onAsignado: function (msg) { props.onCambio(msg); } }) : null,

    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 } },
      h('div', { className: 'card' },
        h('div', { className: 'card-titulo', style: { marginBottom: 4 } }, h(Ico, { name: 'upload', size: 16 }), 'Importar desde Excel'),
        h('div', { className: 'card-sub', style: { marginBottom: 10 } }, 'Trae tu plantilla (hojas Inventario, Mercadillo y Resumen). Los nombres se corrigen al oficial de Habbo.es.'),
        electron ? null : h('input', { className: 'inp', style: { marginBottom: 8 }, placeholder: 'Ruta del archivo .xlsx', value: rutaExcel, onChange: function (e) { setRutaExcel(e.target.value); } }),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', { className: 'btn', onClick: function () { elegirExcel(false); }, disabled: enviando }, electron ? 'Elegir archivo…' : 'Importar'),
          h('button', { className: 'btn btn-peligro', disabled: enviando, onClick: function () {
            setConfirmacion({ titulo: 'Reemplazar todo', peligro: true, icono: 'trash', textoBoton: 'Borrar e importar',
              mensaje: 'Esto BORRA tus furnis y lotes actuales antes de importar el Excel. No se puede deshacer.',
              accion: function () { elegirExcel(true); } });
          } }, 'Reemplazar todo')),
        informe ? h('div', { className: 'aviso', style: { marginTop: 10 } },
          informe.furnis + ' furnis y ' + informe.compras + ' lotes importados.',
          informe.correcciones.length ? ' ' + informe.correcciones.length + ' nombre(s) corregido(s) al oficial.' : '',
          informe.sinVincular.length ? ' ' + informe.sinVincular.length + ' sin vincular al catálogo.' : '') : null),

      h('div', { className: 'card' },
        h('div', { className: 'card-titulo', style: { marginBottom: 4 } }, h(Ico, { name: 'database', size: 16 }), 'Catálogo de Habbo.es'),
        h('div', { className: 'card-sub', style: { marginBottom: 10 } }, catalogo
          ? (catalogo.actualizando ? 'Buscando novedades en Habbo.es…'
            : catalogo.disponible ? catalogo.total.toLocaleString('es-CO') + ' furnis · revisado ' + fmtHace(catalogo.descargadoEn) + '. Se actualiza solo cada vez que abres la app.'
            : 'No disponible: ' + (catalogo.error || 'sin descargar'))
          : 'Cargando…'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', { className: 'btn', onClick: actualizarCatalogo, disabled: enviando }, h(Ico, { name: 'refresh', size: 14 }), 'Actualizar ahora'),
          electron ? h('button', { className: 'btn', onClick: function () { window.electronAPI.abrirCarpetaDatos(); } }, h(Ico, { name: 'folder', size: 14 }), 'Carpeta de datos') : null)),

      h(Notificaciones, { enVivo: conexion ? conexion.auditoria_en_vivo : null, onAviso: props.onAviso, onError: props.onError }),

      h('div', { className: 'card' },
        h('div', { className: 'card-titulo', style: { marginBottom: 4 } }, h(Ico, { name: 'settings', size: 16 }), 'Cuenta y apariencia'),
        h(Campo, { l: 'Sesión' }, h('span', null, cuenta.usuario ? cuenta.usuario.email : '-')),
        h(Campo, { l: 'Supabase' }, h('span', { className: 'mono suave', style: { fontSize: 12, wordBreak: 'break-all' } }, cuenta.demo ? 'Modo demo (local)' : cuenta.url)),
        electron ? h(Actualizaciones) : null,
        h(Campo, { l: 'Tema' },
          h('div', { className: 'segmento', style: { maxWidth: 240 } },
            [['dark', 'Oscuro'], ['light', 'Claro']].map(function (t) {
              return h('button', { key: t[0], className: props.tema === t[0] ? 'activo' : '', onClick: function () { props.onTema(t[0]); } }, t[1]);
            }))),
        cuenta.demo ? null : h('button', { className: 'btn', style: { marginTop: 10 }, onClick: props.onSalir }, h(Ico, { name: 'logout', size: 14 }), 'Cerrar sesión'))));
}
