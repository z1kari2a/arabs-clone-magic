// Licensed Electron shell — the ~small binary you ship to customers.
// It contains NO business code; on first launch it collects a license code,
// activates it against the license server, downloads the encrypted app
// bundle, verifies the signature, decrypts it in RAM, writes the decoded
// files under userData/current-bundle, and loads index.html from there.
//
// Heartbeat runs every 30 minutes. If the server revokes the license or the
// subscription expires, the shell locks the UI on the next heartbeat.

const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const https = require("https");

// ---- Configuration ---------------------------------------------------------

const SERVER_BASE =
  process.env.ERP_LICENSE_SERVER ||
  "https://arabs-clone-magic.lovable.app";
const HEARTBEAT_MS = 30 * 60 * 1000; // 30 minutes

let mainWindow = null;
let heartbeatTimer = null;

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
  try { fs.unlinkSync(licensePath()); } catch {}
  try { fs.rmSync(bundleDir(), { recursive: true, force: true }); } catch {}
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
            resolve({ status: res.statusCode || 0, json: { ok: false, error: "invalid_response" } });
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
      try { await downloadAndInstallBundle(license); } catch (e) { console.error("update failed", e); }
    }
    return { ok: true };
  }
  // Terminal errors: wipe and force re-activation.
  if (["license_disabled", "license_expired", "invalid_session", "device_revoked"].includes(json.error)) {
    clearLicense();
    if (mainWindow) mainWindow.loadFile(path.join(__dirname, "..", "electron-shell", "index.html"));
  }
  return { ok: false, error: json.error };
}

// ---- Windows ---------------------------------------------------------------

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
  const url = license && hasBundle
    ? bundleIndex
    : path.join(__dirname, "..", "electron-shell", "index.html");
  mainWindow.loadFile(url).catch((e) => console.error("loadFile failed", e));

  if (process.argv.includes("--dev")) mainWindow.webContents.openDevTools();
}

// ---- App bootstrap ---------------------------------------------------------

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "ملف", submenu: [
      { label: "إلغاء التفعيل على هذا الجهاز", click: () => { clearLicense(); mainWindow?.reload(); } },
      { type: "separator" },
      { role: "quit", label: "خروج" },
    ]},
    { label: "عرض", submenu: [
      { role: "reload", label: "إعادة تحميل" },
      { role: "toggleDevTools", label: "أدوات المطور" },
      { type: "separator" },
      { role: "togglefullscreen", label: "ملء الشاشة" },
    ]},
  ]));

  heartbeatTimer = setInterval(() => { heartbeat().catch(() => {}); }, HEARTBEAT_MS);
  heartbeat().catch(() => {}); // fire once on start

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (process.platform !== "darwin") app.quit();
});

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
}