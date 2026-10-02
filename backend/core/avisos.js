// backend/core/avisos.js — cuando merece una notificacion del sistema lo que llega en vivo
// (la foto del inventario de un sniper, un catalogo nuevo de Habbo.es o las ventas que
// registra el Sniper) y con que texto.
// Sin Electron ni base de datos, para que npm run verificar lo pruebe; el servidor lo usa
// al recibir la foto (migracion 20261011000000) y el proceso principal solo muestra.
//
// El Sniper reenvia la foto tras cada tanda de eventos, asi que casi siempre llega igual.
// Por eso se avisa solo de diferencias NUEVAS de la Auditoria (las del numero del menu:
// sobrantes, faltantes y LTD con otro numero):
//   - un furni que antes cuadraba y ahora no, o cuya diferencia crecio;
//   - resolver diferencias (o que se achiquen) no avisa;
//   - lo que ya habia al abrir la app es la base: no se avisa;
//   - dentro de los 2 minutos siguientes a un aviso de ese keko, el nuevo va sin sonido
//     (reemplaza al anterior en pantalla).

const CATEGORIAS = { sobrante: 'con sobrantes', faltante: 'con faltantes', ltd: 'LTD con otro número' };
const SIN_SONIDO_MS = 2 * 60 * 1000;

function pl(n, uno, varios) { return n === 1 ? uno : varios; }

// furni -> tamaño de su diferencia, solo de lo que cuenta en el menu.
function diferencias(filas) {
  const m = new Map();
  for (const f of filas || []) {
    if (!CATEGORIAS[f.categoria]) continue;
    m.set(f.categoria + ':' + f.tipo + ':' + f.sprite_id, Math.abs(Number(f.diferencia) || 0) || 1);
  }
  return m;
}

function textoAuditoria(keko, nuevas) {
  const cuenta = {};
  for (const clave of nuevas) { const c = clave.split(':')[0]; cuenta[c] = (cuenta[c] || 0) + 1; }
  const partes = Object.keys(CATEGORIAS).filter((c) => cuenta[c]).map((c) => cuenta[c] + ' ' + CATEGORIAS[c]);
  const detalle = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes[0];
  const n = nuevas.length;
  return {
    titulo: 'Auditoría de ' + keko,
    cuerpo: n + pl(n, ' furni tiene una diferencia nueva', ' furnis tienen diferencias nuevas') + ' en tu inventario de Habbo (' + detalle + '). Haz clic para revisarlas.',
    breve: 'Auditoría de ' + keko + ': ' + n + pl(n, ' furni con una diferencia nueva', ' furnis con diferencias nuevas'),
  };
}

function crearDetectorAuditoria({ sinSonidoMs = SIN_SONIDO_MS, ahora = () => Date.now() } = {}) {
  const vistas = new Map();       // keko -> diferencias ya conocidas
  const ultimoAviso = new Map();  // keko -> hora del ultimo aviso

  // Lo que ya hay (al abrir la app o al iniciar sesion): no se avisa.
  function base(keko, filas) { vistas.set(keko, diferencias(filas)); }

  // Aviso por las diferencias nuevas de un keko, o null.
  function revisar(keko, filas) {
    const antes = vistas.get(keko) || new Map();
    const ahoraDif = diferencias(filas);
    vistas.set(keko, ahoraDif);
    const nuevas = [...ahoraDif].filter(([clave, n]) => !antes.has(clave) || n > antes.get(clave)).map(([clave]) => clave);
    if (!nuevas.length) return null;
    const t = ahora();
    const silencioso = ultimoAviso.has(keko) && t - ultimoAviso.get(keko) < sinSonidoMs;
    ultimoAviso.set(keko, t);
    return { keko, nuevas: nuevas.length, pendientes: ahoraDif.size, silencioso, ...textoAuditoria(keko, nuevas) };
  }

  function reiniciar() { vistas.clear(); ultimoAviso.clear(); }
  return { base, revisar, reiniciar };
}

// Catalogo nuevo de Habbo.es: solo si trae furnis que antes no estaban (una version que
// solo cambia iconos no merece aviso).
function avisoCatalogo({ anterior, version, nuevos }) {
  if (!anterior || anterior === version || !(nuevos > 0)) return null;
  return {
    titulo: 'Catálogo de Habbo.es al día',
    cuerpo: nuevos + pl(nuevos, ' furni nuevo llegó', ' furnis nuevos llegaron') + ' al catálogo. Ya puedes buscarlos en la app.',
  };
}

// ── Ventas del Sniper (migracion 20261015000000) ──
// Un aviso por keko y por rafaga: «Vendido en Ux_Data» con lo vendido y la ganancia, o
// «Venta por asignar» si la base no supo de que lote salio (al hacer clic se abre la
// bandeja). Dentro de los 2 minutos siguientes a un aviso de ese keko, el nuevo va sin
// sonido (reemplaza al anterior en pantalla).
const MAX_LINEAS = 3;

function cifra(n) { return new Intl.NumberFormat('es-CO').format(Math.round(n)); }

function nombreVenta(v) {
  const base = v.nombre || (v.sprite_id ? 'un furni sin registrar (sprite ' + v.sprite_id + ')' : 'un furni');
  return base + (v.numero_ltd ? ' #' + v.numero_ltd : '');
}

// «2 × Corona Estrella y 1 × Cama Criogénica Negra #1475» (las mas vendidas primero).
function listaVentas(ventas) {
  const m = new Map();
  for (const v of ventas) { const k = nombreVenta(v); m.set(k, (m.get(k) || 0) + 1); }
  const partes = [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => n + ' × ' + k);
  if (partes.length > MAX_LINEAS) {
    const resto = partes.length - MAX_LINEAS + 1;
    return partes.slice(0, MAX_LINEAS - 1).join(', ') + ' y ' + resto + ' furnis más';
  }
  return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes[0];
}

function textoGanancia(ventas) {
  const conocidas = ventas.filter((v) => v.ganancia_cr !== null && v.ganancia_cr !== undefined && !isNaN(Number(v.ganancia_cr)));
  if (!conocidas.length) return '';
  const g = conocidas.reduce((s, v) => s + Number(v.ganancia_cr), 0);
  return g >= 0 ? ' · +' + cifra(g) + ' cr de ganancia' : ' · ' + cifra(-g) + ' cr de pérdida';
}

// El aviso de las ventas de UN keko.
function avisoVentasKeko(keko, ventas) {
  const casadas = ventas.filter((v) => !v.por_asignar);
  const pendientes = ventas.filter((v) => v.por_asignar);
  const n = ventas.length;
  const destino = { vista: 'inventario', filtro: pendientes.length ? 'por_asignar' : 'vendido', keko };
  if (!casadas.length) {
    const una = n === 1;
    return {
      keko, destino, ventas: n, por_asignar: n,
      titulo: una ? 'Venta por asignar en ' + keko : n + ' ventas por asignar en ' + keko,
      cuerpo: listaVentas(pendientes) + (una ? ' a ' + cifra(pendientes[0].precio) + ' cr: no se supo de qué lote salió. Ábrela para asignarla.'
        : ': no se supo de qué lote salieron. Ábrelas para asignarlas.'),
    };
  }
  const detalle = casadas.length === 1 && n === 1 ? ' a ' + cifra(casadas[0].precio) + ' cr' : '';
  const resto = pendientes.length ? ' · ' + pendientes.length + (pendientes.length === 1 ? ' quedó por asignar' : ' quedaron por asignar') : '';
  return {
    keko, destino, ventas: n, por_asignar: pendientes.length,
    titulo: n === 1 ? 'Vendido en ' + keko : 'Vendido en ' + keko + ': ' + n + ' ventas',
    cuerpo: listaVentas(casadas) + detalle + textoGanancia(casadas) + resto,
  };
}

function crearAvisosVentas({ sinSonidoMs = SIN_SONIDO_MS, ahora = () => Date.now() } = {}) {
  const ultimoAviso = new Map();   // keko -> hora del ultimo aviso
  // ventas: [{ keko, nombre, sprite_id, numero_ltd, precio, ganancia_cr, por_asignar }]
  function avisar(ventas) {
    const porKeko = new Map();
    for (const v of ventas || []) {
      const k = v.keko || 'tu keko';
      if (!porKeko.has(k)) porKeko.set(k, []);
      porKeko.get(k).push(v);
    }
    const t = ahora();
    return [...porKeko].map(([keko, lista]) => {
      const silencioso = ultimoAviso.has(keko) && t - ultimoAviso.get(keko) < sinSonidoMs;
      ultimoAviso.set(keko, t);
      return { ...avisoVentasKeko(keko, lista), silencioso };
    });
  }
  return { avisar };
}

module.exports = { crearDetectorAuditoria, avisoCatalogo, diferencias, crearAvisosVentas };
