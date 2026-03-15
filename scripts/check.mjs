import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const scanDirs = ["src", "scripts", "test"];

function collectJavaScriptFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))
    ) {
      files.push(path.relative(rootDir, fullPath));
    }
  }

  return files;
}

const targets = scanDirs.flatMap((dir) =>
  collectJavaScriptFiles(path.join(rootDir, dir))
);

for (const target of targets) {
  const result = spawnSync(process.execPath, ["--check", target], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Syntax check passed for ${targets.length} files.`);
