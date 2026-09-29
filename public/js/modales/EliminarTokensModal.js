// public/js/modales/EliminarTokensModal.js — eliminar uno o todos los tokens revocados, eligiendo
// que pasa con lo que envio su Sniper (v1.5.0):
//   - Borrado simple (por defecto): solo el token; los lotes, las ventas, la foto del
//     inventario y el keko se conservan.
//   - Limpieza profunda (migracion 20261012000000): ademas se borran TODOS los datos de su
//     keko (lotes en mano, publicados y vendidos, la foto, las exclusiones) y el historial de
//     eventos de esos tokens. El modal muestra antes cuanto se borra, pide marcar «Entiendo»
//     y la bloquea si el keko tiene un token ACTIVO (su Sniper sigue gestionando ese
//     inventario). La base lo vuelve a comprobar en la misma transaccion que borra, asi que
//     si algo cambio mientras el modal estaba abierto, se niega y el modal se pone al dia.

import { h, useState, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { fmtHace } from '../core/format.js';
import { Modal } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';

function pl(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
function unidades(n) { return pl(n, 'unidad', 'unidades'); }
function lista(nombres) { return nombres.map(function (x) { return '«' + x + '»'; }).join(', '); }

// Lo que se borra de un keko, una linea por tipo de dato.
function detalleKeko(k) {
  var lineas = [];
  if (k.lotes_en_mano) lineas.push(pl(k.lotes_en_mano, 'lote en mano', 'lotes en mano') + ' (' + unidades(k.en_mano) + ')');
  if (k.lotes_publicados) lineas.push(pl(k.lotes_publicados, 'lote publicado', 'lotes publicados') + ' en el mercadillo (' + unidades(k.publicadas) + ')');
  if (k.ventas) lineas.push(pl(k.ventas, 'venta registrada', 'ventas registradas') + ' (' + unidades(k.vendidas) + '): su ganancia sale del Resumen');
  if (k.foto) lineas.push('La foto de su inventario de Habbo (enviada ' + fmtHace(k.foto) + ')');
  if (k.exclusiones) lineas.push(pl(k.exclusiones, 'furni quitado', 'furnis quitados') + ' de su auditoría');
  if (!lineas.length) lineas.push('No tiene lotes ni inventario registrados');
  return lineas;
}

export function EliminarTokensModal(props) {
  var tokens = props.tokens;
  var ids = tokens.map(function (t) { return t.id; });
  var varios = tokens.length > 1;
  var sM = useState('simple'); var modo = sM[0]; var setModo = sM[1];
  var sV = useState(null); var vista = sV[0]; var setVista = sV[1];
  var sE = useState(false); var entiendo = sE[0]; var setEntiendo = sE[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  // Lo que borraria la limpieza profunda y si un token activo la bloquea (al abrir y cada
  // vez que se elige la limpieza: el estado de los tokens puede cambiar).
  function revisar() {
    return API.get('/api/sniper/tokens/limpieza?ids=' + ids.join(',')).then(function (r) { if (r) setVista(r); return r; });
  }
  useEffect(function () { revisar(); }, []);
  useEffect(function () {
    function tecla(e) { if (e.key === 'Escape') props.onClose(); }
    document.addEventListener('keydown', tecla);
    return function () { document.removeEventListener('keydown', tecla); };
  }, []);

  var kekos = vista && vista.disponible ? vista.kekos || [] : [];
  var bloqueados = kekos.filter(function (k) { return (k.activos || []).length; });
  var motivo = !vista ? null
    : !vista.disponible ? 'Para usarla instala la migración 20261012000000_limpieza_tokens.sql (aviso ámbar de arriba).'
    : !kekos.length ? (varios ? 'Ninguno de estos tokens llegó a enviar' : 'Este token nunca envió') + ' el inventario de un keko: no hay datos de un keko que borrar.'
    : null;
  var profundaPosible = !!vista && !motivo && !bloqueados.length;
  var profunda = modo === 'profunda';

  function elegir(m) {
    setModo(m);
    setEntiendo(false);
    if (m === 'profunda') revisar();
  }

  function eliminar() {
    if (profunda && (!profundaPosible || !entiendo)) return;
    _submitGuard(enviando, setEnviando, function () {
      var peticion = varios
        ? API.post('/api/sniper/tokens/borrar-revocados', { limpieza: profunda })
        : API.del('/api/sniper/tokens/' + ids[0] + (profunda ? '?limpieza=1' : ''));
      return peticion.then(function (r) {
        // Si la base lo nego (p. ej. un token de ese keko se activo mientras tanto), el
        // aviso ya salio: el modal se pone al dia y sigue abierto.
        if (!r) { if (profunda) { setEntiendo(false); revisar(); } return; }
        var que = varios ? pl(r.borrados, 'token revocado eliminado', 'tokens revocados eliminados') : 'Token «' + tokens[0].nombre + '» eliminado';
        if (profunda && r.kekos && r.kekos.length) {
          que += ' y datos de ' + lista(r.kekos) + ' borrados (' + pl(r.lotes, 'lote', 'lotes') + ', ' + pl(r.eventos, 'evento', 'eventos') + ')';
        }
        props.onHecho(que, profunda);
      });
    });
  }

  function opcion(m, titulo, texto, extra, deshabilitada) {
    var activa = modo === m;
    return h('div', { role: 'radio', tabIndex: deshabilitada ? -1 : 0, 'aria-checked': activa ? 'true' : 'false', 'aria-disabled': deshabilitada ? 'true' : null,
      className: 'opcion-borrado' + (m === 'profunda' ? ' peligro' : '') + (activa ? ' activa' : '') + (deshabilitada ? ' deshabilitada' : ''),
      onClick: function () { if (!deshabilitada) elegir(m); },
      onKeyDown: function (e) { if (!deshabilitada && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); elegir(m); } } },
      h('span', { className: 'radio' }),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { className: 'opcion-titulo' }, titulo),
        h('div', { className: 'opcion-texto' }, texto),
        extra));
  }

  var nombres = varios ? pl(tokens.length, 'token revocado', 'tokens revocados') : 'el token revocado «' + tokens[0].nombre + '»';
  var kekoTexto = kekos.length ? lista(kekos.map(function (k) { return k.keko; })) : null;

  // Detalle de la limpieza: bloqueo, motivo por el que no aplica, o lo que se borra.
  var detalle = null;
  if (!vista) {
    detalle = h('div', { className: 'opcion-texto' }, 'Revisando los datos de su keko…');
  } else if (motivo) {
    detalle = h('div', { className: 'opcion-texto', style: { marginTop: 4 } }, motivo);
  } else if (bloqueados.length) {
    detalle = h('div', { className: 'aviso aviso-rojo', style: { display: 'flex', gap: 8, marginTop: 8 } },
      h(Ico, { name: 'lock', size: 14 }),
      h('div', null, bloqueados.map(function (k) {
        return h('div', { key: k.keko }, 'Bloqueada: el keko «' + k.keko + '» tiene ' +
          (k.activos.length === 1 ? 'el token activo ' : 'los tokens activos ') + lista(k.activos) + '. Su Sniper sigue gestionando ese inventario.');
      }), h('div', { style: { marginTop: 4 } }, 'Revoca ' + (bloqueados.length === 1 && bloqueados[0].activos.length === 1 ? 'ese token' : 'esos tokens') + ' primero, o usa el borrado simple.')));
  } else {
    detalle = h('div', { style: { marginTop: 6 } },
      kekos.map(function (k) {
        return h('div', { key: k.keko },
          kekos.length > 1 ? h('b', { style: { fontSize: 12 } }, k.keko) : null,
          h('ul', { className: 'limpieza-lista' }, detalleKeko(k).map(function (t, i) { return h('li', { key: i }, t); })));
      }),
      vista.eventos ? h('ul', { className: 'limpieza-lista' }, h('li', null, pl(vista.eventos, 'evento del historial', 'eventos del historial') + (varios ? ' de estos tokens' : ' de este token'))) : null);
  }

  return h(Modal, { titulo: h('span', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, h(Ico, { name: 'trash', size: 16, color: 'var(--red)' }), varios ? 'Eliminar tokens revocados' : 'Eliminar token'),
    onClose: props.onClose, ancho: 520 },
    h('div', { style: { fontSize: 14, lineHeight: 1.5, marginBottom: 12 } }, 'Se elimina para siempre ' + nombres + '. ¿Qué hacemos con lo que envió su Sniper?'),
    h('div', { role: 'radiogroup', 'aria-label': 'Qué hacer con los datos', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      opcion('simple', 'Borrado simple', 'Solo se borra el token. Se conserva todo lo que envió su Sniper: lotes, ventas, el inventario y el keko.', null, false),
      opcion('profunda', 'Limpieza profunda', kekoTexto
        ? 'Se borra el token y todos los datos de ' + kekoTexto + ':'
        : 'Se borra el token y todos los datos de su keko.', detalle, !!vista && !profundaPosible)),
    profunda && profundaPosible ? h('label', { className: 'check limpieza-entiendo' },
      h('input', { type: 'checkbox', checked: entiendo, onChange: function (e) { setEntiendo(e.target.checked); } }),
      h('span', null, 'Entiendo que estos datos se borran para siempre y no se pueden recuperar.')) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 } },
      h('button', { className: 'btn', onClick: props.onClose, autoFocus: true }, 'Cancelar'),
      h('button', { className: 'btn btn-peligro', onClick: eliminar, disabled: enviando || (profunda && (!profundaPosible || !entiendo)) },
        h(Ico, { name: 'trash', size: 13 }),
        profunda ? 'Eliminar y borrar datos' : varios ? 'Eliminar ' + tokens.length + ' tokens' : 'Eliminar token')));
}
