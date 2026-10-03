// public/js/vistas/Historial.js — el Historial de ventas (v1.9.0; maqueta aprobada por el
// dueño el 03-10-2026 con sus 8 recomendaciones).
//
// Todas las ventas de la cuenta en orden cronologico, sin importar el keko: un libro mayor
// para auditar. No reemplaza Inventario › Vendido (que sigue por keko).
//
//   - Arriba, 4 tarjetas que siguen los filtros: Ventas (reparto Sniper / manual), Entró
//     (neto, con la comision pagada y el costo), Ganancia (margen y reparto) y Mejor furni.
//   - La barra de filtros se queda fija al bajar: buscar, rango de fechas, kekos (menu con
//     casillas), origen y «Con pérdida». Debajo, los filtros activos como chips con ✕ y
//     «Limpiar». Se recuerdan en este equipo (decision 8; la busqueda no).
//   - El libro, agrupado por dia (decision 5): cada dia con su subtotal en un encabezado que
//     se queda fijo bajo los filtros. Orden por hora, por lo que entró o por ganancia (clic
//     en el titulo). «Ver 60 más». Con la ventana angosta se ocultan Keko y Precio c/u (el
//     keko pasa bajo el nombre del furni).
//   - Clic en una venta: su detalle, con «Ver en el Inventario» (Vendido, en el bloque de su
//     keko y con el lote abierto) y «Deshacer venta» (decision 6).
//   - El grafico de ganancia por dia (decision 4; por semana o por mes en rangos largos): una
//     barra por dia, verde Sniper y azul manual, roja si ese dia dejo perdida. Al pasar el
//     raton, el globo del dia; con un clic, el libro muestra solo ese dia (chip «Día: …»).
//   - «Exportar CSV» de lo filtrado (decision 7): en la app de escritorio, el «Guardar como»
//     del sistema (electron/archivos.js) y «Mostrar»; en el navegador, una descarga.
//   - Las ventas «por asignar» del Sniper van en el libro, en azul, sin ganancia (no se sabe de
//     que lote salieron) y con «Asignar a un lote…» (decision 3). No suman dinero.
//   - En vivo: cuando el Sniper envia ventas, app.js recarga los datos y el libro se pone al
//     dia solo; las ventas nuevas se iluminan un momento.
//
// Toda la logica (filas, filtros, orden, dias, metricas) vive en core/historial.js, probada
// contra la base: lo que se ve aqui cuadra al centimo con el Inventario y el Resumen.
// Barreras: la seccion (app.js), cada dia y cada venta.

import { h, useState, useMemo, useEffect, useRef } from '../core/react.js';
import { API } from '../core/api.js';
import { fmtCr, fmtLg, fmtPct } from '../core/format.js';
import { _submitGuard } from '../core/ui.js';
import { Ico } from '../componentes/iconos.js';
import { IconoFurni, EtiquetaLtd, Confirmar } from '../componentes/base.js';
import { AvatarKeko, Columnas, useAlineado } from '../componentes/BloquesKeko.js';
import { Barrera, Dibujar } from '../componentes/Barrera.js';
import { claveKeko } from '../core/kekos.js';
import { horaDe } from '../core/ventas.js';
import {
  filasHistorial, filtrar, ordenar, porDia, metricas, kekosDe, leerFiltros, guardarFiltros,
  tituloDia, diaCorto, duracion, activos, quitarFiltro, hoyDe, sumarDias, serieDiaria, csv, nombreCsv,
} from '../core/historial.js';

var RANGOS = [['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['mes', 'Este mes'], ['todo', 'Todo'], ['propio', 'Fechas…']];
var ORIGENES = [['todas', 'Todas', null], ['sniper', 'Sniper', 'radar'], ['manual', 'Manual', 'user']];
var TEXTO_ORDEN = { fecha: 'las más recientes primero', ganancia: 'por ganancia, de mayor a menor', entro: 'por lo que entró, de mayor a menor' };
var PAGINA = 60;
// Columnas del libro: [clave, titulo, ancho (null = Furni), orden al hacer clic]. Con poco
// ancho (COMPACTO) se quitan Keko y Precio c/u.
var COLUMNAS = [['hora', 'Hora', 78, 'fecha'], ['furni', 'Furni', null], ['keko', 'Keko', 150], ['cant', 'Cant.', 58],
  ['precio', 'Precio c/u', 96], ['entro', 'Entró', 100, 'entro'], ['ganancia', 'Ganancia', 108, 'ganancia'], ['origen', 'Origen', 112]];
var MINIMO_COMPLETO = 920;
var SIN_VENTAS = [];

function signo(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmtCr(Math.abs(n)); }
function claseSigno(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }

// Las 4 tarjetas de arriba.
function Tarjetas(props) {
  var m = props.m;
  var totalGan = Math.max(0, m.sniper.ganancia) + Math.max(0, m.manual.ganancia);
  return h('div', { className: 'h-kpis-caja' }, h('div', { className: 'h-kpis' },
    h('div', { className: 'h-kpi' },
      h('div', { className: 'h-kpi-l' }, h(Ico, { name: 'recibo', size: 12 }), 'Ventas'),
      h('div', { className: 'h-kpi-v' }, fmtCr(m.ventas)),
      h('div', { className: 'h-kpi-s' }, fmtCr(m.unidades) + ' und · ' + m.furnis + (m.furnis === 1 ? ' furni' : ' furnis distintos'),
        m.porAsignar ? h('span', { className: 'txt-azul', title: 'Ventas del Sniper que aún no tienen lote: no suman en los totales' }, ' · ' + m.porAsignar + ' por asignar') : null),
      h('div', { className: 'h-reparto', title: m.sniper.ventas + ' del Sniper · ' + m.manual.ventas + ' manuales' },
        h('i', { style: { flexGrow: m.sniper.ventas, background: 'var(--green)' } }), h('i', { style: { flexGrow: m.manual.ventas, background: 'var(--blue)' } })),
      h('div', { className: 'h-reparto-ley' }, h('span', { className: 's' }, h('b', null, m.sniper.ventas), ' Sniper'), h('span', { className: 'm' }, h('b', null, m.manual.ventas), ' manuales')),
      h('span', { className: 'h-kpi-fondo' }, h(Ico, { name: 'recibo', size: 64, sw: 1.5 }))),
    h('div', { className: 'h-kpi' },
      h('div', { className: 'h-kpi-l' }, h(Ico, { name: 'moneda', size: 12 }), 'Entró (neto)'),
      h('div', { className: 'h-kpi-v' }, fmtCr(m.entro), h('small', null, 'cr')),
      h('div', { className: 'h-kpi-s' }, 'Comisión pagada ' + fmtCr(m.comision) + ' cr · costo ' + fmtCr(m.costo) + ' cr'),
      h('span', { className: 'h-kpi-fondo' }, h(Ico, { name: 'moneda', size: 64, sw: 1.5 }))),
    h('div', { className: 'h-kpi ganancia' + (m.ganancia < 0 ? ' neg' : '') },
      h('div', { className: 'h-kpi-l' }, h(Ico, { name: m.ganancia < 0 ? 'bajando' : 'trending', size: 12 }), 'Ganancia'),
      h('div', { className: 'h-kpi-v ' + (m.ganancia < 0 ? 'neg' : 'pos') }, signo(m.ganancia), h('small', null, 'cr')),
      h('div', { className: 'h-kpi-s' }, 'Margen ' + (m.margen === null ? '—' : fmtPct(m.margen)) + ' · Sniper ' + signo(m.sniper.ganancia) + ' · manual ' + signo(m.manual.ganancia)),
      h('div', { className: 'h-reparto' },
        h('i', { style: { flexGrow: totalGan ? Math.max(0, m.sniper.ganancia) / totalGan : 0, background: 'var(--green)' } }),
        h('i', { style: { flexGrow: totalGan ? Math.max(0, m.manual.ganancia) / totalGan : 0, background: 'var(--blue)' } })),
      h('span', { className: 'h-kpi-fondo' }, h(Ico, { name: 'trending', size: 64, sw: 1.5 }))),
    h('div', { className: 'h-kpi' },
      h('div', { className: 'h-kpi-l' }, h(Ico, { name: 'trofeo', size: 12 }), 'Mejor furni'),
      m.mejor ? h('div', { className: 'h-kpi-mejor' },
          h(IconoFurni, { classname: m.mejor.classname, revision: m.mejor.revision, size: 38 }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'nom', title: m.mejor.nombre }, m.mejor.nombre),
            h('div', { className: 'h-kpi-s' }, h('b', { className: 'mono ' + claseSigno(m.mejor.ganancia) }, signo(m.mejor.ganancia) + ' cr'),
              ' en ' + m.mejor.ventas + (m.mejor.ventas === 1 ? ' venta' : ' ventas'))))
        : h('div', { className: 'h-kpi-s', style: { marginTop: 12 } }, 'Sin ventas en este filtro'),
      h('span', { className: 'h-kpi-fondo' }, h(Ico, { name: 'trofeo', size: 64, sw: 1.5 })))));
}

// ── El grafico de ganancia por dia (decision 4) ──
var TITULO_GRAFICO = { dia: 'Ganancia por día', semana: 'Ganancia por semana', mes: 'Ganancia por mes' };
var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function tituloPunto(p, por, ahora) {
  if (por === 'dia') return tituloDia(p.desde, ahora);
  if (por === 'mes') { var m = MESES_LARGOS[Number(p.clave.slice(5, 7)) - 1]; return m.charAt(0).toUpperCase() + m.slice(1) + ' de ' + p.clave.slice(0, 4); }
  return 'Del ' + diaCorto(p.desde, ahora) + ' al ' + diaCorto(p.hasta, ahora);
}
var ALTO_BARRAS = 84;
function Grafico(props) {
  var s = props.serie;
  var por = s.por;
  var sT = useState(null); var tip = sT[0]; var setTip = sT[1];
  var periodo = props.periodo;
  // Escala: lo mas que gano un dia, arriba; lo mas que perdio, debajo de la linea base.
  var max = Math.max(1, Math.max.apply(null, s.puntos.map(function (p) { return Math.max(0, p.ganancia); })));
  var minNeg = Math.min(0, Math.min.apply(null, s.puntos.map(function (p) { return p.ganancia; })));
  var escala = ALTO_BARRAS / (max - minNeg || 1);
  var base = -minNeg * escala;
  function elegido(p) { return !!periodo && periodo.desde === p.desde && periodo.hasta === p.hasta; }
  // El globo, al costado de la barra y a media altura del grafico (no tapa las tarjetas de
  // arriba ni el dia que miras): a la derecha de la barra o, en la mitad derecha, a su izquierda.
  function mostrarTip(p, e) {
    var r = e.currentTarget.getBoundingClientRect();
    var c = e.currentTarget.parentNode.getBoundingClientRect();
    var izq = r.left + r.width / 2 > c.left + c.width / 2;
    setTip({ p: p, izq: izq, x: izq ? r.left - 8 : r.right + 8, y: c.top + c.height / 2 });
  }
  var p0 = s.puntos[0];
  var pN = s.puntos[s.puntos.length - 1];
  return h('div', { className: 'h-grafico' },
    h('div', { className: 'h-grafico-cab' },
      h('b', null, TITULO_GRAFICO[por]),
      h('span', { className: 'mono ' + claseSigno(s.total.ganancia) }, signo(s.total.ganancia) + ' cr'),
      h('span', null, '· clic en ' + (por === 'dia' ? 'un día para ver solo ese día' : por === 'semana' ? 'una semana para ver solo esa semana' : 'un mes para ver solo ese mes')),
      // Lo importado del Excel no tiene dia: no cabe en ninguna barra (las tarjetas si lo cuentan).
      s.total.sinDia ? h('span', { title: 'Las ventas importadas del Excel no tienen fecha: cuentan en las tarjetas y en el libro, pero no en el gráfico' },
        '· ' + s.total.sinDia + (s.total.sinDia === 1 ? ' venta sin fecha no entra' : ' ventas sin fecha no entran')) : null,
      h('span', { className: 'h-ley' }, h('span', { className: 's' }, 'Sniper'), h('span', { className: 'm' }, 'Manual'), h('span', { className: 'n' }, 'Pérdida'))),
    h('div', { className: 'h-barras' + (periodo ? ' con-sel' : ''), onMouseLeave: function () { setTip(null); } },
      h('div', { className: 'h-base', style: { bottom: base } }),
      s.puntos.map(function (p) {
        var vacio = !p.ventas && !p.porAsignar;
        var g = p.ganancia;
        // Un dia que gano: la barra mide lo que gano, repartida entre Sniper y manual; uno que
        // perdio: una barra roja hacia abajo.
        var positivos = Math.max(0, p.sniper) + Math.max(0, p.manual);
        var hs = g > 0 && positivos ? g * escala * Math.max(0, p.sniper) / positivos : 0;
        var hm = g > 0 && positivos ? g * escala * Math.max(0, p.manual) / positivos : 0;
        var hn = g < 0 ? -g * escala : 0;
        var etiqueta = tituloPunto(p, por, props.ahora) + ': ' + (vacio ? 'sin ventas' : signo(g) + ' cr en ' + p.ventas + (p.ventas === 1 ? ' venta' : ' ventas'));
        return h('button', { key: p.clave, type: 'button', className: 'h-barra' + (vacio ? ' vacia' : '') + (elegido(p) ? ' sel' : ''), disabled: vacio,
            style: { paddingBottom: base, '--base': base + 'px' }, 'aria-label': etiqueta, 'aria-pressed': elegido(p),
            onClick: function () { setTip(null); props.onElegir(elegido(p) ? null : { desde: p.desde, hasta: p.hasta }); },
            onMouseEnter: function (e) { mostrarTip(p, e); }, onFocus: function (e) { mostrarTip(p, e); }, onBlur: function () { setTip(null); } },
          hm ? h('div', { className: 'm tope', style: { height: hm } }) : null,
          hs ? h('div', { className: 's' + (hm ? '' : ' tope'), style: { height: hs } }) : null,
          hn ? h('div', { className: 'n', style: { bottom: base - hn, height: hn } }) : null);
      })),
    h('div', { className: 'h-ejes' }, h('span', null, p0 ? diaCorto(p0.desde, props.ahora) : ''), h('span', null, pN ? diaCorto(pN.hasta, props.ahora) : '')),
    tip ? h('div', { className: 'h-tip' + (tip.izq ? ' izq' : ''), role: 'tooltip', style: { left: tip.x, top: tip.y } },
      h('b', null, tituloPunto(tip.p, por, props.ahora)),
      tip.p.ventas ? [
        h('div', { key: 'v', className: 'fila' }, h('span', null, tip.p.ventas + (tip.p.ventas === 1 ? ' venta' : ' ventas')),
          h('span', { className: 'mono ' + claseSigno(tip.p.ganancia) }, signo(tip.p.ganancia) + ' cr')),
        h('div', { key: 's', className: 'fila tenue' }, h('span', null, 'Sniper'), h('span', { className: 'mono' }, signo(tip.p.sniper))),
        h('div', { key: 'm', className: 'fila tenue' }, h('span', null, 'Manual'), h('span', { className: 'mono' }, signo(tip.p.manual))),
        h('div', { key: 'e', className: 'fila tenue' }, h('span', null, 'Entró'), h('span', { className: 'mono' }, fmtCr(tip.p.entro) + ' cr')),
      ] : h('div', { className: 'tenue' }, 'Sin ventas'),
      tip.p.porAsignar ? h('div', { className: 'fila txt-azul' }, h('span', null, 'Por asignar'), h('span', { className: 'mono' }, tip.p.porAsignar)) : null) : null);
}

export function HistorialView(props) {
  var compras = props.compras || [];
  var listaKekos = props.kekos && props.kekos.disponible ? props.kekos.kekos || [] : [];
  var sF = useState(function () { return leerFiltros(); }); var filtros = sF[0]; var setFiltros = sF[1];
  var sA = useState(null); var abierta = sA[0]; var setAbierta = sA[1];
  var sM = useState(PAGINA); var mostrar = sM[0]; var setMostrar = sM[1];
  var sD = useState(false); var menuKekos = sD[0]; var setMenuKekos = sD[1];
  var sC = useState(null); var confirmacion = sC[0]; var setConfirmacion = sC[1];
  var sE = useState(false); var enviando = sE[0]; var setEnviando = sE[1];
  var sH = useState(56); var altoFiltros = sH[0]; var setAltoFiltros = sH[1];
  var refFiltros = useRef(null);
  var refMenu = useRef(null);
  // En vivo: las ventas que aparecen mientras miras se iluminan un momento.
  var vistas = useRef(null);
  var sN = useState(null); var nuevas = sN[0]; var setNuevas = sN[1];
  var ancho = useAlineado(MINIMO_COMPLETO);
  var compacto = !ancho.alineado;
  var ahora = Date.now();

  // Los filtros que dejaste se recuerdan en este equipo (no la busqueda ni el dia elegido).
  useEffect(function () { guardarFiltros(filtros); }, [filtros.rango, filtros.desde, filtros.hasta, (filtros.kekos || []).join('|'), filtros.origen, filtros.perdida, filtros.orden]);
  // Lo alto de la barra de filtros: los encabezados de los dias se quedan fijos justo debajo.
  useEffect(function () {
    var el = refFiltros.current;
    if (!el) return undefined;
    // Se mide ya (el observador no avisa mientras la ventana no se dibuja) y en cada cambio.
    setAltoFiltros(el.offsetHeight);
    if (!window.ResizeObserver) return undefined;
    var ro = new ResizeObserver(function () { setAltoFiltros(el.offsetHeight); });
    ro.observe(el);
    return function () { ro.disconnect(); };
  }, []);
  // El menu de kekos se cierra al hacer clic fuera o con Esc.
  useEffect(function () {
    if (!menuKekos) return undefined;
    function fuera(e) { if (refMenu.current && !refMenu.current.contains(e.target)) setMenuKekos(false); }
    function tecla(e) { if (e.key === 'Escape') setMenuKekos(false); }
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return function () { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [menuKekos]);

  // Las ventas por asignar: solo con la migracion 20261015000000 (si no, ninguna).
  var porAsignar = props.porAsignar && props.porAsignar.disponible ? props.porAsignar.ventas || [] : SIN_VENTAS;
  var filas = useMemo(function () { return filasHistorial(compras, porAsignar, props.furnis || []); }, [compras, porAsignar, props.furnis]);
  var filtradas = useMemo(function () { return filtrar(filas, filtros, Date.now()); }, [filas, filtros]);
  // El grafico ve todos los dias del rango (sin el dia elegido en el, para poder cambiarlo).
  var serie = useMemo(function () {
    var sinPeriodo = Object.assign({}, filtros, { periodo: null });
    return serieDiaria(filtrar(filas, sinPeriodo, Date.now()), sinPeriodo, Date.now());
  }, [filas, filtros]);
  useEffect(function () {
    var actuales = filas.map(function (x) { return x.clave; });
    if (vistas.current) {
      var llegaron = actuales.filter(function (c) { return !vistas.current.has(c); });
      if (llegaron.length) setNuevas(new Set(llegaron));
    }
    vistas.current = new Set(actuales);
  }, [filas]);
  useEffect(function () {
    if (!nuevas) return undefined;
    var t = setTimeout(function () { setNuevas(null); }, 3000);
    return function () { clearTimeout(t); };
  }, [nuevas]);
  var ordenadas = useMemo(function () { return ordenar(filtradas, filtros.orden); }, [filtradas, filtros.orden]);
  var m = useMemo(function () { return metricas(filtradas); }, [filtradas]);
  var kekosLista = useMemo(function () { return kekosDe(filas); }, [filas]);
  var nombresKekos = {};
  kekosLista.forEach(function (k) { nombresKekos[k.clave] = k.nombre; });
  var chips = activos(filtros, function (c) { return nombresKekos[c] || c; }, ahora);

  // Siempre sobre los filtros mas recientes (dos clics seguidos no se pisan).
  function cambiar(parche) {
    setFiltros(function (f) { return Object.assign({}, f, typeof parche === 'function' ? parche(f) : parche); });
    setMostrar(PAGINA);
  }
  function quitar(clave) { setFiltros(function (f) { return quitarFiltro(f, clave); }); setMostrar(PAGINA); }
  function elegirRango(r) {
    cambiar(function (f) {
      var parche = { rango: r, periodo: null };
      // «Fechas…» la primera vez: las dos ultimas semanas.
      if (r === 'propio' && !f.desde && !f.hasta) { parche.hasta = hoyDe(); parche.desde = sumarDias(parche.hasta, -13); }
      return parche;
    });
  }
  function alternarKeko(clave) {
    cambiar(function (f) {
      var ks = f.kekos || [];
      return { kekos: ks.indexOf(clave) !== -1 ? ks.filter(function (x) { return x !== clave; }) : ks.concat([clave]) };
    });
  }

  // El keko de una venta como lo muestran los bloques del Inventario.
  function kekoDe(nombre) {
    if (!nombre) return { nombre: null, origen: 'sin' };
    var k = listaKekos.find(function (x) { return claveKeko(x.nombre) === claveKeko(nombre); });
    return { nombre: nombre, origen: k ? k.origen : 'manual', snipers: k ? k.snipers : null };
  }
  function sniperDe(nombre) { var k = kekoDe(nombre); return k.snipers && k.snipers.length ? k.snipers.join(', ') : null; }

  function deshacer(x) {
    var l = x.lote;
    setConfirmacion({ titulo: 'Deshacer la venta', icono: 'undo', textoBoton: 'Deshacer venta', peligro: true,
      mensaje: h('span', null, '¿Deshacer la venta de ', h('b', null, x.cantidad + ' × ' + x.nombre), ' (lote Nº ' + l.id + ')? Las unidades vuelven a Publicado o a Comprado.',
        x.origen === 'sniper' ? h('span', { className: 'suave' }, ' La registró el Sniper: si la deshaces, no la vuelve a enviar.') : null),
      accion: function () {
        return API.post('/api/compras/' + l.id + '/revertir', {}).then(function (r) {
          if (r) { setAbierta(null); props.onCambio(r.fusionada ? 'Venta deshecha: las unidades volvieron a su lote' : 'Venta deshecha'); }
        });
      } });
  }
  // «Exportar CSV» de lo filtrado, en el orden del libro.
  function exportar() {
    var texto = csv(ordenadas);
    var nombre = nombreCsv();
    var n = ordenadas.length + (ordenadas.length === 1 ? ' venta' : ' ventas');
    var api = window.electronAPI;
    if (api && api.guardarCsv) {
      api.guardarCsv(nombre, texto).then(function (r) {
        if (r) props.onAviso('Guardado ' + r.nombre + ' con ' + n, { texto: 'Mostrar', fn: function () { api.mostrarArchivo(r.ruta); } });
      }).catch(function (e) { props.onError('No se pudo guardar el CSV: ' + (e && e.message ? e.message : e)); });
      return;
    }
    var url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    props.onAviso('Descargado ' + nombre + ' con ' + n + ' (lo que ves filtrado)');
  }
  function ejecutar(accion) {
    _submitGuard(enviando, setEnviando, function () { return accion().then(function () { setConfirmacion(null); }); });
  }

  var columnas = COLUMNAS.filter(function (c) { return !compacto || (c[0] !== 'keko' && c[0] !== 'precio'); });
  var nCol = columnas.length;

  // ── Una venta (y su detalle, si esta abierta), dentro de su barrera ──
  function filasVenta(x) {
    var abiertaEsta = abierta === x.clave;
    var k = kekoDe(x.keko);
    var asignar = x.tipo === 'por_asignar';
    var sub = asignar ? 'sin lote: no se sabe lo que costó'
      : x.moneda === 'lingos' ? 'tradeo en lingos' : x.mercadillo ? 'mercadillo · comisión ' + fmtCr(x.cantidad ? x.comision / x.cantidad : 0) + ' c/u' : 'tradeo o venta directa';
    var celdas = {
      hora: h('td', { key: 'hora' }, x.conHora ? h('span', { className: 'h-hora' }, horaDe(x.momento))
        : h('span', { className: 'h-hora sin', title: x.registro === 'excel' ? 'Importada del Excel: sin fecha ni hora' : 'Registrada a mano antes de la 1.9.0: solo se sabe el día' }, 'sin hora')),
      furni: h('td', { key: 'furni' }, h('div', { className: 'furni' },
        h(IconoFurni, { classname: x.classname, revision: x.revision, size: 32 }),
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'furni-linea' }, h('span', { className: 'furni-nombre', title: x.nombre }, x.nombre), x.numero_ltd ? h(EtiquetaLtd, { numero: x.numero_ltd }) : null),
          h('div', { className: 'furni-sub' }, compacto ? (k.origen === 'sin' ? 'Sin keko' : k.nombre) + ' · ' + sub : sub)))),
      keko: h('td', { key: 'keko' }, h('span', { className: 'h-keko' }, h(AvatarKeko, { keko: k, tam: 20 }), h('span', null, k.origen === 'sin' ? 'Sin keko' : k.nombre))),
      cant: h('td', { key: 'cant', className: 'r mono' }, x.cantidad),
      precio: h('td', { key: 'precio', className: 'r mono' }, x.precio === null ? '-' : fmtLg(x.precio), x.moneda === 'lingos' ? h('span', { className: 'tenue' }, ' lg') : null),
      entro: h('td', { key: 'entro', className: 'r mono' + (asignar ? ' tenue' : ''), title: asignar ? 'Lo que entró, pero sin lote todavía: no suma en los totales' : null }, fmtCr(x.entro)),
      ganancia: h('td', { key: 'ganancia', className: 'r mono ' + claseSigno(x.ganancia) }, x.ganancia === null ? h('span', { className: 'tenue' }, '—')
        : [h('b', { key: 'g' }, signo(x.ganancia)), x.margen !== null ? h('div', { key: 'm', className: 'h-margen' }, fmtPct(x.margen)) : null]),
      origen: h('td', { key: 'origen' }, asignar
        ? h('span', { className: 'tag tag-asignar', title: 'Venta del Sniper que aún no tiene lote' }, h(Ico, { name: 'radar', size: 11 }), 'Por asignar')
        : x.origen === 'sniper'
        ? h('span', { className: 'tag tag-sniper' }, h(Ico, { name: 'radar', size: 11 }), 'Sniper')
        : h('span', { className: 'tag tag-manual' }, h(Ico, { name: 'user', size: 11 }), 'Manual')),
    };
    var tr = [h('tr', { key: x.clave, className: 'fila venta' + (asignar ? ' asignar' : '') + (abiertaEsta ? ' abierta' : '') + (nuevas && nuevas.has(x.clave) ? ' nueva' : ''),
        onClick: function () { setAbierta(abiertaEsta ? null : x.clave); } },
      columnas.map(function (c) { return celdas[c[0]]; }))];
    if (abiertaEsta) tr.push(h('tr', { key: x.clave + '-d' }, h('td', { colSpan: nCol, className: 'detalle' + (asignar ? ' asignar' : '') }, asignar ? detallePorAsignar(x, k) : detalleVenta(x, k))));
    return tr;
  }

  function dato(etiqueta, valor) { return h('div', { key: etiqueta }, h('div', { className: 'dato-l' }, etiqueta), h('div', { className: 'dato-v' }, valor)); }
  function detalleVenta(x, k) {
    var l = x.lote;
    var costoU = x.cantidad && x.costo !== null ? x.costo / x.cantidad : null;
    var registrada = x.registro === 'sniper' ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Ico, { name: 'radar', size: 13, color: 'var(--green)' }),
        'El Sniper' + (sniperDe(x.keko) ? ' · ' + sniperDe(x.keko) : ''))
      : x.registro === 'excel' ? 'Importada del Excel' : x.registro === 'antigua' ? 'Tú (antes de la 1.9.0)' : 'Tú';
    var estuvo = x.publicadoMs !== null ? duracion(x.publicadoMs) + ' antes de venderse'
      : l.publicado_en ? 'sí (sin la hora exacta de la venta)' : null;
    return [
      h('div', { key: 'g', className: 'detalle-grid' },
        dato('Lote', 'Nº ' + l.id + (x.origen_id ? ' · dividido del Nº ' + x.origen_id : '')),
        compacto ? dato('Keko', k.origen === 'sin' ? 'Sin keko' : k.nombre) : null,
        dato('Precio de venta', x.precio === null ? '-' : fmtLg(x.precio) + (x.moneda === 'lingos' ? ' lingos (≈ ' + fmtCr(x.cantidad ? x.entro / x.cantidad : 0) + ' cr)' : ' cr') + ' c/u'),
        dato('Comisión de Habbo', x.mercadillo ? fmtCr(x.comision) + ' cr' : 'sin comisión'),
        dato('Entró', fmtCr(x.entro) + ' cr'),
        dato('Costo', costoU === null ? '-' : fmtLg(Math.round(costoU * 100) / 100) + ' cr c/u · ' + fmtCr(x.costo) + ' cr'),
        dato('Ganancia', x.ganancia === null ? '-' : h('span', { className: claseSigno(x.ganancia) }, signo(x.ganancia) + ' cr' + (x.margen !== null ? ' · ' + fmtPct(x.margen) : ''))),
        estuvo ? dato('Estuvo publicado', estuvo) : null,
        dato('Registrada por', registrada),
        dato('Cuándo', x.dia ? tituloDia(x.dia, ahora) + (x.conHora ? ' · ' + horaDe(x.momento) : ' · sin hora') : 'Sin fecha')),
      l.notas ? h('div', { key: 'n', className: 'suave', style: { fontSize: 12, marginBottom: 10 } }, l.notas) : null,
      h('div', { key: 'b', style: { display: 'flex', gap: 8 } },
        h('button', { className: 'btn btn-chico', onClick: function (e) { e.stopPropagation(); props.onVerEnInventario(l); },
          title: 'Abre Inventario › Vendido en el bloque de este keko, con este lote abierto' }, h(Ico, { name: 'ir', size: 12 }), 'Ver en el Inventario'),
        h('button', { className: 'btn btn-chico btn-peligro', onClick: function (e) { e.stopPropagation(); deshacer(x); }, disabled: enviando },
          h(Ico, { name: 'undo', size: 12 }), 'Deshacer venta')),
    ];
  }

  // Una venta del Sniper sin lote: lo que se sabe de ella y «Asignar a un lote…» (el mismo
  // modal de Inventario › Por asignar; si no hay lote posible, alli se puede descartar).
  function detallePorAsignar(x, k) {
    return [
      h('div', { key: 'g', className: 'detalle-grid' },
        dato('Vendido a', fmtCr(x.precio) + ' cr (precio de lista)'),
        dato('Entró', fmtCr(x.entro) + ' cr · comisión ' + fmtCr(x.comision)),
        compacto ? dato('Keko', k.nombre || 'Sin keko') : null,
        dato('Registrada por', h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Ico, { name: 'radar', size: 13, color: 'var(--blue)' }),
          'El Sniper' + (sniperDe(x.keko) ? ' · ' + sniperDe(x.keko) : ''))),
        dato('Cuándo', x.dia ? tituloDia(x.dia, ahora) + ' · ' + horaDe(x.momento) : 'Sin fecha')),
      h('div', { key: 'm', className: 'aviso h-motivo' }, h(Ico, { name: 'radar', size: 14 }),
        h('span', null, h('b', null, 'Por qué no se asignó: '), x.motivo || 'No se encontró un lote publicado con el que casar.')),
      h('div', { key: 'b', style: { display: 'flex', gap: 8 } },
        h('button', { className: 'btn btn-chico btn-verde', onClick: function (e) { e.stopPropagation(); props.onAsignarVenta(x.venta); } },
          h(Ico, { name: 'check', size: 12, sw: 2.4 }), 'Asignar a un lote…')),
    ];
  }

  // ── El libro ──
  var visibles = ordenadas.slice(0, mostrar);
  var faltan = ordenadas.length - visibles.length;
  var cuerpo;
  if (filtros.orden === 'fecha') {
    // Por dia (decision 5): los subtotales son del dia entero, aunque se vean solo las primeras.
    var restantes = mostrar;
    cuerpo = [];
    porDia(ordenadas).forEach(function (d) {
      if (restantes <= 0) return;
      var aqui = d.filas.slice(0, restantes);
      restantes -= aqui.length;
      cuerpo.push(h(Barrera, { key: 'd' + (d.dia || 'sin'), tipo: 'fila', columnas: nCol, etiqueta: 'El día ' + (d.dia || 'sin fecha'), donde: 'Historial › ' + (d.dia || 'sin fecha'), onVerErrores: props.onVerErrores },
        h(Dibujar, { dibujar: function () {
          return [h('tr', { key: 'cab', className: 'h-dia' }, h('td', { colSpan: nCol },
              h('div', { className: 'h-dia-in' },
                h('b', null, d.dia ? tituloDia(d.dia, ahora) : 'Sin fecha · importadas del Excel'),
                h('span', { className: 'h-dia-tot' },
                  d.porAsignar ? h('span', { className: 'txt-azul' }, d.porAsignar + ' por asignar') : null,
                  h('span', null, d.ventas + (d.ventas === 1 ? ' venta' : ' ventas')),
                  h('span', null, 'entró ', h('span', { className: 'mono' }, fmtCr(d.entro))),
                  h('span', null, 'ganancia ', h('span', { className: 'mono ' + claseSigno(d.ganancia) }, signo(d.ganancia)))))))]
            .concat(aqui.map(function (x) {
              return h(Barrera, { key: x.clave, tipo: 'fila', columnas: nCol, etiqueta: x.tipo === 'por_asignar' ? 'La venta por asignar Nº ' + x.id : 'La venta del lote Nº ' + x.id, donde: 'Historial › ' + (x.tipo === 'por_asignar' ? 'por asignar' : 'venta') + ' Nº ' + x.id, onVerErrores: props.onVerErrores },
                h(Dibujar, { dibujar: function () { return filasVenta(x); } }));
            }));
        } })));
    });
  } else {
    cuerpo = visibles.map(function (x) {
      return h(Barrera, { key: x.clave, tipo: 'fila', columnas: nCol, etiqueta: x.tipo === 'por_asignar' ? 'La venta por asignar Nº ' + x.id : 'La venta del lote Nº ' + x.id, donde: 'Historial › ' + (x.tipo === 'por_asignar' ? 'por asignar' : 'venta') + ' Nº ' + x.id, onVerErrores: props.onVerErrores },
        h(Dibujar, { dibujar: function () { return filasVenta(x); } }));
    });
  }

  var hayVentas = filas.length > 0;
  var etiquetaKekos = !(filtros.kekos || []).length ? 'Todos los kekos'
    : filtros.kekos.length === 1 ? (filtros.kekos[0] ? nombresKekos[filtros.kekos[0]] || filtros.kekos[0] : 'Sin keko') : filtros.kekos.length + ' kekos';

  return h('div', { className: 'contenedor fade-in historial', style: { '--alto-filtros': altoFiltros + 'px' } },
    h(Tarjetas, { m: m }),
    hayVentas ? h(Barrera, { tipo: 'bloque', etiqueta: 'El gráfico', donde: 'Historial › gráfico', onVerErrores: props.onVerErrores },
      h(Grafico, { serie: serie, periodo: filtros.periodo, ahora: ahora, onElegir: function (p) { cambiar({ periodo: p }); } })) : null,

    // ── Filtros (fijos al bajar) ──
    h('div', { className: 'h-filtros', ref: refFiltros },
      h('div', { className: 'h-buscar' },
        h(Ico, { name: 'search', size: 15 }),
        h('input', { className: 'inp', placeholder: 'Buscar furni…', value: filtros.q || '', onChange: function (e) { cambiar({ q: e.target.value }); } })),
      h('div', { className: 'h-grupo' }, RANGOS.map(function (r) {
        return h('button', { key: r[0], className: 'chip' + (!filtros.periodo && filtros.rango === r[0] ? ' activo' : ''), onClick: function () { elegirRango(r[0]); } }, r[1]);
      })),
      filtros.rango === 'propio' && !filtros.periodo ? h('span', { className: 'h-propio' }, 'del ',
        h('input', { type: 'date', className: 'inp h-fecha', value: filtros.desde || '', max: filtros.hasta || undefined, onChange: function (e) { cambiar({ desde: e.target.value || null }); } }),
        ' al ',
        h('input', { type: 'date', className: 'inp h-fecha', value: filtros.hasta || '', min: filtros.desde || undefined, onChange: function (e) { cambiar({ hasta: e.target.value || null }); } })) : null,
      h('div', { className: 'h-drop' + (menuKekos ? ' abierto' : ''), ref: refMenu },
        h('button', { className: 'chip' + ((filtros.kekos || []).length ? ' activo' : ''), 'aria-expanded': menuKekos, onClick: function () { setMenuKekos(!menuKekos); } },
          h(Ico, { name: 'user', size: 12 }), etiquetaKekos, h(Ico, { name: 'chevdown', size: 12 })),
        menuKekos ? h('div', { className: 'h-drop-menu' },
          kekosLista.length ? kekosLista.map(function (k) {
            var dentro = (filtros.kekos || []).indexOf(k.clave) !== -1;
            return h('label', { key: k.clave || '(sin)', className: 'h-drop-op' },
              h('input', { type: 'checkbox', checked: dentro, onChange: function () { alternarKeko(k.clave); } }),
              h(AvatarKeko, { keko: kekoDe(k.nombre), tam: 22 }),
              h('span', { className: 'h-drop-nom' }, k.clave ? k.nombre : 'Sin keko'),
              h('span', { className: 'h-drop-n mono' }, k.ventas));
          }) : h('div', { className: 'tenue', style: { padding: 8, fontSize: 12 } }, 'Aún no hay ventas.'),
          h('div', { className: 'h-drop-pie' },
            h('button', { onClick: function () { cambiar({ kekos: [] }); } }, 'Todos'),
            h('button', { onClick: function () { setMenuKekos(false); } }, 'Listo'))) : null),
      h('div', { className: 'h-seg' }, ORIGENES.map(function (o) {
        return h('button', { key: o[0], className: (filtros.origen === o[0] ? 'on ' : '') + o[0], onClick: function () { cambiar({ origen: o[0] }); } },
          o[2] ? h(Ico, { name: o[2], size: 11 }) : null, o[1]);
      })),
      h('button', { className: 'chip rojo' + (filtros.perdida ? ' activo' : ''), title: 'Solo las ventas que dejaron pérdida', onClick: function () { cambiar({ perdida: !filtros.perdida }); } }, 'Con pérdida')),
    chips.length ? h('div', { className: 'h-activos' }, 'Filtros:',
      chips.map(function (c) {
        return h('span', { key: c.clave, className: 'h-activo' }, c.texto,
          h('button', { title: 'Quitar', 'aria-label': 'Quitar ' + c.texto, onClick: function () { quitar(c.clave); } }, h(Ico, { name: 'x', size: 12 })));
      }),
      h('button', { className: 'btn btn-chico', onClick: function () { quitar('todo'); } }, h(Ico, { name: 'trash', size: 12 }), 'Limpiar')) : null,

    // ── El libro ──
    h('div', { className: 'h-libro', ref: ancho.ref },
      h('div', { className: 'h-libro-cab' },
        h('span', null, h('b', null, fmtCr(ordenadas.length) + (ordenadas.length === 1 ? ' venta' : ' ventas')), ' · ' + TEXTO_ORDEN[filtros.orden]),
        h('button', { className: 'btn btn-chico h-csv', onClick: exportar, disabled: !ordenadas.length, title: 'Guardar las ventas de este filtro en un archivo para Excel' },
          h(Ico, { name: 'download', size: 13 }), 'Exportar CSV')),
      !ordenadas.length
        ? h('div', { className: 'vacio' }, h(Ico, { name: hayVentas ? 'search' : 'recibo', size: 22, color: 'var(--text3)' }),
            h('div', { style: { marginTop: 6 } }, hayVentas ? 'Ninguna venta con estos filtros.' : 'Aún no hay ventas. Cuando vendas algo (o lo registre el Sniper), aparecerá aquí.'),
            hayVentas && chips.length ? h('button', { className: 'btn btn-chico', style: { marginTop: 10 }, onClick: function () { quitar('todo'); } }, 'Limpiar filtros') : null)
        : h('table', { className: 'tabla h-tabla' },
            h(Columnas, { anchos: columnas.map(function (c) { return c[2]; }) }),
            h('thead', null, h('tr', null, columnas.map(function (c) {
              var r = c[0] === 'cant' || c[0] === 'precio' || c[0] === 'entro' || c[0] === 'ganancia';
              if (!c[3]) return h('th', { key: c[0], className: r ? 'r' : null }, c[1]);
              var on = filtros.orden === c[3];
              return h('th', { key: c[0], className: 'h-orden' + (on ? ' on' : '') + (r ? ' r' : ''), onClick: function () { cambiar({ orden: c[3] }); },
                title: on ? null : 'Ordenar ' + TEXTO_ORDEN[c[3]], 'aria-sort': on ? 'descending' : 'none' }, c[1] + (on ? ' ↓' : ''));
            }))),
            h('tbody', null, cuerpo)),
      ordenadas.length ? h('div', { className: 'h-mas' }, 'Mostrando ' + fmtCr(visibles.length) + ' de ' + fmtCr(ordenadas.length),
        faltan > 0 ? h('button', { className: 'btn btn-chico', onClick: function () { setMostrar(mostrar + PAGINA); } }, 'Ver ' + Math.min(PAGINA, faltan) + ' más') : null) : null),

    h('div', { className: 'tenue', style: { fontSize: 12, marginTop: 8 } },
      'Desde la 1.9.0, las ventas que registras a mano guardan la hora en que las registras (si son del día). Las anteriores solo tienen el día («sin hora»). La ganancia ya descuenta la comisión del mercadillo de Habbo.es.'),
    confirmacion ? h(Confirmar, Object.assign({}, confirmacion, { enviando: enviando,
      onClose: function () { setConfirmacion(null); }, onConfirmar: function () { ejecutar(confirmacion.accion); } })) : null);
}
