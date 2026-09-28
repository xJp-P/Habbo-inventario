// backend/core/seguridad.js — protege la API local frente a paginas web maliciosas.
//
// El servidor escucha solo en 127.0.0.1, pero el NAVEGADOR del usuario tambien corre en
// este equipo: una pagina cualquiera podria intentar mandar peticiones a
// http://127.0.0.1:<puerto>/api/... (por ejemplo un <form> que "venda" un lote). Tres
// barreras lo impiden:
//
//  1. Host local: rechaza peticiones cuyo Host no sea 127.0.0.1/localhost (ataque de
//     "DNS rebinding", donde un dominio externo apunta a 127.0.0.1).
//  2. Origin: si la peticion trae Origin (la mandan los navegadores), debe ser local.
//  3. Solo JSON en escrituras: POST/PUT/PATCH deben ser application/json. Un <form> HTML
//     no puede enviar JSON, y un fetch con JSON desde otro origen exige una verificacion
//     previa (CORS) que este servidor nunca aprueba.
//
// La interfaz de la app (misma origen 127.0.0.1) y las extensiones locales (sin Origin)
// pasan sin problema. Las extensiones ademas necesitan su token (services/sniper.js).

const HOSTS_LOCALES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const METODOS_ESCRITURA = new Set(['POST', 'PUT', 'PATCH']);

function hostnameDe(valor) {
  try { return new URL(valor).hostname; } catch (_) { return null; }
}

function protegerApiLocal() {
  return (req, res, next) => {
    if (!HOSTS_LOCALES.has(hostnameDe('http://' + (req.headers.host || '')))) {
      return res.status(403).json({ error: 'Acceso permitido solo desde este equipo.' });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !HOSTS_LOCALES.has(hostnameDe(origin))) {
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
    if (METODOS_ESCRITURA.has(req.method) && req.path.startsWith('/api/') && !req.is('application/json')) {
      return res.status(415).json({ error: 'Las peticiones deben enviarse como JSON (Content-Type: application/json).' });
    }
    next();
  };
}

// Exige "Authorization: Bearer <token>" valido.
function requiereToken(esValido) {
  return (req, res, next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m || !esValido(m[1])) {
      return res.status(401).json({ error: 'Token ausente o invalido. Copialo desde Ajustes en la app.' });
    }
    next();
  };
}

module.exports = { protegerApiLocal, requiereToken };
