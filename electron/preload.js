// electron/preload.js — puente seguro entre la interfaz y el proceso principal.
// La interfaz NO tiene acceso a Node; solo a estas funciones.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  info:               () => ipcRenderer.invoke('app:info'),
  abrirCarpetaDatos:  () => ipcRenderer.invoke('app:abrir-carpeta-datos'),
  elegirExcel:        () => ipcRenderer.invoke('app:elegir-excel'),
  // «Copiar detalles» del informe de errores (v1.6.1): el portapapeles del sistema, sin
  // depender de los permisos del navegador.
  copiar:             (texto) => ipcRenderer.invoke('app:copiar', String(texto)),
  // «Exportar CSV» del Historial de ventas (v1.9.0): «Guardar como» del sistema y «Mostrar».
  guardarCsv:         (nombre, contenido) => ipcRenderer.invoke('app:guardar-csv', { nombre: String(nombre), contenido: String(contenido) }),
  mostrarArchivo:     (ruta) => ipcRenderer.invoke('app:mostrar-archivo', String(ruta)),
  // Notificaciones del sistema (electron/notificaciones.js): las decide el proceso
  // principal; aqui solo las preferencias y una de prueba.
  notificaciones: {
    leer:           () => ipcRenderer.invoke('app:notificaciones'),
    guardar:        (cambios) => ipcRenderer.invoke('app:notificaciones-guardar', cambios),
    probar:         () => ipcRenderer.invoke('app:notificaciones-probar'),
  },
  // Clic en una notificacion: lo que hay que abrir (p. ej. { vista: 'auditoria', keko }).
  alAbrir: (cb) => {
    const f = (_e, destino) => cb(destino);
    ipcRenderer.on('app:abrir', f);
    return () => ipcRenderer.removeListener('app:abrir', f);
  },
  // Actualizaciones desde GitHub Releases (electron/actualizaciones.js)
  actualizacion: {
    estado:         () => ipcRenderer.invoke('app:actualizacion'),
    buscar:         () => ipcRenderer.invoke('app:actualizacion-buscar'),
    descargar:      () => ipcRenderer.invoke('app:actualizacion-descargar'),
    instalar:       () => ipcRenderer.invoke('app:actualizacion-instalar'),
    abrirDescarga:  () => ipcRenderer.invoke('app:actualizacion-abrir-descarga'),
    alCambiar: (cb) => {
      const f = (_e, estado) => cb(estado);
      ipcRenderer.on('app:actualizacion-estado', f);
      return () => ipcRenderer.removeListener('app:actualizacion-estado', f);
    },
  },
});
