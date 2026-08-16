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
  // Passwords are checked here, never by re-hashing and comparing in the
  // renderer: a bcrypt hash never equals another hash of the same password.
  verifyPassword: (pw, salt, hash) => ipcRenderer.invoke("db:verifyPassword", pw, salt, hash),
  randomSalt: () => ipcRenderer.invoke("db:randomSalt"),
  appendAudit: (entry) => ipcRenderer.invoke("db:appendAudit", entry),
  getAudit: (limit) => ipcRenderer.invoke("db:getAudit", limit),
  dbStatus: () => ipcRenderer.invoke("db:status"),
  // Snapshot into the data folder's backups/ — the offline build's answer to
  // "نسخ احتياطي الآن", which previously only worked in the licensed shell.
  backupNow: () => ipcRenderer.invoke("db:backupNow"),
  backupTo: (dest) => ipcRenderer.invoke("db:backup", dest),
  restoreFrom: (src) => ipcRenderer.invoke("db:restore", src),

  // Renames/re-icons the live window. Only the main process can touch either,
  // so the settings screen reaches them through here.
  setBranding: (branding) => ipcRenderer.invoke("app:setBranding", branding),

  // Native shell actions, so in-app buttons can open real Windows dialogs
  // instead of the browser-flavoured equivalents.
  info: () => ipcRenderer.invoke("app:info"),
  backupDialog: () => ipcRenderer.invoke("app:backupDialog"),
  restoreDialog: () => ipcRenderer.invoke("app:restoreDialog"),
  print: () => ipcRenderer.invoke("app:print"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  // Synchronous on purpose: the app's call sites are `if (!confirm(...))`, and
  // these back real Windows message boxes instead of Chromium's, which look like
  // a web page's dialogs. Wired over window.confirm/window.alert by
  // src/lib/native-dialogs.ts — a preload cannot do it itself, because with
  // contextIsolation the `window` here is the isolated world, not the page's.
  confirmSync: (message) => ipcRenderer.sendSync("app:confirm", String(message ?? "")),
  alertSync: (message) => ipcRenderer.sendSync("app:alert", String(message ?? "")),
  // Automatic updates (electron/updater.cjs). `onState` is a subscription: the
  // main process pushes every phase change — checking, download progress,
  // ready — and returns the unsubscribe function React's effect needs.
  updates: {
    state: () => ipcRenderer.invoke("update:state"),
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    setAuto: (auto) => ipcRenderer.invoke("update:setAuto", auto),
    onState: (callback) => {
      // The event object carries a sender the renderer must never see.
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("update:state", handler);
      return () => ipcRenderer.removeListener("update:state", handler);
    },
  },

  // لا minimize/toggleMaximize/quit هنا: كانت موجودة لخدمة أزرار شريط العنوان
  // المرسوم في ErpLayout، وقد حُذفت تلك الأزرار — النافذة تُنشأ بإطار ويندوز
  // الأصلي وأزراره هي الحقيقية. واجهة لا يستدعيها أحد سطحُ هجومٍ بلا مقابل.
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
