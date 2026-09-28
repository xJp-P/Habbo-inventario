// public/js/vistas/Acceso.js — primer arranque (asistente de configuracion) e inicio de
// sesion con tu usuario de Supabase Auth.
//
// Sin proyecto de Supabase configurado, la app abre el ASISTENTE:
//   bienvenida → 1 Proyecto → 2 Conectar → 3 Base de datos → 4 Tu usuario (y entrar)
// «Ya tengo mi Supabase listo» va directo a Conectar y, si la base ya esta completa, a
// entrar. Con el proyecto configurado pero sin sesion abre el inicio de sesion, que
// avisa si a la base le faltan migraciones. Si pusiste las variables en el .env, la app
// empieza en el inicio de sesion.
//
// La base se instala copiando cada migracion al SQL Editor de Supabase: la app NUNCA
// pide la clave secreta. `InstalarBase` detecta sola que migraciones estan (con la clave
// publica, ver backend/services/instalacion.js); la app ya abierta tambien la usa cuando
// una actualizacion trae una migracion nueva.

import { h, useState, useEffect } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { Fld } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';

var PANEL = 'https://supabase.com/dashboard';

// Enlaces directos al panel del proyecto: el ref es el subdominio de la URL. Sin
// proyecto conocido, "_" hace que Supabase pregunte cual.
function enlacesSupabase(url) {
  var m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url || '');
  var base = PANEL + '/project/' + (m ? m[1] : '_');
  return {
    proyectos: PANEL + '/projects', claves: base + '/settings/api-keys', datos: base + '/settings/api',
    sql: base + '/sql/new', usuarios: base + '/auth/users', registro: base + '/auth/providers',
  };
}

function Logo() {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 } },
    h('img', { src: '/img/icono.png', alt: '', style: { width: 52, height: 52, imageRendering: 'pixelated' } }),
    h('div', null, h('div', { style: { fontWeight: 700, fontSize: 20 } }, 'Habbo Inventario'), h('div', { className: 'suave', style: { fontSize: 13 } }, 'Compra y venta de furnis · Habbo.es')));
}

// Boton que abre una pagina de Supabase en el navegador del sistema.
function Enlace(props) {
  return h('a', { className: 'btn btn-chico', href: props.href, target: '_blank', rel: 'noopener noreferrer' },
    h(Ico, { name: 'external', size: 12 }), props.children);
}

function Titulo(props) {
  return h('div', null,
    h('div', { className: 'card-titulo' }, h(Ico, { name: props.icono, size: 16 }), props.titulo),
    props.sub ? h('div', { className: 'card-sub', style: { lineHeight: 1.5 } }, props.sub) : null);
}

function Instrucciones(props) {
  return h('ol', { className: 'instrucciones' }, props.items.map(function (it, i) { return h('li', { key: i }, it); }));
}

function Pie(props) {
  return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
    props.onAtras ? h('button', { className: 'btn', onClick: props.onAtras }, 'Atrás') : h('span'),
    props.children);
}

var PASOS = [['proyecto', 'Proyecto'], ['conectar', 'Conectar'], ['instalar', 'Base de datos'], ['usuario', 'Tu usuario']];

function Pasos(props) {
  var actual = PASOS.findIndex(function (p) { return p[0] === props.actual; });
  return h('div', { className: 'pasos' }, PASOS.map(function (p, i) {
    return h('span', { key: p[0], className: 'paso' + (i === actual ? ' actual' : i < actual ? ' hecho' : '') },
      i < actual ? h(Ico, { name: 'check', size: 11, sw: 3 }) : (i + 1) + '.', p[1]);
  }));
}

function Bienvenida(props) {
  function opcion(icono, titulo, texto, alElegir) {
    return h('button', { className: 'opcion', onClick: alElegir },
      h('span', { className: 'opcion-ico' }, h(Ico, { name: icono, size: 18 })),
      h('span', null, h('span', { className: 'opcion-titulo' }, titulo), h('span', { className: 'opcion-texto' }, texto)));
  }
  return [
    h(Titulo, { key: 't', icono: 'database', titulo: 'Bienvenido', sub: 'Tus datos viven en tu propio proyecto de Supabase (el plan gratis alcanza). ¿Cómo quieres empezar?' }),
    h('div', { key: 'o', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      opcion('plug', 'Ya tengo mi Supabase listo', 'Pego la URL y la clave, y entro con mi usuario.', props.onRapido),
      opcion('bolt', 'Configurar desde cero', 'Asistente guiado, unos 10 minutos. No hace falta tocar archivos.', props.onGuiado)),
  ];
}

function PasoProyecto(props) {
  return [
    h(Titulo, { key: 't', icono: 'plus', titulo: 'Crea tu proyecto en Supabase', sub: 'Vuelve aquí cuando termine de crearse (tarda 1 o 2 minutos).' }),
    h(Instrucciones, { key: 'i', items: [
      ['Entra a Supabase (crea tu cuenta si no tienes) y pulsa ', h('b', null, 'New project'), '.'],
      ['En ', h('b', null, 'Database Password'), ' pon una contraseña fuerte y guárdala: la app no la necesita.'],
      ['En ', h('b', null, 'Region'), ' elige la más cercana a ti y a tus VPS.'],
    ] }),
    h('div', { key: 'e' }, h(Enlace, { href: enlacesSupabase().proyectos }, 'Abrir Supabase')),
    h(Pie, { key: 'p', onAtras: props.onAtras }, h('button', { className: 'btn btn-verde', onClick: props.onSiguiente }, 'Ya lo creé', h(Ico, { name: 'chevright', size: 14 }))),
  ];
}

// Guarda la URL y la clave y comprueba que el proyecto responda.
function PasoConectar(props) {
  var sU = useState(''); var url = sU[0]; var setUrl = sU[1];
  var sK = useState(''); var clave = sK[0]; var setClave = sK[1];
  var sErr = useState(''); var error = sErr[0]; var setError = sErr[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var enlaces = enlacesSupabase(url.trim());

  function conectar() {
    _submitGuard(enviando, setEnviando, function () {
      setError('');
      return API.post('/api/cuenta/configurar', { url: url, anonKey: clave }).then(function (cuenta) {
        if (!cuenta) return;
        props.onCuenta(cuenta);
        return API.get('/api/instalacion').then(function (inst) {
          if (!inst) return;
          if (inst.error) setError(inst.error);
          else props.onConectado(inst);
        });
      });
    });
  }
  var alEnter = function (e) { if (e.key === 'Enter') conectar(); };

  return [
    h(Titulo, { key: 't', icono: 'plug', titulo: 'Conecta la app con tu proyecto', sub: 'Copia estos dos datos del panel de tu proyecto en Supabase.' }),
    h(Fld, { key: 'u', label: 'Project URL', ayuda: 'Project Settings → Data API (o el botón Connect).' },
      h('input', { className: 'inp', value: url, placeholder: 'https://abcd1234.supabase.co', autoFocus: true, onChange: function (e) { setUrl(e.target.value); setError(''); }, onKeyDown: alEnter })),
    h(Fld, { key: 'k', label: 'Clave pública', ayuda: 'Project Settings → API Keys: la Publishable key, o la anon public en Legacy API Keys. Nunca la clave secreta: la app la rechaza.' },
      h('input', { className: 'inp mono', value: clave, placeholder: 'sb_publishable_… o eyJ…', onChange: function (e) { setClave(e.target.value); setError(''); }, onKeyDown: alEnter })),
    h('div', { key: 'e', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      h(Enlace, { href: enlaces.datos }, 'Data API'), h(Enlace, { href: enlaces.claves }, 'API Keys')),
    error ? h('div', { key: 'x', className: 'aviso aviso-rojo' }, error) : null,
    h(Pie, { key: 'p', onAtras: props.onAtras },
      h('button', { className: 'btn btn-verde', onClick: conectar, disabled: enviando }, enviando ? 'Conectando…' : 'Conectar', enviando ? null : h(Ico, { name: 'chevright', size: 14 }))),
  ];
}

// Lista de migraciones con su estado; la siguiente pendiente trae "Copiar SQL" y el
// enlace al SQL Editor de tu proyecto. Revisa sola al volver a la ventana y cada 5 s.
export function InstalarBase(props) {
  var sE = useState(null); var est = sE[0]; var setEst = sE[1];
  var sC = useState(null); var copiada = sC[0]; var setCopiada = sC[1];
  var sErrC = useState(''); var errorCopia = sErrC[0]; var setErrorCopia = sErrC[1];
  var sB = useState(false); var buscando = sB[0]; var setBuscando = sB[1];
  var enlaces = enlacesSupabase(props.cuenta.url);

  function comprobar() {
    setBuscando(true);
    return API.get('/api/instalacion').then(function (r) { setBuscando(false); if (r) setEst(r); });
  }
  useEffect(function () {
    comprobar();
    function alVolver() { if (!document.hidden) comprobar(); }
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return function () { window.removeEventListener('focus', alVolver); document.removeEventListener('visibilitychange', alVolver); };
  }, []);
  var completa = !!(est && est.completa);
  useEffect(function () {
    if (completa) return;
    var t = setInterval(comprobar, 5000);
    return function () { clearInterval(t); };
  }, [completa]);

  function copiar(archivo) {
    setErrorCopia('');
    API.get('/api/instalacion/sql/' + encodeURIComponent(archivo)).then(function (r) {
      if (!r) return;
      var fallo = function () { setErrorCopia('No se pudo copiar. Abre el archivo supabase/migrations/' + archivo + ' y copia todo su contenido.'); };
      if (!navigator.clipboard) { fallo(); return; }
      navigator.clipboard.writeText(r.sql).then(function () { setCopiada(archivo); }, fallo);
    });
  }

  var cuerpo;
  if (!est) {
    cuerpo = h('div', { className: 'suave', style: { fontSize: 13 } }, 'Revisando tu base de datos…');
  } else if (est.error) {
    cuerpo = [
      h('div', { key: 'x', className: 'aviso aviso-rojo' }, est.error),
      h('div', { key: 'b' }, h('button', { className: 'btn', onClick: comprobar, disabled: buscando }, h(Ico, { name: 'refresh', size: 14 }), 'Reintentar')),
    ];
  } else {
    cuerpo = [
      h('div', { key: 'b' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 } },
          h('span', { className: completa ? 'pos' : '' }, est.instaladas + ' de ' + est.total + ' instaladas'),
          h('span', { className: 'tenue' }, buscando ? 'revisando…' : 'se revisa sola')),
        h('div', { className: 'barra-avance', style: { maxWidth: 'none' } }, h('div', { style: { width: Math.round(est.instaladas * 100 / est.total) + '%' } }))),
      h('div', { key: 'l' }, est.migraciones.map(function (m) {
        var siguiente = m.archivo === est.siguiente;
        return h('div', { key: m.archivo, className: 'mig' + (siguiente ? ' siguiente' : '') },
          m.instalada ? h(Ico, { name: 'check', size: 15, sw: 2.5, color: 'var(--green)' })
            : h(Ico, { name: siguiente ? 'play' : 'circle', size: 14, color: siguiente ? 'var(--yellow)' : 'var(--text3)' }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: m.instalada || siguiente ? '' : 'tenue' }, m.numero + '. ' + m.titulo),
            h('div', { className: 'mono tenue', style: { fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.archivo)),
          siguiente ? h('div', { style: { display: 'flex', gap: 6, flexShrink: 0 } },
            h('button', { className: 'btn btn-chico' + (copiada === m.archivo ? ' btn-verde' : ''), onClick: function () { copiar(m.archivo); } },
              h(Ico, { name: copiada === m.archivo ? 'check' : 'copy', size: 12 }), copiada === m.archivo ? 'Copiado' : 'Copiar SQL'),
            h(Enlace, { href: enlaces.sql }, 'SQL Editor')) : null);
      })),
      errorCopia ? h('div', { key: 'ec', className: 'aviso aviso-rojo' }, errorCopia) : null,
      copiada && copiada === est.siguiente ? h('div', { key: 'a', className: 'aviso', style: { lineHeight: 1.5 } },
        'Pégalo en el SQL Editor y pulsa ', h('b', null, 'Run'), '. Si Supabase avisa ', h('i', null, 'Potential issue detected'), ', confirma con ', h('b', null, 'Run this query'), '. Esta lista se actualiza sola.') : null,
      completa ? h('div', { key: 'ok', className: 'aviso', style: { background: 'var(--green-bg)', color: 'var(--green)' } }, 'Base de datos lista: las ' + est.total + ' migraciones están instaladas.') : null,
    ];
  }

  return [
    props.sinTitulo ? null : h(Titulo, { key: 't', icono: 'database', titulo: 'Instala la base de datos', sub: 'Copia cada archivo en el SQL Editor de tu proyecto y pulsa Run, en orden. La app detecta sola cuáles ya están.' }),
    h('div', { key: 'c', style: { display: 'flex', flexDirection: 'column', gap: 10 } }, cuerpo),
    h(Pie, { key: 'p', onAtras: props.onAtras },
      h('div', { style: { display: 'flex', gap: 8 } },
        completa ? null : h('button', { className: 'btn', onClick: comprobar, disabled: buscando }, h(Ico, { name: 'refresh', size: 14 }), 'Comprobar ahora'),
        completa ? h('button', { className: 'btn btn-verde', onClick: props.onListo }, props.textoListo || 'Continuar', h(Ico, { name: 'chevright', size: 14 })) : null)),
  ];
}

// Inicio de sesion. En el asistente (o al pedirlo) explica como crear el usuario.
function Entrar(props) {
  var cuenta = props.cuenta;
  var sE = useState(''); var email = sE[0]; var setEmail = sE[1];
  var sP = useState(''); var pass = sP[0]; var setPass = sP[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];
  var sG = useState(!!props.guiado); var guia = sG[0]; var setGuia = sG[1];
  var sI = useState(null); var inst = sI[0]; var setInst = sI[1];
  var enlaces = enlacesSupabase(cuenta.url);

  useEffect(function () {
    if (!props.guiado) API.get('/api/instalacion').then(function (r) { if (r) setInst(r); });
  }, []);

  function enviar() {
    _submitGuard(enviando, setEnviando, function () {
      return API.post('/api/cuenta/entrar', { email: email, password: pass }).then(function (r) { if (r) props.onCuenta(r); });
    });
  }
  var alEnter = function (e) { if (e.key === 'Enter') enviar(); };
  var faltan = inst && !inst.error && !inst.completa ? inst.total - inst.instaladas : 0;

  return [
    h(Titulo, { key: 't', icono: props.guiado ? 'user' : 'key', titulo: props.guiado ? 'Crea tu usuario y entra' : 'Iniciar sesión' }),
    h('div', { key: 'u', className: 'card-sub mono', style: { wordBreak: 'break-all', marginTop: -8 } }, cuenta.url),
    faltan ? h('div', { key: 'f', className: 'aviso aviso-ambar', style: { display: 'flex', gap: 8, alignItems: 'center' } },
      h('span', { style: { flex: 1 } }, 'A tu base de datos ' + (faltan === 1 ? 'le falta 1 migración' : 'le faltan ' + faltan + ' migraciones') + ' de esta versión.'),
      h('button', { className: 'btn btn-chico', onClick: props.onInstalar }, 'Instalar lo que falta')) : null,
    guia ? h('div', { key: 'g', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('div', { className: 'card-sub', style: { lineHeight: 1.5 } }, 'El único usuario de tu proyecto lo creas tú. Después cierras el registro para que nadie más pueda crearse una cuenta.'),
      h(Instrucciones, { items: [
        [h('b', null, 'Add user → Create new user'), ': tu email y una contraseña, marcando ', h('b', null, 'Auto Confirm User'), '. ', h(Enlace, { href: enlaces.usuarios }, 'Usuarios')],
        ['Desactiva ', h('b', null, 'Allow new users to sign up'), ' y guarda. ', h(Enlace, { href: enlaces.registro }, 'Registro')],
      ] }))
      : h('button', { key: 'g', className: 'btn-enlace', onClick: function () { setGuia(true); } }, '¿Aún no tienes usuario? Ver cómo crearlo'),
    h(Fld, { key: 'e', label: 'Email' }, h('input', { className: 'inp', type: 'email', value: email, autoFocus: !props.guiado, onChange: function (e) { setEmail(e.target.value); }, onKeyDown: alEnter })),
    h(Fld, { key: 'c', label: 'Contraseña' }, h('input', { className: 'inp', type: 'password', value: pass, onChange: function (e) { setPass(e.target.value); }, onKeyDown: alEnter })),
    h('button', { key: 'b', className: 'btn-primary', onClick: enviar, disabled: enviando }, enviando ? 'Conectando…' : 'Entrar'),
    props.onAtras ? h(Pie, { key: 'p', onAtras: props.onAtras })
      : cuenta.configEditable ? h('button', { key: 'p', className: 'btn-enlace', onClick: props.onCambiarProyecto }, 'Usar otro proyecto de Supabase') : null,
  ];
}

export function AccesoView(props) {
  var cuenta = props.cuenta;
  var sP = useState(cuenta.estado === 'sin_configurar' ? 'bienvenida' : 'entrar'); var paso = sP[0]; var setPaso = sP[1];
  var sG = useState(false); var guiado = sG[0]; var setGuiado = sG[1];
  var inicio = cuenta.estado === 'sin_configurar' ? 'bienvenida' : 'entrar';

  var contenido;
  if (paso === 'bienvenida') {
    contenido = h(Bienvenida, {
      onRapido: function () { setGuiado(false); setPaso('conectar'); },
      onGuiado: function () { setGuiado(true); setPaso('proyecto'); },
    });
  } else if (paso === 'proyecto') {
    contenido = h(PasoProyecto, { onAtras: function () { setPaso('bienvenida'); }, onSiguiente: function () { setPaso('conectar'); } });
  } else if (paso === 'conectar') {
    contenido = h(PasoConectar, {
      onCuenta: props.onCuenta,
      onAtras: function () { setPaso(guiado ? 'proyecto' : inicio); },
      // Guiado: siempre pasa por la base de datos. Rapido: solo si le falta algo.
      onConectado: function (inst) { setPaso(guiado || !inst.completa ? 'instalar' : 'entrar'); },
    });
  } else if (paso === 'instalar') {
    contenido = h(InstalarBase, {
      cuenta: cuenta,
      onAtras: function () { setPaso(guiado ? 'conectar' : 'entrar'); },
      onListo: function () { setPaso(guiado ? 'usuario' : 'entrar'); },
    });
  } else {
    contenido = h(Entrar, {
      key: paso, cuenta: cuenta, guiado: paso === 'usuario', onCuenta: props.onCuenta,
      onAtras: paso === 'usuario' ? function () { setPaso('instalar'); } : null,
      onInstalar: function () { setPaso('instalar'); },
      onCambiarProyecto: function () { setGuiado(false); setPaso('conectar'); },
    });
  }

  return h('div', { className: 'acceso', 'data-app-lista': '1' },
    h('div', { className: 'acceso-caja', style: { maxWidth: paso === 'instalar' ? 580 : 460 } },
      h(Logo),
      guiado && paso !== 'bienvenida' ? h(Pasos, { actual: paso }) : null,
      h('div', { className: 'card', style: { display: 'flex', flexDirection: 'column', gap: 14 } }, contenido)));
}
