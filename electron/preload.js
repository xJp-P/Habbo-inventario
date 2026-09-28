// electron/preload.js — puente seguro entre la interfaz y el proceso principal.
// La interfaz NO tiene acceso a Node; solo a estas funciones.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  info:               () => ipcRenderer.invoke('app:info'),
  abrirCarpetaDatos:  () => ipcRenderer.invoke('app:abrir-carpeta-datos'),
  elegirExcel:        () => ipcRenderer.invoke('app:elegir-excel'),
});
