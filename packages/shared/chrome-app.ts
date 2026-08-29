/**
 * Chrome app-mode window discovery.
 *
 * Chrome-family browsers accept `--app=<url>`, which opens a frameless
 * application window instead of a tab in the user's existing window. This is
 * how Plannotator gets a dedicated window without shipping a native shell.
 *
 * The random local port is not a problem here. Chrome remembers an app
 * window's geometry under `browser.app_window_placement` keyed by HOST AND
 * PATH ("localhost_/"), never by port — verified by launching two sessions on
 * different random ports against one profile and getting a single restored
 * entry. So a session reopens at the size and position the user left it at
 * even though `Bun.serve({ port: 0 })` hands out a new port every run.
 *
 * Every setting the app persists is already a cookie rather than
 * localStorage (see packages/ui/utils/storage.ts) precisely because of that
 * random port, and cookies ignore port — so app mode needs no storage work.
 */

import { existsSync } from "node:fs";
import { delimiter, join, basename } from "node:path";
import os from "node:os";

/**
 * Browsers whose CLI implements `--app=`. All Chromium derivatives do; the
 * check is applied to a PLANNOTATOR_BROWSER value so an explicitly chosen
 * Chrome-family browser is driven in app mode, while an explicitly chosen
 * non-Chromium browser (Firefox, Safari) opts the session out entirely
 * rather than being silently replaced by Chrome.
 */
const CHROME_FAMILY_RE =
  /(google[ _-]?chrome|chromium|\bchrome\b|brave|msedge|microsoft[ _-]?edge|\bedge\b|vivaldi|opera)/i;

export function isChromeAppCapableBrowser(value: string | undefined): boolean {
  if (!value) return false;
  return CHROME_FAMILY_RE.test(value);
}

function firstExisting(paths: string[]): string | undefined {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

/** Resolve a bare command name against PATH (node-only, no Bun.which). */
function whichOnPath(command: string): string | undefined {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Turn a macOS PLANNOTATOR_BROWSER value into an executable path.
 *
 * `open -a "Google Chrome" --args --app=URL` CANNOT be used: macOS silently
 * drops `--args` when the application is already running, which would hand
 * the user an ordinary tab with no error. The binary inside the bundle has to
 * be executed directly — it relays to the running instance and exits (~100ms).
 */
function macBinaryForBrowser(value: string): string | undefined {
  if (value.includes("/") && !value.endsWith(".app")) {
    return existsSync(value) ? value : undefined;
  }
  const appPath = value.endsWith(".app")
    ? value
    : join("/Applications", `${value}.app`);
  const name = basename(appPath, ".app");
  const home = os.homedir();
  return firstExisting([
    join(appPath, "Contents", "MacOS", name),
    join(home, appPath.startsWith("/") ? appPath.slice(1) : appPath, "Contents", "MacOS", name),
  ]);
}

function macCandidates(): string[] {
  const home = os.homedir();
  const rel = [
    "Google Chrome.app/Contents/MacOS/Google Chrome",
    "Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "Chromium.app/Contents/MacOS/Chromium",
    "Brave Browser.app/Contents/MacOS/Brave Browser",
    "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "Vivaldi.app/Contents/MacOS/Vivaldi",
  ];
  return [
    ...rel.map((r) => join("/Applications", r)),
    ...rel.map((r) => join(home, "Applications", r)),
  ];
}

function winCandidates(): string[] {
  const roots = [
    process.env["PROGRAMFILES"],
    process.env["PROGRAMFILES(X86)"],
    process.env["LOCALAPPDATA"],
  ].filter(Boolean) as string[];
  const rel = [
    join("Google", "Chrome", "Application", "chrome.exe"),
    join("Chromium", "Application", "chrome.exe"),
    join("BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    join("Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  return roots.flatMap((root) => rel.map((r) => join(root, r)));
}

const LINUX_COMMANDS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "microsoft-edge",
  "vivaldi-stable",
];

/**
 * Locate a Chrome-family executable, honoring an explicit PLANNOTATOR_BROWSER
 * choice when that choice is itself Chrome-family.
 *
 * Returns undefined when nothing suitable is installed — the caller then falls
 * through to the existing browser chain instead of failing the session.
 */
export function findChromeAppBinary(
  browserSetting?: string,
): string | undefined {
  const platform = process.platform;

  if (browserSetting && isChromeAppCapableBrowser(browserSetting)) {
    if (platform === "darwin") {
      const resolved = macBinaryForBrowser(browserSetting);
      if (resolved) return resolved;
    } else if (browserSetting.includes("/") || browserSetting.includes("\\")) {
      if (existsSync(browserSetting)) return browserSetting;
    } else {
      const resolved = whichOnPath(browserSetting);
      if (resolved) return resolved;
    }
  }

  if (platform === "darwin") return firstExisting(macCandidates());
  if (platform === "win32") return firstExisting(winCandidates());
  for (const command of LINUX_COMMANDS) {
    const resolved = whichOnPath(command);
    if (resolved) return resolved;
  }
  return undefined;
}

/**
 * Args for a Chrome app window.
 *
 * Deliberately no `--window-size`: Chrome persists the window's own geometry
 * across sessions (see the module header), and passing a size every launch
 * would stomp the user's resize on every review.
 */
export function buildChromeAppArgs(url: string): string[] {
  return [`--app=${url}`];
}
