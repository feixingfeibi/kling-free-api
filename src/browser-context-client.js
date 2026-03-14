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
      throw serializeBrowserError(error);
    }
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
  }
}
