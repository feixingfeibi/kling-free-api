import process from "node:process";

import { resolveBrowserExecutablePath } from "./browser-executable.js";
import { loadKlingCookieFromChrome } from "./chrome-cookie.js";

const autoCookie = process.env.KLING_COOKIE || loadKlingCookieFromChrome();
const browserExecutable = resolveBrowserExecutablePath(
  process.env.KLING_BROWSER_EXECUTABLE_PATH || ""
);

export const config = {
  port: Number(process.env.PORT || 8010),
  apiBaseUrl:
    process.env.KLING_API_BASE_URL || "https://api-app-cn.klingai.com",
  siteBaseUrl: process.env.KLING_SITE_BASE_URL || "https://app.klingai.com",
  cookie: autoCookie,
  acceptLanguage: process.env.KLING_ACCEPT_LANGUAGE || "zh-CN,zh;q=0.9",
  timeZone: process.env.KLING_TIME_ZONE || "Asia/Shanghai",
  browserExecutablePath: browserExecutable.path,
  browserExecutableSource: browserExecutable.source,
  browserExecutableCandidates: browserExecutable.candidates,
  browserUserDataDir:
    process.env.KLING_BROWSER_USER_DATA_DIR || ".browser-profile",
  browserHeadless: process.env.KLING_BROWSER_HEADLESS !== "false",
  enableDebugRoutes: process.env.KLING_ENABLE_DEBUG_ROUTES === "true",
  browserModuleUrl: process.env.KLING_BROWSER_MODULE_URL || "",
  browserRequestTimeoutMs: Number(
    process.env.KLING_BROWSER_REQUEST_TIMEOUT_MS || 120000
  ),
};

export function getCookieFromRequest(req) {
  const headerCookie = req.headers["x-kling-cookie"];
  return headerCookie || loadKlingCookieFromChrome() || config.cookie;
}
