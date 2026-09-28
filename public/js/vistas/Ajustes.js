// public/js/vistas/Ajustes.js — conexion con los SniperMercadillo, importar Excel,
// catalogo de Habbo.es, tema y cuenta.
//
// Cada sniper (cada VPS) usa su PROPIO token: si un VPS se compromete, se revoca solo
// ese. El token se muestra una unica vez al crearlo; en Supabase queda solo su huella.

import { h, useState, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtHace, fmtD } from '../core/format.js';
import { _submitGuard } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { Confirmar } from '../componentes/base.js';

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
  var electron = typeof window !== 'undefined' && window.electronAPI;

  function cargar() {
    API.get('/api/sniper/conexion').then(function (r) { if (r) setConexion(r); });
    API.get('/api/sniper/tokens').then(function (r) { if (r) setTokens(r); });
    API.get('/api/furnidata/estado').then(function (r) { if (r) setCatalogo(r); });
  }
  useEffect(cargar, []);

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
          h('div', { className: 'card-sub' }, 'Tus snipers de los VPS envían sus compras, publicaciones y recuperaciones directo a Supabase. Solo Habbo.es; cada VPS con su propio token.')),
        h('span', { className: 'tag tag-verde' }, 'Habbo.es')),
      conexion && conexion.url_eventos ? h(Campo, { l: 'Dirección' },
        h('div', { style: { display: 'flex', gap: 6 } },
          h('span', { className: 'codigo', style: { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, conexion.url_eventos),
          h('button', { className: 'btn', onClick: function () { copiar(conexion.url_eventos, function () { props.onAviso('Dirección copiada'); }); } }, h(Ico, { name: 'copy', size: 14 })))) : null,
      conexion && conexion.demo ? h('div', { className: 'aviso aviso-ambar', style: { margin: '6px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { style: { flex: 1, minWidth: 200 } }, 'Modo demo: la base es local. Simula lo que envía el Sniper:'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('compra'); } }, h(Ico, { name: 'cart', size: 12 }), 'Compra'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('publicar'); } }, h(Ico, { name: 'lock', size: 12 }), 'Publicar'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('recuperar'); } }, h(Ico, { name: 'undo', size: 12 }), 'Recuperar'),
        h('button', { className: 'btn btn-chico', onClick: function () { simular('inventario'); } }, h(Ico, { name: 'audit', size: 12 }), 'Inventario')) : null,
      h(Campo, { l: 'Clave del proyecto' }, h('span', { className: 'suave', style: { fontSize: 13 } }, 'La misma Anon Key de tu .env (va en las cabeceras apikey y Authorization).')),

      nuevo ? h('div', { className: 'token-nuevo', style: { margin: '10px 0' } },
        h('div', { style: { fontWeight: 700, color: 'var(--green)', marginBottom: 6 } }, 'Token de "' + nuevo.nombre + '" — cópialo ahora, no se vuelve a mostrar'),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('span', { className: 'codigo', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, nuevo.token),
          h('button', { className: 'btn btn-verde', onClick: function () { copiar(nuevo.token, function () { props.onAviso('Token copiado'); }); } }, h(Ico, { name: 'copy', size: 14 }), 'Copiar')),
        h('div', { className: 'suave', style: { fontSize: 12, marginTop: 6 } }, 'Pégalo en la configuración del sniper de ese VPS. Si lo pierdes, revoca este y crea otro.')) : null,

      h('div', { style: { marginTop: 10 } },
        h('div', { className: 'fld-l' }, 'Tokens de tus snipers'),
        tokens.length === 0 ? h('div', { className: 'suave', style: { fontSize: 13, padding: '6px 0' } }, 'Aún no hay tokens. Crea uno por cada VPS.')
          : h('table', { className: 'tabla', style: { marginBottom: 10 } },
              h('thead', null, h('tr', null, h('th', null, 'Nombre'), h('th', null, 'Token'), h('th', null, 'Creado'), h('th', null, 'Último uso'), h('th', null, 'Estado'), h('th', null))),
              h('tbody', null, tokens.map(function (t) {
                return h('tr', { key: t.id },
                  h('td', null, t.nombre),
                  h('td', { className: 'mono tenue' }, t.prefijo + '…'),
                  h('td', { className: 'suave' }, fmtD(String(t.creado_en).slice(0, 10))),
                  h('td', { className: 'suave' }, t.ultimo_uso ? fmtHace(t.ultimo_uso) : 'nunca'),
                  h('td', null, t.revocado ? h('span', { className: 'tag tag-gris' }, 'Revocado') : h('span', { className: 'tag tag-verde' }, 'Activo')),
                  h('td', { className: 'r' }, t.revocado ? null : h('button', { className: 'btn btn-chico btn-peligro', onClick: function () { revocar(t); } }, 'Revocar')));
              }))),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { className: 'inp', placeholder: 'Nombre del VPS (p. ej. VPS 1)', value: nombre, onChange: function (e) { setNombre(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') crearToken(); } }),
          h('button', { className: 'btn btn-verde', onClick: crearToken, disabled: enviando }, h(Ico, { name: 'key', size: 14 }), 'Crear token'))),
      ejemplo ? h('details', { style: { marginTop: 12 } },
        h('summary', { className: 'suave', style: { cursor: 'pointer', fontSize: 13 } }, 'Ejemplo de envío (para configurar el sniper)'),
        h('div', { className: 'codigo', style: { marginTop: 8 } }, ejemplo)) : null),

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
          ? (catalogo.disponible ? catalogo.total.toLocaleString('es-CO') + ' furnis · actualizado ' + fmtHace(catalogo.descargadoEn) : 'No disponible: ' + (catalogo.error || 'sin descargar'))
          : 'Cargando…'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', { className: 'btn', onClick: actualizarCatalogo, disabled: enviando }, h(Ico, { name: 'refresh', size: 14 }), 'Actualizar ahora'),
          electron ? h('button', { className: 'btn', onClick: function () { window.electronAPI.abrirCarpetaDatos(); } }, h(Ico, { name: 'folder', size: 14 }), 'Carpeta de datos') : null)),

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
