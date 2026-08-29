import { describe, expect, test, afterEach } from "bun:test";
import {
  isChromeAppCapableBrowser,
  buildChromeAppArgs,
  findChromeAppBinary,
} from "./chrome-app";
import { resolveUseChromeApp } from "./config";

const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_FLAG = process.env.PLANNOTATOR_CHROME_APP;

afterEach(() => {
  if (ORIGINAL_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = ORIGINAL_PATH;
  if (ORIGINAL_FLAG === undefined) delete process.env.PLANNOTATOR_CHROME_APP;
  else process.env.PLANNOTATOR_CHROME_APP = ORIGINAL_FLAG;
});

describe("isChromeAppCapableBrowser", () => {
  // Guards the opt-out rule: an explicitly configured non-Chromium browser
  // must NOT be silently replaced by a Chrome app window.
  test("recognizes Chromium derivatives", () => {
    for (const value of [
      "Google Chrome",
      "/Applications/Google Chrome.app",
      "google-chrome-stable",
      "chromium-browser",
      "Brave Browser",
      "microsoft-edge",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ]) {
      expect(isChromeAppCapableBrowser(value)).toBe(true);
    }
  });

  test("rejects non-Chromium browsers and empty values", () => {
    for (const value of ["firefox", "/Applications/Firefox.app", "Safari", "", undefined]) {
      expect(isChromeAppCapableBrowser(value)).toBe(false);
    }
  });
});

describe("buildChromeAppArgs", () => {
  // The whole feature is this one flag; a regression here silently returns
  // the user to an ordinary tab. Deliberate pin.
  test("passes --app and nothing that would stomp remembered geometry", () => {
    expect(buildChromeAppArgs("http://localhost:5173/")).toEqual([
      "--app=http://localhost:5173/",
    ]);
  });
});

describe("findChromeAppBinary", () => {
  test("returns undefined when nothing is installed so the caller can fall back", () => {
    process.env.PATH = "/nonexistent-plannotator-test-path";
    // Only meaningful where the platform probe is PATH-based; macOS/Windows
    // probe fixed install locations that a real machine may well have.
    if (process.platform !== "linux") return;
    expect(findChromeAppBinary(undefined)).toBeUndefined();
  });

  test("does not resolve a non-Chromium browser setting via the family branch", () => {
    process.env.PATH = "/nonexistent-plannotator-test-path";
    if (process.platform !== "linux") return;
    expect(findChromeAppBinary("firefox")).toBeUndefined();
  });
});

describe("resolveUseChromeApp", () => {
  test("defaults on, env var overrides config", () => {
    delete process.env.PLANNOTATOR_CHROME_APP;
    expect(resolveUseChromeApp({})).toBe(true);
    expect(resolveUseChromeApp({ chromeApp: false })).toBe(false);
    // Hand-edited config.json can quote the boolean.
    expect(resolveUseChromeApp({ chromeApp: "false" as never })).toBe(false);

    process.env.PLANNOTATOR_CHROME_APP = "0";
    expect(resolveUseChromeApp({ chromeApp: true })).toBe(false);
    process.env.PLANNOTATOR_CHROME_APP = "true";
    expect(resolveUseChromeApp({ chromeApp: false })).toBe(true);
  });
});
