import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { config, getCookieFromRequest } from "./config.js";
import {
  isAuthExpiredError,
  KLING_LOGIN_URL,
  normalizeAuthError,
} from "./auth-errors.js";
import { maskCookie } from "./chrome-cookie.js";
import { KlingBrowserContextClient } from "./browser-context-client.js";
import { readLocalFileAsBase64 } from "./file-utils.js";
import { KlingWebClient } from "./kling-web-client.js";
import {
  buildFirstLastFrameVideoTask,
  buildImageToVideoTask,
  buildOmniVideoPriceBody,
  buildOmniVideoRecognitionBody,
  buildOmniVideoSubmitTask,
  buildOmniVideoTemplateBody,
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
  const normalized = normalizeAuthError(error) || error;
  const status =
    Number.isInteger(normalized?.status) &&
    normalized.status >= 100 &&
    normalized.status <= 599
      ? normalized.status
      : 500;

  console.error("kling-free-api error:", normalized);

  res.status(status).json({
    ok: false,
    error: normalized?.message || "Unknown error",
    code: normalized?.code || null,
    data:
      normalized?.data ||
      (status === 401
        ? {
            reauth_required: true,
            login_url: KLING_LOGIN_URL,
          }
        : null),
  });
}

function parseCapturedEvents(events = []) {
  const findLastRequest = (needle) =>
    [...events]
      .reverse()
      .find((event) => event.type === "request" && event.url.includes(needle));

  const findLastResponse = (needle) =>
    [...events]
      .reverse()
      .find((event) => event.type === "response" && event.url.includes(needle));

  const parseJson = (value) => {
    if (!value || typeof value !== "string") {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  return {
    request: {
      omni_intent_recognition: parseJson(
        findLastRequest("/api/omni/intent-recognition")?.postData
      ),
      omni_submit_config_template: parseJson(
        findLastRequest("/api/omni/submit-config-template")?.postData
      ),
      task_price: parseJson(findLastRequest("/api/task/price")?.postData),
      task_submit: parseJson(findLastRequest("/api/task/submit")?.postData),
    },
    response: {
      omni_intent_recognition:
        findLastResponse("/api/omni/intent-recognition")?.body || null,
      omni_submit_config_template:
        findLastResponse("/api/omni/submit-config-template")?.body || null,
      task_price: findLastResponse("/api/task/price")?.body || null,
      task_submit: findLastResponse("/api/task/submit")?.body || null,
    },
  };
}

async function uploadLocalImage(filePath) {
  return uploadLocalFile(filePath, { type: "image", fileType: "image" });
}

async function uploadLocalFile(
  filePath,
  { type = "image", verify = true, fileType = type } = {}
) {
  const file = readLocalFileAsBase64(filePath);
  const upload = await browserClient.uploadFile({
    fileName: file.fileName,
    base64: file.base64,
    mimeType: file.mimeType,
    type,
    verify,
    fileType,
  });

  return {
    file_path: file.filePath,
    file_name: file.fileName,
    mime_type: file.mimeType,
    upload,
  };
}

async function submitBrowserTaskAndMaybePoll(
  task,
  { poll = false, pollIntervalMs, pollTimeoutMs } = {}
) {
  const submitted = await browserClient.submitTask(task);

  if (!poll) {
    return { submitted, final: null };
  }

  const taskId = submitted?.data?.task?.id || submitted?.task?.id || submitted?.taskId;
  if (!taskId) {
    throw {
      status: 502,
      message: "Task submitted but task id was missing in response",
      data: submitted,
    };
  }

  const final = await browserClient.pollTask(taskId, {
    intervalMs: Number(pollIntervalMs || 5000),
    timeoutMs: Number(pollTimeoutMs || 300000),
  });

  return { submitted, final };
}

function normalizeOmniInputName(type, index) {
  return `${type}_${index}`;
}

function normalizeOmniInputType(type = "") {
  const value = String(type || "").toLowerCase();
  return value === "video" ? "video" : "image";
}

async function resolveOmniVideoInputs(body = {}) {
  const uploaded = {};
  const inputs = [];
  let imageIndex = 1;
  let videoIndex = 1;

  const appendInput = async ({ name, type, url, path }) => {
    const normalizedType = normalizeOmniInputType(type);
    const resolvedName =
      name ||
      normalizeOmniInputName(
        normalizedType,
        normalizedType === "video" ? videoIndex : imageIndex
      );

    let resolvedUrl = url;
    if (!resolvedUrl && path) {
      const uploadedFile = await uploadLocalFile(path, {
        type: normalizedType,
        fileType: normalizedType,
      });
      resolvedUrl = uploadedFile.upload.url;
      uploaded[resolvedName] = uploadedFile;
    }

    if (!resolvedUrl) {
      throw new Error(`Missing URL for omni input ${resolvedName}`);
    }

    const input = {
      name: resolvedName,
      type: normalizedType,
      inputType: "URL",
      url: String(resolvedUrl),
    };
    inputs.push(input);

    if (normalizedType === "video") {
      videoIndex += 1;
      return;
    }

    imageIndex += 1;
  };

  if (body.image_url || body.image_path) {
    await appendInput({
      name: body.image_name,
      type: "image",
      url: body.image_url,
      path: body.image_path,
    });
  }

  if (body.video_url || body.video_path) {
    await appendInput({
      name: body.video_name,
      type: "video",
      url: body.video_url,
      path: body.video_path,
    });
  }

  for (const item of Array.isArray(body.inputs) ? body.inputs : []) {
    await appendInput({
      name: item?.name,
      type: item?.type,
      url: item?.url,
      path: item?.path,
    });
  }

  return {
    inputs: inputs.map(({ type, ...input }) => input),
    uploaded: Object.keys(uploaded).length ? uploaded : null,
    hasVideo: inputs.some((input) => input.type === "video"),
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

app.get("/v2/browser/auth/check", async (req, res) => {
  try {
    const data = await browserClient.getProfileAndFeatures();
    res.json({
      ok: true,
      authenticated: true,
      login_url: KLING_LOGIN_URL,
      user_id: data?.data?.userProfile?.userId || null,
      login: data?.data?.login ?? true,
    });
  } catch (error) {
    const normalized = normalizeAuthError(error);
    if (isAuthExpiredError(normalized)) {
      return res.json({
        ok: true,
        authenticated: false,
        login_url: KLING_LOGIN_URL,
        error: normalized.message,
        code: normalized.code,
      });
    }
    sendError(res, normalized);
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

app.get("/v2/browser/omni/recommend", async (req, res) => {
  try {
    const type = String(req.query.type || "");
    if (!type) {
      return res.status(400).json({ ok: false, error: "type is required" });
    }

    const data = await browserClient.request(
      {
        url: "/api/omni/pre-skill/recommend",
        method: "GET",
        params: { type },
      },
      {},
      308
    );

    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/omni/intent-recognition", async (req, res) => {
  try {
    const data = await browserClient.request(
      {
        url: "/api/omni/intent-recognition",
        method: "POST",
        data: req.body || {},
      },
      {},
      308,
      Number(req.body?.requestTimeoutMs || config.browserRequestTimeoutMs)
    );

    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/omni/submit-config-template", async (req, res) => {
  try {
    const data = await browserClient.request(
      {
        url: "/api/omni/submit-config-template",
        method: "POST",
        data: req.body || {},
      },
      {},
      308,
      Number(req.body?.requestTimeoutMs || config.browserRequestTimeoutMs)
    );

    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/omni/video-preprocess", async (req, res) => {
  try {
    const { video_url } = req.body || {};
    if (!video_url) {
      return res.status(400).json({ ok: false, error: "video_url is required" });
    }

    const data = await browserClient.request(
      {
        url: "/api/task/preprocess",
        method: "POST",
        data: {
          type: "omni_base_video_preprocess",
          inputs: [{ name: "video", inputType: "URL", url: video_url }],
          arguments: [{ name: "sam2Mode", value: "startSession" }],
        },
      },
      {},
      308,
      Number(req.body?.requestTimeoutMs || config.browserRequestTimeoutMs)
    );

    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/omni/capture-video-flow", async (req, res) => {
  try {
    const { image_path, wait_after_upload_ms, max_events } = req.body || {};
    if (!image_path) {
      return res.status(400).json({ ok: false, error: "image_path is required" });
    }

    const data = await browserClient.captureOmniVideoFlow({
      imagePath: image_path,
      waitAfterUploadMs: Number(wait_after_upload_ms || 25000),
      maxEvents: Number(max_events || 50),
    });

    res.json({ ok: true, data, parsed: parseCapturedEvents(data.events) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/omni/video/build-recognition-body", async (req, res) => {
  try {
    const body = buildOmniVideoRecognitionBody(req.body || {});
    res.json({ ok: true, data: body });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/omni/video/build-template-body", async (req, res) => {
  try {
    const body = buildOmniVideoTemplateBody(req.body || {});
    res.json({ ok: true, data: body });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/omni/video/build-price-body", async (req, res) => {
  try {
    const body = buildOmniVideoPriceBody(req.body || {});
    res.json({ ok: true, data: body });
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

    const { submitted, final } = await submitBrowserTaskAndMaybePoll(task, {
      poll,
      pollIntervalMs: poll_interval_ms,
      pollTimeoutMs: poll_timeout_ms,
    });

    res.json({
      ok: true,
      data: poll ? { submitted, final } : submitted,
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

    const { submitted, final } = await submitBrowserTaskAndMaybePoll(task, {
      poll,
      pollIntervalMs: poll_interval_ms,
      pollTimeoutMs: poll_timeout_ms,
    });

    res.json({
      ok: true,
      data: poll ? { submitted, final } : submitted,
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

    const { submitted, final } = await submitBrowserTaskAndMaybePoll(task, {
      poll,
      pollIntervalMs: poll_interval_ms,
      pollTimeoutMs: poll_timeout_ms,
    });

    res.json({
      ok: true,
      data: poll ? { submitted, final } : submitted,
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

    const { submitted, final } = await submitBrowserTaskAndMaybePoll(task, {
      poll,
      pollIntervalMs: poll_interval_ms,
      pollTimeoutMs: poll_timeout_ms,
    });

    res.json({
      ok: true,
      data: poll ? { submitted, final } : submitted,
      task,
      uploaded,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/v2/browser/tasks/omni-video", async (req, res) => {
  try {
    const {
      prompt = "",
      rich_prompt = "",
      skill = "",
      kling_version,
      model_mode,
      duration,
      aspect_ratio,
      image_count,
      creation_entrance,
      enable_audio,
      customize_multi_shots,
      prefer_multi_shots,
      setting_keys,
      callback_payloads,
      poll = false,
      poll_interval_ms,
      poll_timeout_ms,
    } = req.body || {};

    const { inputs, uploaded, hasVideo } = await resolveOmniVideoInputs(
      req.body || {}
    );

    if (hasVideo) {
      return res.status(400).json({
        ok: false,
        error:
          "omni-video route does not support video reference inputs yet; use image/text inputs for now",
        code: "OMNI_VIDEO_INPUT_UNSUPPORTED",
        data: {
          supported_input_types: ["image", "text"],
        },
      });
    }

    const recognitionBody = buildOmniVideoRecognitionBody({
      inputs,
      prompt,
      richPrompt: rich_prompt,
      skill,
      klingVersion: kling_version,
      enableAudio: enable_audio,
      customizeMultiShots: customize_multi_shots,
      preferMultiShots: prefer_multi_shots,
      callbackPayloads: callback_payloads,
    });

    const recognition = await browserClient.request({
      url: "/api/omni/intent-recognition",
      method: "POST",
      data: recognitionBody,
    });

    const omniRecognition = recognition?.data?.omniRecognition;
    if (!omniRecognition) {
      return res.status(502).json({
        ok: false,
        error: "Omni intent recognition did not return omniRecognition",
        data: recognition,
      });
    }

    const task = buildOmniVideoSubmitTask({
      inputs,
      omniRecognition,
      prompt,
      richPrompt: rich_prompt,
      skill,
      klingVersion: kling_version,
      modelMode: model_mode,
      duration,
      aspectRatio: aspect_ratio,
      imageCount: image_count,
      creationEntrance: creation_entrance,
      enableAudio: enable_audio,
      customizeMultiShots: customize_multi_shots,
      preferMultiShots: prefer_multi_shots,
      settingKeys: setting_keys,
      callbackPayloads: callback_payloads,
    });

    const price = await browserClient.request({
      url: "/api/task/price",
      method: "POST",
      data: buildOmniVideoPriceBody({
        inputs,
        omniRecognition,
        prompt,
        richPrompt: rich_prompt,
        skill,
        klingVersion: kling_version,
        modelMode: model_mode,
        duration,
        aspectRatio: aspect_ratio,
        imageCount: image_count,
        creationEntrance: creation_entrance,
        enableAudio: enable_audio,
        customizeMultiShots: customize_multi_shots,
        preferMultiShots: prefer_multi_shots,
        settingKeys: setting_keys,
        callbackPayloads: callback_payloads,
      }),
    });

    const { submitted, final } = await submitBrowserTaskAndMaybePoll(task, {
      poll,
      pollIntervalMs: poll_interval_ms,
      pollTimeoutMs: poll_timeout_ms,
    });

    res.json({
      ok: true,
      data: poll ? { recognition, price, submitted, final } : { recognition, price, submitted },
      task,
      inputs,
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
