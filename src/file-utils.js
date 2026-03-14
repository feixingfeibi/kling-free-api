import fs from "node:fs";
import path from "node:path";

import mime from "mime-types";

export function readLocalFileAsBase64(filePath) {
  const absPath = path.resolve(filePath);
  const buffer = fs.readFileSync(absPath);
  return {
    filePath: absPath,
    fileName: path.basename(absPath),
    mimeType: mime.lookup(absPath) || "application/octet-stream",
    base64: buffer.toString("base64"),
  };
}
