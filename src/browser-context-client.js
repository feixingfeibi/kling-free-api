import path from "node:path";

import { chromium } from "playwright-core";

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

function serializeBrowserError(error) {
  return {
    status: error?.status || 500,
    message: error?.message || String(error),
    data: error?.data || null,
    stack: error?.stack || null,
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
    this.initPromise = null;
    this.operationChain = Promise.resolve();
  }

  async runExclusive(task) {
    const run = this.operationChain.then(task, task);
    this.operationChain = run.catch(() => {});
    return run;
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
      this.browser = await chromium.launch({
        executablePath: this.executablePath,
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

      if (this.cookie) {
        const cookies = parseCookieHeader(this.cookie).map((cookie) => ({
          ...cookie,
          domain: ".klingai.com",
          path: "/",
          httpOnly: false,
          secure: true,
          sameSite: "None",
        }));
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

      if (!this.moduleUrl) {
        this.moduleUrl = await this.page.evaluate(async () => {
        const candidates = [
          ...document.querySelectorAll(
            'link[rel="modulepreload"][href*="/assets/js/index-"]'
          ),
        ].map((node) => node.href);

        for (const candidate of candidates) {
          try {
            const mod = await import(candidate);
            if (typeof mod.r === "function" && Object.keys(mod).length > 100) {
              return candidate;
            }
          } catch {
            // Keep scanning.
          }
        }

        return null;
        });
      }

      if (!this.moduleUrl) {
        throw new Error(
          "Failed to discover Kling request module exporting mod.r"
        );
      }

      let lastError = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const probe = await this.page.evaluate(
          async ({ moduleUrl }) => {
            try {
              const mod = await import(moduleUrl);
              const result = await mod.r(
                {
                  url: "/api/user/profile_and_features",
                  method: "GET",
                  params: {},
                },
                { ifIgnore401Interceptor: true },
                308
              );
              return {
                ok: true,
                data: result?.data ?? result,
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
          { moduleUrl: this.moduleUrl }
        );

        if (probe?.ok) {
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
    requestTimeoutMs = this.requestTimeoutMs
  ) {
    return this.runExclusive(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.ensureReady();

        try {
          const response = await this.page.evaluate(
        async ({
          moduleUrl,
          requestConfig,
          requestCustomConfig,
          localeCode,
          requestTimeoutMs,
        }) => {
          try {
            const mod = await import(moduleUrl);
            const result = await Promise.race([
              mod.r(requestConfig, requestCustomConfig, localeCode),
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
            return {
              ok: true,
              data: result?.data ?? result,
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
          moduleUrl: this.moduleUrl,
          requestConfig,
          requestCustomConfig,
          localeCode,
          requestTimeoutMs,
        }
      );
          if (!response?.ok) {
            throw {
              status: response?.error?.status || 500,
              message: response?.error?.message || "Browser request failed",
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
    });
  }

  async uploadFile({
    fileName,
    base64,
    mimeType = "application/octet-stream",
    type = "image",
    verify = true,
    fileType = "",
  }) {
    return this.runExclusive(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.ensureReady();

        try {
          const response = await this.page.evaluate(
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
    });
  }

  async captureOmniVideoFlow({
    imagePath,
    waitAfterUploadMs = 25000,
    maxEvents = 50,
  }) {
    return this.runExclusive(async () => {
      if (!this.browser || !this.context) {
        this.browser = await chromium.launch({
          executablePath: this.executablePath,
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

        if (this.cookie) {
          const cookies = parseCookieHeader(this.cookie).map((cookie) => ({
            ...cookie,
            domain: ".klingai.com",
            path: "/",
            httpOnly: false,
            secure: true,
            sameSite: "None",
          }));
          if (cookies.length) {
            await this.context.addCookies(cookies);
          }
        }
      }

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
        await capturePage.goto(`${this.siteBaseUrl}/cn/omni/new?model=video`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        }).catch(() => {});

        await capturePage
          .waitForFunction(
            () => document.querySelectorAll('input[type="file"]').length >= 2,
            { timeout: 60000 }
          )
          .catch(() => {});

        const fileInputs = await capturePage.$$('input[type="file"]');
        if (!fileInputs.length) {
          throw new Error("Omni page did not expose file inputs");
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
    });
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
    this.initPromise = null;
    this.operationChain = Promise.resolve();
  }
}
