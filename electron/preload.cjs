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

  // Native shell actions, so in-app buttons can open real Windows dialogs
  // instead of the browser-flavoured equivalents.
  info: () => ipcRenderer.invoke("app:info"),
  backupDialog: () => ipcRenderer.invoke("app:backupDialog"),
  restoreDialog: () => ipcRenderer.invoke("app:restoreDialog"),
  print: () => ipcRenderer.invoke("app:print"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  // Synchronous on purpose: the app's call sites are `if (!confirm(...))`, and
  // these back real Windows message boxes (see entry.tsx) instead of
  // Chromium's, which look like a web page's dialogs.
  confirmSync: (message) => ipcRenderer.sendSync("app:confirm", String(message ?? "")),
  alertSync: (message) => ipcRenderer.sendSync("app:alert", String(message ?? "")),
  minimize: () => ipcRenderer.invoke("app:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("app:toggleMaximize"),
  quit: () => ipcRenderer.invoke("app:quit"),
});

// Dropping a file anywhere on a browser window makes it navigate to that file.
// An installed program does not do that, so the whole window refuses drops
// outside of elements that opt in with a `data-accepts-drop` attribute.
for (const type of ["dragover", "drop"]) {
  window.addEventListener(
    type,
    (event) => {
      if (event.target instanceof Element && event.target.closest("[data-accepts-drop]")) return;
      event.preventDefault();
    },
    false,
  );
}
