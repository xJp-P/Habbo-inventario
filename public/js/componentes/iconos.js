// public/js/componentes/iconos.js — vocabulario visual: iconos SVG de trazo.
//
// Heredado de Proyecto_Cartera (public/js/componentes/iconos.js): mismo diccionario
// `ICONS` de paths y el mismo componente `Ico`, con los iconos nuevos que necesita el
// inventario (tienda, cajas, radar del sniper, conexion, diamante del Lingo, moneda...).
// `Ico` devuelve null en silencio si el nombre no existe: comprobarlo antes de usarlo.

import { h } from '../core/react.js';

export var ICONS = {
  home:      'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
  dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  store:     'M3 9l1.5-5h15L21 9 M3 9h18v2a3 3 0 01-6 0 3 3 0 01-6 0 3 3 0 01-6 0z M5 13v8h14v-8 M10 21v-5h4v5',
  box:       'M21 8l-9-5-9 5 9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8',
  radar:     'M12 12m-1 0a1 1 0 102 0 1 1 0 10-2 0 M12 3a9 9 0 109 9 M12 7a5 5 0 105 5 M12 12l6-6',
  plug:      'M7 12l-4 4 5 5 4-4 M17 12l4-4-5-5-4 4 M8 16l8-8 M10 8l-2-2 M16 14l2 2',
  diamond:   'M6 3h12l4 6-10 12L2 9z M2 9h20 M12 21L8 9l4-6 4 6-4 12',
  coin:      'M12 21a9 9 0 100-18 9 9 0 000 18z M14.8 9A2 2 0 0013 8h-2a2 2 0 000 4h2a2 2 0 010 4h-2a2 2 0 01-1.8-1 M12 6v2 M12 16v2',
  settings:  'M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z M12 15a3 3 0 100-6 3 3 0 000 6z',
  plus:      'M12 5v14 M5 12h14',
  minus:     'M5 12h14',
  sparkle:   'M12 2l2 6.5L20.5 10l-6.5 2L12 18.5 10 12l-6.5-1.5L10 8.5 12 2z',
  edit:      'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
  trash:     'M3 6h18 M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2',
  x:         'M18 6L6 18 M6 6l12 12',
  check:     'M20 6L9 17l-5-5',
  checkCircle:'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
  alert:     'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01',
  search:    'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  chevdown:  'M6 9l6 6 6-6',
  chevright: 'M9 18l6-6-6-6',
  refresh:   'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0020.49 15',
  undo:      'M3 7v6h6 M21 17a9 9 0 00-15-6.7L3 13',
  menu:      'M3 12h18 M3 6h18 M3 18h18',
  sun:       'M12 17a5 5 0 100-10 5 5 0 000 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
  moon:      'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  folder:    'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z',
  upload:    'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  download:  'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  external:  'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6 M15 3h6v6 M10 14L21 3',
  circle:    'M12 2a10 10 0 100 20 10 10 0 000-20z',
  play:      'M6 4l14 8-14 8V4z',
  user:      'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 3a4 4 0 100 8 4 4 0 000-8z',
  audit:     'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 5a2 2 0 012-2h2a2 2 0 012 2 M9 14l2 2 4-4',
  mas:       'M12 2a10 10 0 100 20 10 10 0 000-20z M12 8v8 M8 12h8',
  menos:     'M12 2a10 10 0 100 20 10 10 0 000-20z M8 12h8',
  key:       'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  copy:      'M20 9h-9a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2z M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  logout:    'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
  bolt:      'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  bell:      'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 01-3.46 0',
  database:  'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z M21 12c0 1.66-4 3-9 3s-9-1.34-9-3 M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  arrowDown: 'M12 5v14 M19 12l-7 7-7-7',
  tag:       'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z M7 7h.01',
  trending:  'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6',
  lock:      'M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2z M7 11V7a5 5 0 0110 0v4',
  cart:      'M9 21a1 1 0 100-2 1 1 0 000 2z M20 21a1 1 0 100-2 1 1 0 000 2z M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6'
};

export function Ico(props){
  var name=props.name,size=props.size||18,sw=props.sw||1.8,color=props.color||'currentColor';
  var d=ICONS[name]; if(!d) return null;
  var parts=d.split(' M ');
  var paths=parts.map(function(p,i){return i===0?p:'M '+p;});
  return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:color,strokeWidth:sw,strokeLinecap:'round',strokeLinejoin:'round',style:{flexShrink:0}},
    paths.map(function(p,i){return h('path',{key:i,d:p});}));
}
