// public/js/vistas/Auditoria.js — bandeja de auditoria: compara el inventario de Habbo
// que envia cada sniper (uno por keko) con lo que la app tiene EN MANO en ese keko, y
// muestra SOLO las diferencias para resolverlas rapido.
//
// La base calcula todo en vivo contra la ultima foto (funcion auditoria_inventario), asi
// que al resolver una diferencia la fila desaparece sin esperar otro escaneo:
//   sobrante       en Habbo hay mas: son de este keko (lotes sin asignar), volvieron de
//                  otro keko, entrada con costo o «Quitar de la auditoria» (no es mercancia)
//   faltante       la app tiene de mas: las vendi, estan en otro keko o borrar
//   ltd            misma cantidad pero otro numero de serie: corregir el numero
//   sin_keko       cuadra en este keko, pero sobran unidades sin keko asignado (del Excel
//                  o de antes de la auditoria): estan en otro keko o ya no existen
//   no_registrado  furnis de Habbo que la app no tiene (decoracion, regalos, un tradeo sin
//                  registrar): lista plegada con agregar o quitar de la auditoria
// Una exclusion vale mientras las cantidades de ese furni no cambien.
//
// Costos del Sniper (v1.3.0, migracion 20261009000000): si el Sniper sabe lo que costo un
// furni (su cartera, FIFO), la foto lo trae y la entrada de un sobrante o de un furni no
// registrado lo propone: cantidad y costo ya puestos, y aviso si el costo es un promedio.
// Desde la v1.4.0 (migracion 20261010000000) cada costo distinto llega como un tramo
// aparte: una linea por tramo, cada una con su propia entrada a su costo exacto.

import { h, useState, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { fmtHace, leerNumero, fmtLg } from '../core/format.js';
import { tramosDelSniper, porRegistrar, mismoCosto, textoCosto } from '../core/costos.js';
import { NombreFurni, SelectorMoneda, Confirmar, EtiquetaLtd } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';

function clave(f) { return f.tipo + ':' + f.sprite_id; }
function unidades(n) { return n + (n === 1 ? ' unidad' : ' unidades'); }
// Singular o plural segun la cantidad: pl(1, 'furni', 'furnis') -> 'furni'.
function pl(n, singular, plural) { return n === 1 ? singular : plural; }

function Chip(props) {
  return h('span', { className: 'tag ' + props.clase, style: { fontSize: 12 } }, props.children);
}

// Formulario en linea dentro de una fila.
function Formulario(props) {
  return h('div', { className: 'aud-form' }, props.children,
    h('div', { style: { display: 'flex', gap: 6, marginLeft: 'auto' } },
      h('button', { className: 'btn btn-chico', onClick: props.onCancelar }, 'Cancelar'),
      h('button', { className: 'btn btn-chico btn-verde', onClick: props.onGuardar, disabled: props.enviando }, props.textoGuardar || 'Guardar')));
}

function Campo(props) {
  return h('label', { className: 'aud-campo' }, h('span', null, props.l), props.children);
}

// Entrada con costo (sobrante de un furni conocido, o furni no registrado). Desde la linea
// de un tramo del Sniper llega con su cantidad y su costo; si no, con lo que sobra sin costo.
function FormEntrada(props) {
  var f = props.fila;
  var nuevos = f.ltds_nuevos || [];
  var tramo = props.tramo;
  var sC = useState(String(nuevos.length ? 1 : props.cantidad)); var cant = sC[0]; var setCant = sC[1];
  var sP = useState(tramo ? textoCosto(tramo.costo) : ''); var precio = sP[0]; var setPrecio = sP[1];
  var sM = useState('creditos'); var moneda = sM[0]; var setMoneda = sM[1];
  var sL = useState(nuevos.length ? String(nuevos[0]) : ''); var ltd = sL[0]; var setLtd = sL[1];
  function guardar() {
    var c = leerNumero(cant); var p = leerNumero(precio);
    if (!c || c < 1 || c > f.diferencia) { props.onError('La cantidad debe estar entre 1 y ' + f.diferencia + '.'); return; }
    if (p === null || isNaN(p) || p < 0) { props.onError('Escribe el costo por unidad (0 si fue un regalo).'); return; }
    // El costo de un tramo vale para sus unidades, no para mas.
    if (tramo && moneda === 'creditos' && mismoCosto(p, tramo.costo) && (ltd ? 1 : c) > tramo.unidades) {
      props.onError('El Sniper conoce ese costo solo para ' + unidades(tramo.unidades) + ': registra ' + pl(tramo.unidades, 'esa', 'esas') +
        ' con ese costo y las demás aparte, con el suyo.');
      return;
    }
    props.onEnviar('/api/auditoria/entrada', {
      furni_id: f.furni_id || null, sprite_id: f.sprite_id, tipo: f.tipo, keko: props.keko,
      cantidad: ltd ? 1 : c, precio: p, moneda: moneda, numero_ltd: ltd || null,
    }, (props.nombre) + ': entrada de ' + unidades(ltd ? 1 : c) + ' en ' + props.keko);
  }
  return h(Formulario, { onCancelar: props.onCerrar, onGuardar: guardar, enviando: props.enviando, textoGuardar: 'Registrar entrada' },
    nuevos.length ? h(Campo, { l: 'Número LTD' },
      h('select', { className: 'inp', value: ltd, onChange: function (e) { setLtd(e.target.value); } },
        nuevos.map(function (n) { return h('option', { key: n, value: String(n) }, '#' + n); }))) :
      h(Campo, { l: 'Cantidad' }, h('input', { className: 'inp inp-num', style: { width: 80 }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); } })),
    h(Campo, { l: 'Costo c/u' }, h('input', { className: 'inp inp-num', style: { width: 110 }, value: precio, autoFocus: true, placeholder: '0', inputMode: 'decimal', onChange: function (e) { setPrecio(e.target.value); } })),
    h(Campo, { l: 'Moneda' }, h(SelectorMoneda, { valor: moneda, onChange: setMoneda })));
}

// Una linea de la lista de costos de un sobrante: un tramo del Sniper (unidades y costo
// exacto) o lo que sobra sin costo conocido, con su propia entrada debajo al abrirla.
function LineaTramo(props) {
  var t = props.tramo;
  return h('div', null,
    h('div', { className: 'aud-tramo' + (t ? '' : ' sin-costo') },
      h('span', { className: 'aud-tramo-txt' }, h('b', null, unidades(props.unidades)),
        t ? [' a ', h('b', { key: 'c', className: 'mono' }, fmtLg(t.costo) + ' cr'), ' c/u'] : ' sin costo conocido'),
      t && t.medio ? h('span', { className: 'tag tag-ambar', title: 'Lotes comprados a precios distintos: el costo es su promedio, tomados en el orden en que se compraron' },
        h(Ico, { name: 'alert', size: 11 }), 'El precio es un promedio calculado (FIFO)') : null,
      h('button', { className: 'btn btn-chico' + (props.abierto ? ' activo' : ''), onClick: props.onAbrir },
        h(Ico, { name: 'plus', size: 12 }), props.texto)),
    props.abierto ? props.formulario : null);
}

// «Las vendi…» de un faltante: venta manual que sale de los lotes de ESTE keko.
function FormVenta(props) {
  var f = props.fila;
  var falta = -f.diferencia;
  var sC = useState(String(falta)); var cant = sC[0]; var setCant = sC[1];
  var sP = useState(''); var precio = sP[0]; var setPrecio = sP[1];
  var sM = useState('creditos'); var moneda = sM[0]; var setMoneda = sM[1];
  var sMer = useState(false); var mercadillo = sMer[0]; var setMercadillo = sMer[1];
  var lotes = f.lotes_ltd_faltantes || [];
  function guardar() {
    var c = leerNumero(cant); var p = leerNumero(precio);
    if (!c || c < 1 || c > falta) { props.onError('La cantidad debe estar entre 1 y ' + falta + '.'); return; }
    if (p === null || isNaN(p) || p < 0) { props.onError('Escribe el precio de venta por unidad.'); return; }
    props.onEnviar('/api/furnis/' + f.furni_id + '/vender-en-mano', {
      cantidad: c, precio: p, moneda: mercadillo ? 'creditos' : moneda, mercadillo: mercadillo, keko: props.keko,
      lote_id: lotes.length === 1 && c === 1 ? lotes[0].lote_id : null,
    }, props.nombre + ': venta de ' + unidades(c) + ' registrada');
  }
  return h(Formulario, { onCancelar: props.onCerrar, onGuardar: guardar, enviando: props.enviando, textoGuardar: 'Registrar venta' },
    h(Campo, { l: 'Cantidad' }, h('input', { className: 'inp inp-num', style: { width: 80 }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); } })),
    h(Campo, { l: mercadillo ? 'Pagó el comprador c/u' : 'Precio c/u' }, h('input', { className: 'inp inp-num', style: { width: 110 }, value: precio, autoFocus: true, inputMode: 'decimal', onChange: function (e) { setPrecio(e.target.value); } })),
    mercadillo ? null : h(Campo, { l: 'Moneda' }, h(SelectorMoneda, { valor: moneda, onChange: setMoneda })),
    h('label', { className: 'check', style: { alignSelf: 'center' } },
      h('input', { type: 'checkbox', checked: mercadillo, onChange: function (e) { setMercadillo(e.target.checked); } }),
      h('span', null, 'En el mercadillo (se guarda el neto)')));
}

// «Estan en otro keko»: mueve unidades de este keko (faltantes) o sin keko asignado a otro.
function FormMover(props) {
  var f = props.fila;
  var maximo = props.maximo;
  var sC = useState(String(maximo)); var cant = sC[0]; var setCant = sC[1];
  var sK = useState(''); var destino = sK[0]; var setDestino = sK[1];
  var lotes = props.desde ? (f.lotes_ltd_faltantes || []) : [];
  function guardar() {
    var c = leerNumero(cant);
    if (!c || c < 1 || c > maximo) { props.onError('La cantidad debe estar entre 1 y ' + maximo + '.'); return; }
    if (!destino.trim() || destino.trim() === props.keko) { props.onError('Escribe el keko donde están (distinto de ' + props.keko + ').'); return; }
    props.onEnviar('/api/auditoria/mover', {
      furni_id: f.furni_id, cantidad: c, desde: props.desde, hacia: destino.trim(),
      lote_ids: lotes.length ? lotes.map(function (l) { return l.lote_id; }) : null,
    }, props.nombre + ': ' + unidades(c) + pl(c, ' pasa a ', ' pasan a ') + destino.trim());
  }
  return h(Formulario, { onCancelar: props.onCerrar, onGuardar: guardar, enviando: props.enviando, textoGuardar: 'Mover' },
    h(Campo, { l: 'Cantidad' }, h('input', { className: 'inp inp-num', style: { width: 80 }, value: cant, inputMode: 'numeric', onChange: function (e) { setCant(e.target.value); } })),
    h(Campo, { l: '¿En qué keko están?' }, h('input', { className: 'inp', style: { width: 180 }, value: destino, autoFocus: true, list: 'kekos-conocidos', placeholder: 'Nombre del keko', onChange: function (e) { setDestino(e.target.value); } })));
}

export function AuditoriaView(props) {
  var sA = useState(null); var aud = sA[0]; var setAud = sA[1];
  var sAb = useState(null); var abierto = sAb[0]; var setAbierto = sAb[1];
  var sNR = useState(false); var verNoReg = sNR[0]; var setVerNoReg = sNR[1];
  var sEx = useState(false); var verExcl = sEx[0]; var setVerExcl = sEx[1];
  var sConf = useState(null); var confirmacion = sConf[0]; var setConfirmacion = sConf[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var sCmp = useState(false); var comparando = sCmp[0]; var setComparando = sCmp[1];

  function cargar(keko) {
    return API.get('/api/auditoria' + (keko ? '?keko=' + encodeURIComponent(keko) : '')).then(function (r) { if (r) setAud(r); return r; });
  }
  // Al entrar, el primer keko (o el de la notificacion en la que hiciste clic).
  useEffect(function () {
    setAbierto(null);
    cargar(props.abrir ? props.abrir.keko : null);
  }, [props.abrir]);
  // Llego una foto nueva del Sniper (auditoria en vivo): se compara de nuevo, en silencio.
  useEffect(function () {
    if (props.senal && aud) cargar(aud.keko);
  }, [props.senal]);

  // «Comparar de nuevo»: vuelve a pedir la comparacion a la base (contra la ultima foto
  // del Sniper) y recarga los datos de la app (nombres, lotes y el numero del menu). El
  // boton gira mientras trabaja (al menos un instante, para que se note) y al terminar
  // un aviso dice como quedo.
  function compararDeNuevo() {
    if (comparando) return;
    setComparando(true);
    setAbierto(null);
    var pausa = new Promise(function (listo) { setTimeout(listo, 450); });
    Promise.all([cargar(aud.keko), props.onRecargar ? props.onRecargar() : null, pausa]).then(function (x) {
      setComparando(false);
      var r = x[0];
      if (!r) return;
      if (!r.keko) { props.onAviso('Todavía no llega ningún inventario del Sniper'); return; }
      var n = (r.filas || []).filter(function (f) { return f.categoria === 'sobrante' || f.categoria === 'faltante' || f.categoria === 'ltd'; }).length;
      props.onAviso('Auditoría de ' + r.keko + ' al día: ' + (n ? n + pl(n, ' furni con diferencias', ' furnis con diferencias') : 'todo cuadra') +
        ' · inventario enviado ' + fmtHace(r.recibido_en));
    });
  }
  function botonComparar() {
    return h('button', { className: 'btn' + (comparando ? ' girando' : ''), onClick: compararDeNuevo, disabled: enviando || comparando, 'aria-busy': comparando ? 'true' : null },
      h(Ico, { name: 'refresh', size: 14 }), comparando ? 'Comparando…' : 'Comparar de nuevo');
  }

  function enviar(url, cuerpo, msg, metodo) {
    _submitGuard(enviando, setEnviando, function () {
      return (metodo === 'put' ? API.put(url, cuerpo) : API.post(url, cuerpo)).then(function (r) {
        if (!r) return;
        setAbierto(null);
        props.onCambio(msg);
        return cargar(aud.keko);
      });
    });
  }

  if (!aud) return h('div', { className: 'contenedor' }, h('div', { className: 'spinner' }));

  if (!aud.keko) {
    return h('div', { className: 'contenedor fade-in' }, h('div', { className: 'card', style: { maxWidth: 640 } },
      h('div', { className: 'card-titulo' }, h(Ico, { name: 'audit', size: 16 }), 'Auditoría de inventario'),
      h('p', { className: 'card-sub', style: { lineHeight: 1.6, marginTop: 8 } },
        'Todavía no llega ningún inventario. Cada sniper envía el inventario de su keko al iniciar sesión en Habbo; aquí verás solo las diferencias con lo que la app tiene en mano: sobrantes, faltantes y furnis sin registrar.'),
      props.demo ? h('div', { className: 'aviso aviso-ambar', style: { marginTop: 10 } }, 'Modo demo: en Ajustes → «Inventario» simulas el envío del inventario de un keko.') : null,
      h('div', { style: { marginTop: 12 } }, botonComparar())));
  }

  var K = aud.keko;
  var filas = aud.filas || [];
  var porFurni = {};
  (props.furnis || []).forEach(function (f) { porFurni[f.id] = f; });
  var conocidos = {};
  (aud.kekos || []).forEach(function (k) { conocidos[k.keko] = true; });
  (props.compras || []).forEach(function (c) { if (c.keko) conocidos[c.keko] = true; });
  filas.forEach(function (f) { (f.otros || []).forEach(function (o) { conocidos[o.keko] = true; }); });

  var sobrantes = filas.filter(function (f) { return f.categoria === 'sobrante'; });
  var faltantes = filas.filter(function (f) { return f.categoria === 'faltante'; });
  var ltds = filas.filter(function (f) { return f.categoria === 'ltd'; });
  var noReg = filas.filter(function (f) { return f.categoria === 'no_registrado'; });
  var sinKeko = filas.filter(function (f) { return f.categoria === 'sin_keko'; });
  var asignables = sobrantes.filter(function (f) { return f.sin_asignar > 0; });
  var r = aud.resumen || {};

  function furniDe(f) {
    var base = f.furni_id && porFurni[f.furni_id];
    if (base) return base;
    if (f.catalogo) return f.catalogo;
    return { nombre: f.nombre || ('Sprite ' + f.sprite_id + ' (' + f.tipo + ')') };
  }
  function nombreDe(f) { return furniDe(f).nombre; }

  function asignarTodo() {
    _submitGuard(enviando, setEnviando, function () {
      var cadena = Promise.resolve(0);
      asignables.forEach(function (f) {
        cadena = cadena.then(function (n) {
          return API.post('/api/auditoria/mover', { furni_id: f.furni_id, cantidad: Math.min(f.diferencia, f.sin_asignar), desde: null, hacia: K })
            .then(function (x) { return x ? n + 1 : n; });
        });
      });
      return cadena.then(function (n) { props.onCambio(n + ' furni(s) con unidades sin keko asignadas a ' + K); return cargar(K); });
    });
  }

  function quitarNoRegistrados() {
    enviar('/api/auditoria/excluir', { keko: K, items: noReg.map(function (f) { return { sprite_id: f.sprite_id, tipo: f.tipo, unidades: f.diferencia, habbo: f.habbo, app: f.app }; }) },
      noReg.length + pl(noReg.length, ' furni quitado', ' furnis quitados') + ' de la auditoría de ' + K);
  }

  function excluir(f, unidadesExcl) {
    enviar('/api/auditoria/excluir', { keko: K, sprite_id: f.sprite_id, tipo: f.tipo, unidades: unidadesExcl, habbo: f.habbo, app: f.app },
      unidadesExcl ? nombreDe(f) + ': ' + unidades(unidadesExcl) + ' fuera de la auditoría' : nombreDe(f) + ' vuelve a la auditoría');
  }

  function formDe(f, accion) {
    var comunes = { key: accion, fila: f, keko: K, nombre: nombreDe(f), enviando: enviando, onError: props.onError, onEnviar: enviar, onCerrar: function () { setAbierto(null); } };
    // 'entrada' (sin costos del Sniper), 'entrada-<n>' (el tramo n) o 'entrada-sin' (lo
    // que sobra sin costo conocido).
    if (accion.indexOf('entrada') === 0) {
      var tramos = tramosDelSniper(f);
      var cual = accion.slice(8);
      var tramo = cual && cual !== 'sin' ? tramos[Number(cual)] || null : null;
      var sinCosto = porRegistrar(f) - tramos.reduce(function (s, t) { return s + t.unidades; }, 0);
      return h(FormEntrada, Object.assign(comunes, { tramo: tramo, cantidad: tramo ? tramo.unidades : cual === 'sin' ? sinCosto : f.diferencia }));
    }
    if (accion === 'venta') return h(FormVenta, comunes);
    if (accion === 'mover') return h(FormMover, Object.assign(comunes, { maximo: -f.diferencia, desde: K }));
    if (accion === 'mover-sin') return h(FormMover, Object.assign(comunes, { maximo: f.sin_asignar, desde: null }));
    return null;
  }

  function Fila(f) {
    var k = clave(f);
    var abiertoAqui = abierto && abierto.clave === k ? abierto.accion : null;
    var abrir = function (accion) { setAbierto(abiertoAqui === accion ? null : { clave: k, accion: accion }); };
    var falta = -f.diferencia;
    var acciones = [];
    var notas = [];
    var lineas = null;
    if (f.exclusion_vencida) notas.push('Antes lo quitaste de la auditoría, pero su cantidad cambió: decide de nuevo.');
    if (f.categoria === 'sobrante' || f.categoria === 'no_registrado') {
      var textoEntrada = f.categoria === 'no_registrado' ? 'Agregar al inventario' : 'Registrar entrada';
      // Con costos del Sniper, una linea por tramo (cada una con su entrada a su costo
      // exacto) y otra para lo que sobra sin costo; sin costos, el boton de siempre.
      var tramos = tramosDelSniper(f);
      if (tramos.length) {
        var sinCosto = porRegistrar(f) - tramos.reduce(function (s, t) { return s + t.unidades; }, 0);
        var linea = function (accion, tramo, n) {
          return h(LineaTramo, { key: accion, tramo: tramo, unidades: n, texto: textoEntrada, abierto: abiertoAqui === accion,
            onAbrir: function () { abrir(accion); }, formulario: abiertoAqui === accion ? formDe(f, accion) : null });
        };
        lineas = h('div', { className: 'aud-tramos' },
          h('div', { className: 'aud-tramos-t' }, h(Ico, { name: 'bolt', size: 12, color: 'var(--green)' }),
            tramos.length > 1 ? 'Costos según el Sniper: un tramo por cada precio de compra' : 'Costo según el Sniper'),
          tramos.map(function (t, i) { return linea('entrada-' + i, t, t.unidades); }),
          sinCosto > 0 ? linea('entrada-sin', null, sinCosto) : null);
      }
      if (f.sin_asignar > 0) {
        var n = Math.min(f.diferencia, f.sin_asignar);
        acciones.push(h('button', { key: 's', className: 'btn btn-chico btn-verde', title: 'Lotes de la app sin keko (Excel, compras manuales o del Sniper antes de la auditoría)', onClick: function () {
          enviar('/api/auditoria/mover', { furni_id: f.furni_id, cantidad: n, desde: null, hacia: K }, nombreDe(f) + ': ' + unidades(n) + pl(n, ' asignada a ', ' asignadas a ') + K);
        } }, 'Son de este keko (' + f.sin_asignar + ' sin asignar)'));
      }
      (f.otros || []).forEach(function (o) {
        var m = Math.min(f.diferencia, o.unidades);
        acciones.push(h('button', { key: 'o' + o.keko, className: 'btn btn-chico', onClick: function () {
          enviar('/api/auditoria/mover', { furni_id: f.furni_id, cantidad: m, desde: o.keko, hacia: K }, nombreDe(f) + ': ' + unidades(m) + pl(m, ' volvió de ', ' volvieron de ') + o.keko);
        } }, 'Volvieron de ' + o.keko + ' (' + o.unidades + ' allá)'));
      });
      if (!lineas) {
        acciones.push(h('button', { key: 'e', className: 'btn btn-chico' + (abiertoAqui === 'entrada' ? ' activo' : ''), onClick: function () { abrir('entrada'); } },
          h(Ico, { name: 'plus', size: 12 }), textoEntrada));
      }
      acciones.push(h('button', { key: 'x', className: 'btn btn-chico', title: 'No es mercancía (decoración, regalos…). Si llega o compras otra unidad, vuelve a aparecer.', onClick: function () { excluir(f, f.diferencia); } }, 'Quitar de la auditoría'));
    } else if (f.categoria === 'faltante') {
      acciones.push(h('button', { key: 'v', className: 'btn btn-chico' + (abiertoAqui === 'venta' ? ' activo' : ''), onClick: function () { abrir('venta'); } }, falta === 1 ? 'La vendí…' : 'Las vendí…'));
      acciones.push(h('button', { key: 'm', className: 'btn btn-chico' + (abiertoAqui === 'mover' ? ' activo' : ''), onClick: function () { abrir('mover'); } }, falta === 1 ? 'Está en otro keko' : 'Están en otro keko'));
      acciones.push(h('button', { key: 'b', className: 'btn btn-chico btn-peligro', onClick: function () {
        var lotes = (f.lotes_ltd_faltantes || []).map(function (l) { return l.lote_id; });
        setConfirmacion({ titulo: 'Borrar unidades', peligro: true, icono: 'trash', textoBoton: 'Borrar',
          mensaje: h('span', null, 'Se eliminan ', h('b', null, unidades(falta)), ' de «' + nombreDe(f) + '» del keko ' + K + ', sin registrar venta ni pérdida.'),
          accion: function () { enviar('/api/auditoria/baja', { furni_id: f.furni_id, cantidad: falta, keko: K, lote_ids: lotes.length ? lotes : null }, nombreDe(f) + ': ' + unidades(falta) + pl(falta, ' borrada', ' borradas')); } });
      } }, 'Borrar'));
    } else if (f.categoria === 'sin_keko') {
      acciones.push(h('button', { key: 'm', className: 'btn btn-chico' + (abiertoAqui === 'mover-sin' ? ' activo' : ''), onClick: function () { abrir('mover-sin'); } }, 'Están en otro keko'));
      acciones.push(h('button', { key: 'b', className: 'btn btn-chico btn-peligro', onClick: function () {
        setConfirmacion({ titulo: 'Borrar unidades', peligro: true, icono: 'trash', textoBoton: 'Borrar',
          mensaje: h('span', null, 'Se eliminan ', h('b', null, unidades(f.sin_asignar)), ' sin keko de «' + nombreDe(f) + '», sin registrar venta ni pérdida.'),
          accion: function () { enviar('/api/auditoria/baja', { furni_id: f.furni_id, cantidad: f.sin_asignar, keko: null }, nombreDe(f) + ': ' + unidades(f.sin_asignar) + ' sin keko ' + pl(f.sin_asignar, 'borrada', 'borradas')); } });
      } }, 'Borrar'));
      notas.push('Si las vendiste, regístralo en Inventario → Venta.');
    } else if (f.categoria === 'ltd') {
      var faltantesL = f.lotes_ltd_faltantes || [];
      if (faltantesL.length === 1 && (f.ltds_nuevos || []).length === 1) {
        var nuevo = f.ltds_nuevos[0];
        acciones.push(h('button', { key: 'c', className: 'btn btn-chico btn-verde', onClick: function () {
          enviar('/api/compras/' + faltantesL[0].lote_id + '/ltd', { numero_ltd: nuevo }, nombreDe(f) + ': el número pasa a #' + nuevo, 'put');
        } }, 'Corregir: es #' + nuevo));
      } else {
        notas.push('Revisa los números en el detalle de cada lote (Inventario → Número LTD).');
      }
    }

    var dif = f.categoria === 'ltd' || f.categoria === 'sin_keko' ? null : f.diferencia;
    return h('div', { key: k, className: 'aud-fila' },
      h('div', { className: 'aud-top' },
        h('div', { style: { flex: 1, minWidth: 200 } }, h(NombreFurni, { furni: furniDe(f),
          ltds: f.categoria === 'faltante' ? (f.ltds_faltantes || []) : (f.ltds_nuevos || []),
          sub: f.furni_id ? null : 'No está en la app · sprite ' + f.sprite_id + (f.tipo === 'pared' ? ' (pared)' : '') })),
        h('span', { className: 'aud-cant' }, 'Habbo ', h('b', null, f.habbo), ' · App ', h('b', null, f.app),
          f.excluidas ? h('span', { className: 'tenue' }, ' · ' + f.excluidas + ' excluidas') : null,
          f.categoria === 'sin_keko' ? h('span', null, ' · Sin keko ', h('b', null, f.sin_asignar)) : null),
        dif !== null ? h('span', { className: 'aud-dif ' + (dif > 0 ? 'mas' : 'menos') }, (dif > 0 ? '+' : '−') + Math.abs(dif)) : null),
      f.categoria === 'ltd' ? h('div', { className: 'aud-nota' }, 'En la app: ',
        (f.ltds_faltantes || []).map(function (n) { return h(EtiquetaLtd, { key: 'a' + n, numero: n }); }),
        ' · En Habbo: ', (f.ltds_nuevos || []).map(function (n) { return h(EtiquetaLtd, { key: 'h' + n, numero: n }); })) : null,
      notas.map(function (t, i) { return h('div', { key: i, className: 'aud-nota' }, t); }),
      lineas,
      acciones.length ? h('div', { className: 'aud-acc' }, acciones) : null,
      // La entrada de un tramo se abre bajo su linea; lo demas, al pie de la fila.
      abiertoAqui && !(lineas && abiertoAqui.indexOf('entrada') === 0) ? formDe(f, abiertoAqui) : null);
  }

  function Seccion(titulo, icono, color, lista, extra) {
    if (!lista.length) return null;
    return h('div', { key: titulo, style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('div', { className: 'aud-sec', style: { color: color } }, h(Ico, { name: icono, size: 15 }), titulo, h('span', { className: 'tenue', style: { fontWeight: 400 } }, '(' + lista.length + ')')),
      extra || null,
      lista.map(Fila));
  }

  var hayDiferencias = sobrantes.length + faltantes.length + ltds.length > 0;

  return h('div', { className: 'contenedor fade-in', style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    confirmacion ? h(Confirmar, Object.assign({}, confirmacion, {
      enviando: enviando,
      onClose: function () { setConfirmacion(null); },
      onConfirmar: function () { var a = confirmacion.accion; setConfirmacion(null); a(); } })) : null,
    h('datalist', { id: 'kekos-conocidos' }, Object.keys(conocidos).filter(function (k) { return k !== K; }).map(function (k) { return h('option', { key: k, value: k }); })),

    h('div', { className: 'card' },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' } },
        h('div', { style: { flex: 1, minWidth: 240 } },
          h('div', { className: 'card-titulo' }, h(Ico, { name: 'audit', size: 16 }), 'Auditoría de inventario'),
          h('div', { className: 'card-sub' }, 'Inventario de Habbo del keko ', h('b', null, K), ' · enviado por el Sniper ' + fmtHace(aud.recibido_en))),
        botonComparar()),
      (aud.kekos || []).length > 1 ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 } },
        aud.kekos.map(function (k) {
          return h('button', { key: k.keko, className: 'chip' + (k.keko === K ? ' activo' : ''), onClick: function () { setAbierto(null); cargar(k.keko); } }, k.keko);
        })) : null,
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 } },
        h(Chip, { clase: 'tag-verde' }, (r.coinciden || 0) + pl(r.coinciden || 0, ' coincide', ' coinciden')),
        sobrantes.length ? h(Chip, { clase: 'tag-azul' }, sobrantes.length + ' con sobrantes') : null,
        faltantes.length ? h(Chip, { clase: 'tag-rojo' }, faltantes.length + ' con faltantes') : null,
        ltds.length ? h(Chip, { clase: 'tag-ambar' }, ltds.length + ' LTD con otro número') : null,
        sinKeko.length ? h(Chip, { clase: 'tag-ambar' }, sinKeko.length + ' con unidades sin keko') : null,
        noReg.length ? h(Chip, { clase: 'tag-gris' }, noReg.length + ' sin registrar') : null,
        (aud.excluidos || []).length ? h(Chip, { clase: 'tag-gris' }, aud.excluidos.length + pl(aud.excluidos.length, ' excluido', ' excluidos')) : null)),

    hayDiferencias ? null : h('div', { className: 'aviso', style: { background: 'var(--green-bg)', color: 'var(--green)', fontSize: 13 } },
      'Todo cuadra: lo que la app tiene en mano en ' + K + ' coincide con Habbo.'),

    Seccion('Sobrantes: en Habbo hay más que en la app', 'mas', 'var(--blue)', sobrantes,
      asignables.length > 1 ? h('div', { className: 'aviso', style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 } },
        h('span', { style: { flex: 1, minWidth: 220 } }, asignables.length + ' furnis tienen unidades sin keko asignado (del Excel, compras manuales o del Sniper antes de la auditoría) que explican su sobrante.'),
        h('button', { className: 'btn btn-chico btn-verde', onClick: asignarTodo, disabled: enviando }, 'Asignarlas a ' + K)) : null),
    Seccion('Faltantes: la app tiene unidades que no están en Habbo', 'menos', 'var(--red)', faltantes),
    Seccion('LTD con otro número de serie', 'tag', 'var(--gold)', ltds),
    Seccion('Sin keko asignado: la app las tiene, pero en este keko no hacen falta', 'alert', 'var(--yellow)', sinKeko),

    noReg.length ? h('div', { className: 'card' },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
        h('button', { className: 'plegable', onClick: function () { setVerNoReg(!verNoReg); } },
          h(Ico, { name: verNoReg ? 'chevdown' : 'chevright', size: 14 }),
          noReg.length + pl(noReg.length, ' furni de tu Habbo no está', ' furnis de tu Habbo no están') + ' en la app (decoración, regalos o un tradeo sin registrar)'),
        h('button', { className: 'btn btn-chico', style: { marginLeft: 'auto' }, onClick: quitarNoRegistrados, disabled: enviando }, 'Quitar todos de la auditoría')),
      verNoReg ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 } }, noReg.map(Fila)) : null) : null,

    (aud.excluidos || []).length ? h('div', { className: 'card' },
      h('button', { className: 'plegable', onClick: function () { setVerExcl(!verExcl); } },
        h(Ico, { name: verExcl ? 'chevdown' : 'chevright', size: 14 }),
        aud.excluidos.length + pl(aud.excluidos.length, ' furni quitado de la auditoría (vuelve', ' furnis quitados de la auditoría (vuelven') + ' a aparecer si cambia su cantidad)'),
      verExcl ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 } }, aud.excluidos.map(function (x) {
        return h('div', { key: clave(x), className: 'aud-top', style: { padding: '4px 0' } },
          h('div', { style: { flex: 1, minWidth: 200 } }, h(NombreFurni, { furni: furniDe(x) })),
          h('span', { className: 'aud-cant' }, unidades(x.unidades) + ' excluidas'),
          h('button', { className: 'btn btn-chico', onClick: function () { excluir(x, 0); }, disabled: enviando }, 'Incluir de nuevo'));
      })) : null) : null);
}
