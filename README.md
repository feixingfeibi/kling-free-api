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

One concrete payload discovery is now confirmed:

- the current web text-to-video flow prices against `type: "m2v_aio2video"`
- not the older `m2v_txt2video` shape
- the built-in `/v2/browser/tasks/text-to-video` builder has been verified end-to-end
- the current 3.0 image-to-video flow also works with `type: "m2v_aio2video"` when `inputs` contains an image URL
- the current first/last-frame flow also works with `type: "m2v_aio2video"` when `inputs` contains both `input` and `tail_image`

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

If `KLING_COOKIE` is not set, the server now tries to read Kling cookies from local Chrome automatically via `browser_cookie3`.

Fast local start:

```bash
./scripts/run_local.sh
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

### Submit text-to-video with the built-in minimal builder

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

Observed verified result in this workspace:

- request returned `200`
- task was created successfully
- example task id: `305455133152156`
- initial task status: `5` (queued/running pipeline)

### Submit image-to-video with the built-in minimal builder

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/image-to-video \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452",
    "prompt": "subtle cinematic motion, natural camera push-in, realistic lighting",
    "duration": "5",
    "aspect_ratio": "16:9",
    "kling_version": "3.0",
    "model_mode": "std",
    "enable_audio": "true"
  }'
```

You can also pass a local file path instead of `image_url`:

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/image-to-video \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/absolute/path/to/image.png",
    "prompt": "subtle cinematic motion, natural camera push-in, realistic lighting",
    "duration": "5",
    "aspect_ratio": "16:9",
    "kling_version": "3.0",
    "model_mode": "std",
    "enable_audio": "true"
  }'
```

Observed verified result in this workspace:

- request returned `200`
- task was created successfully
- example task id: `305455855145523`
- initial task status: `5`

### Upload a local image and get a Kling-ready URL

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/upload/image \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "/absolute/path/to/image.png"
  }'
```

Observed verified result in this workspace:

- local PNG upload succeeded
- response included a stable `url`
- that uploaded image URL was then used to create image-to-video successfully

### Generic local file upload

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/upload/file \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "/absolute/path/to/file.png",
    "type": "image",
    "file_type": "image"
  }'
```

### Submit first/last-frame video with the built-in minimal builder

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/first-last-frame \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452",
    "tail_image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_3.png?x-kcdn-pid=112452",
    "prompt": "smooth transition from first frame to last frame, cinematic movement",
    "duration": "5",
    "aspect_ratio": "16:9",
    "kling_version": "3.0",
    "model_mode": "std",
    "enable_audio": "true"
  }'
```

You can also use local file paths:

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/first-last-frame \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/absolute/path/to/first.png",
    "tail_image_path": "/absolute/path/to/last.png",
    "prompt": "smooth transition from first frame to last frame, cinematic movement",
    "duration": "5",
    "aspect_ratio": "16:9",
    "kling_version": "3.0",
    "model_mode": "std",
    "enable_audio": "true"
  }'
```

Observed verified result in this workspace:

- request returned `200`
- task was created successfully
- example task id: `305456209256466`
- initial task status: `5`

### Omni recommendation examples

```bash
curl "http://127.0.0.1:8010/v2/browser/omni/recommend?type=m2v_omni_video"
```

### Omni intent recognition

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/omni/intent-recognition \
  -H "Content-Type: application/json" \
  -d '{
    "type": "m2v_omni_video",
    "version": "3.0",
    "prompt": "cinematic scene with strong subject consistency"
  }'
```

### Omni submit config template

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/omni/submit-config-template \
  -H "Content-Type: application/json" \
  -d '{
    "type": "m2v_omni_video",
    "version": "3.0",
    "taskInputs": [],
    "taskArguments": []
  }'
```

### Omni video preprocess

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/omni/video-preprocess \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/demo.mp4"
  }'
```

### Capture Omni video low-level flow after image upload

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/omni/capture-video-flow \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/absolute/path/to/image.png",
    "wait_after_upload_ms": 25000,
    "max_events": 50
  }'
```

### Build Omni video recognition body

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/omni/video/build-recognition-body \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "",
    "richPrompt": "",
    "klingVersion": "3.0-omni"
  }'
```

### Build Omni video template body

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/omni/video/build-template-body \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3.0",
    "omniRecognition": "RECOGNITION_STRING",
    "taskInputs": [],
    "taskArguments": []
  }'
```

### Build Omni video price body

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/omni/video/build-price-body \
  -H "Content-Type: application/json" \
  -d '{
    "omniRecognition": "RECOGNITION_STRING",
    "klingVersion": "3.0-omni",
    "modelMode": "pro",
    "duration": "5",
    "aspectRatio": "16:9",
    "imageCount": "1"
  }'
```

## Current limitations

- Upload-to-storage is not proxied yet. This version only wraps Kling's token issue and post-upload verification APIs.
- Model-specific `task` builders are not implemented yet.
- OpenAI-compatible routes are not implemented yet, because Kling's internal task schema still needs per-tool reverse engineering.
- Raw HTTP replay still cannot be trusted on its own. The recommended route is now `/v2/browser/*`, which executes signed requests inside the real page context.

Current Omni status:

- `m2v_omni_video` is confirmed as a valid task type
- direct `task/price` accepts the type, but may return `status: 6`
- current message: `意图识别参数缺失`
- low-level Omni helper endpoints are now exposed, but the final high-level Omni video builder is not finished yet
- a capture endpoint now exists to record the actual Omni upload -> recognize -> template -> price flow

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
- a real page-init `POST /api/task/price` payload has been captured
- the current text-to-video body shape is:

```json
{
  "type": "m2v_aio2video",
  "arguments": [
    {"name":"negative_prompt","value":""},
    {"name":"duration","value":"5"},
    {"name":"imageCount","value":"1"},
    {"name":"kling_version","value":"3.0"},
    {"name":"prompt","value":"..."},
    {"name":"rich_prompt","value":""},
    {"name":"cfg","value":"0.5"},
    {"name":"aspect_ratio","value":"16:9"},
    {"name":"camera_json","value":"{\"type\":\"empty\",\"horizontal\":0,\"vertical\":0,\"zoom\":0,\"tilt\":0,\"pan\":0,\"roll\":0}"},
    {"name":"camera_control_enabled","value":"false"},
    {"name":"prefer_multi_shots","value":"true"},
    {"name":"biz","value":"klingai"},
    {"name":"enable_audio","value":"true"},
    {"name":"model_mode","value":"std"}
  ],
  "inputs": []
}
```

The successful submit response also shows that Kling injects some extra internal arguments on submit, including:

- `__deviceType`
- `__did`
- `__effect`
- `__locale`
- `__platform`
- `__priority`
- `__userType`

For image-to-video, the frontend also switches the generated effect suffix from:

- `m2v_aio2video_t2v_v30_720p`

to:

- `m2v_aio2video_i2v_v30_720p`

For first/last-frame mode, the effect becomes:

- `m2v_aio2video_i2v_fflf_v30_720p`

For Omni video, the current confirmed findings are:

- valid task type: `m2v_omni_video`
- support flow in frontend code:
  - `/api/omni/pre-skill/recommend`
  - `/api/omni/intent-recognition`
  - `/api/omni/submit-config-template`
  - then `task/price` / `task/submit`
- the service can now build the three currently known low-level Omni request bodies
- official recommendation payloads contain structured `resources`
- a raw `task/price` probe returns `status: 6` with `意图识别参数缺失`

That is another reason browser-context forwarding is the preferred route right now: the frontend runtime can enrich the minimal payload automatically.

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
