#!/usr/bin/env node
// Node 24: uses built-in TypeScript stripping to share the browser's validator.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseChatImport, CHAT_IMPORT_MAX_PHOTO_BYTES, CHAT_IMPORT_MAX_BYTES } from "../src/chat-import.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function allowKeys(value, keys, description) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${description} contains unsupported fields or is not an object.`);
  }
}

async function embeddedPhoto(path, baseDirectory) {
  if (typeof path !== "string" || !path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(path)) {
    throw new Error("Every photo must point to a local JPEG, PNG or WebP file.");
  }
  const fullPath = resolve(baseDirectory, path);
  const info = await stat(fullPath);
  if (!info.isFile() || info.size > CHAT_IMPORT_MAX_PHOTO_BYTES) throw new Error("Each photo must be a file smaller than 12 MB.");
  const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[extname(fullPath).toLowerCase()];
  if (!mime) throw new Error("Only JPEG, PNG and WebP photos are supported.");
  const bytes = await readFile(fullPath);
  if (bytes.byteLength > CHAT_IMPORT_MAX_PHOTO_BYTES) throw new Error("A photo exceeds 12 MB.");
  return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, bytes };
}

async function main() {
  const [specArgument, outputArgument] = process.argv.slice(2);
  if (!specArgument || process.argv.length > 4) throw new Error("Usage: node scripts/prepare-chat-import.mjs <local-spec.json> [batch-name.json]");
  const specPath = resolve(specArgument);
  if ((await stat(specPath)).size > 1024 * 1024) throw new Error("The preparation spec exceeds 1 MB.");
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  allowKeys(spec, ["format", "version", "items"], "The spec");
  if (!Array.isArray(spec.items) || spec.items.length < 1 || spec.items.length > 10) throw new Error("Provide between 1 and 10 pieces.");
  const items = [];
  for (const entry of spec.items) {
    allowKeys(entry, ["id", "name", "category", "brand", "color", "size", "photos", "ai"], "A piece");
    allowKeys(entry.photos, ["front", "label", "back", "render"], "Photos");
    const front = await embeddedPhoto(entry.photos.front, dirname(specPath));
    const photos = { front: front.dataUrl };
    for (const key of ["label", "back", "render"]) {
      if (Object.hasOwn(entry.photos, key)) photos[key] = (await embeddedPhoto(entry.photos[key], dirname(specPath))).dataUrl;
    }
    const item = { ...entry, photos };
    if (Object.hasOwn(entry, "ai")) {
      allowKeys(entry.ai, ["render"], "AI metadata");
      allowKeys(entry.ai.render, ["provider", "model", "createdAt", "sourcePhotoSha256", "prompt", "referenceUrl"], "Render metadata");
      item.ai = { render: { ...entry.ai.render, sourcePhotoSha256: createHash("sha256").update(front.bytes).digest("hex") } };
    }
    items.push(item);
  }
  const batch = await parseChatImport(JSON.stringify({
    format: spec.format ?? "digital-closet-chat-import",
    version: spec.version ?? 1,
    items,
  }));
  const serialized = JSON.stringify(batch);
  if (Buffer.byteLength(serialized) > CHAT_IMPORT_MAX_BYTES) throw new Error("The prepared batch exceeds 30 MB. Split it into smaller batches.");
  const outputName = outputArgument ?? `${basename(specPath, extname(specPath))}.json`;
  if (!/^[a-z\d][a-z\d._-]*\.json$/iu.test(outputName) || outputName.includes("..")) throw new Error("Use a plain .json filename for the output.");
  const outputDirectory = resolve(projectRoot, ".closet-imports");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const outputPath = resolve(outputDirectory, outputName);
  await writeFile(outputPath, serialized, { flag: "wx", mode: 0o600 });
  console.log(`Prepared ${items.length} piece${items.length === 1 ? "" : "s"}: ${outputPath}`);
  console.log("Nothing uploaded. Open Import from chat in Digital Closet and select this private file.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not prepare the import.");
  process.exitCode = 1;
});
