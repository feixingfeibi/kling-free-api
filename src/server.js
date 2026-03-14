import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { config, getCookieFromRequest } from "./config.js";
import { KlingWebClient } from "./kling-web-client.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

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
  res.status(error.status || 500).json({
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
  });
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
