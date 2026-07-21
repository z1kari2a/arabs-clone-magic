// Preload script — exposes a safe, minimal API to the renderer via contextBridge.
// The renderer sees only these methods, never Node.js internals.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("erpNative", {
  isElectron: true,
  getAll: (table) => ipcRenderer.invoke("db:getAll", table),
  setAll: (table, rows) => ipcRenderer.invoke("db:setAll", table, rows),
  getKV: (key) => ipcRenderer.invoke("db:getKV", key),
  setKV: (key, value) => ipcRenderer.invoke("db:setKV", key, value),
  hashPassword: (pw, salt) => ipcRenderer.invoke("db:hashPassword", pw, salt),
  randomSalt: () => ipcRenderer.invoke("db:randomSalt"),
  backupTo: (dest) => ipcRenderer.invoke("db:backup", dest),
  restoreFrom: (src) => ipcRenderer.invoke("db:restore", src),
});