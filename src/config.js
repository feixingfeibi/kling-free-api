import process from "node:process";

export const config = {
  port: Number(process.env.PORT || 8010),
  apiBaseUrl:
    process.env.KLING_API_BASE_URL || "https://api-app-cn.klingai.com",
  siteBaseUrl: process.env.KLING_SITE_BASE_URL || "https://app.klingai.com",
  cookie: process.env.KLING_COOKIE || "",
  acceptLanguage: process.env.KLING_ACCEPT_LANGUAGE || "zh-CN,zh;q=0.9",
  timeZone: process.env.KLING_TIME_ZONE || "Asia/Shanghai",
  browserExecutablePath:
    process.env.KLING_BROWSER_EXECUTABLE_PATH ||
    "/Users/luki/.agent-browser/browsers/chrome-146.0.7680.80/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  browserUserDataDir:
    process.env.KLING_BROWSER_USER_DATA_DIR || ".browser-profile",
  browserHeadless: process.env.KLING_BROWSER_HEADLESS !== "false",
  browserModuleUrl: process.env.KLING_BROWSER_MODULE_URL || "",
  browserRequestTimeoutMs: Number(
    process.env.KLING_BROWSER_REQUEST_TIMEOUT_MS || 120000
  ),
};

export function getCookieFromRequest(req) {
  const headerCookie = req.headers["x-kling-cookie"];
  return headerCookie || config.cookie;
}
