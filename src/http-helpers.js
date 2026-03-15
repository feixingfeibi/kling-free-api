import { KLING_LOGIN_URL, normalizeAuthError } from "./auth-errors.js";

export function sendError(res, error) {
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

export function buildHttpError(
  status,
  message,
  { code = null, data = null } = {}
) {
  return {
    status,
    message,
    code,
    data,
  };
}

export function buildValidationError(message, data = null) {
  return buildHttpError(400, message, {
    code: "VALIDATION_ERROR",
    data,
  });
}

export function buildUpstreamResponseError(message, data = null) {
  return buildHttpError(502, message, {
    code: "UPSTREAM_INVALID_RESPONSE",
    data,
  });
}

export function requireObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw buildValidationError(`${fieldName} object is required`, {
      field: fieldName,
      expected: "object",
    });
  }

  return value;
}

export function requireNonEmptyString(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw buildValidationError(`${fieldName} is required`, {
      field: fieldName,
      expected: "non-empty string",
    });
  }

  return normalized;
}

export function createRequireDebugRoutesEnabled(enableDebugRoutes) {
  return function requireDebugRoutesEnabled(req, res, next) {
    if (enableDebugRoutes) {
      return next();
    }

    return res.status(404).json({
      ok: false,
      error: "Route not found",
      code: "DEBUG_ROUTE_DISABLED",
    });
  };
}
