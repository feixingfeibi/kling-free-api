import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthExpiredError,
  isAuthExpiredError,
  isAuthExpiredResponseData,
  KLING_AUTH_EXPIRED_MESSAGE,
  KLING_LOGIN_URL,
  normalizeAuthError,
} from "../src/auth-errors.js";

test("isAuthExpiredResponseData detects explicit login false", () => {
  assert.equal(isAuthExpiredResponseData({ login: false }), true);
  assert.equal(isAuthExpiredResponseData({ data: { login: false } }), true);
});

test("isAuthExpiredResponseData detects auth failure text and numeric status", () => {
  assert.equal(isAuthExpiredResponseData({ status: 401 }), true);
  assert.equal(isAuthExpiredResponseData({ message: "Please log in again" }), true);
  assert.equal(isAuthExpiredResponseData({ brief: "未登录" }), true);
  assert.equal(isAuthExpiredResponseData({ message: "other error" }), false);
});

test("buildAuthExpiredError returns normalized auth payload", () => {
  const original = { code: 401, message: "unauthorized" };
  const error = buildAuthExpiredError(original);

  assert.equal(error.status, 401);
  assert.equal(error.code, "AUTH_EXPIRED");
  assert.equal(error.message, KLING_AUTH_EXPIRED_MESSAGE);
  assert.equal(error.data.reauth_required, true);
  assert.equal(error.data.login_url, KLING_LOGIN_URL);
  assert.deepEqual(error.data.original, original);
});

test("normalizeAuthError converts 401-style errors into AUTH_EXPIRED", () => {
  const fromStatus = normalizeAuthError({ status: 401, data: { code: 401 } });
  const fromMessage = normalizeAuthError({ message: "login expired" });

  assert.equal(fromStatus.code, "AUTH_EXPIRED");
  assert.equal(fromMessage.code, "AUTH_EXPIRED");
  assert.equal(isAuthExpiredError(fromStatus), true);
});

test("normalizeAuthError preserves unrelated errors", () => {
  const error = { status: 500, message: "upstream failure", data: { foo: 1 } };
  assert.equal(normalizeAuthError(error), error);
  assert.equal(isAuthExpiredError(error), false);
});
