# kling-free-api

`kling-free-api` is a minimal private-web API wrapper for Kling's consumer site.

It is modeled after the architecture idea in `jimeng-free-api-all`, but not its protocol:

- `jimeng-free-api-all` uses web-session cookies and browser-like requests to call Jimeng's private web endpoints.
- Kling's consumer site does the same pattern, but the actual endpoints are different:
  - `GET /api/user/profile_and_features`
  - `GET /api/upload/issue/token?filename=...`
  - `GET /api/upload/verify/token`
  - `GET /api/upload/verify/video`
  - `GET /api/upload/verify/audio`
  - `POST /api/task/submit`
  - `GET /api/task/status?taskId=...`

This prototype intentionally exposes the smallest stable layer first:

- session check
- upload token issue
- upload token verify
- raw task submit
- task status query
- polling

It does not yet try to hide Kling's internal `task` payload schema behind a fake "official" API. The payload structure still depends on individual web tools and frontend chunks.

There is one confirmed blocker for real end-to-end replay:

- Kling's frontend adds signed URL parameters such as `__NS_hxfalcon` and `caver`
- without that signing layer, some `/api/...` calls fall back to SPA HTML instead of JSON

So this repository should currently be treated as:

- a verified direction change away from the enterprise API
- a stable scaffold for session, upload, submit, and polling wrappers
- a now-implemented browser-context forwarding server for signed requests
- not yet a finished "works for every task body" replay server

## Why this route

The existing enterprise Kling API skill in this workspace targets `api-beijing.klingai.com`.

This prototype switches to the consumer web route:

- cookie-based session
- `withCredentials` style requests
- browser headers like `Accept-Language` and `Time-Zone`
- private `/api/...` endpoints used by `app.klingai.com`

## Setup

1. Copy `.env.example` to `.env`
2. Fill `KLING_COOKIE` with your browser cookie string from `https://app.klingai.com`
   or reuse the persistent browser profile directory
3. Install deps:

```bash
npm install
```

4. Start the server:

```bash
npm start
```

Default port is `8010`.

Current defaults:

- API domain: `https://api-app-cn.klingai.com`
- Site origin / Referer: `https://app.klingai.com`
- Browser executable: agent-browser installed Chrome
- Browser profile dir: `.browser-profile`
- Browser request helper: set `KLING_BROWSER_MODULE_URL` if auto-discovery misses the current helper chunk

Recommended for the current Kling build:

```bash
export KLING_BROWSER_MODULE_URL="https://p1-kling.klingai.com/kcdn/cdn-kcdn112452/kling-web/assets/js/index-BrvXf0G_.js"
```

## Endpoints

### Health

```bash
curl http://127.0.0.1:8010/health
```

### Validate login state

```bash
curl http://127.0.0.1:8010/v1/account/profile
```

### Validate login state through browser-context forwarding

```bash
curl http://127.0.0.1:8010/v2/browser/account/profile
```

### Issue upload token

```bash
curl "http://127.0.0.1:8010/v1/upload/issue-token?filename=demo.png"
```

### Verify uploaded resource

```bash
curl -X POST http://127.0.0.1:8010/v1/upload/verify \
  -H "Content-Type: application/json" \
  -d '{"token":"UPLOAD_TOKEN","type":"image"}'
```

### Submit a raw task

```bash
curl -X POST http://127.0.0.1:8010/v1/tasks/submit \
  -H "Content-Type: application/json" \
  -d '{
    "task": {
      "type": "video",
      "inputs": [],
      "arguments": []
    }
  }'
```

### Submit and poll

```bash
curl -X POST http://127.0.0.1:8010/v1/tasks/submit \
  -H "Content-Type: application/json" \
  -d '{
    "task": {
      "type": "video",
      "inputs": [],
      "arguments": []
    },
    "poll": true,
    "poll_interval_ms": 5000,
    "poll_timeout_ms": 300000
  }'
```

### Query task status

```bash
curl http://127.0.0.1:8010/v1/tasks/TASK_ID
```

### Send a signed browser-context request

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/request \
  -H "Content-Type: application/json" \
  -d '{
    "requestConfig": {
      "url": "/api/user/profile_and_features",
      "method": "GET",
      "params": {}
    },
    "requestCustomConfig": {
      "ifIgnore401Interceptor": true
    }
  }'
```

### Submit a task through browser-context forwarding

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/submit \
  -H "Content-Type: application/json" \
  -d '{
    "task": {
      "type": "video",
      "inputs": [],
      "arguments": []
    }
  }'
```

## Current limitations

- Upload-to-storage is not proxied yet. This version only wraps Kling's token issue and post-upload verification APIs.
- Model-specific `task` builders are not implemented yet.
- OpenAI-compatible routes are not implemented yet, because Kling's internal task schema still needs per-tool reverse engineering.
- Raw HTTP replay still cannot be trusted on its own. The recommended route is now `/v2/browser/*`, which executes signed requests inside the real page context.

## Agent-Browser Findings

With `agent-browser`, the browser page context confirms:

- `Object.jmpOnw_ms` exists and can build the signature input string
- `Object.jmpOnw_b2h` exists
- `Object.jmpOnw_send` exists
- the page runtime exposes the actual API base as `https://api-app-cn.klingai.com`

Example probe:

```bash
agent-browser --session-name kling open https://app.klingai.com/cn/
agent-browser --session-name kling eval 'JSON.stringify({
  has_ms: typeof Object.jmpOnw_ms,
  has_b2h: typeof Object.jmpOnw_b2h
})'
```

And a minimal signing-input probe:

```bash
agent-browser --session-name kling eval 'Object.jmpOnw_ms({
  url: location.origin + "/api/user/profile_and_features",
  query: { caver: "1.0.0" }
})'
```

Current result:

- the input string is reproducible in-page
- the final `__NS_hxfalcon` generation step can be bypassed by browser-context forwarding

## Preferred path now

Use `/v2/browser/*` first.

Reason:

- it imports the same Kling frontend module already loaded by the page
- it calls `mod.r(...)`, the request wrapper with signing and interceptors
- signer logic stays inside the real browser runtime
- Cookie, URL signing, and request conventions stay aligned with the site

## Practical next step

Either keep using browser-context forwarding, or later extract the signer into a pure HTTP implementation.

Then add model-specific builders on top of `/api/task/submit` for:

- text-to-image
- image-to-video
- text-to-video
- omni / multimodal

Once those payload builders are stable, an OpenAI-compatible route can sit above them.
