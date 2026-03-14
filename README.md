# kling-free-api

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Playwright](https://img.shields.io/badge/Playwright-browser--signed-45BA63?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Kling Web](https://img.shields.io/badge/Kling-consumer_web_route-111111)](https://app.klingai.com/)

**English** | [简体中文](./README.zh-CN.md)

`kling-free-api` is a local wrapper around Kling's consumer web endpoints.

It does **not** use the old enterprise `api-beijing.klingai.com` route as the primary path.  
Instead, it reuses your browser login state from `app.klingai.com` and exposes a practical local API for:

- auth checks
- signed browser-context requests
- media upload helpers
- task submit / task polling
- built-in task builders for text-to-video, image-to-video, first-last-frame, and Omni video

## Overview

This project exists because Kling's web app relies on:

- private `/api/...` endpoints
- browser session cookies
- signed request parameters such as `__NS_hxfalcon` and `caver`

Plain HTTP replay is fragile.  
The stable path in this repository is the **browser-signed** route under `v2/browser/*`.

## Status

This project is usable, but still experimental.

What is working well:

- `v2/browser/auth/check`
- `v2/browser/account/profile`
- generic browser-signed request forwarding
- text-to-video submit
- image-to-video submit
- first-last-frame submit
- Omni video submit for:
  - prompt-only
  - image-reference inputs

What is intentionally not enabled yet:

- Omni video with `video_url` / `video_path`
- a fake "official" public API schema hiding all Kling web payload details

If Omni video receives video reference inputs in the high-level route, the service now returns a clear unsupported error instead of a broken submit flow.

## Why This Project

Compared with the old enterprise-doc route, this project focuses on the path that actually matches the consumer site:

| Route | Primary auth | Signing | Recommended |
| --- | --- | --- | --- |
| `v1/*` | cookie header / direct HTTP | manual / limited | only for low-level or legacy debugging |
| `v2/browser/*` | browser login state | browser-side signing | yes |

In practice:

- use `v2/browser/*` first
- use `v1/*` only when you explicitly want the low-level direct HTTP wrapper

## Features

### Browser-signed execution

Requests can be signed inside a real page context and then sent through browser `fetch`, which keeps behavior aligned with Kling's current frontend.

### Auto cookie recovery

If the service detects expired auth, it can re-read Kling cookies from local Chrome and retry.  
If login is still invalid, it returns a normalized `AUTH_EXPIRED` response with the Kling login URL.

### Built-in task builders

The service includes minimal but verified builders for:

- text-to-video
- image-to-video
- first-last-frame video
- Omni video

### Local media upload helpers

You can upload local images and files, then reuse the returned Kling-ready URLs in task payloads.

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

Copy `.env.example` to `.env`.

Important fields:

- `PORT`
- `KLING_COOKIE`
- `KLING_API_BASE_URL`
- `KLING_SITE_BASE_URL`
- `KLING_BROWSER_EXECUTABLE_PATH`
- `KLING_BROWSER_USER_DATA_DIR`
- `KLING_BROWSER_HEADLESS`
- `KLING_BROWSER_REQUEST_TIMEOUT_MS`
- `KLING_BROWSER_MODULE_URL`

Notes:

- If `KLING_COOKIE` is empty, the service will try to read Kling cookies from local Chrome.
- The default consumer site is `https://app.klingai.com`.
- The default API origin is `https://api-app-cn.klingai.com`.

### 3. Start

```bash
npm start
```

Or use the helper:

```bash
./scripts/run_local.sh
```

Default local address:

```text
http://127.0.0.1:8010
```

## Authentication Flow

Check service health:

```bash
curl http://127.0.0.1:8010/health
```

Check whether browser auth is still valid:

```bash
curl http://127.0.0.1:8010/v2/browser/auth/check
```

Valid auth:

```json
{
  "ok": true,
  "authenticated": true,
  "login_url": "https://app.klingai.com/cn/"
}
```

Expired auth:

```json
{
  "ok": true,
  "authenticated": false,
  "code": "AUTH_EXPIRED",
  "login_url": "https://app.klingai.com/cn/"
}
```

If auth expires, log in again in a real browser first:

```text
https://app.klingai.com/cn/
```

Then retry `GET /v2/browser/auth/check`.

## API Summary

### Core browser routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/browser/health` | browser-side runtime health |
| `GET` | `/v2/browser/auth/check` | auth status |
| `GET` | `/v2/browser/account/profile` | profile and features |
| `POST` | `/v2/browser/request` | generic signed request proxy |
| `POST` | `/v2/browser/upload/image` | upload local image |
| `POST` | `/v2/browser/upload/file` | upload local file |
| `POST` | `/v2/browser/tasks/submit` | submit raw task body |
| `POST` | `/v2/browser/tasks/text-to-video` | built-in text-to-video |
| `POST` | `/v2/browser/tasks/image-to-video` | built-in image-to-video |
| `POST` | `/v2/browser/tasks/first-last-frame` | built-in first/last-frame |
| `POST` | `/v2/browser/tasks/omni-video` | built-in Omni video |
| `GET` | `/v2/browser/tasks/:taskId` | task status |
| `GET` | `/v2/browser/tasks/:taskId/poll` | polling helper |

### Legacy / low-level routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/account/profile` | direct HTTP profile |
| `GET` | `/v1/upload/issue-token` | direct HTTP upload token |
| `POST` | `/v1/upload/verify` | direct HTTP upload verify |
| `POST` | `/v1/tasks/submit` | direct HTTP raw submit |
| `GET` | `/v1/tasks/:taskId` | direct HTTP task status |
| `GET` | `/v1/tasks/:taskId/poll` | direct HTTP polling |

## Examples

### Generic signed browser request

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/request \
  -H "Content-Type: application/json" \
  -d '{
    "requestConfig": {
      "url": "/api/user/profile_and_features",
      "method": "GET",
      "params": {}
    }
  }'
```

### Text to video

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/text-to-video \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "cinematic city street at night, reflective rain, slow dolly in",
    "duration": "5",
    "aspect_ratio": "16:9",
    "kling_version": "3.0",
    "model_mode": "std",
    "enable_audio": "true"
  }'
```

### Image to video

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/image-to-video \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452",
    "prompt": "subtle cinematic motion, natural camera push-in, realistic lighting"
  }'
```

### First / last frame

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/first-last-frame \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452",
    "tail_image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_3.png?x-kcdn-pid=112452",
    "prompt": "smooth transition from first frame to last frame, cinematic movement"
  }'
```

### Omni video

Prompt-only:

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/omni-video \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a girl slowly turns around on the beach, cinematic lighting"
  }'
```

Image reference:

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/omni-video \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "give <<<image_1>>> a gentle push-in and natural lighting variation",
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452"
  }'
```

## Error Model

Common responses:

| Code | Meaning |
| --- | --- |
| `AUTH_EXPIRED` | Kling browser login is no longer valid |
| `OMNI_VIDEO_INPUT_UNSUPPORTED` | the high-level Omni route does not support video-reference inputs yet |
| `TASK.MembershipQueueLimit` | current account cannot submit another task right now |
| `VALID.IllegalArgument` | request payload is invalid |
| `TASK.TaskPriceSearchFail` | Kling rejected the pricing-stage payload |

## Project Structure

```text
.
├── src/
│   ├── server.js
│   ├── browser-context-client.js
│   ├── kling-web-client.js
│   ├── task-builders.js
│   └── auth-errors.js
├── scripts/
├── .env.example
└── README.md
```

## Limitations

- This project depends on Kling's private web behavior and may break when the frontend changes.
- The task schema is still model-specific.
- Omni video high-level execution does not support video-reference inputs yet.
- This is not an official Kling API.

## Roadmap

- improve model-specific builders
- add more verified Omni flows
- reduce breakage when Kling updates frontend bundles
- keep the browser-signed path as the primary stable route

## Disclaimer

This project is an unofficial wrapper around Kling's consumer web experience.  
Use it carefully, respect the target platform, and assume private routes may change without notice.
