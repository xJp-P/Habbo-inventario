// public/js/componentes/Barrera.js — barrera de errores de una seccion (v1.6.1).
//
// Sin ella, un error al dibujar cualquier parte de una vista (por ejemplo, un lote con un
// dato raro) borraba la app entera, menu incluido. Con ella, solo esa seccion muestra que
// no se pudo dibujar, el mensaje y los botones «Ver detalles» (ErroresModal, para copiarlo
// o fotografiarlo) y «Reintentar»; el menu y las demas secciones siguen funcionando.
// El error queda en el registro de la sesion (core/errores.js).
//
// Es el unico componente de clase de la app: React solo atrapa errores al dibujar con
// getDerivedStateFromError / componentDidCatch.

import { h, Component } from '../core/react.js';
import { Ico } from './iconos.js';
import { registrarError } from '../core/errores.js';

// Las primeras lineas de la pila, sin rutas largas (solo el archivo de la app y la linea).
function pila(texto, lineas) {
  return String(texto || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean)
    .slice(0, lineas).map(function (l) { return l.replace(/https?:\/\/[^/]+\//g, '').replace(/\?[^:)]*/g, ''); }).join('\n');
}

export class Barrera extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reintentar = this.reintentar.bind(this);
  }
  static getDerivedStateFromError(error) { return { error: error }; }
  componentDidCatch(error, info) {
    registrarError({ origen: 'seccion', ruta: this.props.seccion, mensaje: error && error.message ? error.message : String(error),
      detalle: [pila(error && error.stack, 4), pila(info && info.componentStack, 4)].filter(Boolean).join('\n') || null });
  }
  reintentar() { this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    var e = this.state.error;
    return h('div', { className: 'contenedor fade-in' },
      h('div', { className: 'card panel-error' },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700, fontSize: 15 } },
          h(Ico, { name: 'alert', size: 18, color: 'var(--red)' }), 'Esta sección no se pudo mostrar'),
        h('p', { className: 'suave', style: { fontSize: 13, margin: '8px 0 10px', lineHeight: 1.55 } },
          'Algo de «' + (this.props.seccion || 'esta sección') + '» falló al dibujarse. El resto de la app sigue funcionando y tus datos no se tocaron.'),
        h('div', { className: 'aviso aviso-rojo mono', style: { fontSize: 12, wordBreak: 'break-word', marginBottom: 12 } }, e && e.message ? e.message : String(e)),
        h('div', { style: { display: 'flex', gap: 8 } },
          this.props.onVerErrores ? h('button', { className: 'btn', onClick: this.props.onVerErrores }, h(Ico, { name: 'copy', size: 14 }), 'Ver y copiar detalles') : null,
          h('button', { className: 'btn btn-verde', onClick: this.reintentar }, h(Ico, { name: 'refresh', size: 14 }), 'Reintentar'))));
  }
}
