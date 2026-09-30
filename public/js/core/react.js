// public/js/core/react.js — puente a los globals de React UMD (heredado de Cartera).
//
// React 18 UMD SIN build step: `React` y `ReactDOM` llegan como globales desde los
// <script src="/vendor/..."> de index.html (clasicos, corren antes que los modulos).
// React 19 ya no publica builds UMD; por eso package.json fija react@18.3.1.

export var h = React.createElement;
export var useState = React.useState;
export var useEffect = React.useEffect;
export var useMemo = React.useMemo;
export var useCallback = React.useCallback;
export var useRef = React.useRef;
export var createRoot = ReactDOM.createRoot;
// Solo para la barrera de errores (componentes/Barrera.js): React no tiene otra forma
// de atrapar un error al dibujar que un componente de clase.
export var Component = React.Component;
