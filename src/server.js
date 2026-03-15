import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { config, getCookieFromRequest } from "./config.js";
import { maskCookie } from "./chrome-cookie.js";
import { KlingBrowserContextClient } from "./browser-context-client.js";
import { KlingWebClient } from "./kling-web-client.js";
import { createRequireDebugRoutesEnabled, sendError } from "./http-helpers.js";
import { registerBrowserRoutes } from "./routes/browser-routes.js";
import { registerLegacyRoutes } from "./routes/legacy-routes.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

const browserClient = new KlingBrowserContextClient({
  apiBaseUrl: config.apiBaseUrl,
  siteBaseUrl: config.siteBaseUrl,
  cookie: config.cookie,
  acceptLanguage: config.acceptLanguage,
  timeZone: config.timeZone,
  executablePath: config.browserExecutablePath,
  userDataDir: config.browserUserDataDir,
  headless: config.browserHeadless,
  moduleUrl: config.browserModuleUrl,
  requestTimeoutMs: config.browserRequestTimeoutMs,
});

function getClient(req) {
  return new KlingWebClient({
    apiBaseUrl: config.apiBaseUrl,
    siteBaseUrl: config.siteBaseUrl,
    cookie: getCookieFromRequest(req),
    acceptLanguage: config.acceptLanguage,
    timeZone: config.timeZone,
  });
}

const requireDebugRoutesEnabled = createRequireDebugRoutesEnabled(
  config.enableDebugRoutes
);

registerBrowserRoutes(app, {
  browserClient,
  config,
  getCookieFromRequest,
  sendError,
  requireDebugRoutesEnabled,
});

registerLegacyRoutes(app, {
  getClient,
  sendError,
});

app.listen(config.port, () => {
  console.log(`kling-free-api listening on http://127.0.0.1:${config.port}`);
  console.log(
    JSON.stringify(
      {
        api_base_url: config.apiBaseUrl,
        site_base_url: config.siteBaseUrl,
        browser_module_url: config.browserModuleUrl || null,
        cookie_loaded: Boolean(config.cookie),
        cookie_preview: maskCookie(config.cookie),
      },
      null,
      2
    )
  );
});

async function shutdown() {
  await browserClient.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
