import { execFileSync } from "node:child_process";

function escapePython(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function loadKlingCookieFromChrome() {
  const script = `
import browser_cookie3
domains = ['klingai.com', '.klingai.com', 'app.klingai.com']
pairs = []
seen = set()
for domain in domains:
    try:
        jar = browser_cookie3.chrome(domain_name=domain)
    except Exception:
        continue
    for c in jar:
        if 'klingai.com' not in c.domain:
            continue
        if c.name in seen:
            continue
        seen.add(c.name)
        pairs.append(f"{c.name}={c.value}")
print('; '.join(pairs))
`;

  try {
    return execFileSync("python3", ["-c", script], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function maskCookie(cookie) {
  if (!cookie) {
    return "";
  }

  const parts = cookie.split("; ").map((entry) => {
    const index = entry.indexOf("=");
    if (index < 0) {
      return entry;
    }

    const key = entry.slice(0, index);
    const value = entry.slice(index + 1);
    if (value.length <= 8) {
      return `${key}=********`;
    }

    return `${key}=${value.slice(0, 4)}...${value.slice(-4)}`;
  });

  return parts.join("; ");
}
