// backend/services/furnidata.js — catalogo oficial de furnis de Habbo.es.
//
// REGLA DEL PROYECTO: la unica fuente de datos es el hotel Habbo.es. No hay soporte,
// calculo ni datos de Habbo Origins. `validarFuente` lo hace cumplir en codigo: cualquier
// URL de furnidata que no sea de www.habbo.es se rechaza.
//
// FLUJO:
//  1. Al arrancar se lee la cache local (furnidata-es.json en la carpeta de datos).
//  2. Si no hay cache, se descarga en primer plano. Si la hay, CADA VEZ que se abre la app
//     (y cada 6 h mientras siga abierta) se busca en segundo plano si Habbo.es publico un
//     catalogo nuevo, sin bloquear la app ni avisar: el boton de Ajustes ya no hace falta.
//  3. La URL oficial redirige a una URL versionada (.../furnidata_json/<hash>). Ese hash
//     es la "version": basta leer la redireccion (unos bytes) para saber si cambio; solo
//     entonces se descarga y se procesa el catalogo entero.
//
// ICONOS: https://images.habbo.com/dcr/hof_furni/<revision>/<classname>_icon.png, donde
// el "*" de las variantes de color se escribe "_" (rare_fountain*7 -> rare_fountain_7).
// Se guardan en disco la primera vez que se piden: despues cargan sin internet.

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { normalizar, parecido } = require('../core/util');

const URL_FURNIDATA = 'https://www.habbo.es/gamedata/furnidata_json/1';
const HOST_PERMITIDO = 'www.habbo.es';
const URL_ICONOS = 'https://images.habbo.com/dcr/hof_furni';
const REVISION_MS = 6 * 60 * 60 * 1000;
const ARCHIVO_CACHE = 'furnidata-es.json';
// v2 agrega el id numerico (sprite id) de cada furni, que es como lo identifican los
// paquetes del juego que lee G-Earth. Una cache de formato viejo se refresca sola.
const FORMATO_CACHE = 2;

// Habbo.es rechaza clientes sin cabeceras de navegador (error 463).
const CABECERAS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,image/png,*/*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

function validarFuente(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== HOST_PERMITIDO) {
    throw new Error(`Fuente de furnidata no permitida: ${u.hostname}. Solo se admite ${HOST_PERMITIDO}.`);
  }
}

// GET con redirecciones y descompresion. Devuelve { buffer, urlFinal, tipo }.
function descargar(url, { redirecciones = 5, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: CABECERAS }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirecciones <= 0) return reject(new Error('Demasiadas redirecciones'));
        const siguiente = new URL(headers.location, url).href;
        return resolve(descargar(siguiente, { redirecciones: redirecciones - 1, timeoutMs }));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} al descargar ${url}`));
      }
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        try {
          let buffer = Buffer.concat(partes);
          const enc = headers['content-encoding'];
          if (enc === 'gzip') buffer = zlib.gunzipSync(buffer);
          else if (enc === 'br') buffer = zlib.brotliDecompressSync(buffer);
          else if (enc === 'deflate') buffer = zlib.inflateSync(buffer);
          resolve({ buffer, urlFinal: url, tipo: headers['content-type'] || '' });
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
  });
}

// La version publicada del catalogo SIN descargarlo: la URL oficial redirige a la
// versionada y basta con leer esa redireccion. null si no redirige (se descarga entero).
function versionRemota({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(URL_FURNIDATA, { headers: CABECERAS }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        const destino = new URL(headers.location, URL_FURNIDATA).href;
        try { validarFuente(destino); } catch (e) { return reject(e); }
        return resolve(destino.split('/').pop() || null);
      }
      res.destroy();
      resolve(null);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
  });
}

function nombreArchivoIcono(classname) {
  return String(classname).replace(/\*/g, '_');
}

function urlIcono(classname, revision) {
  if (!classname || !revision) return null;
  return `${URL_ICONOS}/${revision}/${nombreArchivoIcono(classname)}_icon.png`;
}

// Furnidata crudo -> lista compacta { i, c, n, r, t, cat, linea }.
function compactar(json) {
  const salida = [];
  const agregar = (lista, tipo) => {
    for (const f of (lista || [])) {
      const nombre = String(f.name || '').trim();
      if (!f.classname || !nombre) continue;
      salida.push({ i: f.id, c: f.classname, n: nombre, r: f.revision || null, t: tipo, cat: f.category || null, linea: f.furniline || null });
    }
  };
  agregar(json && json.roomitemtypes && json.roomitemtypes.furnitype, 'suelo');
  agregar(json && json.wallitemtypes && json.wallitemtypes.furnitype, 'pared');
  if (salida.length < 1000) throw new Error('El furnidata descargado parece incompleto');
  return salida;
}

// Variantes NFT al final cuando varios furnis comparten nombre.
function penalizacion(item) {
  return item.c.startsWith('nft_') ? 1 : 0;
}

function crearServicioFurnidata({ dirDatos, log = () => {}, alActualizar = null } = {}) {
  const rutaCache = path.join(dirDatos, ARCHIVO_CACHE);
  const dirIconos = path.join(dirDatos, 'iconos');

  let lista = [];                 // items compactos + nn (nombre normalizado)
  let porClassname = new Map();
  let porNombre = new Map();      // nombre normalizado -> [items]
  let porSprite = new Map();      // 'suelo:1234' | 'pared:4001' -> item
  let meta = { version: null, descargadoEn: null, total: 0, formato: null };
  let ultimoError = null;
  let enCurso = null;
  let revision = null;
  const iconosEnCurso = new Map();

  function indexar(items, nuevaMeta) {
    lista = items.map((it) => ({ ...it, nn: normalizar(it.n) }));
    porClassname = new Map(lista.map((it) => [it.c, it]));
    // Suelo y pared tienen numeraciones independientes: la clave lleva el tipo.
    porSprite = new Map(lista.filter((it) => it.i !== undefined).map((it) => [`${it.t}:${it.i}`, it]));
    porNombre = new Map();
    for (const it of lista) {
      if (!porNombre.has(it.nn)) porNombre.set(it.nn, []);
      porNombre.get(it.nn).push(it);
    }
    for (const grupo of porNombre.values()) grupo.sort((a, b) => penalizacion(a) - penalizacion(b));
    meta = { ...nuevaMeta, total: lista.length };
  }

  function cargarCache() {
    try {
      const datos = JSON.parse(fs.readFileSync(rutaCache, 'utf8'));
      indexar(datos.furnis, { version: datos.version, descargadoEn: datos.descargadoEn, formato: datos.formato || 1 });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function actualizar({ forzar = false } = {}) {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      try {
        validarFuente(URL_FURNIDATA);
        const ahora = new Date().toISOString();
        // Revision silenciosa: si la version publicada es la que ya hay, no se descarga.
        if (!forzar && lista.length && meta.formato === FORMATO_CACHE && meta.version &&
            (await versionRemota()) === meta.version) {
          meta.descargadoEn = ahora;
          guardarCache(lista.map(({ nn, ...it }) => it));
          ultimoError = null;
          return estado();
        }
        log('Descargando furnidata de Habbo.es...');
        const { buffer, urlFinal } = await descargar(URL_FURNIDATA);
        validarFuente(urlFinal);
        const version = urlFinal.split('/').pop();
        if (!forzar && version && version === meta.version && meta.formato === FORMATO_CACHE && lista.length) {
          meta.descargadoEn = ahora;
          guardarCache(lista.map(({ nn, ...it }) => it));
          ultimoError = null;
          return estado();
        }
        const items = compactar(JSON.parse(buffer.toString('utf8')));
        indexar(items, { version, descargadoEn: ahora, formato: FORMATO_CACHE });
        guardarCache(items);
        ultimoError = null;
        log(`Furnidata listo: ${items.length} furnis (version ${version}).`);
        if (alActualizar) {
          try { alActualizar(api); } catch (e) { log('Error al sincronizar revisiones: ' + e.message); }
        }
        return estado();
      } catch (e) {
        ultimoError = e.message;
        log('No se pudo actualizar el furnidata: ' + e.message);
        throw e;
      } finally {
        enCurso = null;
      }
    })();
    return enCurso;
  }

  function guardarCache(items) {
    fs.mkdirSync(dirDatos, { recursive: true });
    const tmp = rutaCache + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ formato: FORMATO_CACHE, fuente: URL_FURNIDATA, version: meta.version, descargadoEn: meta.descargadoEn, furnis: items }));
    fs.renameSync(tmp, rutaCache);
  }

  // Deja el catalogo usable: con cache, al instante (y la revision en segundo plano); sin
  // cache o con una de formato viejo, descargandolo en primer plano. Despues revisa cada
  // 6 h (el temporizador no retiene el proceso; `detener` lo apaga).
  async function iniciar() {
    const hayCache = cargarCache();
    if (!hayCache || meta.formato !== FORMATO_CACHE) await actualizar().catch(() => {});
    else actualizar().catch(() => {});
    if (!revision) {
      revision = setInterval(() => actualizar().catch(() => {}), REVISION_MS);
      if (revision.unref) revision.unref();
    }
    return estado();
  }

  function detener() {
    if (revision) clearInterval(revision);
    revision = null;
  }

  function estado() {
    return {
      disponible: lista.length > 0,
      total: meta.total,
      version: meta.version,
      descargadoEn: meta.descargadoEn,
      fuente: URL_FURNIDATA,
      actualizando: !!enCurso,
      error: ultimoError,
    };
  }

  function aSalida(it) {
    return { classname: it.c, nombre: it.n, revision: it.r, tipo: it.t, sprite_id: it.i ?? null, categoria: it.cat, linea: it.linea, icono: urlIcono(it.c, it.r) };
  }

  // Buscador predictivo: todas las palabras deben aparecer; se prioriza coincidencia
  // exacta, luego "empieza por", luego inicio de palabra. Acepta tambien classname.
  function buscar(q, limite = 15) {
    const nq = normalizar(q);
    if (nq.length < 2 || !lista.length) return [];
    const palabras = nq.split(' ');
    const porClase = /[_*]/.test(q) ? String(q).trim().toLowerCase() : null;
    const hallados = [];
    for (const it of lista) {
      let rango;
      if (it.nn === nq) rango = 0;
      else if (it.nn.startsWith(nq)) rango = 1;
      else if (it.nn.includes(' ' + nq)) rango = 2;
      else if (palabras.every((p) => it.nn.includes(p))) rango = 3;
      else if (porClase && it.c.toLowerCase().includes(porClase)) rango = 4;
      else continue;
      hallados.push({ it, rango });
    }
    hallados.sort((a, b) =>
      a.rango - b.rango ||
      penalizacion(a.it) - penalizacion(b.it) ||
      a.it.n.length - b.it.n.length ||
      a.it.n.localeCompare(b.it.n, 'es'));
    return hallados.slice(0, limite).map((h) => aSalida(h.it));
  }

  // Resuelve un nombre escrito a mano (p. ej. desde el Excel) contra el catalogo oficial.
  //   exacta     -> mismo nombre salvo tildes/mayusculas
  //   aproximada -> error de tipeo claro (parecido >= 0.85) o prefijo unico
  //   ninguna    -> sin candidato seguro; se devuelven sugerencias
  function coincidencia(nombre) {
    const nq = normalizar(nombre);
    if (!nq || !lista.length) return { tipo: 'ninguna', furni: null, sugerencias: [] };

    const exactos = porNombre.get(nq);
    if (exactos) return { tipo: 'exacta', furni: aSalida(exactos[0]), variantes: exactos.length, sugerencias: [] };

    if (nq.length >= 8) {
      const prefijo = new Set(lista.filter((it) => it.nn.startsWith(nq + ' ')).map((it) => it.nn));
      if (prefijo.size === 1) {
        const grupo = porNombre.get([...prefijo][0]);
        return { tipo: 'aproximada', furni: aSalida(grupo[0]), variantes: grupo.length, parecido: null, sugerencias: [] };
      }
    }

    const puntuados = [];
    for (const [nn, grupo] of porNombre) {
      if (Math.abs(nn.length - nq.length) > Math.max(4, nq.length * 0.4)) continue;
      const p = parecido(nq, nn);
      if (p >= 0.6) puntuados.push({ p, grupo });
    }
    puntuados.sort((a, b) => b.p - a.p);
    const sugerencias = puntuados.slice(0, 3).map((x) => ({ ...aSalida(x.grupo[0]), parecido: +x.p.toFixed(2) }));
    const mejor = puntuados[0];
    const segundo = puntuados[1];
    if (mejor && mejor.p >= 0.85 && (!segundo || mejor.p - segundo.p >= 0.03)) {
      return { tipo: 'aproximada', furni: aSalida(mejor.grupo[0]), variantes: mejor.grupo.length, parecido: +mejor.p.toFixed(2), sugerencias };
    }
    return { tipo: 'ninguna', furni: null, sugerencias };
  }

  // Furni por id numerico del juego. `tipo`: 'suelo' (por defecto) o 'pared'.
  function porSpriteId(id, tipo = 'suelo') {
    const it = porSprite.get(`${tipo === 'pared' ? 'pared' : 'suelo'}:${Number(id)}`);
    return it ? aSalida(it) : null;
  }

  function porClase(classname) {
    const it = porClassname.get(classname);
    return it ? aSalida(it) : null;
  }

  function variantesDe(nombre) {
    return (porNombre.get(normalizar(nombre)) || []).map(aSalida);
  }

  // Icono como Buffer PNG, con cache en disco (clave: classname + revision).
  async function icono(classname, revisionConocida) {
    const it = porClassname.get(classname);
    const revision = (it && it.r) || revisionConocida;
    if (!revision) throw new Error('Furni sin revision conocida');
    const archivo = path.join(dirIconos, `${nombreArchivoIcono(classname)}_${revision}.png`);
    if (fs.existsSync(archivo)) return fs.readFileSync(archivo);
    if (iconosEnCurso.has(archivo)) return iconosEnCurso.get(archivo);
    const p = (async () => {
      try {
        const { buffer } = await descargar(urlIcono(classname, revision), { timeoutMs: 15000 });
        // Firma PNG: 89 50 4E 47
        if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Respuesta no es PNG');
        fs.mkdirSync(dirIconos, { recursive: true });
        fs.writeFileSync(archivo, buffer);
        return buffer;
      } finally {
        iconosEnCurso.delete(archivo);
      }
    })();
    iconosEnCurso.set(archivo, p);
    return p;
  }

  const api = { iniciar, detener, actualizar, estado, buscar, coincidencia, porClase, porSpriteId, variantesDe, icono, urlIcono, cargarCache };
  return api;
}

module.exports = { crearServicioFurnidata, urlIcono, validarFuente, URL_FURNIDATA };
