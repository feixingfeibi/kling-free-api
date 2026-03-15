import test from "node:test";
import assert from "node:assert/strict";

import {
  getBrowserExecutableCandidates,
  resolveBrowserExecutablePath,
} from "../src/browser-executable.js";

test("getBrowserExecutableCandidates returns expected defaults for linux", () => {
  const candidates = getBrowserExecutableCandidates("linux");

  assert.ok(Array.isArray(candidates));
  assert.ok(candidates.includes("/usr/bin/google-chrome"));
});

test("resolveBrowserExecutablePath reports missing when no platform candidates exist", () => {
  const resolved = resolveBrowserExecutablePath(
    "/definitely/missing/browser",
    "unsupported-platform"
  );

  assert.equal(resolved.path, "");
  assert.equal(resolved.source, "missing");
  assert.deepEqual(resolved.candidates, ["/definitely/missing/browser"]);
});
