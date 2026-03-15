import path from "node:path";

import { chromium } from "playwright-core";
import {
  buildBrowserExecutableNotFoundError,
  resolveBrowserExecutablePath,
} from "./browser-executable.js";
import {
  buildAuthExpiredError,
  isAuthExpiredError,
  isAuthExpiredResponseData,
  normalizeAuthError,
} from "./auth-errors.js";
import { loadKlingCookieFromChrome } from "./chrome-cookie.js";

function parseCookieHeader(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf("=");
      if (index < 0) {
        return null;
      }
      return {
        name: entry.slice(0, index).trim(),
        value: entry.slice(index + 1).trim(),
      };
    })
    .filter(Boolean);
}

function buildBrowserCookies(cookieHeader) {
  return parseCookieHeader(cookieHeader).map((cookie) => ({
    ...cookie,
    domain: ".klingai.com",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "None",
  }));
}

function serializeBrowserError(error) {
  const normalized = normalizeAuthError(error) || error;
  return {
    status: normalized?.status || 500,
    code: normalized?.code || null,
    message: normalized?.message || String(normalized),
    data: normalized?.data || null,
    stack: normalized?.stack || null,
  };
}

function isRecoverablePageError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("frame was detached") ||
    message.includes("Target page, context or browser has been closed")
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAcceptLanguage(defaultValue, localeCode) {
  const localeMap = {
    308: "zh-CN,zh;q=0.9",
    1033: "en-US,en;q=0.9",
    1041: "ja-JP,ja;q=0.9",
    1042: "ko-KR,ko;q=0.9",
  };

  return localeMap[Number(localeCode)] || defaultValue;
}

export class KlingBrowserContextClient {
  constructor({
    apiBaseUrl,
    siteBaseUrl,
    cookie,
    acceptLanguage,
    timeZone,
    executablePath,
    userDataDir,
    headless,
    moduleUrl,
    requestTimeoutMs,
  }) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
    this.siteBaseUrl = siteBaseUrl.replace(/\/+$/, "");
    this.cookie = cookie;
    this.acceptLanguage = acceptLanguage;
    this.timeZone = timeZone;
    this.executablePath = executablePath;
    this.userDataDir = path.resolve(userDataDir);
    this.headless = headless;
    this.requestTimeoutMs = requestTimeoutMs;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.moduleUrl = moduleUrl || null;
    this.guardModuleUrl = null;
    this.initPromise = null;
    this.lifecycleChain = Promise.resolve();
    this.debugChain = Promise.resolve();
    this.activeSharedOperations = 0;
    this.activeSharedOperationWaiters = [];
  }

  async runLifecycleExclusive(task) {
    const run = this.lifecycleChain.then(task, task);
    this.lifecycleChain = run.catch(() => {});
    return run;
  }

  async runDebugExclusive(task) {
    const run = this.debugChain.then(task, task);
    this.debugChain = run.catch(() => {});
    return run;
  }

  async warmup() {
    return this.runLifecycleExclusive(async () => {
      await this.ensureReady();
    });
  }

  async waitForSharedOperationsToDrain() {
    if (this.activeSharedOperations === 0) {
      return;
    }

    await new Promise((resolve) => {
      this.activeSharedOperationWaiters.push(resolve);
    });
  }

  releaseSharedOperation() {
    this.activeSharedOperations = Math.max(0, this.activeSharedOperations - 1);

    if (this.activeSharedOperations === 0) {
      const waiters = this.activeSharedOperationWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
    }
  }

  async withSharedPage(task) {
    const page = await this.runLifecycleExclusive(async () => {
      await this.ensureReady();

      if (!this.page || this.page.isClosed()) {
        throw new Error("Browser page is unavailable");
      }

      this.activeSharedOperations += 1;
      return this.page;
    });

    try {
      return await task(page);
    } finally {
      this.releaseSharedOperation();
    }
  }

  async ensureReady() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    if (this.page && !this.page.isClosed()) {
      return;
    }

    this.initPromise = (async () => {
      const executable = resolveBrowserExecutablePath(this.executablePath);
      if (!executable.path) {
        throw buildBrowserExecutableNotFoundError(executable.candidates);
      }

      this.browser = await chromium.launch({
        executablePath: executable.path,
        headless: this.headless,
        args: ["--disable-blink-features=AutomationControlled"],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1440, height: 960 },
        locale: "zh-CN",
        timezoneId: this.timeZone,
        extraHTTPHeaders: {
          "Accept-Language": this.acceptLanguage,
        },
      });

      this.page = await this.context.newPage();

      {
        const freshCookieHeader = loadKlingCookieFromChrome() || this.cookie;
        const cookies = buildBrowserCookies(freshCookieHeader);
        if (cookies.length) {
          await this.context.addCookies(cookies);
        }
      }

      try {
        await this.page.goto(`${this.siteBaseUrl}/cn/`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
      } catch {
        // Kling occasionally aborts navigation during SPA bootstrap; module import can still work.
      }

      await this.page.waitForTimeout(3000);

      this.guardModuleUrl = await this.page.evaluate(async () => {
        const candidates = [
          ...document.querySelectorAll(
            'link[rel="modulepreload"][href*="/assets/js/vendor--"]'
          ),
        ].map((node) => node.href);

        for (const candidate of candidates) {
          try {
            const mod = await import(candidate);
            if (
              typeof mod?.am?.call === "function" &&
              typeof mod?.an === "function"
            ) {
              return candidate;
            }
          } catch {
            // Keep scanning.
          }
        }

        return null;
      });

      if (!this.guardModuleUrl) {
        throw new Error(
          "Failed to discover Kling guard module exporting $encode"
        );
      }

      let lastError = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const probe = await this.page.evaluate(
          async ({ guardModuleUrl, apiBaseUrl, acceptLanguage, requestTimeoutMs }) => {
            try {
              const mod = await import(guardModuleUrl);
              const guard = mod.am;
              const caver = guard.call("$getCatVersion", []);
              const { signResult } = await new Promise((resolve, reject) => {
                guard.call("$encode", [
                  {
                    url: "/api/user/profile_and_features",
                    query: { caver },
                    form: null,
                    requestBody: null,
                    projectInfo: {
                      appKey: "8M3oUipD76",
                      radarId: "91e99da176",
                      debug: false,
                    },
                  },
                  {
                    suc(signResult, signInput) {
                      resolve({ signResult, signInput });
                    },
                    err(error) {
                      reject(error);
                    },
                  },
                ]);
              });

              const url = `${apiBaseUrl}/api/user/profile_and_features?__NS_hxfalcon=${encodeURIComponent(
                signResult
              )}&caver=${encodeURIComponent(caver)}`;
              const response = await Promise.race([
                fetch(url, {
                  method: "GET",
                  credentials: "include",
                  headers: {
                    "Accept-Language": acceptLanguage,
                    "Time-Zone":
                      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
                  },
                }),
                new Promise((_, reject) =>
                  setTimeout(
                    () =>
                      reject({
                        name: "TimeoutError",
                        message: `Browser request timed out after ${requestTimeoutMs}ms`,
                        status: 408,
                      }),
                    requestTimeoutMs
                  )
                ),
              ]);
              const data = await response.json();
              return {
                ok: true,
                data,
              };
            } catch (error) {
              return {
                ok: false,
                error: {
                  name: error?.name || "Error",
                  message: error?.message || String(error),
                  dataName: error?.data?.name || null,
                },
              };
            }
          },
          {
            guardModuleUrl: this.guardModuleUrl,
            apiBaseUrl: this.apiBaseUrl,
            acceptLanguage: this.acceptLanguage,
            requestTimeoutMs: this.requestTimeoutMs,
          }
        );

        if (probe?.ok) {
          if (isAuthExpiredResponseData(probe.data)) {
            throw buildAuthExpiredError(probe.data);
          }
          return;
        }

        lastError = probe?.error || null;
        await sleep(1500);
      }

      if (lastError) {
        throw new Error(
          `Kling page did not become request-ready: ${JSON.stringify(lastError)}`
        );
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async request(
    requestConfig,
    requestCustomConfig = {},
    localeCode = 308,
    requestTimeoutMs = this.requestTimeoutMs,
    includeOrigin = false
  ) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestAcceptLanguage = resolveAcceptLanguage(
        this.acceptLanguage,
        localeCode
      );

      try {
        const response = await this.withSharedPage((page) =>
          page.evaluate(
        async ({
          guardModuleUrl,
          apiBaseUrl,
          requestAcceptLanguage,
          requestConfig,
          requestCustomConfig,
          requestTimeoutMs,
          includeOrigin,
        }) => {
          try {
            const mod = await import(guardModuleUrl);
            const guard = mod.am;
            const caver = guard.call("$getCatVersion", []);
            const method = String(requestConfig?.method || "GET").toUpperCase();
            const rawUrl = String(requestConfig?.url || "");
            if (!rawUrl) {
              throw {
                name: "RequestConfigError",
                message: "requestConfig.url is required",
                status: 400,
              };
            }

            const parsedUrl = rawUrl.startsWith("http")
              ? new URL(rawUrl)
              : new URL(rawUrl, apiBaseUrl);
            const basePath = parsedUrl.pathname;
            const params = Object.fromEntries(parsedUrl.searchParams.entries());
            if (
              requestConfig?.params &&
              typeof requestConfig.params === "object" &&
              !Array.isArray(requestConfig.params)
            ) {
              Object.assign(params, requestConfig.params);
            }

            for (const [key, value] of Object.entries(params)) {
              if (value == null) {
                delete params[key];
              }
            }

            const requestHeaders = {
              ...(requestConfig?.headers || {}),
              ...(requestCustomConfig?.headers || {}),
            };
            const contentType =
              requestHeaders["Content-Type"] ||
              requestHeaders["content-type"] ||
              (method === "GET" ? "" : "application/json");

            let form = null;
            let requestBody = null;
            let body = undefined;
            if (method !== "GET" && method !== "HEAD") {
              if (contentType.includes("application/x-www-form-urlencoded")) {
                if (typeof requestConfig?.data === "string") {
                  form = requestConfig.data;
                } else {
                  form = new URLSearchParams(requestConfig?.data || {}).toString();
                }
                body = form;
              } else {
                requestBody =
                  requestConfig?.data === undefined ? null : requestConfig.data;
                body =
                  typeof requestConfig?.data === "string"
                    ? requestConfig.data
                    : JSON.stringify(requestConfig?.data ?? {});
              }
            }

            const { signResult } = await new Promise((resolve, reject) => {
              guard.call("$encode", [
                {
                  url: basePath,
                  query: { caver, ...params },
                  form,
                  requestBody,
                  projectInfo: {
                    appKey: "8M3oUipD76",
                    radarId: "91e99da176",
                    debug: false,
                  },
                },
                {
                  suc(result, signInput) {
                    resolve({ signResult: result, signInput });
                  },
                  err(error) {
                    reject(error);
                  },
                },
              ]);
            });

            const signedParams = new URLSearchParams({
              ...params,
              __NS_hxfalcon: signResult,
              caver,
            });
            const targetOrigin = parsedUrl.origin || apiBaseUrl;
            const signedUrl = `${targetOrigin}${basePath}?${signedParams.toString()}`;
            const headers = {
              ...requestHeaders,
              "Accept-Language": requestAcceptLanguage,
              "Time-Zone":
                Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            };
            if (method === "GET" || method === "HEAD") {
              delete headers["Content-Type"];
              delete headers["content-type"];
            } else if (!headers["Content-Type"] && !headers["content-type"]) {
              headers["Content-Type"] = contentType;
            }

            const raw = await Promise.race([
              fetch(signedUrl, {
                method,
                credentials:
                  requestCustomConfig?.credentials ||
                  (requestCustomConfig?.withCredentials === false
                    ? "same-origin"
                    : "include"),
                headers,
                body,
                referrer: requestCustomConfig?.referrer,
              }),
              new Promise((_, reject) =>
                setTimeout(
                  () =>
                    reject({
                      name: "TimeoutError",
                      message: `Browser request timed out after ${requestTimeoutMs}ms`,
                      status: 408,
                    }),
                  requestTimeoutMs
                )
              ),
            ]);
            const responseText = await raw.text();
            let data = responseText;
            try {
              data = JSON.parse(responseText);
            } catch {
              // Preserve plain-text responses.
            }

            let origin = null;
            if (includeOrigin) {
              origin = {
                status: raw.status,
                statusText: raw.statusText,
                data,
              };
            }

            if (!raw.ok) {
              throw {
                name: "HttpError",
                message:
                  data?.error?.detail ||
                  data?.message ||
                  raw.statusText ||
                  `HTTP ${raw.status}`,
                status: raw.status,
                data,
              };
            }

            return {
              ok: true,
              data,
              origin,
            };
          } catch (error) {
            return {
              ok: false,
              error: {
                name: error?.name || "Error",
                message: error?.message || String(error),
                status: error?.status ?? null,
                result: error?.result ?? null,
                brief: error?.brief ?? null,
                errorType: error?.errorType ?? null,
                errorTraceId: error?.errorTraceId ?? null,
                data: error?.data ?? null,
              },
            };
          }
        },
        {
          guardModuleUrl: this.guardModuleUrl,
          apiBaseUrl: this.apiBaseUrl,
          requestAcceptLanguage,
          requestConfig,
          requestCustomConfig,
          requestTimeoutMs,
          includeOrigin,
        }
        )
      );
        if (!response?.ok) {
          throw normalizeAuthError({
            status: response?.error?.status || 500,
            message: response?.error?.message || "Browser request failed",
            data: response?.error || null,
          });
        }
        if (isAuthExpiredResponseData(response.data)) {
          throw buildAuthExpiredError(response.data);
        }
        return includeOrigin ? response : response.data;
      } catch (error) {
        if (
          attempt === 0 &&
          (isRecoverablePageError(error) || isAuthExpiredError(error))
        ) {
          await this.close();
          continue;
        }
        throw serializeBrowserError(error);
      }
    }
  }

  async uploadFile({
    fileName,
    base64,
    mimeType = "application/octet-stream",
    type = "image",
    verify = true,
    fileType = "",
  }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.withSharedPage((page) =>
          page.evaluate(
        async ({ fileName, base64, mimeType, type, verify, fileType }) => {
          try {
            const mod = await import(
              "https://p1-kling.klingai.com/kcdn/cdn-kcdn112452/kling-web/assets/js/lora-CP-qY096.js"
            );
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const file = new File([bytes], fileName, { type: mimeType });
            const result = await mod.w({
              option: { file },
              type,
              verify,
              fileType,
            });
            return { ok: true, data: result };
          } catch (error) {
            return {
              ok: false,
              error: {
                name: error?.name || "Error",
                message: error?.message || String(error),
                status: error?.status ?? null,
                result: error?.result ?? null,
                brief: error?.brief ?? null,
                errorType: error?.errorType ?? null,
                errorTraceId: error?.errorTraceId ?? null,
                data: error?.data ?? null,
              },
            };
          }
        },
        { fileName, base64, mimeType, type, verify, fileType }
        )
      );

        if (!response?.ok) {
          throw {
            status: response?.error?.status || 500,
            message: response?.error?.message || "Browser upload failed",
            data: response?.error || null,
          };
        }

        return response.data;
      } catch (error) {
        if (attempt === 0 && isRecoverablePageError(error)) {
          await this.close();
          continue;
        }
        throw serializeBrowserError(error);
      }
    }
  }

  async uploadOmniVideoReferenceImage(
    imagePath,
    { timeoutMs = 90000, waitAfterUploadMs = 1500 } = {}
  ) {
    return this.runDebugExclusive(async () =>
      this.runLifecycleExclusive(async () => {
        await this.ensureReady();
        await this.waitForSharedOperationsToDrain();

        const capturePage = await this.context.newPage();
        const capturedRequests = [];

        const onRequest = (request) => {
          const url = request.url();
          if (!url.includes("/api/omni/intent-recognition")) {
            return;
          }

          capturedRequests.push({
            method: request.method(),
            url,
            postData: request.postData() || null,
          });
        };

        this.context.on("request", onRequest);

        try {
          await capturePage
            .goto(`${this.siteBaseUrl}/cn/omni/new?model=video`, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            })
            .catch(() => {});

          await capturePage.waitForTimeout(5000);

          await capturePage.waitForFunction(
            () => document.querySelectorAll('input[type="file"]').length >= 1,
            { timeout: 60000 }
          );

          const fileInputs = await capturePage.$$('input[type="file"]');
          if (!fileInputs.length) {
            throw new Error("Omni video page did not expose any file inputs");
          }

          await fileInputs[0].setInputFiles(imagePath);

          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            const lastRequest = [...capturedRequests]
              .reverse()
              .find((item) => item.postData);

            if (lastRequest?.postData) {
              try {
                const parsed = JSON.parse(lastRequest.postData);
                const firstInputUrl = parsed?.inputs?.[0]?.url;
                if (firstInputUrl) {
                  await capturePage.waitForTimeout(waitAfterUploadMs);
                  return {
                    url: firstInputUrl,
                    request: parsed,
                  };
                }
              } catch {
                // Keep polling until the request body becomes parseable.
              }
            }

            await capturePage.waitForTimeout(500);
          }

          throw new Error(
            `Timed out waiting for omni video upload request for ${imagePath}`
          );
        } finally {
          this.context.off("request", onRequest);
          await capturePage.close().catch(() => {});
        }
      })
    );
  }

  async captureOmniVideoFlow({
    imagePath,
    waitAfterUploadMs = 25000,
    maxEvents = 50,
  }) {
    return this.runDebugExclusive(async () =>
      this.runLifecycleExclusive(async () => {
        await this.ensureReady();
        await this.waitForSharedOperationsToDrain();

        const capturePage = await this.context.newPage();
        const events = [];

        const onRequest = (request) => {
          const url = request.url();
          if (
            url.includes("/api/omni/") ||
            url.includes("/api/task/") ||
            url.includes("/api/upload/")
          ) {
            events.push({
              type: "request",
              method: request.method(),
              url,
              postData: request.postData() || null,
            });
          }
        };

        const onResponse = async (response) => {
          const url = response.url();
          if (
            url.includes("/api/omni/") ||
            url.includes("/api/task/") ||
            url.includes("/api/upload/")
          ) {
            let body = null;
            try {
              const contentType = response.headers()["content-type"] || "";
              if (contentType.includes("application/json")) {
                body = await response.json();
              }
            } catch {
              // Ignore unreadable response bodies.
            }

            events.push({
              type: "response",
              status: response.status(),
              url,
              body,
            });
          }
        };

        this.context.on("request", onRequest);
        this.context.on("response", onResponse);

        try {
          await capturePage
            .goto(`${this.siteBaseUrl}/cn/omni/new?model=video`, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            })
            .catch(() => {});

          await capturePage.waitForTimeout(15000);

          await capturePage
            .waitForFunction(
              () => document.querySelectorAll('input[type="file"]').length >= 2,
              { timeout: 60000 }
            )
            .catch(() => {});

          const fileInputs = await capturePage.$$('input[type="file"]');
          if (!fileInputs.length) {
            const debugState = await capturePage.evaluate(() => ({
              url: location.href,
              title: document.title,
              bodyText: document.body.innerText.slice(0, 1200),
              inputCount: document.querySelectorAll('input[type="file"]').length,
            }));
            throw new Error(
              `Omni page did not expose file inputs: ${JSON.stringify(debugState)}`
            );
          }

          await fileInputs[0].setInputFiles(imagePath);

          await capturePage.waitForTimeout(waitAfterUploadMs);

          const state = await capturePage.evaluate(() => ({
            url: location.href,
            title: document.title,
            bodyText: document.body.innerText.slice(0, 2000),
            uploadInputs: document.querySelectorAll('input[type="file"]').length,
            proseMirrorCount: document.querySelectorAll(".ProseMirror").length,
          }));

          return {
            events: events.slice(0, maxEvents),
            state,
          };
        } finally {
          this.context.off("request", onRequest);
          this.context.off("response", onResponse);
          await capturePage.close().catch(() => {});
        }
      })
    );
  }

  async getProfileAndFeatures() {
    return this.request(
      {
        url: "/api/user/profile_and_features",
        method: "GET",
        params: {},
      },
      { ifIgnore401Interceptor: true },
      308
    );
  }

  async submitTask(task) {
    return this.request({
      url: "/api/task/submit",
      method: "POST",
      data: task,
    });
  }

  async getTaskStatus(taskId) {
    return this.request({
      url: "/api/task/status",
      method: "GET",
      params: { taskId },
    });
  }

  async pollTask(taskId, { intervalMs = 5000, timeoutMs = 300000 } = {}) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const result = await this.getTaskStatus(taskId);
      const status = result?.task?.status ?? result?.taskStatus ?? result?.status;

      if ([50, 52, 53, 54, 56, 58, 99].includes(Number(status))) {
        return result;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw {
      status: 408,
      message: `Browser-context polling timed out after ${timeoutMs}ms`,
      data: { taskId },
    };
  }

  async close() {
    return this.runLifecycleExclusive(async () => {
      await this.waitForSharedOperationsToDrain();

      if (this.context) {
        await this.context.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
      this.browser = null;
      this.context = null;
      this.page = null;
      this.moduleUrl = null;
      this.guardModuleUrl = null;
      this.initPromise = null;
    });
  }
}
