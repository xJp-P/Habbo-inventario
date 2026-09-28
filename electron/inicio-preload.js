// electron/inicio-preload.js — puente de la pantalla de inicio (electron/inicio.html).
// Solo recibe el estado a pintar y devuelve el boton elegido; nada mas.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inicio', {
  alCambiar: (cb) => ipcRenderer.on('inicio:estado', (_e, estado) => cb(estado)),
  elegir:    (id) => ipcRenderer.send('inicio:eleccion', String(id)),
});
