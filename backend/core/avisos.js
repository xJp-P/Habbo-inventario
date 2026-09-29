// backend/core/avisos.js — cuando merece una notificacion del sistema lo que llega en vivo
// (la foto del inventario de un sniper o un catalogo nuevo de Habbo.es) y con que texto.
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

module.exports = { crearDetectorAuditoria, avisoCatalogo, diferencias };
