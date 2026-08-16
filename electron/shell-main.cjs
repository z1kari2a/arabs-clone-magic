// Licensed Electron shell — the ~small binary you ship to customers.
// It contains NO business code; on first launch it collects a license code,
// activates it against the license server, downloads the encrypted app
// bundle, verifies the signature, decrypts it in RAM, writes the decoded
// files under userData/current-bundle, and loads index.html from there.
//
// Heartbeat runs every 30 minutes. If the server revokes the license or the
// subscription expires, the shell locks the UI on the next heartbeat.

const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const https = require("https");
const db = require("./db.cjs");

// ---- Configuration ---------------------------------------------------------

const SERVER_BASE = process.env.ERP_LICENSE_SERVER || "https://arabs-clone-magic.lovable.app";
const HEARTBEAT_MS = 30 * 60 * 1000; // 30 minutes

let mainWindow = null;
let heartbeatTimer = null;
let backupTimer = null;

// ---- Machine fingerprint ---------------------------------------------------

function machineFingerprint() {
  const parts = [os.platform(), os.arch(), os.hostname()];
  const cpus = os.cpus();
  if (cpus?.[0]) parts.push(cpus[0].model);
  const ifaces = os.networkInterfaces() || {};
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i && !i.internal && i.mac && i.mac !== "00:00:00:00:00:00") {
        parts.push(i.mac);
        break;
      }
    }
  }
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

// ---- License store (userData/license.json) ---------------------------------

function licensePath() {
  return path.join(app.getPath("userData"), "license.json");
}
function bundleDir() {
  return path.join(app.getPath("userData"), "current-bundle");
}

// ---- Local SQLite backups (userData/backups/) -------------------------------
// Distinct from the bundle download below: this backs up business DATA
// (erp.db), not UI code. Kept independent of the cloud backup in cloud-sync.ts
// so data survives even with no network connection.

const BACKUP_KEEP = 14;
const AUTO_BACKUP_MS = 6 * 60 * 60 * 1000; // 6 hours

function backupsDir() {
  return path.join(app.getPath("userData"), "backups");
}

function autoBackup() {
  try {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(dir, `erp-${stamp}.db`);
    db.backup(dest);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("erp-") && f.endsWith(".db"))
      .sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(dir, files.shift()));
    }
    return dest;
  } catch (e) {
    console.error("autoBackup failed", e);
    return null;
  }
}
function readLicense() {
  try {
    return JSON.parse(fs.readFileSync(licensePath(), "utf8"));
  } catch {
    return null;
  }
}
function writeLicense(obj) {
  fs.writeFileSync(licensePath(), JSON.stringify(obj, null, 2), { mode: 0o600 });
}
function clearLicense() {
  try {
    fs.unlinkSync(licensePath());
  } catch {}
  try {
    fs.rmSync(bundleDir(), { recursive: true, force: true });
  } catch {}
}

// ---- Fetch helpers (no external deps) --------------------------------------

function httpJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: opts.method || "GET",
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: {
          "content-type": "application/json",
          "user-agent": "ERP-Shell/1.0",
          ...(opts.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(body) });
          } catch {
            resolve({
              status: res.statusCode || 0,
              json: { ok: false, error: "invalid_response" },
            });
          }
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

// ---- Crypto (mirror of server) --------------------------------------------

function deriveSessionKey(sessionToken) {
  return crypto.scryptSync(sessionToken, "erp-license-v1", 32);
}
function aesGcmDecrypt(payloadB64, key) {
  const buf = Buffer.from(payloadB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function unwrapMasterKey(wrappedB64, sessionToken) {
  return aesGcmDecrypt(wrappedB64, deriveSessionKey(sessionToken));
}

// ---- Bundle installer ------------------------------------------------------

async function downloadAndInstallBundle(license) {
  const url = `${SERVER_BASE}/api/public/license/bundle?session_token=${encodeURIComponent(license.session_token)}&fingerprint=${encodeURIComponent(license.fingerprint)}`;
  const { status, json } = await httpJson(url);
  if (status !== 200 || !json.ok) throw new Error(json.error || `bundle_http_${status}`);

  const masterKey = unwrapMasterKey(license.wrapped_key, license.session_token);
  const decrypted = aesGcmDecrypt(json.payload_b64, masterKey);
  const raw = zlib.gunzipSync(decrypted);
  const manifest = JSON.parse(raw.toString("utf8"));
  if (!manifest?.files) throw new Error("invalid_manifest");

  // Snapshot erp.db right before swapping in new UI code, so a bad update
  // never leaves the user without a recent recovery point for their data.
  autoBackup();

  fs.rmSync(bundleDir(), { recursive: true, force: true });
  fs.mkdirSync(bundleDir(), { recursive: true });
  for (const [rel, b64] of Object.entries(manifest.files)) {
    const dst = path.join(bundleDir(), rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, Buffer.from(b64, "base64"));
  }
  license.bundle_version = manifest.version || json.version;
  writeLicense(license);
}

// ---- License lifecycle -----------------------------------------------------

async function activate(code, deviceName) {
  const fp = machineFingerprint();
  const { status, json } = await httpJson(`${SERVER_BASE}/api/public/license/activate`, {
    method: "POST",
    body: { code, fingerprint: fp, device_name: deviceName || os.hostname() },
  });
  if (status !== 200 || !json.ok) throw new Error(json.error || `activate_http_${status}`);
  const license = {
    code,
    fingerprint: fp,
    session_token: json.session_token,
    wrapped_key: json.wrapped_key,
    bundle_version: json.bundle_version,
    expires_at: json.expires_at,
    license_type: json.license_type,
  };
  writeLicense(license);
  await downloadAndInstallBundle(license);
  return license;
}

async function heartbeat() {
  const license = readLicense();
  if (!license) return { ok: false, error: "no_license" };
  const { status, json } = await httpJson(`${SERVER_BASE}/api/public/license/heartbeat`, {
    method: "POST",
    body: { session_token: license.session_token, fingerprint: license.fingerprint },
  });
  if (status === 200 && json.ok) {
    if (json.bundle_version && json.bundle_version !== license.bundle_version) {
      try {
        await downloadAndInstallBundle(license);
      } catch (e) {
        console.error("update failed", e);
      }
    }
    return { ok: true };
  }
  // Terminal errors: wipe and force re-activation.
  if (
    ["license_disabled", "license_expired", "invalid_session", "device_revoked"].includes(
      json.error,
    )
  ) {
    clearLicense();
    if (mainWindow) mainWindow.loadFile(path.join(__dirname, "..", "electron-shell", "index.html"));
  }
  return { ok: false, error: json.error };
}

// ---- Branding --------------------------------------------------------------
// Mirrors electron/main.cjs: the name and icon chosen in الإعدادات live in the
// renderer's settings row, so the last applied pair is cached here and used at
// window-creation time, before the bundle has booted.

const APP_TITLE = "ERP — نظام المشتريات";

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

function applyBranding(branding) {
  const name =
    typeof branding?.name === "string" && branding.name.trim() ? branding.name.trim() : null;
  const icon =
    typeof branding?.icon === "string" && branding.icon.startsWith("data:image/")
      ? branding.icon
      : null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(name ?? APP_TITLE);
    const image = icon ? nativeImage.createFromDataURL(icon) : null;
    if (image && !image.isEmpty()) mainWindow.setIcon(image);
  }

  try {
    fs.writeFileSync(brandingPath(), JSON.stringify({ name, icon }));
  } catch {
    /* a read-only profile just means the next launch starts from the default */
  }
  return true;
}

// ---- Windows ---------------------------------------------------------------

function createWindow() {
  const branding = loadBranding();
  const customIcon = branding.icon ? nativeImage.createFromDataURL(branding.icon) : null;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#1e293b",
    title: branding.name ?? APP_TITLE,
    icon: customIcon && !customIcon.isEmpty() ? customIcon : undefined,
    webPreferences: {
      preload: path.join(__dirname, "shell-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const license = readLicense();
  const bundleIndex = path.join(bundleDir(), "index.html");
  const hasBundle = fs.existsSync(bundleIndex);
  const url =
    license && hasBundle ? bundleIndex : path.join(__dirname, "..", "electron-shell", "index.html");
  mainWindow.loadFile(url).catch((e) => console.error("loadFile failed", e));

  if (process.argv.includes("--dev")) mainWindow.webContents.openDevTools();
}

// ---- App bootstrap ---------------------------------------------------------

app.whenReady().then(() => {
  db.init(path.join(app.getPath("userData"), "erp.db"));
  registerIpc();
  createWindow();

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "ملف",
        submenu: [
          {
            label: "إلغاء التفعيل على هذا الجهاز",
            click: () => {
              clearLicense();
              mainWindow?.reload();
            },
          },
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
          { role: "togglefullscreen", label: "ملء الشاشة" },
        ],
      },
    ]),
  );

  heartbeatTimer = setInterval(() => {
    heartbeat().catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat().catch(() => {}); // fire once on start

  autoBackup();
  backupTimer = setInterval(autoBackup, AUTO_BACKUP_MS);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (backupTimer) clearInterval(backupTimer);
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => db.close());

// ---- IPC (activation UI ↔ shell) -------------------------------------------

function registerIpc() {
  ipcMain.handle("license:fingerprint", () => machineFingerprint());
  ipcMain.handle("license:status", () => readLicense());
  ipcMain.handle("license:activate", async (_e, code, deviceName) => {
    try {
      await activate(String(code || "").trim(), String(deviceName || "").trim());
      // Reload window to the freshly installed bundle.
      const idx = path.join(bundleDir(), "index.html");
      if (mainWindow && fs.existsSync(idx)) mainWindow.loadFile(idx);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || "activation_failed" };
    }
  });
  ipcMain.handle("license:deactivate", () => {
    clearLicense();
    if (mainWindow) mainWindow.loadFile(path.join(__dirname, "..", "electron-shell", "index.html"));
    return { ok: true };
  });
  ipcMain.handle("license:serverBase", () => SERVER_BASE);

  // Local SQLite bridge (erp.db) — same contract as electron/main.cjs.
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
  ipcMain.handle("db:backup", (_e, dest) => db.backup(dest));
  ipcMain.handle("db:restore", (_e, src) => db.restore(src));
  ipcMain.handle("db:backupNow", () => autoBackup());
  ipcMain.handle("app:setBranding", (_e, branding) => applyBranding(branding));
}
