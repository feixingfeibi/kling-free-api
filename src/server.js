import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { config, getCookieFromRequest } from "./config.js";
import { KlingBrowserContextClient } from "./browser-context-client.js";
import { KlingWebClient } from "./kling-web-client.js";
import { buildTextToVideoTask } from "./task-builders.js";

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

function sendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
      ? error.status
      : 500;

  console.error("kling-free-api error:", error);

  res.status(status).json({
    ok: false,
    error: error.message || "Unknown error",
    data: error.data || null,
  });
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "kling-free-api",
    api_base_url: config.apiBaseUrl,
    site_base_url: config.siteBaseUrl,
    cookie_configured: Boolean(getCookieFromRequest(req)),
    browser_headless: config.browserHeadless,
    browser_request_timeout_ms: config.browserRequestTimeoutMs,
  });
});

app.get("/v2/browser/health", async (req, res) => {
  try {
    await browserClient.ensureReady();
    res.json({
      ok: true,
      module_url: browserClient.moduleUrl,
      site_base_url: config.siteBaseUrl,
      api_base_url: config.apiBaseUrl,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/v2/browser/account/profile", async (req, res) => {
  try {
    const data = await browserClient.getProfileAndFeatures();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/request", async (req, res) => {
  try {
    const {
      requestConfig,
      requestCustomConfig = {},
      localeCode = 308,
      requestTimeoutMs,
    } = req.body || {};

    if (!requestConfig || typeof requestConfig !== "object") {
      return res
        .status(400)
        .json({ ok: false, error: "requestConfig object is required" });
    }

    const data = await browserClient.request(
      requestConfig,
      requestCustomConfig,
      localeCode,
      Number(requestTimeoutMs || config.browserRequestTimeoutMs)
    );
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/tasks/submit", async (req, res) => {
  try {
    const { task, poll = false, poll_interval_ms, poll_timeout_ms } = req.body || {};
    if (!task || typeof task !== "object") {
      return res.status(400).json({ ok: false, error: "task object is required" });
    }

    const submitted = await browserClient.submitTask(task);

    if (!poll) {
      return res.json({ ok: true, data: submitted });
    }

    const taskId = submitted?.task?.id || submitted?.taskId;
    if (!taskId) {
      return res.status(502).json({
        ok: false,
        error: "Task submitted but task id was missing in response",
        data: submitted,
      });
    }

    const finalState = await browserClient.pollTask(taskId, {
      intervalMs: Number(poll_interval_ms || 5000),
      timeoutMs: Number(poll_timeout_ms || 300000),
    });

    res.json({
      ok: true,
      data: {
        submitted,
        final: finalState,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/tasks/text-to-video", async (req, res) => {
  try {
    const {
      prompt,
      negative_prompt,
      duration,
      aspect_ratio,
      kling_version,
      model_mode,
      enable_audio,
      poll = false,
      poll_interval_ms,
      poll_timeout_ms,
    } = req.body || {};

    const task = buildTextToVideoTask({
      prompt,
      negativePrompt: negative_prompt,
      duration,
      aspectRatio: aspect_ratio,
      klingVersion: kling_version,
      modelMode: model_mode,
      enableAudio: enable_audio,
    });

    const submitted = await browserClient.submitTask(task);

    if (!poll) {
      return res.json({ ok: true, data: submitted, task });
    }

    const taskId = submitted?.task?.id || submitted?.taskId;
    if (!taskId) {
      return res.status(502).json({
        ok: false,
        error: "Task submitted but task id was missing in response",
        data: submitted,
      });
    }

    const finalState = await browserClient.pollTask(taskId, {
      intervalMs: Number(poll_interval_ms || 5000),
      timeoutMs: Number(poll_timeout_ms || 300000),
    });

    res.json({
      ok: true,
      data: {
        submitted,
        final: finalState,
      },
      task,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/v2/browser/tasks/:taskId", async (req, res) => {
  try {
    const data = await browserClient.getTaskStatus(req.params.taskId);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/v2/browser/tasks/:taskId/poll", async (req, res) => {
  try {
    const data = await browserClient.pollTask(req.params.taskId, {
      intervalMs: Number(req.query.interval_ms || 5000),
      timeoutMs: Number(req.query.timeout_ms || 300000),
    });
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/v1/account/profile", async (req, res) => {
  try {
    const client = getClient(req);
    const data = await client.getProfileAndFeatures();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/v1/upload/issue-token", async (req, res) => {
  try {
    const filename = req.query.filename;
    if (!filename) {
      return res.status(400).json({ ok: false, error: "filename is required" });
    }

    const client = getClient(req);
    const data = await client.issueUploadToken(String(filename));
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v1/upload/verify", async (req, res) => {
  try {
    const { token, type = "image" } = req.body || {};
    if (!token) {
      return res.status(400).json({ ok: false, error: "token is required" });
    }

    const client = getClient(req);
    const data = await client.verifyUploadToken(token, type);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v1/tasks/submit", async (req, res) => {
  try {
    const { task, poll = false, poll_interval_ms, poll_timeout_ms } = req.body || {};
    if (!task || typeof task !== "object") {
      return res.status(400).json({ ok: false, error: "task object is required" });
    }

    const client = getClient(req);
    const submitted = await client.submitTask(task);

    if (!poll) {
      return res.json({ ok: true, data: submitted });
    }

    const taskId = submitted?.task?.id || submitted?.taskId;
    if (!taskId) {
      return res.status(502).json({
        ok: false,
        error: "Task submitted but task id was missing in response",
        data: submitted,
      });
    }

    const finalState = await client.pollTask(taskId, {
      intervalMs: Number(poll_interval_ms || 5000),
      timeoutMs: Number(poll_timeout_ms || 300000),
    });

    res.json({
      ok: true,
      data: {
        submitted,
        final: finalState,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/v1/tasks/:taskId", async (req, res) => {
  try {
    const client = getClient(req);
    const data = await client.getTaskStatus(req.params.taskId);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/v1/tasks/:taskId/poll", async (req, res) => {
  try {
    const client = getClient(req);
    const data = await client.pollTask(req.params.taskId, {
      intervalMs: Number(req.query.interval_ms || 5000),
      timeoutMs: Number(req.query.timeout_ms || 300000),
    });
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.listen(config.port, () => {
  console.log(
    `kling-free-api listening on http://127.0.0.1:${config.port}`
  );
});

async function shutdown() {
  await browserClient.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
