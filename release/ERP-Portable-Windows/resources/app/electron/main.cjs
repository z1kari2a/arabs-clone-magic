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
  session,
  nativeTheme,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db.cjs");
const updater = require("./updater.cjs");

const APP_TITLE = "ERP — نظام المشتريات";
const IS_DEV = process.argv.includes("--dev");

let mainWindow = null;
let splashWindow = null;
let quitConfirmed = false;
// Shown once the window is up — a modal dialog before that would sit behind the
// splash screen with nothing to attach to.
let pendingDbWarning = null;
let backupTimer = null;

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
    openDatabase();
    goOffline();
    registerIpc();
    buildMenu();
    createSplash();
    createWindow();
    updater.init({ window: () => mainWindow, quitForInstall });
    autoBackup();
    backupTimer = setInterval(autoBackup, AUTO_BACKUP_MS);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (backupTimer) clearInterval(backupTimer);
    if (process.platform !== "darwin") app.quit();
  });
}

// ------------------------------------------------------------------- database

// The installed program's database is created here, on first launch, inside the
// user's own profile (%APPDATA%\erp\erp.db) — an installer cannot do it, since
// it runs elevated and would put the file in the administrator's profile.
//
// If that folder is not writable (a locked-down or roaming corporate profile),
// fall back to Documents\ERP rather than starting with no database at all.
function openDatabase() {
  const candidates = [
    path.join(app.getPath("userData"), "erp.db"),
    path.join(app.getPath("documents"), "ERP", "erp.db"),
  ];

  let result = null;
  for (const candidate of candidates) {
    result = db.init(candidate);
    if (db.ready()) break;
  }

  if (!db.ready()) {
    dialog.showErrorBox(
      "تعذّر إنشاء قاعدة البيانات",
      [
        "لم يستطع البرنامج إنشاء ملف البيانات على هذا الجهاز.",
        "",
        `المسار: ${candidates[0]}`,
        result?.error ? `السبب: ${result.error}` : "",
        "",
        "شغّل البرنامج بحساب له صلاحية الكتابة على مجلد المستخدم.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    app.exit(1);
    return;
  }

  // The database opened, but not the way it should have. The user is told once,
  // after the window is up, because the app is fully usable either way.
  if (result?.error || result?.backend === "json") {
    pendingDbWarning = {
      message:
        result.backend === "json"
          ? "البرنامج يعمل بوضع تخزين احتياطي"
          : "تنبيه بشأن قاعدة البيانات",
      detail:
        (result.backend === "json"
          ? "تعذّر تشغيل محرّك SQLite على هذا الجهاز، فتم تخزين البيانات في ملف عادي. البرنامج يعمل بشكل كامل، لكن يُنصح بإعادة التثبيت.\n\n"
          : "") +
        (result.error ?? "") +
        `\n\nملف البيانات: ${db.dbPath()}`,
    };
  }
}

// -------------------------------------------------------------- auto backups

// The offline build has no cloud to fall back on, so the only thing standing
// between a customer and a lost year of invoices is a copy on the same disk.
// One is taken at every launch and every six hours, keeping the last 14.
const BACKUP_KEEP = 14;
const AUTO_BACKUP_MS = 6 * 60 * 60 * 1000;

function backupsDir() {
  return path.join(path.dirname(db.dbPath()), "backups");
}

function autoBackup() {
  if (!db.ready()) return null;
  try {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(dir, `erp-${stamp}${path.extname(db.dbPath())}`);
    db.backup(dest);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("erp-"))
      .sort();
    while (files.length > BACKUP_KEEP) fs.unlinkSync(path.join(dir, files.shift()));
    return dest;
  } catch (err) {
    console.error("autoBackup failed", err);
    return null;
  }
}

// ------------------------------------------------------------------- offline

// The installed program is an offline product: everything it renders is loaded
// from disk. Any http(s) request it makes would be a bug, and on a machine with
// no internet a bug like that shows up as a screen that hangs waiting for a
// timeout — so requests to the network are refused outright instead.
function goOffline() {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => {
      console.warn("blocked network request:", details.url);
      callback({ cancel: true });
    },
  );
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

// ------------------------------------------------------------------- branding

// The window title and icon the user chose in الإعدادات. They live in the
// renderer's settings row, which is only readable after the page has booted —
// so the last applied pair is mirrored here, next to the window state, and the
// window opens with it instead of flashing the stock name for a second first.

function brandingPath() {
  return path.join(app.getPath("userData"), "branding.json");
}

function loadBranding() {
  try {
    const saved = JSON.parse(fs.readFileSync(brandingPath(), "utf8"));
    return {
      name: typeof saved?.name === "string" && saved.name.trim() ? saved.name.trim() : null,
      icon:
        typeof saved?.icon === "string" && saved.icon.startsWith("data:image/") ? saved.icon : null,
    };
  } catch {
    return { name: null, icon: null };
  }
}

/** `icon` is a data: URL, or null to fall back to the bundled build/icon.ico. */
function applyBranding(branding) {
  const name =
    typeof branding?.name === "string" && branding.name.trim() ? branding.name.trim() : null;
  const icon =
    typeof branding?.icon === "string" && branding.icon.startsWith("data:image/")
      ? branding.icon
      : null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(name ?? APP_TITLE);
    // A failed decode returns an empty image; setting that would blank the
    // window icon rather than leave the previous one alone.
    const image = icon ? nativeImage.createFromDataURL(icon) : bundledIcon();
    if (image && !image.isEmpty()) mainWindow.setIcon(image);
  }

  try {
    fs.writeFileSync(brandingPath(), JSON.stringify({ name, icon }));
  } catch {
    /* a read-only profile just means the next launch starts from the default */
  }
  return true;
}

function bundledIcon() {
  const file = path.join(__dirname, "..", "build", "icon.ico");
  return fs.existsSync(file) ? nativeImage.createFromPath(file) : null;
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
  const branding = loadBranding();
  const customIcon = branding.icon ? nativeImage.createFromDataURL(branding.icon) : null;
  const windowIcon = customIcon && !customIcon.isEmpty() ? customIcon : bundledIcon();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f172a" : "#f1f5f9",
    title: branding.name ?? APP_TITLE,
    icon: windowIcon ?? undefined,
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
    if (pendingDbWarning) {
      const warning = pendingDbWarning;
      pendingDbWarning = null;
      dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: APP_TITLE,
        buttons: ["موافق"],
        noLink: true,
        ...warning,
      });
    }
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

// Closes the program on the updater's behalf: the installer is already running
// elevated behind the UAC prompt the user just accepted, and it kills ERP.exe
// to free the files it is about to overwrite. Getting out of its way in an
// orderly fashion — window state saved, a fresh backup taken, the database file
// closed — is the difference between an update and a crash. No close
// confirmation: the user has already answered that question twice.
function quitForInstall() {
  quitConfirmed = true;
  saveWindowState();
  autoBackup();
  try {
    db.close();
  } catch {
    /* a database that never opened does not need closing */
  }
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
          click: () => shell.openPath(path.dirname(db.dbPath())),
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
        { label: "التحقق من وجود تحديث…", click: checkForUpdate },
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
      "يعمل بلا إنترنت — كل البيانات على هذا الجهاز",
      "",
      `ملف البيانات: ${db.dbPath()}`,
    ].join("\n"),
    buttons: ["موافق"],
    noLink: true,
  });
}

// A check the user asked for has to answer, even when the answer is "nothing
// new" — the background checks stay silent, but a menu item that looks like it
// did nothing reads as broken.
async function checkForUpdate() {
  if (!updater.state.supported) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "التحديثات",
      message: "التحديث التلقائي متاح في النسخة المثبّتة على Windows فقط.",
      detail: `الإصدار الحالي: ${app.getVersion()}`,
      buttons: ["موافق"],
      noLink: true,
    });
    return;
  }

  const state = await updater.check(true);

  if (state.phase === "ready") {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "تحديث جاهز",
      message: `الإصدار ${state.version} جاهز للتثبيت`,
      buttons: ["لاحقاً", "إعادة التشغيل الآن"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (response === 1) updater.install();
    return;
  }

  // Found one, but automatic downloading is switched off — so ask, rather than
  // start a 100 MB transfer the user has already said no to once.
  if (state.phase === "available" && !state.auto) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "يوجد تحديث جديد",
      message: `الإصدار ${state.version} متاح`,
      detail: "التنزيل التلقائي معطّل. يمكنك تنزيل هذا التحديث الآن.",
      buttons: ["لاحقاً", "تنزيل الآن"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (response === 1) void updater.download();
    return;
  }

  const downloading = state.phase === "available" || state.phase === "downloading";

  dialog.showMessageBox(mainWindow, {
    type: state.phase === "error" ? "warning" : "info",
    title: "التحديثات",
    message:
      state.phase === "error"
        ? "تعذّر التحقق من التحديثات"
        : downloading
          ? "يوجد تحديث جديد"
          : "لا يوجد تحديث",
    detail:
      state.phase === "error"
        ? state.error
        : downloading
          ? `يجري تنزيل الإصدار ${state.version} في الخلفية. ستُطلب منك إعادة التشغيل عند اكتماله.`
          : `الإصدار الحالي ${app.getVersion()} هو الأحدث.`,
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
  ipcMain.handle("db:verifyPassword", (_e, pw, salt, hash) => db.verifyPassword(pw, salt, hash));
  ipcMain.handle("db:randomSalt", () => db.randomSalt());
  ipcMain.handle("db:appendAudit", (_e, entry) => db.appendAudit(entry));
  ipcMain.handle("db:getAudit", (_e, limit) => db.getAudit(limit));
  ipcMain.handle("db:status", () => db.status());
  ipcMain.handle("db:backupNow", () => autoBackup());
  ipcMain.handle("db:backup", (_e, dest) => db.backup(dest));
  ipcMain.handle("db:restore", (_e, src) => db.restore(src));

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: path.dirname(db.dbPath()),
  }));
  ipcMain.handle("app:setBranding", (_e, branding) => applyBranding(branding));
  ipcMain.handle("app:backupDialog", backupDb);
  ipcMain.handle("app:restoreDialog", restoreDb);
  ipcMain.handle("app:print", () => mainWindow?.webContents.print({ silent: false }));
  ipcMain.handle("app:openExternal", (_e, url) => openExternal(url));
  // app:minimize / app:toggleMaximize / app:quit كانت تخدم أزرار شريط العنوان
  // المرسوم في الواجهة. الشريط يعتمد الآن على إطار ويندوز الأصلي، فأزراره
  // الحقيقية هي التي تصغّر وتكبّر وتغلق — ولا حاجة لقناة IPC تكرّرها.

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
