// public/js/componentes/Fantasmas.js — el aviso de furnis fantasma de antes de la 1.10.0 (v1.10.1).
//
// Maqueta aprobada el 08-10-2026: aviso ambar arriba del Mercadillo y de Inventario › Publicado
// («Ver como limpiarlos» / «Ahora no»), etiqueta gris punteada en las listas y una ventana con la
// lista por keko (con la hora de su inventario) y los pasos. La app NO borra nada: la ventana copia
// los SQL de scripts/limpiar-fantasmas (que van en el instalador) para el SQL Editor del proyecto,
// donde el usuario revisa antes de limpiar. «Expirado» va en condicional: a veces el furni vuelve
// solo a la mano y no hay nada que recoger (lo vio el dueño).

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { Ico } from './iconos.js';
import { Modal, NombreFurni } from './base.js';
import { AvatarKeko } from './BloquesKeko.js';
import { avisoVisible, textoAviso, porKeko } from '../core/fantasmas.js';
import { fmtHace } from '../core/format.js';
import { enlacesSupabase } from '../vistas/Acceso.js';

export var AYUDA_FANTASMA = 'Lo volviste a registrar con «Entrada con costo» cuando volvió a tu mano: cuenta dos veces. Arriba, «Ver cómo limpiarlos».';

export function EtiquetaFantasma(props) {
  return h('span', { className: 'tag tag-fantasma', title: AYUDA_FANTASMA },
    h(Ico, { name: 'fantasma', size: 11, sw: 2 }), props.n ? props.n + ' fantasma' : 'Fantasma');
}

// «Ux_Data, -JDark y Claudio4.8», con los nombres en negrita.
function listaKekos(kekos) {
  var partes = [];
  kekos.forEach(function (k, i) {
    if (i) partes.push(i === kekos.length - 1 ? ' y ' : ', ');
    partes.push(h('b', { key: k }, k));
  });
  return partes;
}

// El aviso de arriba. props: datos (/api/fantasmas), oculta («Ahora no»), onVer, onAhoraNo.
export function AvisoFantasmas(props) {
  if (!avisoVisible(props.datos, props.oculta)) return null;
  var t = textoAviso(props.datos);
  return h('div', { className: 'fantasmas', role: 'status' },
    h('div', { className: 'fantasmas-ico' }, h(Ico, { name: 'fantasma', size: 19, sw: 2 })),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { className: 'fantasmas-t' }, t.titulo),
      h('div', { className: 'fantasmas-txt' },
        'Son ofertas que caducaron y que volviste a registrar con «Entrada con costo» cuando el furni volvió a tu mano: siguen aquí como publicadas, así que cuentan dos veces en el Mercadillo y en tu ganancia esperada. ',
        'Están en ', listaKekos(t.kekos), '.'),
      h('div', { className: 'fantasmas-acc' },
        h('button', { className: 'btn btn-chico btn-verde', onClick: props.onVer }, h(Ico, { name: 'fantasma', size: 12, sw: 2 }), 'Ver cómo limpiarlos'),
        h('button', { className: 'btn btn-chico', title: 'Se oculta en este equipo hasta que la lista cambie', onClick: props.onAhoraNo }, 'Ahora no'))));
}

// Copia al portapapeles como «Copiar detalles» de ErroresModal: en la app de escritorio, el del
// sistema (Electron); si no, el del navegador; y si no deja, la copia clasica con un cuadro
// temporal. Resuelve true/false.
function alPortapapeles(texto) {
  var clasica = function () {
    var area = document.createElement('textarea');
    area.value = texto; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(area);
    return ok;
  };
  var electron = window.electronAPI && window.electronAPI.copiar;
  if (electron) return electron(texto).then(function () { return true; }, clasica);
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto).then(function () { return true; }, clasica);
  return Promise.resolve(clasica());
}

function fecha(iso) {
  if (!iso) return 'sin fecha';
  var d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
  return isNaN(d.getTime()) ? 'sin fecha' : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

// La ventana. props: datos, cuenta (su url da el SQL Editor del proyecto), compras, furnis, kekos,
// onClose, onComprobar (vuelve a mirar; devuelve una promesa).
export function FantasmasModal(props) {
  var sC = useState(null); var copiado = sC[0]; var setCopiado = sC[1];
  var sE = useState(''); var error = sE[0]; var setError = sE[1];
  var sB = useState(false); var comprobando = sB[0]; var setComprobando = sB[1];
  var r = props.datos;
  var grupos = porKeko(r);
  var sin21 = r.migracion21 === false;
  var viejos = grupos.filter(function (g) { return !g.reciente; });
  var lotes = {};
  (props.compras || []).forEach(function (l) { lotes[l.id] = l; });
  var furnis = {};
  (props.furnis || []).forEach(function (f) { furnis[f.id] = f; });
  var listaK = (props.kekos && props.kekos.kekos) || [];
  var sql = enlacesSupabase(props.cuenta && props.cuenta.url).sql;
  var nLotes = grupos.reduce(function (s, g) { return s + g.filas.reduce(function (t, f) { return t + (f.lotes_fantasma || []).length; }, 0); }, 0);

  function copiar(archivo, paso) {
    setError('');
    API.get('/api/fantasmas/sql/' + encodeURIComponent(archivo)).then(function (x) {
      if (!x) return;
      return alPortapapeles(x.sql).then(function (ok) {
        if (ok) setCopiado(paso);
        else setError('No se pudo copiar. Abre el archivo scripts/limpiar-fantasmas/' + archivo + ' (en GitHub, en la carpeta del proyecto) y copia todo su contenido.');
      });
    });
  }
  function comprobar() {
    if (comprobando) return;
    setComprobando(true);
    Promise.resolve(props.onComprobar()).then(function () { setComprobando(false); }, function () { setComprobando(false); });
  }
  function botonCopiar(archivo, paso, texto) {
    var listo = copiado === paso;
    return h('button', { className: 'btn btn-chico' + (listo ? ' btn-verde' : ''), disabled: sin21, onClick: function () { copiar(archivo, paso); } },
      h(Ico, { name: listo ? 'check' : 'copy', size: 12 }), listo ? 'Copiado' : (texto || 'Copiar SQL'));
  }
  function paso(n, titulo, texto, acciones, siguiente) {
    return h('div', { key: n, className: 'mig' + (siguiente ? ' siguiente' : '') + (sin21 && n > 0 ? ' bloqueado' : '') },
      h('span', { className: 'paso-n' }, n),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('div', null, h('b', null, titulo)), h('div', { className: 'suave', style: { fontSize: 12, marginTop: 2, lineHeight: 1.45 } }, texto)),
      acciones ? h('div', { className: 'acciones' }, acciones) : null);
  }

  return h(Modal, { titulo: [h(Ico, { key: 'i', name: 'fantasma', size: 17, sw: 2, color: 'var(--yellow)' }), 'Furnis fantasma de antes de la 1.10.0'], ancho: 640, onClose: props.onClose },
    h('div', { className: 'suave', style: { fontSize: 13, lineHeight: 1.5 } },
      'Antes de la 1.10.0, cuando una oferta caducaba y el furni volvía a tu mano, la Auditoría lo mostraba como sobrante y lo registraste con «Entrada con costo». La oferta vieja se quedó en Publicado: el mismo furni cuenta dos veces. ',
      h('b', null, 'La app no borra nada:'), ' la limpieza se hace en tu Supabase, revisando primero.'),
    h('div', { className: 'fz-resumen' },
      h('span', { className: 'tag tag-ambar' }, h(Ico, { name: 'fantasma', size: 11, sw: 2 }), r.unidades + ' und'),
      h('span', { className: 'tag tag-gris' }, nLotes + (nLotes === 1 ? ' lote' : ' lotes')),
      h('span', { className: 'tag tag-gris' }, grupos.length + (grupos.length === 1 ? ' keko' : ' kekos'))),
    sin21 ? h('div', { className: 'aviso aviso-rojo', style: { display: 'flex', gap: 8, alignItems: 'center' } }, h(Ico, { name: 'database', size: 14 }),
      'Primero instala la actualización de la base (la migración 21) desde el aviso ámbar de arriba: la limpieza la necesita.') : null,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, grupos.map(function (g) {
      var k = listaK.find(function (x) { return String(x.nombre).toLowerCase() === String(g.keko).toLowerCase(); }) || { nombre: g.keko, origen: 'sniper' };
      return h('div', { key: g.keko, className: 'fz-keko' },
        h('div', { className: 'fz-keko-cab' }, h(AvatarKeko, { keko: k, tam: 24 }), h('b', null, g.keko),
          h('span', { className: 'estado ' + (g.reciente ? 'pos' : 'caduco') },
            g.reciente ? h(Ico, { name: 'check', size: 12, sw: 2.4 }) : h(Ico, { name: 'alert', size: 12 }),
            'Inventario ' + fmtHace(g.inventario_en) + (g.reciente ? '' : ': reconecta su Sniper antes del paso 1'))),
        g.filas.map(function (f) {
          var ids = f.lotes_fantasma || [];
          var primero = lotes[ids[0]];
          var furni = furnis[f.furni_id] || { nombre: f.furni };
          var sub = (ids.length === 1 ? 'Lote Nº ' : 'Lotes Nº ') + ids.join(', ') + ' · publicado el ' + fecha(primero && primero.publicado_en)
            + (f.numero_ltd ? ' · el #' + f.numero_ltd + ' ya está en otro lote' : ' · registrado otra vez el ' + (f.entradas_dias || []).map(fecha).join(', '));
          return h('div', { key: ids.join('-') || f.furni, className: 'fz-fila' },
            h(NombreFurni, { furni: furni, ltds: f.numero_ltd ? [f.numero_ltd] : [], size: 30, sub: sub }),
            h('span', { className: 'mono' }, h('b', null, f.unidades), ' und'));
        }));
    })),
    h('div', { className: 'fz-pasos' },
      paso(0, 'Si quedó algo en «Expirado», recógelo',
        'En Habbo, mira la pestaña «Expirado» del Mercadillo de cada keko: si hay furnis, recógelos (a veces vuelven solos a tu inventario y no hace falta). Luego espera unos 3 minutos con el Sniper conectado: lo real vuelve solo a Comprado.',
        null, copiado === null),
      paso(1, 'Revisar (no cambia nada)',
        'Pégalo en el SQL Editor y pulsa Run. Debe marcar BORRAR las mismas ' + r.unidades + ' und de esta lista'
          + (viejos.length ? '; los kekos con el inventario viejo saldrán «NO SE TOCA»: reconecta su Sniper y repítelo' : '') + '.',
        [h('span', { key: 'c' }, botonCopiar('1-revisar.sql', 1)),
          h('a', { key: 'e', className: 'btn btn-chico', href: sin21 ? undefined : sql, target: '_blank', rel: 'noopener noreferrer', 'aria-disabled': sin21 || undefined,
              style: sin21 ? { opacity: 0.5, pointerEvents: 'none' } : null },
            h(Ico, { name: 'external', size: 12 }), 'SQL Editor')],
        copiado === 1),
      paso(2, 'Limpiar (guarda una copia)',
        'Pégalo y pulsa Run. Supabase avisará «Potential issue detected»: confirma con «Run this query». Te muestra lo que borró.',
        botonCopiar('2-limpiar.sql', 2), copiado === 2),
      paso(3, 'Comprueba',
        'Vuelve aquí y pulsa «Comprobar de nuevo»: si ya no quedan, este aviso desaparece.',
        h('button', { className: 'btn btn-chico' + (comprobando ? ' girando' : ''), disabled: sin21 || comprobando, onClick: comprobar }, h(Ico, { name: 'refresh', size: 12 }), 'Comprobar de nuevo'),
        copiado === 3)),
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { className: 'suave', style: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
      '¿Algo no cuadra después? «Deshacer» devuelve todo lo que borró el paso 2, tal cual.', botonCopiar('3-deshacer.sql', 4, 'Copiar «Deshacer»')));
}
