// Preload for the activation window. Exposes a minimal, typed API.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("erpLicense", {
  fingerprint: () => ipcRenderer.invoke("license:fingerprint"),
  status: () => ipcRenderer.invoke("license:status"),
  activate: (code, deviceName) => ipcRenderer.invoke("license:activate", code, deviceName),
  deactivate: () => ipcRenderer.invoke("license:deactivate"),
});