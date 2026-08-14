// App identity — the name and icon the program presents itself under.
//
// Both live in `settings` (see erp-types.ts), so they persist through
// localDb.settings and ride along in the cloud backup payload for free: rename
// the app on one machine, restore on another, and the name comes with it.
//
// Applying them is the part that differs per host:
//   web     — <title> and the <link rel="icon"> in the live document
//   desktop — the same, plus the real window title and window/taskbar icon,
//             which only the main process can set (see electron/main.cjs)

import { useEffect } from "react";
import type { Settings } from "./erp-types";
import { useErpStore } from "./erp-store";
// Imported rather than referenced as "/favicon.ico": the desktop build runs
// from file://, where a root-absolute path resolves to file:///favicon.ico and
// resolves to nothing. Going through the bundler yields a path relative to the
// page, which works in both builds.
import bundledIcon from "../assets/app-icon.png";

/** Shown wherever no custom name has been set. */
export const DEFAULT_APP_NAME = "ERP — نظام المشتريات";
/** Bundled artwork, used when no custom icon has been uploaded. */
export const DEFAULT_APP_ICON = bundledIcon;

/** Longest custom name we accept — a window title is not a paragraph. */
const MAX_NAME = 60;
/** Icons are normalized to this square before they are stored. */
const ICON_SIZE = 256;
/**
 * Refuse anything that would bloat every settings write and every cloud push.
 * A 256px PNG lands around 30-60 KB; 400 KB leaves room for a busy photo but
 * still stops someone from pasting a 12-megapixel JPEG into the settings row.
 */
const MAX_ICON_BYTES = 400 * 1024;

export function appName(settings: Settings): string {
  const name = settings.appName?.trim();
  return name || DEFAULT_APP_NAME;
}

export function appIcon(settings: Settings): string {
  return settings.appIcon || DEFAULT_APP_ICON;
}

/**
 * Turn a user-picked image file into a square PNG data URL.
 *
 * Everything goes through a canvas rather than being stored as-is: it forces a
 * known size and format, so a 4 MB JPEG or an SVG with a script in it can never
 * reach the settings row — the canvas only ever gives back pixels.
 */
export function fileToIconDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("الملف المختار ليس صورة"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = ICON_SIZE;
        canvas.height = ICON_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("تعذّر تجهيز الصورة");
        // Fit the whole image inside the square and centre it. Cropping to fill
        // would quietly cut the edges off a wide logo.
        const scale = Math.min(ICON_SIZE / img.width, ICON_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (ICON_SIZE - w) / 2, (ICON_SIZE - h) / 2, w, h);
        const dataUrl = canvas.toDataURL("image/png");
        // base64 carries 3 bytes per 4 characters.
        const bytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
        if (bytes > MAX_ICON_BYTES) {
          reject(new Error("الصورة كبيرة جداً — اختر صورة أبسط أو أصغر"));
          return;
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("تعذّر تجهيز الصورة"));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("تعذّر قراءة الصورة"));
    };
    img.src = url;
  });
}

export function normalizeAppName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME);
}

/** Points the document's favicon at `href`, creating the link tag if needed. */
function setFavicon(href: string) {
  const links = document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']");
  if (links.length === 0) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = href;
    document.head.appendChild(link);
    return;
  }
  links.forEach((link) => {
    link.href = href;
    // The bundled default is an .ico; an uploaded one is always a PNG. Leaving
    // a stale type here makes Firefox skip the new icon.
    link.type = href.startsWith("data:image/png") ? "image/png" : "image/x-icon";
  });
}

/**
 * Push the current identity into the page (and, on desktop, into the window).
 *
 * Safe to call on every settings change — each step is idempotent, and the
 * desktop bridge is simply absent in the browser.
 */
export function applyBranding(settings: Settings) {
  if (typeof document === "undefined") return;
  const name = appName(settings);
  const icon = appIcon(settings);
  document.title = name;
  setFavicon(icon);
  // Fire-and-forget: a desktop window that refuses the icon must not break the
  // page that just renamed itself correctly. An already-installed copy has no
  // "app:setBranding" handler at all, and invoke() rejects on an unknown
  // channel — swallow that instead of surfacing it as an unhandled rejection.
  window.erpNative?.setBranding?.({ name, icon: settings.appIcon ?? null }).catch(() => {});
}

/** Keeps the document title and favicon in step with the stored settings. */
export function useBranding() {
  const settings = useErpStore((s) => s.settings);
  useEffect(() => {
    applyBranding(settings);
  }, [settings.appName, settings.appIcon]);
}
