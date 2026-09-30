// public/js/componentes/Barrera.js — barrera de errores (v1.6.1).
//
// Sin ella, un error al dibujar cualquier parte de una vista (por ejemplo, un lote con un
// dato raro) borraba la app entera, menu incluido. Tres tamaños (`tipo`):
//   'seccion' (por defecto)  la vista entera: el menu y las demas secciones siguen;
//   'bloque'                 la tarjeta de un keko: los demas kekos siguen;
//   'fila'                   un lote o un furni de la tabla: el resto del bloque sigue.
// Cada una dice que no se pudo dibujar, el mensaje y ofrece «Ver detalles» (ErroresModal,
// para copiarlo o fotografiarlo) y «Reintentar». El error queda en el registro de la
// sesion (core/errores.js) con `donde` (p. ej. «Inventario › lote Nº 12»).
//
// Es el unico componente de clase de la app: React solo atrapa errores al dibujar con
// getDerivedStateFromError / componentDidCatch. Y solo los de sus hijos: lo que se calcula
// para un bloque o una fila tiene que calcularse DENTRO de la barrera (con Dibujar).

import { h, Component } from '../core/react.js';
import { Ico } from './iconos.js';
import { registrarError, mensajeLegible } from '../core/errores.js';

// Dibuja lo que devuelve props.dibujar() como hijo, para que un error al calcularlo quede
// dentro de la barrera que lo envuelve (y no en el componente padre).
export function Dibujar(props) { return props.dibujar(); }

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
    var original = error && error.message ? error.message : String(error);
    var legible = mensajeLegible(original);
    registrarError({ origen: 'seccion', ruta: this.props.donde || this.props.seccion, mensaje: legible,
      detalle: [legible !== original ? original.split('; visit')[0] : null, pila(error && error.stack, 4), pila(info && info.componentStack, 4)].filter(Boolean).join('\n') || null });
  }
  reintentar() { this.setState({ error: null }); }
  botones(chicos) {
    var cls = 'btn' + (chicos ? ' btn-chico' : '');
    return [
      this.props.onVerErrores ? h('button', { key: 'v', className: cls, onClick: this.props.onVerErrores }, h(Ico, { name: 'copy', size: chicos ? 12 : 14 }), chicos ? 'Detalles' : 'Ver y copiar detalles') : null,
      h('button', { key: 'r', className: cls + (chicos ? '' : ' btn-verde'), onClick: this.reintentar }, h(Ico, { name: 'refresh', size: chicos ? 12 : 14 }), 'Reintentar'),
    ];
  }
  render() {
    if (!this.state.error) return this.props.children;
    var e = this.state.error;
    var mensaje = mensajeLegible(e && e.message ? e.message : String(e));
    if (this.props.tipo === 'fila') {
      return h('tr', { className: 'fila-error' }, h('td', { colSpan: this.props.columnas || 1 },
        h('div', { className: 'fila-error-in' },
          h(Ico, { name: 'alert', size: 14, color: 'var(--red)' }),
          h('span', { className: 'fila-error-txt' }, h('b', null, (this.props.etiqueta || 'Esta fila') + ' no se pudo mostrar: '), h('span', { className: 'mono' }, mensaje)),
          this.botones(true))));
    }
    if (this.props.tipo === 'bloque') {
      return h('section', { className: 'bk' }, h('div', { className: 'card panel-error bloque-error' },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700 } },
          h(Ico, { name: 'alert', size: 16, color: 'var(--red)' }), (this.props.etiqueta || 'Este bloque') + ' no se pudo mostrar'),
        h('p', { className: 'suave', style: { fontSize: 12, margin: '6px 0 8px' } }, 'Los demás kekos se ven normal y tus datos no se tocaron.'),
        h('div', { className: 'aviso aviso-rojo mono', style: { fontSize: 12, wordBreak: 'break-word', marginBottom: 10 } }, mensaje),
        h('div', { style: { display: 'flex', gap: 8 } }, this.botones(true))));
    }
    return h('div', { className: 'contenedor fade-in' },
      h('div', { className: 'card panel-error' },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700, fontSize: 15 } },
          h(Ico, { name: 'alert', size: 18, color: 'var(--red)' }), 'Esta sección no se pudo mostrar'),
        h('p', { className: 'suave', style: { fontSize: 13, margin: '8px 0 10px', lineHeight: 1.55 } },
          'Algo de «' + (this.props.seccion || 'esta sección') + '» falló al dibujarse. El resto de la app sigue funcionando y tus datos no se tocaron.'),
        h('div', { className: 'aviso aviso-rojo mono', style: { fontSize: 12, wordBreak: 'break-word', marginBottom: 12 } }, mensaje),
        h('div', { style: { display: 'flex', gap: 8 } }, this.botones(false))));
  }
}
