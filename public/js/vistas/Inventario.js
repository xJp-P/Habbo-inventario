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
// keko (migracion 20261014000000). Clic en un lote: su detalle. Desde la v1.8.0, la
// cabecera de cada bloque es el encabezado C (dona, capsula, globo y barra de colores).
//
// Agrupado por furni (v1.8.0; maqueta del 02-10-2026, decisiones 1-5 y 7), en las tres
// pestañas: dentro de cada bloque, una fila por furni con sus totales (core/grupos.js). Un
// furni con un solo lote se ve como antes. Clic en la fila (o en su flecha): se despliega
// con la curva del acordeon y sus lotes entran en cascada, colgando de una rama, en el orden
// en que la base los toma (Comprado y Publicado del mas antiguo al mas nuevo, con «1º en
// salir»; Vendido, la ultima venta arriba). En Comprado, la franja de precios de compra
// (cada punto es un lote: al pasar el raton se ilumina su fila, y al reves). «Abrir todo /
// Cerrar todo» en la barra; al buscar, los furnis que coinciden se abren solos; los que
// dejas abiertos se recuerdan en este equipo. Los botones del furni llegan en la fase 4:
// por ahora, cada lote conserva los suyos.
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
import { composicionLotes, agruparPorFurni, franjaPrecios, claveGrupo, leerAbiertos, guardarAbiertos, alternarAbierto } from '../core/grupos.js';

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
  comprado: [62, null, 56, 96, 100, 124, 210],
  publicado: [62, null, 56, 96, 100, 96, 100, 68, 116, 206],
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

// Lo que dice la cabecera de un bloque en cada pestana (encabezado C, v1.8.0): la capsula
// «lotes · und · dinero» (el costo en Comprado; la ganancia en Publicado y Vendido) y el
// globo con el dinero de cada furni (core/grupos.js, composicionLotes).
function resumenBloque(lotes, filtro) {
  var n = lotes.length;
  var r = { n: n, nTexto: filtro === 'vendido' ? (n === 1 ? 'venta' : 'ventas') : (n === 1 ? 'lote' : 'lotes'), und: sumar(lotes, 'cantidad') };
  r.dinero = filtro === 'comprado'
    ? { tipo: 'costo', valor: sumar(lotes, 'costo_total_cr'), texto: 'costo' }
    : { tipo: 'ganancia', valor: sumar(lotes, 'ganancia_cr'), texto: filtro === 'publicado' ? 'ganancia esperada' : 'ganancia', sufijo: filtro === 'publicado' ? 'esperada' : null };
  return r;
}
var TEXTOS_COMPOSICION = {
  comprado: { titulo: 'Dónde está tu inversión', pie: 'Lo que costó lo que tienes en mano en este keko, por furni.' },
  publicado: { titulo: 'Lo que te entraría, por furni', pie: 'Lo que te entraría tras la comisión si se vende todo lo publicado en este keko.' },
  vendido: { titulo: 'De dónde vienen tus ingresos', pie: 'Lo que entró por cada furni vendido en este keko (si fue en el mercadillo, el neto).' },
};

// ── Agrupado por furni (v1.8.0) ──
function redondo1(x) { return Math.round(x * 10) / 10; }
// «21 sept» (con el año si no es el actual).
function fechaCorta(s) {
  if (!s) return null;
  var d = new Date(String(s).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  var op = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) op.year = 'numeric';
  return d.toLocaleDateString('es-CO', op);
}
function cuandoVendido(l) { return l.vendido_en ? cuandoVenta(l.vendido_en) : l.fecha_venta ? 'el ' + fmtD(l.fecha_venta) : 'sin fecha'; }
var ORIGEN_LOTE = { excel: 'del Excel', manual: 'a mano', sniper: 'del Sniper' };

// Lo que dice un lote dentro de su furni (en vez del nombre, que ya esta en la fila del furni).
function EncabezadoLote(props) {
  var l = props.lote;
  var titulo, sub;
  if (l.estado === 'vendido') {
    titulo = 'Vendida ' + cuandoVendido(l);
    sub = ventaDelSniper(l) ? 'registrada por el Sniper' + (props.sniper ? ' · ' + props.sniper : '') : 'registrada por ti';
  } else if (l.estado === 'publicado') {
    titulo = l.publicado_en ? 'Publicado ' + fmtHace(l.publicado_en) : 'Publicado (sin fecha)';
    sub = (l.publicado_por === 'manual' ? 'por ti' : 'por el Sniper') + (fechaCorta(l.fecha_compra) ? ' · comprado el ' + fechaCorta(l.fecha_compra) : '');
  } else {
    titulo = fechaCorta(l.fecha_compra) ? 'Lote del ' + fechaCorta(l.fecha_compra) : 'Lote sin fecha';
    sub = (ORIGEN_LOTE[l.fuente] || l.fuente || '') + (l.instancia ? ' · ' + l.instancia : '');
  }
  return h('div', { style: { minWidth: 0 } },
    h('div', { className: 'lote-nombre' }, h('span', { className: 'lote-titulo' }, titulo),
      l.numero_ltd ? h(EtiquetaLtd, { numero: l.numero_ltd }) : null,
      props.primero ? h('span', { className: 'primero', title: '«Publicar» empieza por este lote: es el más antiguo que tienes en mano' }, '1º en salir') : null),
    sub ? h('div', { className: 'lote-sub' }, sub) : null);
}

// La franja de precios de compra: cada punto es un lote (mas grande, mas unidades) y la
// marca dorada es el promedio. Pasar el raton por un punto ilumina su fila, y al reves.
function FranjaPrecios(props) {
  var f = props.franja;
  var g = props.grupo;
  var porId = {};
  g.lotes.forEach(function (l) { porId[l.id] = l; });
  return h('div', { className: 'franja' },
    h('span', null, 'Precio de compra'),
    h('span', { className: 'mono' }, fmtLg(f.min)),
    h('div', { className: 'eje' },
      h('span', { className: 'media', style: { left: f.posPromedio + '%' }, title: 'Promedio: ' + fmtLg(redondo1(f.promedio)) + ' c/u' }),
      f.puntos.map(function (p) {
        var l = porId[p.id];
        return h('span', { key: p.id, className: 'pt' + (p.pendiente ? ' pend' : '') + (props.resaltado === p.id ? ' resalta' : ''),
          style: { left: p.pos + '%', width: p.tam, height: p.tam },
          title: 'Lote Nº ' + p.id + ' · ' + l.cantidad + ' und a ' + fmtLg(l.precio_compra_cr) + ' c/u' + (p.pendiente ? ' (por revisar)' : ''),
          onMouseEnter: function () { props.onResaltar(p.id); }, onMouseLeave: function () { props.onResaltar(null); } });
      })),
    h('span', { className: 'mono' }, fmtLg(f.max)),
    h('span', null, 'promedio ', h('b', { className: 'mono' }, fmtLg(redondo1(f.promedio))), ' · ' + fmtCr(g.unidades) + ' und · ' + fmtCr(g.costo) + ' cr'));
}

// Un furni con varios lotes: su fila con los totales y, debajo, el desplegable con sus
// lotes (siempre en la pagina para que la animacion sea suave; cerrado, inerte y oculto).
// `filasLote(l, op)` dibuja cada lote como hoy, con su detalle y sus botones.
function GrupoFurni(props) {
  var g = props.grupo;
  var filtro = props.filtro;
  var abierto = props.abierto;
  var sR = useState(null); var resaltado = sR[0]; var setResaltado = sR[1];
  var conPrecio = filtro !== 'comprado';
  var franja = filtro === 'comprado' ? franjaPrecios(g) : null;
  var n = g.lotes.length;
  var gan = g.ganancia;
  var claseGan = gan > 0 ? 'pos' : gan < 0 ? 'neg' : '';
  var sub;
  if (filtro === 'vendido') sub = n + ' ventas · última ' + cuandoVendido(g.lotes[0]);
  else if (filtro === 'publicado') sub = n + ' lotes · ' + (g.listas.length > 1 ? g.listas.length + ' precios de lista' : 'todos a ' + fmtLg(g.listas[0]) + ' cr');
  else sub = n + ' lotes · ' + (g.compraMin === g.compraMax ? 'todos a ' + fmtLg(g.compraMin) + ' c/u' : 'de ' + fmtLg(g.compraMin) + ' a ' + fmtLg(g.compraMax) + ' c/u');
  var estado = filtro === 'comprado'
    ? (g.porRevisar ? h('span', { className: 'tag tag-ambar' }, h(Ico, { name: 'radar', size: 11 }), g.porRevisar + ' por revisar') : h('span', { className: 'tag tag-azul' }, 'Comprado'))
    : filtro === 'publicado' ? h(EtiquetaPublicado, {})
    : g.todasSniper ? h('span', { className: 'tag tag-sniper' }, h(Ico, { name: 'radar', size: 11 }), 'Vendido · Sniper')
    : h('span', { className: 'tag tag-verde' }, 'Vendido');
  var prom = h('div', { className: 'prom' }, 'prom.');
  function alternar(e) { if (e) e.stopPropagation(); props.onAlternar(); }
  return [
    h('tr', { key: 'g', className: 'fila-grupo' + (abierto ? ' abierto' : '') + (g.porRevisar ? ' con-revisar' : ''), onClick: alternar },
      h('td', null, h('div', { className: 'g-cel' },
        h('button', { type: 'button', className: 'g-flecha', 'aria-expanded': abierto, onClick: alternar,
          'aria-label': (abierto ? 'Ocultar' : 'Ver') + ' los ' + n + ' lotes de ' + g.nombre }, h(Ico, { name: 'chevright', size: 13, sw: 2.6 })),
        h('span', { className: 'g-n mono' }, '×' + n))),
      h('td', null, h('div', { className: 'furni' },
        h(IconoFurni, { classname: g.classname, revision: g.revision, pila: true }),
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'furni-linea' },
            h('div', { className: 'furni-nombre', title: g.nombre }, g.nombre),
            g.ltds.slice(0, 4).map(function (x) { return h(EtiquetaLtd, { key: x, numero: x }); }),
            g.ltds.length > 4 ? h('span', { className: 'tenue mono', style: { fontSize: 11 } }, '+' + (g.ltds.length - 4)) : null),
          h('div', { className: 'furni-sub' }, sub)))),
      h('td', { className: 'r mono' }, h('b', null, fmtCr(g.unidades))),
      h('td', { className: 'r mono' }, fmtLg(redondo1(g.compraProm)), prom),
      h('td', { className: 'r mono' }, h('b', null, fmtCr(g.costo))),
      conPrecio ? h('td', { className: 'r mono' }, filtro === 'publicado'
        ? h('span', { className: 'morado', style: { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' } },
            h(Ico, { name: 'lock', size: 11, sw: 2.2 }), fmtLg(g.listas[0]) + (g.listas.length > 1 ? '–' + fmtLg(g.listas[g.listas.length - 1]) : ''))
        : h('span', null, fmtLg(redondo1(g.ventaProm)), prom)) : null,
      conPrecio ? h('td', { className: 'r mono ' + claseGan }, gan === null ? '-' : h('b', null, (gan > 0 ? '+' : '') + fmtCr(gan))) : null,
      conPrecio ? h('td', { className: 'r mono ' + claseGan }, g.margen === null ? '-' : fmtPct(g.margen)) : null,
      h('td', null, estado),
      h('td', { className: 'r' })),
    h('tr', { key: 'l', className: 'fila-lotes' + (abierto ? ' abierto' : '') + (props.animar ? ' animar' : '') },
      h('td', { colSpan: props.columnas },
        h('div', { className: 'desp' },
          h('div', { className: 'desp-in', 'aria-hidden': !abierto, inert: abierto ? undefined : '' },
            h('div', { className: 'desp-marco' },
              franja ? h(FranjaPrecios, { franja: franja, grupo: g, resaltado: resaltado, onResaltar: setResaltado }) : null,
              h('table', { className: 'tabla sub' },
                h(Columnas, { anchos: props.anchos }),
                h('tbody', null, g.lotes.map(function (l, i) {
                  return h(Barrera, { key: l.id, tipo: 'fila', columnas: props.columnas, etiqueta: 'El lote Nº ' + l.id,
                      donde: 'Inventario › lote Nº ' + l.id, onVerErrores: props.onVerErrores },
                    h(Dibujar, { dibujar: function () {
                      return props.filasLote(l, { dentro: true, indice: i, ultimo: i === n - 1, primero: g.primero === l.id,
                        resaltado: resaltado === l.id, onResaltar: setResaltado });
                    } }));
                })))))))),
  ];
}

export function InventarioView(props) {
  var compras = props.compras;
  var pendientes = props.pendientes;
  var sQ = useState(props.filtroFurni || ''); var q = sQ[0]; var setQ = sQ[1];
  var sF = useState('comprado'); var filtro = sF[0]; var setFiltro = sF[1];
  var sA = useState(null); var abierto = sA[0]; var setAbierto = sA[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var sConf = useState(null); var confirmacion = sConf[0]; var setConfirmacion = sConf[1];
  // Furnis abiertos: los que dejaste abiertos (se recuerdan en este equipo, core/grupos.js);
  // al buscar, todos los que coinciden, salvo los que cierres durante esa busqueda.
  var sAb = useState(leerAbiertos); var abiertos = sAb[0]; var setAbiertos = sAb[1];
  var sCq = useState([]); var cerradosBusqueda = sCq[0]; var setCerradosBusqueda = sCq[1];
  // Los recien abiertos (por un segundo): solo ellos animan la entrada de sus lotes; lo que
  // ya estaba abierto al entrar se ve sin animar.
  var sAn = useState(null); var animados = sAn[0]; var setAnimados = sAn[1];
  useEffect(function () { setCerradosBusqueda([]); }, [q]);
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

  // ── Furnis abiertos ──
  function claveDe(keko, g) { return claveGrupo(keko.nombre, filtro, g.furni_id !== null && g.furni_id !== undefined ? g.furni_id : g.clave); }
  function grupoAbierto(clave) { return q ? cerradosBusqueda.indexOf(clave) === -1 : abiertos.indexOf(clave) !== -1; }
  function seAnima(clave) { return !!animados && Date.now() - animados.t < 1200 && animados.claves.indexOf(clave) !== -1; }
  function guardar(lista) { setAbiertos(lista); guardarAbiertos(lista); }
  function alternarGrupo(clave) {
    var abrir = !grupoAbierto(clave);
    if (q) setCerradosBusqueda(abrir ? cerradosBusqueda.filter(function (x) { return x !== clave; }) : cerradosBusqueda.concat([clave]));
    else guardar(alternarAbierto(abiertos, clave, abrir));
    if (abrir) setAnimados({ claves: [clave], t: Date.now() });
  }
  // Las claves de los furnis con varios lotes de esta pestaña («Abrir todo / Cerrar todo»).
  // Si un bloque trae un dato raro, su propia barrera lo dice: aqui solo se salta.
  var clavesGrupos = [];
  if (!enBandeja) {
    agrupado.bloques.forEach(function (b) {
      try {
        agruparPorFurni(b.items, filtro).forEach(function (g) { if (g.lotes.length > 1) clavesGrupos.push(claveDe(b.keko, g)); });
      } catch (_) { /* lo dibuja su barrera */ }
    });
  }
  var todosAbiertos = clavesGrupos.length > 0 && clavesGrupos.every(grupoAbierto);
  function abrirOCerrarTodo() {
    if (todosAbiertos) {
      if (q) setCerradosBusqueda(clavesGrupos.slice());
      else guardar(abiertos.filter(function (c) { return clavesGrupos.indexOf(c) === -1; }));
      return;
    }
    var cerrados = clavesGrupos.filter(function (c) { return !grupoAbierto(c); });
    if (q) setCerradosBusqueda([]);
    else guardar(cerrados.reduce(function (lista, c) { return alternarAbierto(lista, c, true); }, abiertos));
    setAnimados({ claves: cerrados, t: Date.now() });
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
  // `op.dentro`: el lote va dentro de su furni (Inventario agrupado): cuelga de la rama,
  // entra en cascada (`op.indice`), dice su fecha en vez del nombre, lleva «1º en salir» si
  // toca y se ilumina junto con su punto de la franja de precios.
  function filasLote(l, op) {
    op = op || {};
    var abiertoEste = abierto === l.id;
    var publicado = l.estado === 'publicado';
    var manual = publicado && l.publicado_por === 'manual';
    var clase = 'fila' + (abiertoEste ? ' abierta' : '') + (l.pendiente ? ' huerfana' : '') + (l.estado === 'vendido' ? ' vendida' : '') + (publicado ? ' publicada' : '')
      + (op.dentro ? ' lote' + (op.ultimo ? ' ultimo' : '') + (op.resaltado ? ' resalta' : '') : '');
    var g = l.ganancia_cr;
    var delSniper = ventaDelSniper(l);
    var filas = [h('tr', { key: l.id, className: clase, onClick: function () { setAbierto(abiertoEste ? null : l.id); },
        style: op.dentro ? { '--i': op.indice } : undefined,
        onMouseEnter: op.onResaltar ? function () { op.onResaltar(l.id); } : undefined,
        onMouseLeave: op.onResaltar ? function () { op.onResaltar(null); } : undefined },
      h('td', { className: 'mono' + (op.dentro ? ' rama' : ''), style: { color: l.pendiente ? 'var(--yellow)' : 'var(--text3)' } }, l.id),
      h('td', null, op.dentro
        ? h(EncabezadoLote, { lote: l, primero: op.primero, sniper: delSniper ? sniperDe(l.keko) : null })
        : h(NombreFurni, { furni: l, sub: l.estado === 'vendido' && l.vendido_en ? 'vendida ' + cuandoVenta(l.vendido_en) : null })),
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
    return h(BloqueKeko, { key: k.clave, keko: k, resumen: resumenBloque(b.items, filtro), composicion: composicionLotes(b.items, filtro),
        textos: TEXTOS_COMPOSICION[filtro],
        aviso: pendientesAqui ? h('span', { className: 'tag tag-ambar' }, h(Ico, { name: 'radar', size: 11 }), pendientesAqui + ' por revisar') : null,
        accion: filtro === 'comprado' && usaKekos && k.origen !== 'sin' && !k.desconocido
          ? h('button', { className: 'btn btn-verde btn-pil', title: 'Registrar una compra ya asignada a ' + k.nombre, onClick: function () { props.onNueva(k.nombre); } },
              h(Ico, { name: 'plus', size: 13, sw: 2.6 }), 'Compra') : null },
      // Anchos fijos tambien con la ventana angosta (la tarjeta se desplaza de lado): la
      // tabla de los lotes de cada furni repite estas columnas y debe coincidir con ellas.
      h('table', { className: 'tabla', style: alineado.alineado ? undefined : { tableLayout: 'fixed', minWidth: anchoMinimo(ANCHOS[filtro]) } },
        h(Columnas, { anchos: ANCHOS[filtro] }),
        h('thead', null, h('tr', null,
          h('th', null, 'Nº'), h('th', null, 'Furni'), h('th', { className: 'r' }, 'Cant.'), h('th', { className: 'r' }, 'Compra c/u'),
          h('th', { className: 'r' }, 'Costo'),
          conPrecio ? h('th', { className: 'r', title: filtro === 'publicado' ? 'Precio de lista' : 'Lo que entró (neto si fue en el mercadillo)' }, 'Venta c/u') : null,
          conPrecio ? h('th', { className: 'r' }, 'Ganancia') : null, conPrecio ? h('th', { className: 'r' }, 'Margen') : null,
          h('th', null, 'Estado'), h('th', null))),
        // Una fila por furni (core/grupos.js); un furni con un solo lote, como antes. Cada
        // furni y cada lote tienen su barrera: si uno trae un dato raro, solo el lo dice.
        h('tbody', null, agruparPorFurni(b.items, filtro).map(function (gr) {
          var columnas = conPrecio ? 10 : 7;
          if (gr.lotes.length === 1) {
            var l = gr.lotes[0];
            return h(Barrera, { key: 'l' + l.id, tipo: 'fila', columnas: columnas, etiqueta: 'El lote Nº ' + l.id,
                donde: 'Inventario › lote Nº ' + l.id, onVerErrores: props.onVerErrores },
              h(Dibujar, { dibujar: function () { return filasLote(l); } }));
          }
          var clave = claveDe(k, gr);
          var nombre = typeof gr.nombre === 'string' ? gr.nombre : 'este furni';
          return h(Barrera, { key: 'g' + gr.clave, tipo: 'fila', columnas: columnas, etiqueta: 'El furni «' + nombre + '»',
              donde: 'Inventario › ' + nombreBloque(k) + ' › ' + nombre, onVerErrores: props.onVerErrores },
            h(Dibujar, { dibujar: function () {
              return h(GrupoFurni, { grupo: gr, filtro: filtro, abierto: grupoAbierto(clave), animar: seAnima(clave),
                onAlternar: function () { alternarGrupo(clave); }, filasLote: filasLote, columnas: columnas, anchos: ANCHOS[filtro],
                onVerErrores: props.onVerErrores });
            } }));
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
      clavesGrupos.length ? h('button', { className: 'btn', onClick: abrirOCerrarTodo,
          title: todosAbiertos ? 'Cerrar todos los furnis con varios lotes' : 'Abrir todos los furnis con varios lotes para ver sus lotes' },
        h(Ico, { name: todosAbiertos ? 'contraer' : 'expandir', size: 14 }), todosAbiertos ? 'Cerrar todo' : 'Abrir todo') : null,
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
