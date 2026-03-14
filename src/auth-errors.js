export const KLING_LOGIN_URL = "https://app.klingai.com/cn/";
export const KLING_AUTH_EXPIRED_MESSAGE =
  "Kling 登录已失效，请先在浏览器重新登录可灵后重试";

function containsAuthText(value) {
  const text = String(value || "").toLowerCase();
  return (
    text.includes("unauthorized") ||
    text.includes("not login") ||
    text.includes("not logged") ||
    text.includes("sign in") ||
    text.includes("log in") ||
    text.includes("login") ||
    text.includes("请登录") ||
    text.includes("重新登录") ||
    text.includes("未登录") ||
    text.includes("登录")
  );
}

export function isAuthExpiredResponseData(data) {
  if (!data || typeof data !== "object") {
    return false;
  }

  if (data.login === false || data?.data?.login === false) {
    return true;
  }

  if (Number(data.status) === 401 || Number(data.code) === 401) {
    return true;
  }

  return (
    containsAuthText(data.message) ||
    containsAuthText(data.brief) ||
    containsAuthText(data?.error?.detail) ||
    containsAuthText(data?.error?.brief) ||
    containsAuthText(data?.error?.type)
  );
}

export function buildAuthExpiredError(data = null) {
  return {
    status: 401,
    code: "AUTH_EXPIRED",
    message: KLING_AUTH_EXPIRED_MESSAGE,
    data: {
      reauth_required: true,
      login_url: KLING_LOGIN_URL,
      original: data,
    },
  };
}

export function normalizeAuthError(error) {
  if (!error) {
    return error;
  }

  if (
    error.code === "AUTH_EXPIRED" ||
    error?.data?.reauth_required ||
    isAuthExpiredResponseData(error?.data)
  ) {
    return buildAuthExpiredError(error?.data || null);
  }

  if (Number(error.status) === 401) {
    return buildAuthExpiredError(error?.data || null);
  }

  if (
    containsAuthText(error.message) ||
    containsAuthText(error.brief) ||
    containsAuthText(error.errorType)
  ) {
    return buildAuthExpiredError(error?.data || null);
  }

  return error;
}

export function isAuthExpiredError(error) {
  return normalizeAuthError(error)?.code === "AUTH_EXPIRED";
}
