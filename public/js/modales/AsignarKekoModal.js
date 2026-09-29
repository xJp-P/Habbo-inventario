// public/js/modales/AsignarKekoModal.js — ordenar lo que esta en mano SIN keko (compras
// manuales anteriores a v1.2.0, el Excel y lo que compro un Sniper antes de su primer
// inventario). Esas unidades salen como «Sin keko asignado» en las auditorias de los
// snipers.
//
// Una fila por furni con su casilla y cuantas unidades pasar; abajo, el keko de destino.
// Se asigna por tandas: lo marcado va a ese keko, la lista se actualiza y queda abierta
// para mandar el resto a otro. Todo lo de una tanda entra en una sola transaccion
// (asignar_sin_keko, de lo mas antiguo a lo mas nuevo dentro de cada furni).

import { h, useState, useMemo } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard, normalizar } from '../core/ui.js';
import { leerNumero } from '../core/format.js';
import { Modal, Fld, IconoFurni } from '../componentes/base.js';
import { SelectorKeko, NUEVO_KEKO } from '../componentes/SelectorKeko.js';
import { Ico } from '../componentes/iconos.js';

function pl(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

export function AsignarKekoModal(props) {
  var sH = useState(props.hacia || ''); var hacia = sH[0]; var setHacia = sH[1];
  var sN = useState(''); var nuevo = sN[0]; var setNuevo = sN[1];
  var sM = useState({}); var marcados = sM[0]; var setMarcados = sM[1];   // furni_id -> cantidad (texto)
  var sB = useState(''); var busqueda = sB[0]; var setBusqueda = sB[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  // Furnis con unidades en mano sin keko.
  var grupos = useMemo(function () {
    var porFurni = {};
    (props.compras || []).forEach(function (c) {
      if (c.estado !== 'comprado' || c.keko) return;
      var g = porFurni[c.furni_id] || (porFurni[c.furni_id] = { furni_id: c.furni_id, unidades: 0, porRevisar: 0 });
      g.unidades += c.cantidad;
      if (c.pendiente) g.porRevisar += c.cantidad;
    });
    return Object.keys(porFurni).map(function (id) {
      var g = porFurni[id];
      g.furni = (props.furnis || []).find(function (f) { return f.id === g.furni_id; }) || { id: g.furni_id, nombre: 'Furni ' + g.furni_id };
      return g;
    }).sort(function (a, b) { return a.furni.nombre.localeCompare(b.furni.nombre); });
  }, [props.compras, props.furnis]);

  var visibles = grupos.filter(function (g) { return !busqueda || normalizar(g.furni.nombre).indexOf(normalizar(busqueda)) !== -1; });
  var totalSinKeko = grupos.reduce(function (s, g) { return s + g.unidades; }, 0);
  var elegidos = grupos.filter(function (g) { return marcados[g.furni_id] !== undefined; });
  var unidadesElegidas = elegidos.reduce(function (s, g) { var q = leerNumero(marcados[g.furni_id]); return s + (q > 0 ? q : 0); }, 0);
  var destino = hacia === NUEVO_KEKO ? nuevo.trim() : hacia;

  function alternar(g) {
    var m = Object.assign({}, marcados);
    if (m[g.furni_id] !== undefined) delete m[g.furni_id]; else m[g.furni_id] = String(g.unidades);
    setMarcados(m); setError('');
  }
  function marcarVisibles(si) {
    var m = Object.assign({}, marcados);
    visibles.forEach(function (g) { if (si) m[g.furni_id] = m[g.furni_id] !== undefined ? m[g.furni_id] : String(g.unidades); else delete m[g.furni_id]; });
    setMarcados(m); setError('');
  }
  function cambiarCantidad(g, v) {
    var m = Object.assign({}, marcados); m[g.furni_id] = v; setMarcados(m); setError('');
  }

  function asignar() {
    if (!elegidos.length) { setError('Marca al menos un furni.'); return; }
    if (!destino) { setError(hacia === NUEVO_KEKO ? 'Escribe el nombre del keko nuevo.' : 'Elige el keko de destino.'); return; }
    var items = [];
    for (var i = 0; i < elegidos.length; i++) {
      var g = elegidos[i];
      var q = leerNumero(marcados[g.furni_id]);
      if (!q || isNaN(q) || q < 1 || q > g.unidades || Math.floor(q) !== q) {
        setError(g.furni.nombre + ': la cantidad debe estar entre 1 y ' + g.unidades + '.'); return;
      }
      items.push({ furni_id: g.furni_id, cantidad: q });
    }
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/kekos/asignar', { hacia: destino, items: items }).then(function (r) {
        if (!r) return;
        setMarcados({});
        if (hacia === NUEVO_KEKO) { setHacia(r.hacia); setNuevo(''); }
        props.onAsignado(pl(r.unidades, 'unidad asignada', 'unidades asignadas') + ' a ' + r.hacia + ' (' + pl(r.furnis, 'furni', 'furnis') + ')');
      });
    });
  }

  return h(Modal, { titulo: h('span', null, h(Ico, { name: 'user', size: 16 }), ' Asignar unidades sin keko'), ancho: 620, onClose: props.onClose },
    grupos.length === 0
      ? h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center' } }, h(Ico, { name: 'check', size: 14 }), 'No quedan unidades sin keko: tus auditorías ya no las muestran.')
      : [
          h('div', { key: 'intro', className: 'card-sub', style: { lineHeight: 1.5, marginTop: -4 } },
            pl(totalSinKeko, 'unidad', 'unidades') + ' en mano sin keko, en ' + pl(grupos.length, 'furni', 'furnis') +
            '. Marca las que están en un mismo keko y asígnalas; luego repite con el resto.'),
          h('div', { key: 'barra', style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', { className: 'inp', style: { flex: 1 }, placeholder: 'Buscar furni…', value: busqueda, onChange: function (e) { setBusqueda(e.target.value); } }),
            h('button', { className: 'btn btn-chico', onClick: function () { marcarVisibles(true); } }, 'Marcar todos'),
            h('button', { className: 'btn btn-chico', onClick: function () { marcarVisibles(false); } }, 'Ninguno')),
          h('div', { key: 'lista', className: 'lista-furnis', style: { maxHeight: 320 } }, visibles.map(function (g) {
            var marcado = marcados[g.furni_id] !== undefined;
            return h('div', { key: g.furni_id, className: 'lista-furni', style: { cursor: 'default', borderColor: marcado ? 'var(--green-bd)' : undefined } },
              h('input', { type: 'checkbox', checked: marcado, onChange: function () { alternar(g); }, 'aria-label': 'Asignar ' + g.furni.nombre }),
              h(IconoFurni, { classname: g.furni.classname, revision: g.furni.revision, size: 28 }),
              h('span', { style: { flex: 1, minWidth: 0, cursor: 'pointer' }, onClick: function () { alternar(g); } }, g.furni.nombre,
                g.porRevisar ? h('span', { className: 'tenue', style: { fontSize: 11 } }, ' · ' + g.porRevisar + ' por revisar') : null),
              marcado
                ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                    h('input', { className: 'inp inp-num', style: { width: 64, textAlign: 'center' }, value: marcados[g.furni_id], inputMode: 'numeric',
                      onChange: function (e) { cambiarCantidad(g, e.target.value); } }),
                    h('span', { className: 'mono suave', style: { fontSize: 12 } }, 'de ' + g.unidades))
                : h('span', { className: 'mono suave', style: { fontSize: 12 } }, g.unidades + ' und'));
          })),
          h(Fld, { key: 'hacia', label: 'Asignar lo marcado a' },
            h(SelectorKeko, { kekos: props.kekos, valor: hacia, conNuevo: true, nuevo: nuevo, error: !!error && !destino,
              onChange: function (v) { setHacia(v); setError(''); }, onNuevo: function (t) { setNuevo(t); setError(''); } })),
        ],
    error ? h('div', { className: 'aviso aviso-rojo' }, error) : null,
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
      h('button', { className: 'btn', onClick: props.onClose }, grupos.length ? 'Cerrar' : 'Listo'),
      grupos.length ? h('button', { className: 'btn btn-verde', onClick: asignar, disabled: enviando },
        h(Ico, { name: 'check', size: 14, sw: 2.4 }), unidadesElegidas ? 'Asignar ' + pl(unidadesElegidas, 'unidad', 'unidades') : 'Asignar') : null));
}
