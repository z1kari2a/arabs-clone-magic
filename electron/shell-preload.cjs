// Preload for the shell window. Exposes a minimal, typed API.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("erpLicense", {
  fingerprint: () => ipcRenderer.invoke("license:fingerprint"),
  status: () => ipcRenderer.invoke("license:status"),
  activate: (code, deviceName) => ipcRenderer.invoke("license:activate", code, deviceName),
  deactivate: () => ipcRenderer.invoke("license:deactivate"),
  serverBase: () => ipcRenderer.invoke("license:serverBase"),
});

// Same local SQLite bridge as the non-shell build (electron/preload.cjs) — the
// shell was previously missing this, so all business data silently fell back
// to renderer localStorage instead of the erp.db file shell-main.cjs now wires up.
contextBridge.exposeInMainWorld("erpNative", {
  isElectron: true,
  getAll: (table) => ipcRenderer.invoke("db:getAll", table),
  setAll: (table, rows) => ipcRenderer.invoke("db:setAll", table, rows),
  getKV: (key) => ipcRenderer.invoke("db:getKV", key),
  setKV: (key, value) => ipcRenderer.invoke("db:setKV", key, value),
  hashPassword: (pw, salt) => ipcRenderer.invoke("db:hashPassword", pw, salt),
  verifyPassword: (pw, salt, hash) => ipcRenderer.invoke("db:verifyPassword", pw, salt, hash),
  randomSalt: () => ipcRenderer.invoke("db:randomSalt"),
  appendAudit: (entry) => ipcRenderer.invoke("db:appendAudit", entry),
  getAudit: (limit) => ipcRenderer.invoke("db:getAudit", limit),
  dbStatus: () => ipcRenderer.invoke("db:status"),
  backupTo: (dest) => ipcRenderer.invoke("db:backup", dest),
  restoreFrom: (src) => ipcRenderer.invoke("db:restore", src),
  backupNow: () => ipcRenderer.invoke("db:backupNow"),
  setBranding: (branding) => ipcRenderer.invoke("app:setBranding", branding),
});
