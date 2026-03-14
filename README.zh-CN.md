# kling-free-api

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Playwright](https://img.shields.io/badge/Playwright-browser--signed-45BA63?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Kling Web](https://img.shields.io/badge/Kling-consumer_web_route-111111)](https://app.klingai.com/)

[English](./README.md) | **简体中文**

`kling-free-api` 是一个面向可灵官网消费者网页的本地封装服务。

它不再把旧的企业接口 `api-beijing.klingai.com` 作为主路径，而是复用 `app.klingai.com` 的网页登录态，提供一套更贴近真实网页行为的本地 API，用于：

- 登录态检查
- 浏览器签名请求透传
- 本地媒体上传辅助
- 任务提交与轮询
- 内建的文生视频、图生视频、首尾帧、Omni 视频 builder

## 项目概览

这个项目存在的原因很直接：

- 可灵网页端使用的是私有 `/api/...` 接口
- 请求依赖浏览器 Cookie 会话
- 很多接口还依赖 `__NS_hxfalcon`、`caver` 这样的签名参数

单纯 HTTP 重放很脆弱。  
这个仓库当前最稳的主路径是 `v2/browser/*`。

## 当前状态

项目已经可用，但仍然属于实验性质。

目前比较稳定的能力：

- `v2/browser/auth/check`
- `v2/browser/account/profile`
- 通用浏览器签名请求透传
- 文生视频提交
- 图生视频提交
- 首尾帧提交
- Omni 视频提交：
  - 纯 prompt
  - 图片引用输入

当前明确没有启用的能力：

- Omni 视频的 `video_url` / `video_path`
- 把所有 Kling 网页 task body 抽象成一个统一“官方 API”风格 schema

现在如果你给高层 Omni 路由传视频引用，它会返回清晰的“不支持”错误，而不会再走到半路失败。

## 为什么选这条路线

相对旧企业文档接口，这个仓库更关注真正和消费者网页一致的执行路径：

| 路线 | 鉴权方式 | 签名方式 | 推荐程度 |
| --- | --- | --- | --- |
| `v1/*` | Cookie header / 直接 HTTP | 手工或弱封装 | 仅适合低层调试 |
| `v2/browser/*` | 浏览器登录态 | 浏览器侧签名 | 推荐 |

实际使用建议：

- 优先用 `v2/browser/*`
- 只有明确需要低层直连时再用 `v1/*`

## 主要特性

### 浏览器签名执行

请求可以在真实页面环境里完成签名，再通过浏览器 `fetch` 发出，行为更接近 Kling 当前前端。

### 自动 Cookie 恢复

当服务检测到登录态失效时，会尝试重新读取本机 Chrome 里的可灵 Cookie 并重试。  
如果还是失效，会统一返回 `AUTH_EXPIRED`，并附上登录地址。

### 内建任务 builder

当前内建并验证过的 builder：

- 文生视频
- 图生视频
- 首尾帧视频
- Omni 视频

### 本地媒体上传辅助

支持把本地图片或文件上传到 Kling 可用的 URL，再复用到任务请求里。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

把 `.env.example` 复制为 `.env`。

重点字段：

- `PORT`
- `KLING_COOKIE`
- `KLING_API_BASE_URL`
- `KLING_SITE_BASE_URL`
- `KLING_BROWSER_EXECUTABLE_PATH`
- `KLING_BROWSER_USER_DATA_DIR`
- `KLING_BROWSER_HEADLESS`
- `KLING_BROWSER_REQUEST_TIMEOUT_MS`
- `KLING_BROWSER_MODULE_URL`

说明：

- 如果 `KLING_COOKIE` 为空，服务会尝试从本机 Chrome 自动读取 Kling Cookie
- 默认网页地址是 `https://app.klingai.com`
- 默认 API 域名是 `https://api-app-cn.klingai.com`

### 3. 启动服务

```bash
npm start
```

或者使用辅助脚本：

```bash
./scripts/run_local.sh
```

默认本地地址：

```text
http://127.0.0.1:8010
```

## 鉴权流程

检查服务健康状态：

```bash
curl http://127.0.0.1:8010/health
```

检查浏览器登录态是否有效：

```bash
curl http://127.0.0.1:8010/v2/browser/auth/check
```

登录有效时：

```json
{
  "ok": true,
  "authenticated": true,
  "login_url": "https://app.klingai.com/cn/"
}
```

登录失效时：

```json
{
  "ok": true,
  "authenticated": false,
  "code": "AUTH_EXPIRED",
  "login_url": "https://app.klingai.com/cn/"
}
```

如果失效，请先在真实浏览器里重新登录：

```text
https://app.klingai.com/cn/
```

然后重新请求 `GET /v2/browser/auth/check`。

## API 总览

### 核心浏览器路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v2/browser/health` | 浏览器运行时健康检查 |
| `GET` | `/v2/browser/auth/check` | 登录态检查 |
| `GET` | `/v2/browser/account/profile` | 账号资料与 features |
| `POST` | `/v2/browser/request` | 通用签名请求透传 |
| `POST` | `/v2/browser/upload/image` | 上传本地图片 |
| `POST` | `/v2/browser/upload/file` | 上传本地文件 |
| `POST` | `/v2/browser/tasks/submit` | 提交原始 task body |
| `POST` | `/v2/browser/tasks/text-to-video` | 文生视频 |
| `POST` | `/v2/browser/tasks/image-to-video` | 图生视频 |
| `POST` | `/v2/browser/tasks/first-last-frame` | 首尾帧 |
| `POST` | `/v2/browser/tasks/omni-video` | Omni 视频 |
| `GET` | `/v2/browser/tasks/:taskId` | 查任务状态 |
| `GET` | `/v2/browser/tasks/:taskId/poll` | 轮询任务 |

### 低层 / legacy 路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v1/account/profile` | 直接 HTTP 查 profile |
| `GET` | `/v1/upload/issue-token` | 直接 HTTP 申请上传 token |
| `POST` | `/v1/upload/verify` | 直接 HTTP 校验上传 |
| `POST` | `/v1/tasks/submit` | 直接 HTTP 提交原始任务 |
| `GET` | `/v1/tasks/:taskId` | 直接 HTTP 查任务 |
| `GET` | `/v1/tasks/:taskId/poll` | 直接 HTTP 轮询 |

## 使用示例

### 通用浏览器签名请求

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

### 文生视频

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

### 图生视频

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/image-to-video \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452",
    "prompt": "subtle cinematic motion, natural camera push-in, realistic lighting"
  }'
```

### 首尾帧

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/first-last-frame \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452",
    "tail_image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_3.png?x-kcdn-pid=112452",
    "prompt": "smooth transition from first frame to last frame, cinematic movement"
  }'
```

### Omni 视频

纯 prompt：

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/omni-video \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一个女孩在海边慢慢回头，电影感"
  }'
```

图片引用：

```bash
curl -X POST http://127.0.0.1:8010/v2/browser/tasks/omni-video \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "让<<<image_1>>>里的场景产生轻微镜头推进和自然光影变化",
    "image_url": "https://p1-kling.klingai.com/bs2/upload-ylab-stunt/kling/resources/web_wallpaper/wallpaper_5.png?x-kcdn-pid=112452"
  }'
```

## 错误模型

常见错误：

| Code | 含义 |
| --- | --- |
| `AUTH_EXPIRED` | 可灵网页登录态失效 |
| `OMNI_VIDEO_INPUT_UNSUPPORTED` | 高层 Omni 路由暂不支持视频引用输入 |
| `TASK.MembershipQueueLimit` | 当前账号暂时不能继续提交任务 |
| `VALID.IllegalArgument` | 请求参数不合法 |
| `TASK.TaskPriceSearchFail` | Kling 在价格试算阶段拒绝了该 payload |

## 项目结构

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

## 当前限制

- 这个项目依赖 Kling 私有网页行为，前端一变就可能受影响
- 任务 schema 依然是模型相关的
- Omni 视频高层执行目前不支持视频参考输入
- 这不是官方可灵 API

## Roadmap

- 持续补齐更多模型 builder
- 增加更多已验证的 Omni 流程
- 降低 Kling 前端更新带来的破坏
- 保持浏览器签名路径作为主执行路线

## 免责声明

这是一个非官方的 Kling 消费者网页封装项目。  
请谨慎使用，尊重目标平台，并假设私有接口可能随时变化。
