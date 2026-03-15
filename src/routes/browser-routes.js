import {
  isAuthExpiredError,
  KLING_LOGIN_URL,
  normalizeAuthError,
} from "../auth-errors.js";
import { probeChromeCookieSupport } from "../chrome-cookie.js";
import { readLocalFileAsBase64 } from "../file-utils.js";
import {
  buildFirstLastFrameVideoTask,
  buildImageToVideoTask,
  buildOmniVideoPriceBody,
  buildOmniVideoRecognitionBody,
  buildOmniVideoSubmitTask,
  buildOmniVideoTemplateBody,
  buildTextToVideoTask,
} from "../task-builders.js";
import {
  buildHttpError,
  buildUpstreamResponseError,
  requireNonEmptyString,
  requireObject,
} from "../http-helpers.js";

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

function normalizeOmniInputName(type, index) {
  return `${type}_${index}`;
}

function normalizeOmniInputType(type = "") {
  const value = String(type || "").toLowerCase();
  return value === "video" ? "video" : "image";
}

export function registerBrowserRoutes(
  app,
  {
    browserClient,
    config,
    getCookieFromRequest,
    sendError,
    requireDebugRoutesEnabled,
  }
) {
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

  async function uploadLocalImage(filePath) {
    return uploadLocalFile(filePath, { type: "image", fileType: "image" });
  }

  async function submitBrowserTaskAndMaybePoll(
    task,
    { poll = false, pollIntervalMs, pollTimeoutMs } = {}
  ) {
    const submitted = await browserClient.submitTask(task);

    if (!poll) {
      return { submitted, final: null };
    }

    const taskId =
      submitted?.data?.task?.id || submitted?.task?.id || submitted?.taskId;
    if (!taskId) {
      throw buildUpstreamResponseError(
        "Task submitted but task id was missing in response",
        { response: submitted }
      );
    }

    const final = await browserClient.pollTask(taskId, {
      intervalMs: Number(pollIntervalMs || 5000),
      timeoutMs: Number(pollTimeoutMs || 300000),
    });

    return { submitted, final };
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
        throw buildHttpError(400, `Missing URL for omni input ${resolvedName}`, {
          code: "VALIDATION_ERROR",
          data: {
            field: resolvedName,
            expected: "url or path",
          },
        });
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
    const chromeCookieSupport = probeChromeCookieSupport();
    res.json({
      ok: true,
      service: "kling-free-api",
      api_base_url: config.apiBaseUrl,
      site_base_url: config.siteBaseUrl,
      cookie_configured: Boolean(getCookieFromRequest(req)),
      debug_routes_enabled: config.enableDebugRoutes,
      browser_executable_found: Boolean(config.browserExecutablePath),
      browser_executable_source: config.browserExecutableSource,
      browser_headless: config.browserHeadless,
      browser_request_timeout_ms: config.browserRequestTimeoutMs,
      chrome_cookie_support: chromeCookieSupport,
    });
  });

  app.get("/v2/browser/health", async (req, res) => {
    try {
      await browserClient.warmup();
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

  app.post("/v2/browser/request", requireDebugRoutesEnabled, async (req, res) => {
    try {
      const body = req.body || {};
      const {
        requestConfig,
        requestCustomConfig = {},
        localeCode = 308,
        requestTimeoutMs,
      } = body;

      requireObject(requestConfig, "requestConfig");

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

  app.get(
    "/v2/browser/omni/recommend",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const type = requireNonEmptyString(req.query.type, "type");

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
    }
  );

  app.post(
    "/v2/browser/omni/intent-recognition",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const body = req.body || {};
        const data = await browserClient.request(
          {
            url: "/api/omni/intent-recognition",
            method: "POST",
            data: body,
          },
          {},
          308,
          Number(body?.requestTimeoutMs || config.browserRequestTimeoutMs)
        );

        res.json({ ok: true, data });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    "/v2/browser/omni/submit-config-template",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const body = req.body || {};
        const data = await browserClient.request(
          {
            url: "/api/omni/submit-config-template",
            method: "POST",
            data: body,
          },
          {},
          308,
          Number(body?.requestTimeoutMs || config.browserRequestTimeoutMs)
        );

        res.json({ ok: true, data });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    "/v2/browser/omni/video-preprocess",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const body = req.body || {};
        const videoUrl = requireNonEmptyString(body.video_url, "video_url");

        const data = await browserClient.request(
          {
            url: "/api/task/preprocess",
            method: "POST",
            data: {
              type: "omni_base_video_preprocess",
              inputs: [{ name: "video", inputType: "URL", url: videoUrl }],
              arguments: [{ name: "sam2Mode", value: "startSession" }],
            },
          },
          {},
          308,
          Number(body?.requestTimeoutMs || config.browserRequestTimeoutMs)
        );

        res.json({ ok: true, data });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    "/v2/browser/omni/capture-video-flow",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const body = req.body || {};
        const imagePath = requireNonEmptyString(body.image_path, "image_path");

        const data = await browserClient.captureOmniVideoFlow({
          imagePath,
          waitAfterUploadMs: Number(body.wait_after_upload_ms || 25000),
          maxEvents: Number(body.max_events || 50),
        });

        res.json({ ok: true, data, parsed: parseCapturedEvents(data.events) });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    "/v2/browser/omni/video/build-recognition-body",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const body = buildOmniVideoRecognitionBody(req.body || {});
        res.json({ ok: true, data: body });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    "/v2/browser/omni/video/build-template-body",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const body = buildOmniVideoTemplateBody(req.body || {});
        res.json({ ok: true, data: body });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    "/v2/browser/omni/video/build-price-body",
    requireDebugRoutesEnabled,
    async (req, res) => {
      try {
        const body = buildOmniVideoPriceBody(req.body || {});
        res.json({ ok: true, data: body });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post("/v2/browser/upload/image", async (req, res) => {
    try {
      const body = req.body || {};
      const filePath = requireNonEmptyString(body.file_path, "file_path");
      const uploaded = await uploadLocalImage(filePath);

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
      const body = req.body || {};
      const filePath = requireNonEmptyString(body.file_path, "file_path");
      const { type = "image", verify = true, file_type = "" } = body;
      const file = readLocalFileAsBase64(filePath);
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

  app.post("/v2/browser/tasks/submit", requireDebugRoutesEnabled, async (req, res) => {
    try {
      const body = req.body || {};
      const { poll = false, poll_interval_ms, poll_timeout_ms } = body;
      const task = requireObject(body.task, "task");

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
        throw buildHttpError(
          400,
          "omni-video route does not support video reference inputs yet; use image/text inputs for now",
          {
            code: "OMNI_VIDEO_INPUT_UNSUPPORTED",
            data: {
              supported_input_types: ["image", "text"],
            },
          }
        );
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
        throw buildUpstreamResponseError(
          "Omni intent recognition did not return omniRecognition",
          {
            response: recognition,
          }
        );
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
        data: poll
          ? { recognition, price, submitted, final }
          : { recognition, price, submitted },
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
}
