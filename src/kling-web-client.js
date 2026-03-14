import axios from "axios";

function createError(error) {
  if (error.response) {
    return {
      status: error.response.status,
      message:
        error.response.data?.error?.detail ||
        error.response.data?.message ||
        error.message,
      data: error.response.data,
    };
  }

  return {
    status: 500,
    message: error.message || "Unknown Kling request error",
    data: null,
  };
}

export class KlingWebClient {
  constructor({ apiBaseUrl, siteBaseUrl, cookie, acceptLanguage, timeZone }) {
    if (!cookie) {
      throw new Error(
        "Missing Kling cookie. Set KLING_COOKIE or pass x-kling-cookie."
      );
    }

    this.http = axios.create({
      baseURL: apiBaseUrl.replace(/\/+$/, ""),
      timeout: 30000,
      headers: {
        Cookie: cookie,
        "Accept-Language": acceptLanguage,
        "Time-Zone": timeZone,
        Referer: `${siteBaseUrl.replace(/\/+$/, "")}/cn/`,
        Origin: siteBaseUrl.replace(/\/+$/, ""),
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      },
    });
  }

  async request(config) {
    try {
      const response = await this.http.request(config);
      return response.data;
    } catch (error) {
      throw createError(error);
    }
  }

  async getProfileAndFeatures() {
    return this.request({
      method: "GET",
      url: "/api/user/profile_and_features",
    });
  }

  async issueUploadToken(filename) {
    return this.request({
      method: "GET",
      url: `/api/upload/issue/token?filename=${encodeURIComponent(filename)}`,
    });
  }

  async verifyUploadToken(token, type = "image") {
    if (type === "video") {
      return this.request({
        method: "GET",
        url: "/api/upload/verify/video",
        params: { token, type },
      });
    }

    if (type === "audio") {
      return this.request({
        method: "GET",
        url: "/api/upload/verify/audio",
        params: { token },
      });
    }

    return this.request({
      method: "GET",
      url: "/api/upload/verify/token",
      params: { token, type },
    });
  }

  async submitTask(task) {
    return this.request({
      method: "POST",
      url: "/api/task/submit",
      data: task,
    });
  }

  async getTaskStatus(taskId) {
    return this.request({
      method: "GET",
      url: `/api/task/status?taskId=${encodeURIComponent(taskId)}`,
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
      message: `Polling timed out after ${timeoutMs}ms`,
      data: { taskId },
    };
  }
}
