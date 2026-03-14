import process from "node:process";

export const config = {
  port: Number(process.env.PORT || 8010),
  apiBaseUrl:
    process.env.KLING_API_BASE_URL || "https://api-app-cn.klingai.com",
  siteBaseUrl: process.env.KLING_SITE_BASE_URL || "https://app.klingai.com",
  cookie: process.env.KLING_COOKIE || "",
  acceptLanguage: process.env.KLING_ACCEPT_LANGUAGE || "zh-CN,zh;q=0.9",
  timeZone: process.env.KLING_TIME_ZONE || "Asia/Shanghai",
};

export function getCookieFromRequest(req) {
  const headerCookie = req.headers["x-kling-cookie"];
  return headerCookie || config.cookie;
}
