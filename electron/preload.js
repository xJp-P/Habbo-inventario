// electron/preload.js — puente seguro entre la interfaz y el proceso principal.
// La interfaz NO tiene acceso a Node; solo a estas funciones.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  info:               () => ipcRenderer.invoke('app:info'),
  abrirCarpetaDatos:  () => ipcRenderer.invoke('app:abrir-carpeta-datos'),
  elegirExcel:        () => ipcRenderer.invoke('app:elegir-excel'),
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
