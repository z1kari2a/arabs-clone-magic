// Electron main process — real Windows program entry point.
// Launches the ERP window and wires IPC handlers to a local SQLite database.

const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db.cjs");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#1e293b",
    title: "ERP — نظام المشتريات",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  const indexHtml = path.join(__dirname, "..", "dist", "index.html");
  mainWindow.loadFile(indexHtml).catch((err) => {
    console.error("Failed to load index.html:", err);
  });

  // Optional: dev tools only if opened with --dev flag
  if (process.argv.includes("--dev")) mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  db.init(path.join(app.getPath("userData"), "erp.db"));
  registerIpc();
  createWindow();

  // A minimal Arabic-friendly application menu.
  const template = [
    {
      label: "ملف",
      submenu: [
        { label: "نسخ احتياطي...", click: () => backupDb() },
        { label: "استعادة من نسخة...", click: () => restoreDb() },
        { type: "separator" },
        { role: "quit", label: "خروج" },
      ],
    },
    {
      label: "عرض",
      submenu: [
        { role: "reload", label: "إعادة تحميل" },
        { role: "toggleDevTools", label: "أدوات المطور" },
        { type: "separator" },
        { role: "resetZoom", label: "الحجم الافتراضي" },
        { role: "zoomIn", label: "تكبير" },
        { role: "zoomOut", label: "تصغير" },
        { type: "separator" },
        { role: "togglefullscreen", label: "ملء الشاشة" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc() {
  ipcMain.handle("db:getAll", (_e, table) => db.getAll(table));
  ipcMain.handle("db:setAll", (_e, table, rows) => db.setAll(table, rows));
  ipcMain.handle("db:getKV", (_e, key) => db.getKV(key));
  ipcMain.handle("db:setKV", (_e, key, value) => db.setKV(key, value));
  ipcMain.handle("db:hashPassword", (_e, pw, salt) => db.hashPassword(pw, salt));
  ipcMain.handle("db:randomSalt", () => db.randomSalt());
  ipcMain.handle("db:backup", (_e, dest) => db.backup(dest));
  ipcMain.handle("db:restore", (_e, src) => db.restore(src));
}

async function backupDb() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "حفظ نسخة احتياطية",
    defaultPath: `erp-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: "SQLite Database", extensions: ["db"] }],
  });
  if (canceled || !filePath) return;
  fs.copyFileSync(db.dbPath(), filePath);
  dialog.showMessageBox(mainWindow, { message: "تم حفظ النسخة الاحتياطية", type: "info" });
}

async function restoreDb() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "اختر ملف نسخة احتياطية",
    filters: [{ name: "SQLite Database", extensions: ["db"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return;
  const ok = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["إلغاء", "استبدال"],
    defaultId: 0,
    cancelId: 0,
    message: "سيتم استبدال البيانات الحالية بالنسخة المختارة. هل أنت متأكد؟",
  });
  if (ok.response !== 1) return;
  db.close();
  fs.copyFileSync(filePaths[0], db.dbPath());
  db.init(db.dbPath());
  mainWindow.reload();
}