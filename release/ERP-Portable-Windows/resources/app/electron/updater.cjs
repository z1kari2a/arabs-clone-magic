// Automatic updates — checks GitHub Releases, downloads the new Setup .exe in
// the background, and installs it when the user agrees to restart.
//
// How a release reaches a customer:
//
//   npm run make:setup      → electron-release/ERP-Setup-<version>.exe
//   npm run release:publish → uploads that .exe + latest.yml to the tag v<version>
//
// electron-updater reads latest.yml from the newest GitHub release, compares its
// `version` with the running app's, downloads the .exe named there, and checks
// its sha512 before handing it back. Everything below is the part around that:
// when to look, what the renderer is told, and how the installer is launched.
//
// Two things about this app make the standard setup not quite enough:
//
//   1. main.cjs blocks every http(s) request the app makes (goOffline). That
//      hook lives on the DEFAULT session; electron-updater runs its traffic
//      through a session of its own ("electron-updater" partition), so update
//      checks still go out while the app itself stays offline.
//   2. The installer writes to Program Files, so it needs elevation.
//      autoUpdater.quitAndInstall() spawns it with CreateProcess, which cannot
//      raise UAC — electron-builder ships an elevate.exe helper for exactly
//      this, and a packager-built app has none. install() below launches the
//      installer through Start-Process -Verb RunAs instead, which is what puts
//      the UAC prompt on screen, and quits the app once the user accepts.

const { app, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// The feed — which GitHub repository the releases come from — is NOT configured
// here. electron-updater reads it from resources/app-update.yml, written by
// scripts/make-win.mjs, and reads that same file again for the download cache
// directory regardless of what the code sets. One file, one place to change it.
//
// A first look shortly after launch (not during it — the window should open at
// its usual speed on a machine with no internet, where the request will hang
// until it times out), then a quiet look every few hours for the copies that
// stay open all day.
const FIRST_CHECK_MS = 20 * 1000;
const RECHECK_MS = 4 * 60 * 60 * 1000;

let autoUpdater = null;
let getWindow = () => null;
let quitAndInstallHook = null;
let timer = null;
let checking = false;

/**
 * What the settings screen renders. `phase` drives the whole card:
 *   idle        — nothing known yet
 *   checking    — a check is in flight
 *   none        — checked, this is the newest version
 *   available   — a newer version exists (auto off, or download not started)
 *   downloading — fetching it, `percent` is live
 *   ready       — downloaded and verified, waiting for the restart
 *   error       — `error` holds an Arabic message
 */
const state = {
  phase: "idle",
  currentVersion: app.getVersion(),
  version: null,
  notes: null,
  percent: 0,
  error: null,
  checkedAt: null,
  auto: true,
  /** false in dev and on any platform without a published installer. */
  supported: false,
};

let downloadedFile = null;

// ------------------------------------------------------------------ preference

// Whether to check and download on its own. Kept next to window-state.json
// rather than in the app database: the main process needs it before the
// renderer has booted, and a customer on a metered connection must be able to
// turn a 100 MB background download off.
function prefsPath() {
  return path.join(app.getPath("userData"), "updater.json");
}

function loadPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(prefsPath(), "utf8"));
    return { auto: saved?.auto !== false };
  } catch {
    return { auto: true };
  }
}

function savePrefs() {
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify({ auto: state.auto }));
  } catch {
    /* a read-only profile just means the choice lasts for this session */
  }
}

// ---------------------------------------------------------------------- state

function setState(patch) {
  Object.assign(state, patch);
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send("update:state", { ...state });
}

// GitHub hands release notes over as HTML. The settings card shows plain text.
function plainNotes(notes) {
  if (typeof notes !== "string") return null;
  const text = notes
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, 1200) : null;
}

// Update failures are never fatal and never modal: this is an offline-first
// program, and "no internet" is its normal state, not an error the user has to
// be told about. Only a check the user asked for reports its failure.
function message(err) {
  const raw = String(err?.message ?? err ?? "");
  if (/net::|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/i.test(raw))
    return "تعذّر الاتصال بخادم التحديثات — تحقّق من اتصال الإنترنت.";
  if (/404|Cannot find latest\.yml|HttpError: 404/i.test(raw))
    return "لا توجد نسخة منشورة للتحديث بعد.";
  if (/sha512|checksum/i.test(raw)) return "الملف الذي تم تنزيله تالف — أعد المحاولة.";
  return raw ? `تعذّر التحديث: ${raw}` : "تعذّر التحديث.";
}

// ----------------------------------------------------------------------- init

/**
 * @param {object} options
 * @param {() => Electron.BrowserWindow | null} options.window  live main window
 * @param {() => void} options.quitForInstall  closes the database and exits
 */
function init({ window, quitForInstall }) {
  getWindow = window;
  quitAndInstallHook = quitForInstall;
  state.auto = loadPrefs().auto;

  registerIpc();

  // An unpackaged run has no installed copy to replace, and electron-updater
  // throws on the missing app-update.yml if asked anyway.
  if (!app.isPackaged || process.platform !== "win32") return;

  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.error("electron-updater is not available", err);
    return;
  }

  // Downloading is a decision this module makes (see maybeDownload) — the
  // preference has to be honoured, and a manual "نزّل التحديث" has to work even
  // when it is off.
  autoUpdater.autoDownload = false;
  // Installing on quit would replace the program behind the user's back, and
  // ours needs a UAC prompt that nobody would be there to accept.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  state.supported = true;

  autoUpdater.on("checking-for-update", () => setState({ phase: "checking", error: null }));

  autoUpdater.on("update-not-available", () => {
    setState({ phase: "none", version: null, checkedAt: Date.now() });
  });

  autoUpdater.on("update-available", (info) => {
    setState({
      phase: "available",
      version: info?.version ?? null,
      notes: plainNotes(info?.releaseNotes),
      percent: 0,
      checkedAt: Date.now(),
    });
    maybeDownload();
  });

  autoUpdater.on("download-progress", (p) => {
    setState({ phase: "downloading", percent: Math.round(p?.percent ?? 0) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedFile = info?.downloadedFile ?? null;
    setState({ phase: "ready", version: info?.version ?? state.version, percent: 100 });
    promptToRestart();
  });

  autoUpdater.on("error", (err) => {
    log(err);
    // A background check that fails leaves the card as it was; there is nothing
    // the user did that deserves a red banner.
    if (state.phase === "checking" || state.phase === "downloading")
      setState({ phase: "error", error: message(err) });
  });

  setTimeout(() => void check(false), FIRST_CHECK_MS);
  timer = setInterval(() => void check(false), RECHECK_MS);
  app.on("before-quit", () => timer && clearInterval(timer));
}

function log(...args) {
  console.log("[updater]", ...args);
}

// -------------------------------------------------------------------- actions

/** @param {boolean} manual true when the user asked, which overrides the auto preference. */
async function check(manual) {
  if (!autoUpdater || checking) return { ...state };
  if (!manual && !state.auto) return { ...state };
  // Already downloaded: re-checking would only re-download the same file.
  if (state.phase === "ready" || state.phase === "downloading") return { ...state };

  checking = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log(err);
    if (manual) setState({ phase: "error", error: message(err) });
  } finally {
    // Cleared here rather than in the event handlers: a check that resolves
    // without firing either of them would otherwise block every later one.
    checking = false;
  }
  return { ...state };
}

// The one interruption this feature is allowed: the new version is on disk and
// a restart is all that stands between the user and it. Asked once per
// download — declining leaves the same offer sitting in الإعدادات.
function promptToRestart() {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  dialog
    .showMessageBox(win, {
      type: "info",
      buttons: ["لاحقاً", "إعادة التشغيل الآن"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: "تحديث جاهز",
      message: `الإصدار ${state.version} جاهز للتثبيت`,
      detail:
        "تم تنزيل التحديث. سيُغلق البرنامج ويُعاد فتحه على الإصدار الجديد — بياناتك تبقى كما هي.",
    })
    .then(({ response }) => {
      if (response === 1) install();
    })
    .catch(() => {});
}

function maybeDownload() {
  if (state.auto) void download();
}

async function download() {
  if (!autoUpdater || state.phase === "downloading" || state.phase === "ready") return { ...state };
  setState({ phase: "downloading", percent: 0, error: null });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log(err);
    setState({ phase: "error", error: message(err) });
  }
  return { ...state };
}

/**
 * Runs the downloaded installer elevated and quits so it can replace the files.
 * Returns false — with an error on the state — if it could not be started; the
 * app keeps running in that case, still on the old version.
 */
function install() {
  if (!downloadedFile || !fs.existsSync(downloadedFile)) {
    setState({ phase: "error", error: "ملف التحديث غير موجود — أعد التنزيل." });
    return false;
  }

  // -Verb RunAs is the whole point: it raises the UAC prompt that a plain
  // spawn() cannot. /S installs without any screens, --force-run starts the new
  // version afterwards (see scripts/installer.nsi).
  const quoted = `'${downloadedFile.replace(/'/g, "''")}'`;
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `try { Start-Process -FilePath ${quoted} -ArgumentList '/S','--force-run' -Verb RunAs -ErrorAction Stop } catch { exit 1 }`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );

  // Start-Process returns once Windows has created the process, i.e. after the
  // user answered UAC — so a zero exit means the installer really is running
  // and the app should now get out of its way. A refused prompt exits 1, and
  // the app stays open on the version it already has.
  child.on("close", (code) => {
    if (code === 0) quitAndInstallHook?.();
    else setState({ phase: "ready", error: "تم إلغاء التحديث." });
  });

  // PowerShell missing or blocked by policy: fall back to opening the installer
  // normally. Windows raises UAC for it, and the user clicks through its own
  // screens instead of it being silent.
  child.on("error", (err) => {
    log(err);
    shell
      .openPath(downloadedFile)
      .then(() => quitAndInstallHook?.())
      .catch(() => setState({ phase: "ready", error: "تعذّر تشغيل ملف التحديث." }));
  });

  return true;
}

// ------------------------------------------------------------------------ IPC

function registerIpc() {
  ipcMain.handle("update:state", () => ({ ...state }));
  ipcMain.handle("update:check", () => check(true));
  ipcMain.handle("update:download", () => download());
  ipcMain.handle("update:install", () => install());
  ipcMain.handle("update:setAuto", (_e, auto) => {
    setState({ auto: auto !== false });
    savePrefs();
    if (state.auto && state.phase === "available") void download();
    return { ...state };
  });
}

module.exports = { init, check, download, install, state };
