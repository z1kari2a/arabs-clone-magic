// Electron main process — the real Windows program entry point.
//
// Everything here exists to make the app behave like an installed desktop
// program rather than a page in a browser: one instance at a time, a window
// that reopens where you left it, a splash screen instead of a white flash, a
// native Arabic menu bar, and no browser affordances (no address bar, no
// reload, no link that can navigate the window away from the app).

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  screen,
  nativeTheme,
} = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db.cjs");

const APP_TITLE = "ERP — نظام المشتريات";
const IS_DEV = process.argv.includes("--dev");

let mainWindow = null;
let splashWindow = null;
let quitConfirmed = false;

// Windows groups taskbar buttons and toast notifications by this id. Without
// it the taskbar shows the generic "Electron" identity instead of the app's.
if (process.platform === "win32") app.setAppUserModelId("com.fikradigital.erp");

// One running copy, like any installed program. A second launch (double-click
// on the desktop icon while it is already open) just focuses the live window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  start();
}

function start() {
  app.whenReady().then(() => {
    db.init(path.join(app.getPath("userData"), "erp.db"));
    registerIpc();
    buildMenu();
    createSplash();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

// ---------------------------------------------------------------- window state

// Reopening at the size and position the user left the window at is one of the
// small things that separates a program from a web page.
function statePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  const fallback = { width: 1400, height: 900, maximized: true, zoom: 0 };
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return fallback;
  }
  if (!saved || typeof saved.width !== "number" || typeof saved.height !== "number")
    return fallback;

  // A monitor that is no longer attached would put the window off-screen.
  if (typeof saved.x === "number" && typeof saved.y === "number") {
    const visible = screen.getAllDisplays().some(({ workArea: a }) => {
      return (
        saved.x + saved.width > a.x &&
        saved.y + saved.height > a.y &&
        saved.x < a.x + a.width &&
        saved.y < a.y + a.height
      );
    });
    if (!visible) {
      delete saved.x;
      delete saved.y;
    }
  }
  return { ...fallback, ...saved };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  // getBounds() during maximize returns the maximized rect; getNormalBounds()
  // keeps the size to restore to when the user un-maximizes later.
  const bounds = mainWindow.getNormalBounds();
  try {
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ ...bounds, maximized, zoom: mainWindow.webContents.getZoomLevel() }),
    );
  } catch {
    /* a read-only profile must not stop the app from closing */
  }
}

// --------------------------------------------------------------------- splash

// Shown for the second or two the renderer needs to boot. Without it Windows
// draws an empty frame, which reads as "a browser is loading a site".
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 280,
    frame: false,
    resizable: false,
    movable: false,
    center: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#0f172a",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow?.show());
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}

// --------------------------------------------------------------- main window

function createWindow() {
  const state = loadWindowState();
  const icon = path.join(__dirname, "..", "build", "icon.ico");

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f172a" : "#f1f5f9",
    title: APP_TITLE,
    icon: fs.existsSync(icon) ? icon : undefined,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false, // red squiggles under Arabic text are a browser tell
      devTools: IS_DEV,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once("ready-to-show", () => {
    if (state.zoom) mainWindow.webContents.setZoomLevel(state.zoom);
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  // The window title is the program's, not the document's: a stray <title> in
  // the renderer must not rename it the way a browser tab would.
  mainWindow.on("page-title-updated", (e) => e.preventDefault());

  lockDownBrowserBehaviour(mainWindow);
  wireCrashHandlers(mainWindow);

  mainWindow.on("close", onClose);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const indexHtml = path.join(__dirname, "..", "dist-electron", "index.html");
  mainWindow.loadFile(indexHtml).catch((err) => {
    closeSplash();
    dialog.showErrorBox(
      "تعذّر تشغيل البرنامج",
      `لم يتم العثور على ملفات الواجهة.\n\n${err.message}`,
    );
    app.quit();
  });

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function onClose(event) {
  saveWindowState();
  if (quitConfirmed) return;

  event.preventDefault();
  const response = dialog.showMessageBoxSync(mainWindow, {
    type: "question",
    buttons: ["إلغاء", "إغلاق البرنامج"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: "تأكيد",
    message: "هل تريد إغلاق البرنامج؟",
    detail: "سيتم حفظ جميع البيانات تلقائياً.",
  });

  if (response !== 1) return;
  quitConfirmed = true;
  try {
    db.close();
  } catch {
    /* closing a database that never opened is not an error worth blocking on */
  }
  mainWindow.destroy();
}

// ------------------------------------------------------- no browser behaviour

function lockDownBrowserBehaviour(win) {
  const wc = win.webContents;

  // Nothing may navigate the window away from the bundled app — a stray
  // <a href> would otherwise turn the program into a browser showing a site.
  wc.on("will-navigate", (event, url) => {
    if (url !== wc.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });

  // target=_blank / window.open: send real links to the user's browser, refuse
  // to spawn a second, chrome-less window that looks like a popup.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  // "Leave site? Changes you made may not be saved" is a browser dialog. The
  // app's own close confirmation (onClose) is the one the user should see.
  wc.on("will-prevent-unload", (event) => event.preventDefault());

  // A native right-click menu (with working Arabic cut/copy/paste) instead of
  // Chromium's, which carries "Reload", "Back" and "Inspect".
  wc.on("context-menu", (_event, params) => {
    const items = [];
    if (params.isEditable || params.selectionText) {
      items.push(
        { role: "cut", label: "قص", enabled: params.isEditable && !!params.selectionText },
        { role: "copy", label: "نسخ", enabled: !!params.selectionText },
        { role: "paste", label: "لصق", enabled: params.isEditable },
        { type: "separator" },
        { role: "selectAll", label: "تحديد الكل" },
      );
    }
    if (IS_DEV) {
      items.push(
        { type: "separator" },
        { label: "فحص العنصر", click: () => wc.inspectElement(params.x, params.y) },
      );
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Browser keys that have no meaning in an installed program. Zoom and print
  // stay — they go through the menu accelerators below.
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = (input.key || "").toLowerCase();
    const blocked =
      key === "f5" ||
      (input.control && key === "r") ||
      (input.control && key === "w") || // closing "the tab"
      (!IS_DEV && input.control && input.shift && key === "i") ||
      (!IS_DEV && key === "f12") ||
      (input.alt && (key === "arrowleft" || key === "arrowright")); // back/forward
    if (blocked) event.preventDefault();
  });

  // Permission prompts ("… wants to know your location") are pure web. The app
  // needs none of them.
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) shell.openExternal(url);
}

function wireCrashHandlers(win) {
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return;
    const response = dialog.showMessageBoxSync({
      type: "error",
      buttons: ["إغلاق", "إعادة التشغيل"],
      defaultId: 1,
      noLink: true,
      title: "توقف البرنامج",
      message: "حدث خطأ غير متوقع.",
      detail: "بياناتك محفوظة. يمكنك إعادة تشغيل البرنامج الآن.",
    });
    if (response === 1) relaunch();
    else app.exit(0);
  });

  win.on("unresponsive", () => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["انتظار", "إعادة التشغيل"],
      defaultId: 0,
      noLink: true,
      message: "البرنامج لا يستجيب",
      detail: "قد تكون هناك عملية طويلة قيد التنفيذ.",
    });
    if (choice === 1) relaunch();
  });
}

function relaunch() {
  quitConfirmed = true;
  app.relaunch();
  app.exit(0);
}

// ----------------------------------------------------------------------- menu

function buildMenu() {
  const template = [
    {
      label: "ملف",
      submenu: [
        { label: "نسخ احتياطي…", accelerator: "CmdOrCtrl+B", click: backupDb },
        { label: "استعادة من نسخة…", click: restoreDb },
        { type: "separator" },
        {
          label: "مجلد البيانات",
          click: () => shell.openPath(app.getPath("userData")),
        },
        { type: "separator" },
        {
          label: "طباعة…",
          accelerator: "CmdOrCtrl+P",
          click: () => mainWindow?.webContents.print({ silent: false }),
        },
        { type: "separator" },
        { label: "خروج", accelerator: "Alt+F4", click: () => mainWindow?.close() },
      ],
    },
    {
      label: "تحرير",
      submenu: [
        { role: "undo", label: "تراجع" },
        { role: "redo", label: "إعادة" },
        { type: "separator" },
        { role: "cut", label: "قص" },
        { role: "copy", label: "نسخ" },
        { role: "paste", label: "لصق" },
        { role: "selectAll", label: "تحديد الكل" },
      ],
    },
    {
      label: "عرض",
      submenu: [
        { role: "resetZoom", label: "الحجم الافتراضي" },
        { role: "zoomIn", label: "تكبير", accelerator: "CmdOrCtrl+Plus" },
        { role: "zoomOut", label: "تصغير" },
        { type: "separator" },
        { role: "togglefullscreen", label: "ملء الشاشة" },
        ...(IS_DEV
          ? [{ type: "separator" }, { role: "toggleDevTools", label: "أدوات المطور" }]
          : []),
      ],
    },
    {
      label: "مساعدة",
      submenu: [
        { label: "إعادة تشغيل البرنامج", click: relaunch },
        { type: "separator" },
        { label: "حول البرنامج", click: showAbout },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "حول البرنامج",
    message: APP_TITLE,
    detail: [
      `الإصدار ${app.getVersion()}`,
      "تطوير: Fikra Digital",
      "",
      `مجلد البيانات: ${app.getPath("userData")}`,
    ].join("\n"),
    buttons: ["موافق"],
    noLink: true,
  });
}

// ------------------------------------------------------------------------ IPC

function registerIpc() {
  ipcMain.handle("db:getAll", (_e, table) => db.getAll(table));
  ipcMain.handle("db:setAll", (_e, table, rows) => db.setAll(table, rows));
  ipcMain.handle("db:getKV", (_e, key) => db.getKV(key));
  ipcMain.handle("db:setKV", (_e, key, value) => db.setKV(key, value));
  ipcMain.handle("db:hashPassword", (_e, pw, salt) => db.hashPassword(pw, salt));
  ipcMain.handle("db:randomSalt", () => db.randomSalt());
  ipcMain.handle("db:backup", (_e, dest) => db.backup(dest));
  ipcMain.handle("db:restore", (_e, src) => db.restore(src));

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: app.getPath("userData"),
  }));
  ipcMain.handle("app:backupDialog", backupDb);
  ipcMain.handle("app:restoreDialog", restoreDb);
  ipcMain.handle("app:print", () => mainWindow?.webContents.print({ silent: false }));
  ipcMain.handle("app:openExternal", (_e, url) => openExternal(url));
  ipcMain.handle("app:minimize", () => mainWindow?.minimize());
  ipcMain.handle("app:toggleMaximize", () =>
    mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(),
  );
  ipcMain.handle("app:quit", () => mainWindow?.close());

  // Sync channels backing window.confirm / window.alert.
  ipcMain.on("app:confirm", (event, message) => {
    event.returnValue =
      dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["إلغاء", "موافق"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        title: APP_TITLE,
        message,
      }) === 1;
  });

  ipcMain.on("app:alert", (event, message) => {
    dialog.showMessageBoxSync(mainWindow, {
      type: "info",
      buttons: ["موافق"],
      noLink: true,
      title: APP_TITLE,
      message,
    });
    event.returnValue = true;
  });
}

async function backupDb() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "حفظ نسخة احتياطية",
    defaultPath: `erp-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: "قاعدة بيانات ERP", extensions: ["db"] }],
  });
  if (canceled || !filePath) return false;
  db.backup(filePath);
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    message: "تم حفظ النسخة الاحتياطية",
    detail: filePath,
    buttons: ["موافق"],
    noLink: true,
  });
  return true;
}

async function restoreDb() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "اختر ملف نسخة احتياطية",
    filters: [{ name: "قاعدة بيانات ERP", extensions: ["db"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return false;
  const ok = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["إلغاء", "استبدال"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: "سيتم استبدال البيانات الحالية بالنسخة المختارة. هل أنت متأكد؟",
  });
  if (ok.response !== 1) return false;
  db.restore(filePaths[0]);
  mainWindow.reload();
  return true;
}
