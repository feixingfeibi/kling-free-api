#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export KLING_BROWSER_MODULE_URL="${KLING_BROWSER_MODULE_URL:-https://p1-kling.klingai.com/kcdn/cdn-kcdn112452/kling-web/assets/js/index-BrvXf0G_.js}"
export KLING_BROWSER_REQUEST_TIMEOUT_MS="${KLING_BROWSER_REQUEST_TIMEOUT_MS:-30000}"

npm run start:local
