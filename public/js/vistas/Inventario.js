// public/js/vistas/Inventario.js — tus lotes comprados (tabla `compras`; la hoja
// "Mercadillo" del Excel).
//
// Ciclo de un lote: Comprado -> Publicado (en el mercadillo de Habbo; lleva candado y su
// precio de lista) -> Vendido, o de vuelta a Comprado si se retira. Lo publica el Sniper
// (y lo recupera el Sniper) o lo publicas tu con el boton "Publicar" (todas las unidades
// en mano del furni) y lo retiras tu con "Retirar" en su fila. Lo publicado no se edita
// ni se borra: se registra su venta con "Vendido" cuando se vende.
//
// Pestanas: Comprado (en mano), Publicado y Vendido. Un lote vive en una sola: lo
// publicado no aparece en Comprado.
//
// Lo que esta en mano (Comprado) no tiene precio ni ganancia: solo cuantos y lo que
// costaron. El precio aparece al publicar (precio de lista) o al vender (precio real),
// asi que "Venta c/u", "Ganancia" y "Margen" solo existen en Publicado y Vendido.
//
// Arriba, destacadas en ambar, las compras que llegaron de los SniperMercadillo "por
// revisar", agrupadas por furni (con mas de un furni, en un acordeon: cerrado muestra el
// resumen y se despliega con una transicion suave; se recuerda si lo dejaste abierto).
// "Confirmar" las pasa a en mano.
//
// Debajo, los lotes en un bloque por keko (v1.6.0, componentes/BloquesKeko.js): primero
// los kekos manuales, luego los de los Snipers (cada grupo del mas antiguo al mas nuevo) y
// al final lo que no tiene keko. Ningun bloque se pliega ni se recorta. Cada bloque dice
// cuanto hay en ese keko en la pestana, y «Publicar» de una fila solo toma unidades de su
// keko (migracion 20261014000000). Clic en un lote: su detalle.
//
// Ventas del Sniper (v1.7.0, migracion 20261015000000; diseño elegido en la maqueta):
//   - en Vendido, lo que registro el Sniper lleva «Vendido · Sniper» y, bajo el nombre, la
//     hora exacta de la venta (tambien en el detalle, con el Sniper que la registro);
//   - la pestaña «Por asignar» (azul, solo con la migracion) lista las ventas que el Sniper
//     envio y la base no pudo casar con un lote, con el motivo: «Asignar a un lote…» o
//     «Descartar». Son excepcionales: por eso viven en su pestaña y no arriba.

import { h, useState, useMemo, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtCr, fmtLg, fmtPct, fmtD, fmtHace } from '../core/format.js';
import { normalizar, _submitGuard } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { NombreFurni, IconoFurni, EtiquetaPublicado, EtiquetaLtd, Confirmar, AYUDA_PUBLICADO, AYUDA_PUBLICADO_MANUAL } from '../componentes/base.js';
import { BloqueKeko, IndiceKekos, KekosVacios, Columnas, anchoMinimo, useAlineado, nombreBloque, AvatarKeko } from '../componentes/BloquesKeko.js';
import { Barrera, Dibujar } from '../componentes/Barrera.js';
import { agruparPorKeko, claveKeko } from '../core/kekos.js';
import { ingresoNeto, calcularComision } from '../core/comision.js';
import { ventaDelSniper, cuandoVenta, horaDe, diaDe, nombreVentaPendiente } from '../core/ventas.js';

// Un furni que llego del Sniper sin revisar: cuantas, a cuanto, cuando y desde que VPS.
// "Confirmar" lo pasa a en mano (sin precio: el precio se pone al publicar o al vender).
function FilaHuerfana(props) {
  var g = props.grupo;
  var f = g.furni;
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var costoU = g.unidades ? g.costo_cr / g.unidades : 0;

  function confirmar() {
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/pendientes/activar', { furni_id: f.id })
        .then(function (r) { if (r) props.onActivado(f.nombre + ': ' + g.unidades + ' und pasaron a tu stock en mano'); });
    });
  }

  return h('div', { className: 'huerfana-fila' },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h(NombreFurni, { furni: f, ltds: g.lotes.filter(function (l) { return l.numero_ltd; }).map(function (l) { return l.numero_ltd; }), sub: h('span', null,
        g.unidades + ' und · pagaste ' + fmtLg(costoU) + ' c/u · ' + fmtCr(g.costo_cr) + ' cr en total · ' + fmtHace(g.recibido_en) + (g.instancias.length ? ' · ' + g.instancias.join(', ') : ''),
        f.nuevo ? h('span', { className: 'tag tag-azul', style: { marginLeft: 8 } }, 'Furni nuevo') : null) })),
    h('button', { className: 'btn btn-verde', onClick: confirmar, disabled: enviando, title: 'Pasa estas unidades a Comprado (en mano)' },
      h(Ico, { name: 'check', size: 14, sw: 2.4 }), 'Confirmar'));
}

var FILTROS = [['comprado', 'Comprado'], ['publicado', 'Publicado'], ['vendido', 'Vendido']];

// Si el acordeon de "Llegaron del Sniper" quedo abierto (preferencia de este equipo).
var CLAVE_ACORDEON = 'hbi.sniper-abierto';
function leerAcordeon() { try { return window.localStorage.getItem(CLAVE_ACORDEON) === '1'; } catch (_) { return false; } }
function guardarAcordeon(v) { try { window.localStorage.setItem(CLAVE_ACORDEON, v ? '1' : '0'); } catch (_) { /* sin almacenamiento */ } }

// Panel de las compras del Sniper por revisar. Con un solo furni se ve directo; con mas,
// es un acordeon para no llenar la pantalla.
function LlegaronDelSniper(props) {
  var grupos = props.pendientes;
  var sA = useState(leerAcordeon); var abierto = sA[0]; var setAbierto = sA[1];
  var acordeon = grupos.length > 1;
  var unidades = grupos.reduce(function (s, g) { return s + g.unidades; }, 0);
  var costo = grupos.reduce(function (s, g) { return s + g.costo_cr; }, 0);
  var filas = grupos.map(function (g) { return h(FilaHuerfana, { key: g.furni.id, grupo: g, tasa: props.tasa, onActivado: props.onActivado }); });
  function alternar() { setAbierto(!abierto); guardarAcordeon(!abierto); }

  var titulo = h('div', { style: { flex: 1, minWidth: 0 } },
    h('div', { style: { fontWeight: 700, color: 'var(--yellow)' } }, 'Llegaron del Sniper · ' + grupos.length + (grupos.length === 1 ? ' furni' : ' furnis') + ' por revisar'),
    h('div', { className: 'card-sub' }, (acordeon ? unidades + ' und · ' + fmtCr(costo) + ' cr invertidos. ' : '')
      + 'Confírmalas para pasarlas a tu stock en mano; si el Sniper las publica, pasan solas a Publicado.'));

  if (!acordeon) {
    return h('div', { className: 'huerfanas' },
      h('div', { className: 'huerfanas-cab' }, h(Ico, { name: 'radar', size: 20, color: 'var(--yellow)' }), titulo),
      filas);
  }
  return h('div', { className: 'huerfanas' },
    h('button', { className: 'huerfanas-cab huerfanas-boton', 'aria-expanded': abierto, onClick: alternar },
      h(Ico, { name: 'radar', size: 20, color: 'var(--yellow)' }),
      titulo,
      h('span', { className: 'huerfanas-iconos' + (abierto ? ' oculto' : '') },
        grupos.slice(0, 5).map(function (g) { return h(IconoFurni, { key: g.furni.id, classname: g.furni.classname, revision: g.furni.revision, size: 26 }); }),
        grupos.length > 5 ? h('span', { className: 'mono suave', style: { fontSize: 12 } }, '+' + (grupos.length - 5)) : null),
      h('span', { className: 'huerfanas-accion' }, abierto ? 'Ocultar' : 'Revisar',
        h('span', { className: 'chevron' + (abierto ? ' abierto' : '') }, h(Ico, { name: 'chevdown', size: 16 })))),
    h('div', { className: 'acordeon' + (abierto ? ' abierto' : ''), 'aria-hidden': !abierto, inert: abierto ? undefined : '' },
      h('div', { className: 'acordeon-in' }, filas)));
}
// Columna "Venta c/u" (solo Publicado y Vendido): el precio de lista o lo que entro.
function PrecioVenta(props) {
  var l = props.lote;
  if (l.estado === 'publicado') {
    return h('span', { className: 'morado', style: { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' } },
      h(Ico, { name: 'lock', size: 11, sw: 2.2 }), fmtLg(l.precio_lista) + (l.moneda_lista === 'lingos' ? ' lg' : ''));
  }
  return h('span', { title: l.comision_venta !== null && l.comision_venta !== undefined ? 'Neto que entró (ya sin la comisión del mercadillo)' : 'Lo que recibiste' },
    fmtLg(l.precio_venta_real) + (l.moneda_venta_real === 'lingos' ? ' lg' : ''));
}
var ORIGEN = { excel: 'Excel', manual: 'Manual', sniper: 'Sniper' };

// Anchos de las columnas de cada pestana (null = Furni). Con sitio para todos, fijos: los
// bloques quedan alineados entre si.
var ANCHOS = {
  comprado: [62, null, 56, 96, 100, 124, 176],
  publicado: [62, null, 56, 96, 100, 96, 100, 68, 116, 188],
  vendido: [62, null, 56, 96, 100, 96, 100, 68, 132, 64],
};
var VACIOS = { comprado: 'Sin nada en mano: ', publicado: 'Sin nada publicado: ', vendido: 'Sin ventas: ' };

function sumar(lotes, campo) { return lotes.reduce(function (s, l) { return s + (l[campo] || 0); }, 0); }

// El keko de una venta (su cabeza y su nombre), como en las cabeceras de los bloques.
function ChipKeko(props) {
  var lista = props.kekos || [];
  var k = lista.find(function (x) { return claveKeko(x.nombre) === claveKeko(props.nombre); }) || { nombre: props.nombre, origen: 'sniper' };
  return h('span', { className: 'chip-keko' }, h(AvatarKeko, { keko: k, tam: 18 }), h('b', null, k.nombre));
}

// Pestaña «Por asignar»: una fila por venta, con cuando, de que keko, el furni, el precio
// (y lo que entraria neto), por que no se asigno sola y sus dos acciones.
function TablaPorAsignar(props) {
  var ventas = props.ventas;
  if (!ventas.length) {
    return h('div', { className: 'tabla-caja' }, h('div', { className: 'vacio' },
      props.q ? 'Ninguna venta por asignar coincide.' : 'No hay ventas por asignar: todo lo que vendió el Sniper ya está en Vendido.'));
  }
  return h('div', { className: 'tabla-caja' },
    h('table', { className: 'tabla' },
      h('thead', null, h('tr', null, h('th', null, 'Cuándo'), h('th', null, 'Keko'), h('th', null, 'Furni'), h('th', { className: 'r' }, 'Precio'),
        h('th', null, 'Por qué no se asignó'), h('th', null))),
      h('tbody', null, ventas.map(function (v) {
        return h(Barrera, { key: v.id, tipo: 'fila', columnas: 6, etiqueta: 'La venta por asignar Nº ' + v.id,
            donde: 'Inventario › por asignar Nº ' + v.id, onVerErrores: props.onVerErrores },
          h(Dibujar, { dibujar: function () {
            var f = nombreVentaPendiente(v, props.furnis);
            var neto = Number(v.precio) - calcularComision(Number(v.precio));
            return h('tr', { className: 'fila' },
              h('td', { className: 'mono', style: { whiteSpace: 'nowrap', fontSize: 12 } }, cuandoVenta(v.vendido_en)),
              h('td', null, h(ChipKeko, { nombre: v.keko, kekos: props.kekos })),
              h('td', null, h(NombreFurni, { furni: { nombre: f.nombre, classname: f.classname, revision: f.revision, numero_ltd: v.numero_ltd },
                sub: f.registrado ? null : 'furni sin registrar en la app' })),
              h('td', { className: 'r mono' }, fmtCr(v.precio), h('div', { className: 'tenue', style: { fontSize: 11 } }, fmtCr(neto) + ' netos')),
              h('td', { className: 'motivo-venta' }, v.motivo),
              h('td', { className: 'r', style: { whiteSpace: 'nowrap' } },
                h('span', { style: { display: 'inline-flex', gap: 6 } },
                  h('button', { className: 'btn btn-chico btn-verde', onClick: function () { props.onAsignar(v); } }, h(Ico, { name: 'check', size: 12, sw: 2.4 }), 'Asignar a un lote…'),
                  h('button', { className: 'btn btn-chico', onClick: function () { props.onDescartar(v); } }, 'Descartar'))));
          } }));
      }))));
}

// Lo que dice la cabecera de un bloque en cada pestana.
function datosBloque(lotes, filtro) {
  var und = sumar(lotes, 'cantidad');
  var n = lotes.length;
  var datos = [[fmtCr(n), filtro === 'vendido' ? (n === 1 ? 'venta' : 'ventas') : (n === 1 ? 'lote' : 'lotes')], [fmtCr(und), 'und']];
  if (filtro === 'comprado') return datos.concat([[fmtCr(sumar(lotes, 'costo_total_cr')) + ' cr', 'costo']]);
  var g = sumar(lotes, 'ganancia_cr');
  return datos.concat([[(g > 0 ? '+' : '') + fmtCr(g) + ' cr', filtro === 'publicado' ? 'ganancia esperada' : 'ganancia', g > 0 ? 'pos' : g < 0 ? 'neg' : '']]);
}

export function InventarioView(props) {
  var compras = props.compras;
  var pendientes = props.pendientes;
  var sQ = useState(props.filtroFurni || ''); var q = sQ[0]; var setQ = sQ[1];
  var sF = useState('comprado'); var filtro = sF[0]; var setFiltro = sF[1];
  var sA = useState(null); var abierto = sA[0]; var setAbierto = sA[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var sConf = useState(null); var confirmacion = sConf[0]; var setConfirmacion = sConf[1];
  var usaKekos = !!(props.kekos && props.kekos.disponible);
  var listaKekos = usaKekos ? props.kekos.kekos : [];
  // Ventas por asignar: null sin la migracion 20261015000000 (no hay pestaña).
  var porAsignar = props.porAsignar && props.porAsignar.disponible ? props.porAsignar.ventas || [] : null;
  var enBandeja = filtro === 'por_asignar' && !!porAsignar;
  var alineado = useAlineado(anchoMinimo(ANCHOS[enBandeja ? 'vendido' : filtro] || ANCHOS.vendido));
  useEffect(function () { if (props.filtroFurni) { setQ(props.filtroFurni); setFiltro(props.filtroEstado || 'comprado'); } }, [props.filtroFurni, props.filtroEstado]);
  // Clic en el aviso de ventas del Sniper: Vendido (en el bloque de ese keko) o la bandeja.
  useEffect(function () {
    var a = props.abrir;
    if (!a) return undefined;
    setQ('');
    setAbierto(null);
    setFiltro(a.filtro === 'por_asignar' ? 'por_asignar' : 'vendido');
    if (a.filtro === 'por_asignar' || !a.keko) return undefined;
    var t = setTimeout(function () {
      var el = document.getElementById('bk-' + claveKeko(a.keko));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return function () { clearTimeout(t); };
  }, [props.abrir && props.abrir.vez]);
  // Sin la migracion (o si se fue la ultima venta y la pestaña se oculta), a Vendido.
  useEffect(function () { if (filtro === 'por_asignar' && !porAsignar) setFiltro('vendido'); }, [filtro, !!porAsignar]);

  var cuenta = useMemo(function () {
    var c = { comprado: 0, publicado: 0, vendido: 0 };
    compras.forEach(function (l) { c[l.estado]++; });
    return c;
  }, [compras]);

  // Solo lo publicado y lo vendido tienen precio (y con el, ganancia y margen).
  var conPrecio = filtro !== 'comprado';
  var visibles = enBandeja ? [] : compras.filter(function (l) {
    return l.estado === filtro && (!q || normalizar(l.nombre).indexOf(normalizar(q)) !== -1);
  }).sort(function (a, b) { return (b.pendiente ? 1 : 0) - (a.pendiente ? 1 : 0) || b.id - a.id; });
  var ventasVisibles = enBandeja ? porAsignar.filter(function (v) {
    return !q || normalizar(nombreVentaPendiente(v, props.furnis).nombre).indexOf(normalizar(q)) !== -1;
  }) : [];
  var agrupado = agruparPorKeko(visibles, listaKekos, function (l) { return l.keko; });
  // El Sniper de un keko (para «Registrada por»).
  function sniperDe(keko) {
    var k = listaKekos.find(function (x) { return claveKeko(x.nombre) === claveKeko(keko); });
    return k && k.snipers && k.snipers.length ? k.snipers.join(', ') : null;
  }

  // Ejecuta la accion confirmada y cierra el dialogo al terminar.
  function ejecutar(accion) {
    _submitGuard(enviando, setEnviando, function () {
      return accion().then(function () { setConfirmacion(null); });
    });
  }
  function revertir(l) {
    setConfirmacion({ titulo: 'Deshacer la venta', icono: 'undo', textoBoton: 'Deshacer venta',
      mensaje: h('span', null, '¿Deshacer la venta del lote Nº ', h('b', null, l.id), ' (', l.cantidad, ' × ', l.nombre, ')? Las unidades vuelven a su estado anterior.'),
      accion: function () {
        return API.post('/api/compras/' + l.id + '/revertir', {}).then(function (r) { if (r) props.onCambio(r.fusionada ? 'Venta deshecha: las unidades volvieron a su lote' : 'Venta deshecha'); });
      } });
  }
  function retirar(l) {
    setConfirmacion({ titulo: 'Retirar del mercadillo', icono: 'undo', textoBoton: 'Retirar',
      mensaje: h('span', null, '¿Retirar del mercadillo ', h('b', null, l.cantidad + ' × ' + l.nombre), ' (lote Nº ', l.id, ')? Vuelve a Comprado, en mano.'),
      accion: function () {
        return API.post('/api/compras/' + l.id + '/retirar', {}).then(function (r) {
          if (r) { setAbierto(null); props.onCambio(r.fusionada ? 'Retirado: las unidades volvieron a su lote en Comprado' : 'Retirado: el lote volvió a Comprado'); }
        });
      } });
  }
  function eliminar(l) {
    setConfirmacion({ titulo: 'Eliminar lote', peligro: true, icono: 'trash', textoBoton: 'Eliminar lote',
      mensaje: h('span', null, '¿Eliminar el lote Nº ', h('b', null, l.id), ' (', l.cantidad, ' × ', l.nombre, ')? No se puede deshacer.'),
      accion: function () {
        return API.del('/api/compras/' + l.id).then(function (r) { if (r) { setAbierto(null); props.onCambio('Lote eliminado'); } });
      } });
  }

  // Las filas de un lote (y su detalle, si esta abierto). Se dibujan DENTRO de su
  // barrera: si un lote trae un dato raro, solo su fila lo dice.
  function filasLote(l) {
    var abiertoEste = abierto === l.id;
    var publicado = l.estado === 'publicado';
    var manual = publicado && l.publicado_por === 'manual';
    var clase = 'fila' + (abiertoEste ? ' abierta' : '') + (l.pendiente ? ' huerfana' : '') + (l.estado === 'vendido' ? ' vendida' : '') + (publicado ? ' publicada' : '');
    var g = l.ganancia_cr;
    var delSniper = ventaDelSniper(l);
    var filas = [h('tr', { key: l.id, className: clase, onClick: function () { setAbierto(abiertoEste ? null : l.id); } },
      h('td', { className: 'mono', style: { color: l.pendiente ? 'var(--yellow)' : 'var(--text3)' } }, l.id),
      h('td', null, h(NombreFurni, { furni: l, sub: l.estado === 'vendido' && l.vendido_en ? 'vendida ' + cuandoVenta(l.vendido_en) : null })),
      h('td', { className: 'r mono' }, l.cantidad),
      h('td', { className: 'r mono' }, l.moneda_compra === 'lingos' ? fmtLg(l.precio_compra) + ' lg' : fmtLg(l.precio_compra)),
      h('td', { className: 'r mono' }, fmtCr(l.costo_total_cr)),
      conPrecio ? h('td', { className: 'r mono' }, h(PrecioVenta, { lote: l })) : null,
      conPrecio ? h('td', { className: 'r mono ' + (g > 0 ? 'pos' : g < 0 ? 'neg' : '') }, g === null ? '-' : (g > 0 ? '+' : '') + fmtCr(g)) : null,
      conPrecio ? h('td', { className: 'r mono ' + (g > 0 ? 'pos' : g < 0 ? 'neg' : '') }, l.margen === null ? '-' : fmtPct(l.margen)) : null,
      h('td', null, l.pendiente ? h('span', { className: 'tag tag-ambar' }, h(Ico, { name: 'radar', size: 11 }), 'Por revisar')
        : publicado ? h(EtiquetaPublicado, { manual: manual })
        : delSniper ? h('span', { className: 'tag tag-sniper', title: 'Venta registrada por el Sniper' + (sniperDe(l.keko) ? ' (' + sniperDe(l.keko) + ')' : '') },
            h(Ico, { name: 'radar', size: 11 }), 'Vendido · Sniper')
        : l.estado === 'vendido' ? h('span', { className: 'tag tag-verde' }, 'Vendido') : h('span', { className: 'tag tag-azul' }, 'Comprado')),
      h('td', { className: 'r' }, publicado
        ? h('span', { style: { display: 'inline-flex', gap: 6 } },
            h('button', { className: 'btn btn-chico', title: 'Registrar la venta de lo publicado', onClick: function (e) { e.stopPropagation(); props.onVender(l); } }, h(Ico, { name: 'lock', size: 11 }), 'Vendido'),
            manual ? h('button', { className: 'btn btn-chico', title: 'Lo quitaste del mercadillo: vuelve a Comprado', onClick: function (e) { e.stopPropagation(); retirar(l); }, disabled: enviando }, h(Ico, { name: 'undo', size: 12 }), 'Retirar') : null)
        : l.estado === 'comprado'
        ? h('span', { style: { display: 'inline-flex', gap: 6 } },
            l.pendiente ? null : h('button', { className: 'btn btn-chico btn-morado', title: 'Ya lo pusiste en el mercadillo de Habbo: pasa a Publicado (todas sus unidades en mano)', onClick: function (e) { e.stopPropagation(); props.onPublicar(l); } }, h(Ico, { name: 'store', size: 12 }), 'Publicar'),
            h('button', { className: 'btn btn-chico', title: 'Lo vendiste fuera del Sniper: tradeo o venta desde otro keko', onClick: function (e) { e.stopPropagation(); props.onVender(l); } }, 'Vender'))
        : h('button', { className: 'btn btn-chico', title: 'Deshacer la venta', onClick: function (e) { e.stopPropagation(); revertir(l); } }, h(Ico, { name: 'undo', size: 12 }))))];
    if (abiertoEste) {
      filas.push(h('tr', { key: l.id + '-d' }, h('td', { colSpan: conPrecio ? 10 : 7, className: 'detalle' },
        h('div', { className: 'detalle-grid' },
          h('div', null, h('div', { className: 'dato-l' }, 'Origen'), h('div', { className: 'dato-v' }, (ORIGEN[l.fuente] || l.fuente) + (l.instancia ? ' · ' + l.instancia : ''))),
          h('div', null, h('div', { className: 'dato-l' }, 'Número LTD'),
            h('div', { className: 'dato-v', style: { display: 'flex', alignItems: 'center', gap: 8 } },
              l.numero_ltd ? h(EtiquetaLtd, { numero: l.numero_ltd }) : h('span', { className: 'tenue' }, '—'),
              h('button', { className: 'btn btn-chico', onClick: function (e) { e.stopPropagation(); props.onLtd(l); } }, l.numero_ltd ? 'Cambiar' : 'Agregar'))),
          h('div', null, h('div', { className: 'dato-l' }, 'Fecha de compra'), h('div', { className: 'dato-v' }, fmtD(l.fecha_compra))),
          h('div', null, h('div', { className: 'dato-l' }, 'Precio de compra en créditos'), h('div', { className: 'dato-v' }, fmtLg(l.precio_compra_cr) + ' cr')),
          conPrecio ? h('div', null, h('div', { className: 'dato-l' }, l.estado === 'vendido' ? (l.comision_venta !== null && l.comision_venta !== undefined ? 'Entró a tu monedero (neto, congelado)' : 'Vendido a (congelado)') : 'Precio de lista'), h('div', { className: 'dato-v' }, fmtLg(l.precio_venta_cr) + ' cr')) : null,
          l.estado === 'vendido' && l.comision_pagada_cr !== null && l.comision_pagada_cr !== undefined ? h('div', null, h('div', { className: 'dato-l' }, 'Comisión del mercadillo pagada'),
            h('div', { className: 'dato-v' }, fmtCr(l.comision_pagada_cr * l.cantidad) + ' cr', h('span', { className: 'tenue', style: { fontSize: 11 } }, ' · el comprador pagó ' + fmtLg(l.precio_venta_cr + l.comision_pagada_cr) + ' c/u'))) : null,
          l.precio_lista !== null && l.estado === 'vendido' ? h('div', null, h('div', { className: 'dato-l' }, 'Estaba publicado a'), h('div', { className: 'dato-v' }, fmtLg(l.precio_lista) + (l.moneda_lista === 'lingos' ? ' lg' : ' cr'))) : null,
          publicado && l.publicado_en ? h('div', null, h('div', { className: 'dato-l' }, 'Publicado'), h('div', { className: 'dato-v' }, fmtHace(l.publicado_en) + (manual ? ' · por ti' : ' · por el Sniper'))) : null,
          l.estado !== 'vendido' && l.comision_cr ? h('div', null, h('div', { className: 'dato-l' }, 'Recibes por unidad (tras comisión)'),
            h('div', { className: 'dato-v' }, fmtLg(ingresoNeto(l.precio_venta_cr, l.moneda_precio)) + ' cr', h('span', { className: 'tenue', style: { fontSize: 11 } }, ' · comisión ' + fmtCr(l.comision_cr)))) : null,
          l.estado === 'vendido' ? h('div', null, h('div', { className: 'dato-l' }, 'Fecha de venta'), h('div', { className: 'dato-v' },
            l.vendido_en ? fmtD(diaDe(l.vendido_en)) + ' · ' + horaDe(l.vendido_en) : fmtD(l.fecha_venta))) : null,
          l.estado === 'vendido' ? h('div', null, h('div', { className: 'dato-l' }, 'Registrada por'), h('div', { className: 'dato-v' },
            delSniper ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Ico, { name: 'radar', size: 13, color: 'var(--green)' }),
              'El Sniper' + (sniperDe(l.keko) ? ' · ' + sniperDe(l.keko) : '')) : 'Tú')) : null,
          l.origen_id ? h('div', null, h('div', { className: 'dato-l' }, 'Dividido del lote'), h('div', { className: 'dato-v' }, 'Nº ' + l.origen_id)) : null),
        l.notas ? h('div', { className: 'suave', style: { fontSize: 12, marginBottom: 10 } }, l.notas) : null,
        publicado
          ? h('div', { className: 'aviso', style: { display: 'flex', gap: 8, alignItems: 'center', background: 'var(--purple-bg)', color: 'var(--purple)' } },
              h(Ico, { name: 'lock', size: 15 }), h('span', { style: { flex: 1 } }, manual ? AYUDA_PUBLICADO_MANUAL : AYUDA_PUBLICADO))
          : h('div', { style: { display: 'flex', gap: 8 } },
              h('button', { className: 'btn btn-peligro', onClick: function (e) { e.stopPropagation(); eliminar(l); }, disabled: enviando }, h(Ico, { name: 'trash', size: 14 }), 'Eliminar lote')))));
    }
    return filas;
  }

  // La tarjeta de un keko, dentro de su propia barrera: si falla, los demas kekos siguen.
  function bloqueDe(b) {
    var k = b.keko;
    var pendientesAqui = b.items.filter(function (l) { return l.pendiente; }).length;
    return h(BloqueKeko, { key: k.clave, keko: k, datos: datosBloque(b.items, filtro),
        aviso: pendientesAqui ? h('span', { className: 'tag tag-ambar' }, h(Ico, { name: 'radar', size: 11 }), pendientesAqui + ' por revisar') : null,
        accion: filtro === 'comprado' && usaKekos && k.origen !== 'sin' && !k.desconocido
          ? h('button', { className: 'btn btn-chico', title: 'Registrar una compra ya asignada a ' + k.nombre, onClick: function () { props.onNueva(k.nombre); } },
              h(Ico, { name: 'plus', size: 12, sw: 2.4 }), 'Compra') : null },
      h('table', { className: 'tabla' },
        h(Columnas, { anchos: ANCHOS[filtro] }),
        h('thead', null, h('tr', null,
          h('th', null, 'Nº'), h('th', null, 'Furni'), h('th', { className: 'r' }, 'Cant.'), h('th', { className: 'r' }, 'Compra c/u'),
          h('th', { className: 'r' }, 'Costo'),
          conPrecio ? h('th', { className: 'r', title: filtro === 'publicado' ? 'Precio de lista' : 'Lo que entró (neto si fue en el mercadillo)' }, 'Venta c/u') : null,
          conPrecio ? h('th', { className: 'r' }, 'Ganancia') : null, conPrecio ? h('th', { className: 'r' }, 'Margen') : null,
          h('th', null, 'Estado'), h('th', null))),
        h('tbody', null, b.items.map(function (l) {
        return h(Barrera, { key: l.id, tipo: 'fila', columnas: conPrecio ? 10 : 7, etiqueta: 'El lote Nº ' + l.id,
            donde: 'Inventario › lote Nº ' + l.id, onVerErrores: props.onVerErrores },
          h(Dibujar, { dibujar: function () { return filasLote(l); } }));
      }))));
  }

  return h('div', { className: 'contenedor fade-in' },
    pendientes.length ? h(LlegaronDelSniper, { pendientes: pendientes, tasa: props.tasa, onActivado: props.onCambio }) : null,

    h('div', { className: 'barra' },
      h('div', { style: { position: 'relative', flex: 1, minWidth: 200 } },
        h('span', { style: { position: 'absolute', left: 11, top: 10, color: 'var(--text3)' } }, h(Ico, { name: 'search', size: 15 })),
        h('input', { className: 'inp', style: { paddingLeft: 34 }, placeholder: 'Buscar lote por furni…', value: q, onChange: function (e) { setQ(e.target.value); } })),
      FILTROS.map(function (x) {
        return h('button', { key: x[0], className: 'chip' + (filtro === x[0] ? ' activo' : '') + (x[0] === 'publicado' ? ' morado' : ''), onClick: function () { setFiltro(x[0]); },
            title: x[0] === 'publicado' ? AYUDA_PUBLICADO : null },
          x[0] === 'publicado' ? h(Ico, { name: 'lock', size: 12, sw: 2.2 }) : null, x[1], h('span', { className: 'mono' }, cuenta[x[0]]));
      }),
      porAsignar ? h('button', { className: 'chip azul' + (filtro === 'por_asignar' ? ' activo' : ''), onClick: function () { setFiltro('por_asignar'); setAbierto(null); },
          title: 'Ventas que registró el Sniper y la app no supo de qué lote salieron' },
        h(Ico, { name: 'radar', size: 12 }), 'Por asignar',
        porAsignar.length ? h('span', { className: 'chip-num' }, porAsignar.length) : h('span', { className: 'mono' }, 0)) : null,
      h('button', { className: 'btn', onClick: props.onVentaManual, title: 'Registrar una venta hecha fuera del Sniper: un tradeo o una venta desde otro keko' }, h(Ico, { name: 'tag', size: 14 }), 'Venta'),
      h('button', { className: 'btn btn-verde', onClick: function () { props.onNueva(); } }, h(Ico, { name: 'plus', size: 14, sw: 2.4 }), 'Compra')),

    enBandeja
      ? h(TablaPorAsignar, { ventas: ventasVisibles, q: q, furnis: props.furnis, kekos: listaKekos, onVerErrores: props.onVerErrores,
          onAsignar: props.onAsignarVenta, onDescartar: props.onDescartarVenta })
    : visibles.length === 0
      ? h('div', { className: 'tabla-caja' }, h('div', { className: 'vacio' }, !compras.length ? 'Aún no hay compras. Registra una o importa tu Excel desde Ajustes.'
          : q ? 'Ningún lote coincide en esta pestaña.'
          : filtro === 'publicado' ? 'No hay nada publicado en el mercadillo.' : filtro === 'vendido' ? 'Aún no hay ventas.' : 'No tienes nada en mano.'))
      : h('div', null,
          h(IndiceKekos, { bloques: agrupado.bloques, cuenta: function (b) { return fmtCr(sumar(b.items, 'cantidad')); } }),
          h('div', { className: 'bk-lista' + (alineado.alineado ? ' alineado' : ''), ref: alineado.ref }, agrupado.bloques.map(function (b) {
            return h(Barrera, { key: b.keko.clave, tipo: 'bloque', etiqueta: 'El bloque de ' + nombreBloque(b.keko),
                donde: 'Inventario › ' + nombreBloque(b.keko), onVerErrores: props.onVerErrores },
              h(Dibujar, { dibujar: function () { return bloqueDe(b); } }));
          })),
          q ? null : h(KekosVacios, { nombres: agrupado.vacios, texto: VACIOS[filtro] })),
    confirmacion ? h(Confirmar, Object.assign({}, confirmacion, { enviando: enviando,
      onClose: function () { setConfirmacion(null); }, onConfirmar: function () { ejecutar(confirmacion.accion); } })) : null,
    h('div', { className: 'tenue', style: { fontSize: 12, marginTop: 8 } }, filtro === 'comprado'
      ? 'Lo que tienes en mano no tiene precio ni ganancia: solo lo que costó. El precio se pone al publicar o al vender.'
      : filtro === 'publicado' ? 'La ganancia de lo publicado usa su precio de lista y ya descuenta la comisión del mercadillo de Habbo.es.'
      : enBandeja ? 'Ventas que envió el Sniper sin un lote publicado con el que casar. No se pierden: quedan aquí hasta que las asignes o descartes, y se asignan solas si después llega la publicación que faltaba.'
      : 'La ganancia de lo vendido usa el precio real congelado al vender (si fue en el mercadillo, el neto que entró a tu monedero).'));
}
