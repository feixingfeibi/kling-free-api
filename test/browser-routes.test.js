import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { sendError, createRequireDebugRoutesEnabled } from "../src/http-helpers.js";
import { registerBrowserRoutes } from "../src/routes/browser-routes.js";

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { status: response.status, body };
}

function createBrowserApp({
  browserClient = {},
  enableDebugRoutes = false,
  configOverrides = {},
  getCookieFromRequest = () => "cookie=value",
} = {}) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const config = {
    apiBaseUrl: "https://api-app-cn.klingai.com",
    siteBaseUrl: "https://app.klingai.com",
    enableDebugRoutes,
    browserExecutablePath: "/tmp/chrome",
    browserExecutableSource: "env",
    browserHeadless: true,
    browserRequestTimeoutMs: 120000,
    ...configOverrides,
  };

  registerBrowserRoutes(app, {
    browserClient,
    config,
    getCookieFromRequest,
    sendError,
    requireDebugRoutesEnabled: createRequireDebugRoutesEnabled(enableDebugRoutes),
  });

  return app;
}

test("browser debug routes are hidden by default", async () => {
  const app = createBrowserApp();

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/v2/browser/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestConfig: { url: "/api/user/profile_and_features", method: "GET" },
      }),
    });

    assert.equal(result.status, 404);
    assert.equal(result.body.code, "DEBUG_ROUTE_DISABLED");
  });
});

test("browser upload image route returns VALIDATION_ERROR for missing file_path", async () => {
  const app = createBrowserApp();

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/v2/browser/upload/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, "VALIDATION_ERROR");
    assert.equal(result.body.data.field, "file_path");
  });
});

test("browser auth check normalizes auth expiry into authenticated false", async () => {
  const app = createBrowserApp({
    browserClient: {
      async getProfileAndFeatures() {
        throw { status: 401, data: { code: 401 } };
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/v2/browser/auth/check");

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.authenticated, false);
    assert.equal(result.body.code, "AUTH_EXPIRED");
  });
});

test("browser omni-video rejects video inputs with explicit unsupported code", async () => {
  const app = createBrowserApp();

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/v2/browser/tasks/omni-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "demo",
        video_url: "https://example.com/input.mp4",
      }),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, "OMNI_VIDEO_INPUT_UNSUPPORTED");
    assert.deepEqual(result.body.data.supported_input_types, ["image", "text"]);
  });
});
