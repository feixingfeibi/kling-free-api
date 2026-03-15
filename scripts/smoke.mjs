const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8010").replace(/\/+$/, "");
const includeBrowser = process.env.SMOKE_BROWSER === "true";
const includeAuth = process.env.SMOKE_AUTH === "true";

async function getJsonResponse(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Smoke request failed for ${pathname}: ${response.status} ${text}`);
  }

  try {
    return {
      status: response.status,
      data: JSON.parse(text),
    };
  } catch (error) {
    throw new Error(`Smoke request returned non-JSON for ${pathname}: ${text}`);
  }
}

const health = await getJsonResponse("/health");
if (health.data?.ok !== true || health.data?.service !== "kling-free-api") {
  throw new Error(`Unexpected /health payload: ${JSON.stringify(health.data)}`);
}
console.log(`smoke ok: ${baseUrl}/health`);

if (includeBrowser) {
  const browserHealth = await getJsonResponse("/v2/browser/health");
  if (browserHealth.status !== 200 || browserHealth.data?.ok !== true) {
    throw new Error(
      `Unexpected /v2/browser/health payload: ${JSON.stringify(browserHealth.data)}`
    );
  }
  console.log(`smoke ok: ${baseUrl}/v2/browser/health`);
}

if (includeAuth) {
  const auth = await getJsonResponse("/v2/browser/auth/check");
  if (auth.status !== 200 || auth.data?.ok !== true) {
    throw new Error(`Unexpected /v2/browser/auth/check payload: ${JSON.stringify(auth.data)}`);
  }
  if (typeof auth.data?.authenticated !== "boolean") {
    throw new Error(`Missing authenticated:boolean in auth payload: ${JSON.stringify(auth.data)}`);
  }
  console.log(`smoke ok: ${baseUrl}/v2/browser/auth/check`);
}

console.log(`Smoke passed for ${baseUrl}`);
