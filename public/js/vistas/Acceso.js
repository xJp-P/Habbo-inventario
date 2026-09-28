// public/js/vistas/Acceso.js — primera configuracion (URL y Anon Key de Supabase) e
// inicio de sesion con tu usuario de Supabase Auth.
//
// Si ya pusiste las variables en el .env, esta pantalla salta directo al inicio de
// sesion. La sesion queda guardada (cifrada en la app de escritorio): no se vuelve a
// pedir la contraseña en cada arranque.

import { h, useState } from '../core/react.js';
import { API } from '../core/api.js';
import { _submitGuard } from '../core/ui.js';
import { Fld } from '../componentes/base.js';
import { Ico } from '../componentes/iconos.js';

function Logo() {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 } },
    h('img', { src: '/img/icono.png', alt: '', style: { width: 52, height: 52, imageRendering: 'pixelated' } }),
    h('div', null, h('div', { style: { fontWeight: 700, fontSize: 20 } }, 'Habbo Inventario'), h('div', { className: 'suave', style: { fontSize: 13 } }, 'Compra y venta de furnis · Habbo.es')));
}

export function AccesoView(props) {
  var cuenta = props.cuenta;
  var configurar = cuenta.estado === 'sin_configurar';
  var sU = useState(''); var url = sU[0]; var setUrl = sU[1];
  var sK = useState(''); var clave = sK[0]; var setClave = sK[1];
  var sE = useState(''); var email = sE[0]; var setEmail = sE[1];
  var sP = useState(''); var pass = sP[0]; var setPass = sP[1];
  var sEnv = useState(false); var enviando = sEnv[0]; var setEnviando = sEnv[1];

  function enviar() {
    _submitGuard(enviando, setEnviando, function () {
      var p = configurar ? API.post('/api/cuenta/configurar', { url: url, anonKey: clave }) : API.post('/api/cuenta/entrar', { email: email, password: pass });
      return p.then(function (r) { if (r) props.onCuenta(r); });
    });
  }
  var alEnter = function (e) { if (e.key === 'Enter') enviar(); };

  return h('div', { className: 'acceso', 'data-app-lista': '1' },
    h('div', { className: 'acceso-caja' },
      h(Logo),
      h('div', { className: 'card', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        configurar ? [
          h('div', { key: 't' }, h('div', { className: 'card-titulo' }, h(Ico, { name: 'database', size: 16 }), 'Conectar con tu Supabase'),
            h('div', { className: 'card-sub' }, 'Tus datos viven en tu propio proyecto de Supabase. Encuentra estos valores en Project Settings → API.')),
          h(Fld, { key: 'u', label: 'Project URL' }, h('input', { className: 'inp', value: url, placeholder: 'https://abcd1234.supabase.co', autoFocus: true, onChange: function (e) { setUrl(e.target.value); }, onKeyDown: alEnter })),
          h(Fld, { key: 'k', label: 'Anon Key (pública)', ayuda: 'Nunca pegues la service_role: la app la rechaza.' }, h('input', { className: 'inp mono', value: clave, placeholder: 'eyJ…', onChange: function (e) { setClave(e.target.value); }, onKeyDown: alEnter })),
        ] : [
          h('div', { key: 't' }, h('div', { className: 'card-titulo' }, h(Ico, { name: 'key', size: 16 }), 'Iniciar sesión'),
            h('div', { className: 'card-sub mono', style: { wordBreak: 'break-all' } }, cuenta.url)),
          h(Fld, { key: 'e', label: 'Email' }, h('input', { className: 'inp', type: 'email', value: email, autoFocus: true, onChange: function (e) { setEmail(e.target.value); }, onKeyDown: alEnter })),
          h(Fld, { key: 'p', label: 'Contraseña' }, h('input', { className: 'inp', type: 'password', value: pass, onChange: function (e) { setPass(e.target.value); }, onKeyDown: alEnter })),
          h('div', { key: 'a', className: 'tenue', style: { fontSize: 12 } }, 'El usuario se crea en Supabase → Authentication → Users → Add user (marca "Auto Confirm").'),
        ],
        h('button', { className: 'btn-primary', onClick: enviar, disabled: enviando }, enviando ? 'Conectando…' : configurar ? 'Guardar conexión' : 'Entrar'))));
}
