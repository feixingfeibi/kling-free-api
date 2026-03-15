import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { sendError } from "../src/http-helpers.js";
import { registerLegacyRoutes } from "../src/routes/legacy-routes.js";

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

function createLegacyApp(getClient) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  registerLegacyRoutes(app, { getClient, sendError });
  return app;
}

test("legacy upload verify route returns VALIDATION_ERROR for missing token", async () => {
  const app = createLegacyApp(() => {
    throw new Error("getClient should not be called");
  });

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/v1/upload/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, "VALIDATION_ERROR");
    assert.equal(result.body.data.field, "token");
  });
});

test("legacy tasks submit returns UPSTREAM_INVALID_RESPONSE when task id is missing", async () => {
  const app = createLegacyApp(() => ({
    async submitTask() {
      return { task: null };
    },
  }));

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/v1/tasks/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: { type: "demo" },
        poll: true,
      }),
    });

    assert.equal(result.status, 502);
    assert.equal(result.body.code, "UPSTREAM_INVALID_RESPONSE");
  });
});

test("legacy tasks submit validates task object before calling client", async () => {
  let submitCalls = 0;
  const app = createLegacyApp(() => ({
    async submitTask() {
      submitCalls += 1;
      return {};
    },
  }));

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, "/v1/tasks/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: null }),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, "VALIDATION_ERROR");
    assert.equal(result.body.data.field, "task");
    assert.equal(submitCalls, 0);
  });
});

test("legacy upload issue-token route passes validated filename to client", async () => {
  let receivedFilename = null;
  const app = createLegacyApp(() => ({
    async issueUploadToken(filename) {
      receivedFilename = filename;
      return { token: "demo-token" };
    },
  }));

  await withServer(app, async (baseUrl) => {
    const result = await requestJson(
      baseUrl,
      "/v1/upload/issue-token?filename=example.png"
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(receivedFilename, "example.png");
    assert.equal(result.body.data.token, "demo-token");
  });
});
