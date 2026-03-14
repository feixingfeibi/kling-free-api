#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${1:-kling}"

agent-browser --session-name "$SESSION_NAME" open https://app.klingai.com/cn/ || true
agent-browser --session-name "$SESSION_NAME" wait 3000 || true

echo "== globals =="
agent-browser --session-name "$SESSION_NAME" eval 'JSON.stringify({
  has_ms: typeof Object.jmpOnw_ms,
  has_b2h: typeof Object.jmpOnw_b2h,
  has_send: typeof Object.jmpOnw_send,
  api_hint: window.location.origin
})'

echo "== sign input =="
agent-browser --session-name "$SESSION_NAME" eval 'Object.jmpOnw_ms({
  url: location.origin + "/api/user/profile_and_features",
  query: { caver: "1.0.0" }
})'
