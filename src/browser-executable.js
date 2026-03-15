import { existsSync } from "node:fs";
import os from "node:os";
import process from "node:process";
import { execFileSync } from "node:child_process";

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function commandExists(command) {
  try {
    const output = execFileSync("sh", ["-lc", `command -v ${command}`], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || "";
  } catch {
    return "";
  }
}

export function getBrowserExecutableCandidates(platform = process.platform) {
  if (platform === "darwin") {
    return dedupe([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      commandExists("google-chrome"),
      commandExists("chromium"),
      commandExists("chromium-browser"),
      commandExists("microsoft-edge"),
    ]);
  }

  if (platform === "linux") {
    return dedupe([
      commandExists("google-chrome"),
      commandExists("google-chrome-stable"),
      commandExists("chromium"),
      commandExists("chromium-browser"),
      commandExists("microsoft-edge"),
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ]);
  }

  if (platform === "win32") {
    return dedupe([
      process.env.LOCALAPPDATA &&
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env["PROGRAMFILES"] &&
        `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env["PROGRAMFILES(X86)"] &&
        `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env["PROGRAMFILES"] &&
        `${process.env["PROGRAMFILES"]}\\Chromium\\Application\\chrome.exe`,
      process.env["PROGRAMFILES(X86)"] &&
        `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]);
  }

  return [];
}

function expandHome(filePath) {
  if (!filePath || !filePath.startsWith("~/")) {
    return filePath;
  }

  return `${os.homedir()}/${filePath.slice(2)}`;
}

export function resolveBrowserExecutablePath(
  configuredPath,
  platform = process.platform
) {
  const normalizedConfiguredPath = expandHome(String(configuredPath || "").trim());

  if (normalizedConfiguredPath && existsSync(normalizedConfiguredPath)) {
    return {
      path: normalizedConfiguredPath,
      source: "env",
      candidates: [normalizedConfiguredPath],
    };
  }

  if (normalizedConfiguredPath) {
    return {
      path: "",
      source: "missing",
      candidates: [normalizedConfiguredPath],
    };
  }

  const candidates = getBrowserExecutableCandidates(platform);
  const discovered = candidates.find((candidate) => existsSync(candidate));

  return {
    path: discovered || "",
    source: discovered ? "auto" : "missing",
    candidates,
  };
}

export function buildBrowserExecutableNotFoundError(candidates = []) {
  return {
    status: 500,
    code: "BROWSER_EXECUTABLE_NOT_FOUND",
    message:
      "No supported Chrome/Chromium executable was found. Set KLING_BROWSER_EXECUTABLE_PATH or install Chrome/Chromium first.",
    data: {
      candidates,
    },
  };
}
