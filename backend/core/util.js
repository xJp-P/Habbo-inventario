// backend/core/util.js — helpers puros compartidos por rutas, servicios y scripts.
//
// `hoyStr` y `ClientError` vienen heredados de Proyecto_Cartera (backend/core/util.js y
// errors.js) con la misma semantica: fecha LOCAL (no UTC) y "4xx => BD intacta".

// Fecha local (no UTC) en formato AAAA-MM-DD.
function hoyStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Error de validacion -> respuesta 4xx. Se valida LANZANDO antes de escribir nada.
class ClientError extends Error {
  constructor(message, code) { super(message); this.code = code || 400; }
}

// Minusculas, sin tildes ni espacios extra: "Árbol  Sakura" -> "arbol sakura".
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const MONEDAS = ['creditos', 'lingos'];

// Acepta "Créditos", "creditos", "Lingos"... y devuelve el codigo interno.
function monedaDesdeTexto(v, porDefecto = 'creditos') {
  const n = normalizar(v);
  if (!n) return porDefecto;
  if (n.startsWith('lingo')) return 'lingos';
  if (n.startsWith('credito')) return 'creditos';
  throw new ClientError(`Moneda no valida: "${v}". Usa Creditos o Lingos.`);
}

function numeroValido(v, { campo, minimo = 0, entero = false, opcional = false } = {}) {
  if (v === null || v === undefined || v === '') {
    if (opcional) return null;
    throw new ClientError(`Falta ${campo}.`);
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new ClientError(`${campo} debe ser un numero.`);
  if (n < minimo) throw new ClientError(`${campo} debe ser mayor o igual a ${minimo}.`);
  if (entero && !Number.isInteger(n)) throw new ClientError(`${campo} debe ser un numero entero.`);
  return n;
}

// Distancia de edicion (Levenshtein) con dos filas; suficiente para nombres cortos.
function distancia(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// Parecido 0..1 entre dos textos ya normalizados, ignorando espacios.
function parecido(a, b) {
  const x = a.replace(/ /g, '');
  const y = b.replace(/ /g, '');
  const max = Math.max(x.length, y.length);
  return max === 0 ? 1 : 1 - distancia(x, y) / max;
}

// Donde fallo un error inesperado, para el informe de errores de la interfaz (v1.6.1):
// las primeras lineas de la pila con la ruta recortada desde backend/, electron/ o
// node_modules/ (sin la carpeta de instalacion, que lleva el nombre del usuario).
function rastro(err, lineas = 3) {
  if (!err || !err.stack) return null;
  const pila = String(err.stack).split('\n').slice(1).map((l) => l.trim()).filter((l) => l.startsWith('at '));
  if (!pila.length) return null;
  return pila.slice(0, lineas).map((l) => {
    const m = l.match(/[\\/](backend|electron|node_modules|scripts)[\\/]/);
    if (!m) return l;
    // La ruta empieza tras el ultimo «(» o tras «at » / «at async » (puede tener espacios).
    const parentesis = l.lastIndexOf('(', m.index);
    const inicio = parentesis >= 0 ? parentesis + 1 : l.startsWith('at async ') ? 9 : 3;
    return l.slice(0, inicio) + l.slice(m.index + 1).replace(/\\/g, '/');
  }).join('\n');
}

module.exports = { hoyStr, ClientError, normalizar, MONEDAS, monedaDesdeTexto, numeroValido, distancia, parecido, rastro };
