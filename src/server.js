import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { config, getCookieFromRequest } from "./config.js";
import { maskCookie } from "./chrome-cookie.js";
import { KlingBrowserContextClient } from "./browser-context-client.js";
import { readLocalFileAsBase64 } from "./file-utils.js";
import { KlingWebClient } from "./kling-web-client.js";
import {
  buildFirstLastFrameVideoTask,
  buildImageToVideoTask,
  buildTextToVideoTask,
} from "./task-builders.js";

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

async function uploadLocalImage(filePath) {
  const file = readLocalFileAsBase64(filePath);
  const upload = await browserClient.uploadFile({
    fileName: file.fileName,
    base64: file.base64,
    mimeType: file.mimeType,
    type: "image",
    verify: true,
    fileType: "image",
  });

  return {
    file_path: file.filePath,
    file_name: file.fileName,
    mime_type: file.mimeType,
    upload,
  };
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

app.post("/v2/browser/upload/image", async (req, res) => {
  try {
    const { file_path, verify = true } = req.body || {};
    if (!file_path) {
      return res.status(400).json({ ok: false, error: "file_path is required" });
    }

    const uploaded = await uploadLocalImage(file_path);

    res.json({
      ok: true,
      file: {
        file_path: uploaded.file_path,
        file_name: uploaded.file_name,
        mime_type: uploaded.mime_type,
      },
      data: uploaded.upload,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/upload/file", async (req, res) => {
  try {
    const { file_path, type = "image", verify = true, file_type = "" } = req.body || {};
    if (!file_path) {
      return res.status(400).json({ ok: false, error: "file_path is required" });
    }

    const file = readLocalFileAsBase64(file_path);
    const data = await browserClient.uploadFile({
      fileName: file.fileName,
      base64: file.base64,
      mimeType: file.mimeType,
      type,
      verify,
      fileType: file_type || type,
    });

    res.json({
      ok: true,
      file: {
        file_path: file.filePath,
        file_name: file.fileName,
        mime_type: file.mimeType,
      },
      data,
    });
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

app.post("/v2/browser/tasks/image-to-video", async (req, res) => {
  try {
    const {
      image_url,
      image_path,
      tail_image_url,
      tail_image_path,
      prompt,
      negative_prompt,
      duration,
      aspect_ratio,
      kling_version,
      model_mode,
      enable_audio,
      tail_image_enabled = "false",
      poll = false,
      poll_interval_ms,
      poll_timeout_ms,
    } = req.body || {};

    let resolvedImageUrl = image_url;
    let resolvedTailImageUrl = tail_image_url;
    let uploaded = null;

    if (!resolvedImageUrl && image_path) {
      const uploadedImage = await uploadLocalImage(image_path);
      resolvedImageUrl = uploadedImage.upload.url;
      uploaded = {
        image: {
          ...uploadedImage,
        },
      };
    }

    if (!resolvedTailImageUrl && tail_image_path) {
      const uploadedTailImage = await uploadLocalImage(tail_image_path);
      resolvedTailImageUrl = uploadedTailImage.upload.url;
      uploaded = {
        ...(uploaded || {}),
        tail_image: {
          ...uploadedTailImage,
        },
      };
    }

    const task = buildImageToVideoTask({
      imageUrl: resolvedImageUrl,
      tailImageUrl: resolvedTailImageUrl,
      prompt,
      negativePrompt: negative_prompt,
      duration,
      aspectRatio: aspect_ratio,
      klingVersion: kling_version,
      modelMode: model_mode,
      enableAudio: enable_audio,
      tailImageEnabled: tail_image_enabled,
    });

    const submitted = await browserClient.submitTask(task);

    if (!poll) {
      return res.json({ ok: true, data: submitted, task, uploaded });
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
      uploaded,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/tasks/first-last-frame", async (req, res) => {
  try {
    const {
      image_url,
      image_path,
      tail_image_url,
      tail_image_path,
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

    let resolvedImageUrl = image_url;
    let resolvedTailImageUrl = tail_image_url;
    let uploaded = null;

    if (!resolvedImageUrl && image_path) {
      const uploadedImage = await uploadLocalImage(image_path);
      resolvedImageUrl = uploadedImage.upload.url;
      uploaded = {
        image: uploadedImage,
      };
    }

    if (!resolvedTailImageUrl && tail_image_path) {
      const uploadedTailImage = await uploadLocalImage(tail_image_path);
      resolvedTailImageUrl = uploadedTailImage.upload.url;
      uploaded = {
        ...(uploaded || {}),
        tail_image: uploadedTailImage,
      };
    }

    const task = buildFirstLastFrameVideoTask({
      imageUrl: resolvedImageUrl,
      tailImageUrl: resolvedTailImageUrl,
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
      return res.json({ ok: true, data: submitted, task, uploaded });
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
      uploaded,
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
