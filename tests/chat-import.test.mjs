import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseChatImport, CHAT_IMPORT_MAX_BYTES, CHAT_IMPORT_MAX_PHOTO_BYTES } from "../src/chat-import.ts";

// A real 1×1 PNG; the browser separately decodes photos before any database write.
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=", "base64");
const image = `data:image/png;base64,${imageBytes.toString("base64")}`;
const item = () => ({ id: "d244b23b-a245-4fde-a2a4-57edb9aa1bfd", name: "Test beige shirt", category: "Shirts", brand: "Zara", size: "S–M", photos: { front: image } });
const batch = (items = [item()]) => ({ format: "digital-closet-chat-import", version: 1, items });
const parse = (value) => parseChatImport(JSON.stringify(value));
const render = () => ({ provider: "OpenAI", model: "test-model", createdAt: "2026-10-25T00:00:00.000Z", sourcePhotoSha256: createHash("sha256").update(imageBytes).digest("hex") });

const photoBatch = (bytes, mime) => batch([{ ...item(), photos: { front: `data:image/${mime};base64,${bytes.toString("base64")}` } }]);
// Header-only fixtures exercise predecode inspection. The UI independently decodes the full file.
function pngHeader(width, height) {
  const bytes = Buffer.from(imageBytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
function jpegHeader(width, height, marker = 0xc0) {
  const bytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe1, 0, 6, 0x45, 0x78, 0x69, 0x66,
    0xff, marker, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
  bytes.writeUInt16BE(height, 15);
  bytes.writeUInt16BE(width, 17);
  return bytes;
}
function webpChunk(kind, payload) {
  const header = Buffer.alloc(8);
  header.write(kind);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)]);
}
function webpFile(...chunks) {
  const content = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF");
  header.writeUInt32LE(content.length + 4, 4);
  header.write("WEBP", 8);
  return Buffer.concat([header, content]);
}
function vp8(width, height) {
  const payload = Buffer.from([0x10, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0]);
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return webpChunk("VP8 ", payload);
}
function vp8l(width, height) {
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  return webpChunk("VP8L", payload);
}
function vp8x(width, height) {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webpChunk("VP8X", payload);
}

test("accepts an original/label/back batch without adding sync or confirmed state", async () => {
  const entry = item();
  entry.photos.label = image;
  entry.photos.back = image;
  assert.deepEqual(await parse(batch([entry])), batch([entry]));
});

test("binds a generated render to its exact original photo", async () => {
  const entry = item();
  entry.photos.render = image;
  entry.ai = { render: { ...render(), prompt: "Keep four buttons.\nPreserve both pockets.", referenceUrl: "https://example.com/shirt" } };
  assert.deepEqual(await parse(batch([entry])), batch([entry]));
  entry.ai.render.sourcePhotoSha256 = "a".repeat(64);
  await assert.rejects(parse(batch([entry])), /does not reference its front photo/u);
});

test("rejects remote photos, unsupported image types and mismatched signatures", async () => {
  for (const source of ["https://example.com/photo.jpg", "data:image/svg+xml;base64,PHN2Zz4=", image.replace("image/png", "image/jpeg"), "data:image/png;base64,AB=="]) {
    const entry = item();
    entry.photos.front = source;
    await assert.rejects(parse(batch([entry])), /embedded|image type|invalid image/u);
  }
});

test("rejects malformed JSON, unsupported versions, empty batches and duplicate IDs", async () => {
  await assert.rejects(parseChatImport("{"), /valid Digital Closet JSON/u);
  await assert.rejects(parse({ ...batch(), version: 2 }), /not supported/u);
  await assert.rejects(parse(batch([])), /between 1 and 10/u);
  await assert.rejects(parse(batch([item(), item()])), /same piece ID/u);
  await assert.rejects(parse(batch(Array.from({ length: 11 }, item))), /between 1 and 10/u);
});

test("rejects injected bookkeeping and prototype fields at every level", async () => {
  for (const field of ["status", "dirty", "user_id", "createdAt", "photoPath", "confirmed_fields", "constructor", "__proto__"]) {
    const entry = JSON.parse(JSON.stringify(item()));
    Object.defineProperty(entry, field, { value: "injected", enumerable: true });
    await assert.rejects(parse(batch([entry])), /unsupported field/u);
  }
  await assert.rejects(parseChatImport('{"format":"digital-closet-chat-import","version":1,"items":[],"__proto__":{"polluted":true}}'), /unsupported field/u);
  const entry = item();
  entry.photos.photo_path = "another-user/photo.webp";
  await assert.rejects(parse(batch([entry])), /unsupported field/u);
  assert.equal({}.polluted, undefined);
});

test("requires render provenance and rejects unexpected AI metadata or unsafe references", async () => {
  const entry = item();
  entry.photos.render = image;
  await assert.rejects(parse(batch([entry])), /needs AI provenance/u);
  entry.ai = { render: render() };
  for (const url of ["http://example.com/a", "javascript:alert(1)", "https://user:password@example.com/a"]) {
    entry.ai.render.referenceUrl = url;
    await assert.rejects(parse(batch([entry])), /HTTPS URL/u);
  }
  delete entry.ai.render.referenceUrl;
  entry.ai.render.generated_path = "another-user/render.webp";
  await assert.rejects(parse(batch([entry])), /unsupported field/u);
  delete entry.ai.render.generated_path;
  delete entry.photos.render;
  await assert.rejects(parse(batch([entry])), /without a render photo/u);
});

test("bounds names and metadata and requires valid UUIDs and dates", async () => {
  for (const [key, value] of [["name", "x".repeat(121)], ["category", ""], ["id", "not-a-uuid"], ["size", "M\u0000"]]) {
    await assert.rejects(parse(batch([{ ...item(), [key]: value }])));
  }
  const entry = item();
  entry.photos.render = image;
  entry.ai = { render: { ...render(), createdAt: "yesterday" } };
  await assert.rejects(parse(batch([entry])), /ISO UTC timestamp/u);
  entry.ai.render.createdAt = "2026-02-31T00:00:00.000Z";
  await assert.rejects(parse(batch([entry])), /ISO UTC timestamp/u);
});

test("rejects oversized photos and batches before importing", async () => {
  const oversized = Buffer.alloc(CHAT_IMPORT_MAX_PHOTO_BYTES + 1);
  imageBytes.copy(oversized);
  const entry = item();
  entry.photos.front = `data:image/png;base64,${oversized.toString("base64")}`;
  await assert.rejects(parse(batch([entry])), /12 MB photo limit/u);
  await assert.rejects(parseChatImport(" ".repeat(CHAT_IMPORT_MAX_BYTES + 1)), /30 MB batch limit/u);
});

test("accepts bounded PNG, baseline/progressive JPEG, and WebP header variants", async () => {
  for (const [bytes, mime] of [
    [pngHeader(8000, 5000), "png"],
    [jpegHeader(1600, 1200), "jpeg"],
    [jpegHeader(1200, 1600, 0xc2), "jpeg"],
    [webpFile(vp8(1600, 1200)), "webp"],
    [webpFile(vp8l(1200, 1600)), "webp"],
    [webpFile(vp8x(1600, 1200), webpChunk("EXIF", Buffer.from([1, 2, 3])), vp8(1600, 1200)), "webp"],
    [webpFile(vp8x(1200, 1600), vp8l(1200, 1600)), "webp"],
  ]) assert.equal((await parse(photoBatch(bytes, mime))).items.length, 1);
});

test("rejects excessive pixel counts and edges before browser decode", async () => {
  for (const [bytes, mime] of [
    [pngHeader(8000, 5001), "png"],
    [pngHeader(10001, 1), "png"],
    [jpegHeader(8000, 6000), "jpeg"],
    [jpegHeader(1, 10001, 0xc2), "jpeg"],
    [webpFile(vp8(10001, 1)), "webp"],
    [webpFile(vp8l(8000, 6000)), "webp"],
    [webpFile(vp8x(10001, 1), vp8l(10001, 1)), "webp"],
  ]) await assert.rejects(parse(photoBatch(bytes, mime)), /40 megapixels/u);
});

test("rejects missing, zero and truncated PNG/JPEG dimensions", async () => {
  const wrongIhdr = pngHeader(1, 1);
  wrongIhdr.write("IDAT", 12);
  const wrongIhdrLength = pngHeader(1, 1);
  wrongIhdrLength.writeUInt32BE(12, 8);
  const jpegBadLength = jpegHeader(1, 1);
  jpegBadLength.writeUInt16BE(65535, 4);
  const jpegBadComponents = jpegHeader(1, 1);
  jpegBadComponents[19] = 4;
  for (const [bytes, mime] of [
    [pngHeader(0, 1), "png"], [pngHeader(1, 1).subarray(0, 25), "png"],
    [wrongIhdr, "png"], [wrongIhdrLength, "png"],
    [jpegHeader(0, 1), "jpeg"], [jpegHeader(1, 1).subarray(0, 18), "jpeg"],
    [jpegBadLength, "jpeg"], [jpegBadComponents, "jpeg"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), "jpeg"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]), "jpeg"],
  ]) await assert.rejects(parse(photoBatch(bytes, mime)), /image header/u);
});

test("bounds WebP chunks and rejects mismatched canvases, missing frames and animation", async () => {
  const badRiffSize = webpFile(vp8(1, 1));
  badRiffSize.writeUInt32LE(100000, 4);
  const badChunkSize = webpFile(vp8(1, 1));
  badChunkSize.writeUInt32LE(100000, 16);
  const badVp8Start = vp8(1, 1);
  badVp8Start[11] = 0;
  const badVp8lVersion = vp8l(1, 1);
  badVp8lVersion[12] = 0xe0;
  const animated = vp8x(1, 1);
  animated[8] = 0x02;
  const missingPadding = webpFile(webpChunk("VP8L", Buffer.from([0x2f, 0, 0, 0, 0]))).subarray(0, 25);
  missingPadding.writeUInt32LE(missingPadding.length - 8, 4);
  for (const bytes of [
    badRiffSize, badChunkSize, webpFile(badVp8Start), webpFile(badVp8lVersion),
    webpFile(vp8(0, 1)), webpFile(vp8x(2, 2), vp8(1, 1)), webpFile(vp8x(1, 1)),
    webpFile(vp8(1, 1), vp8x(1, 1)), webpFile(vp8(1, 1), vp8l(1, 1)),
    webpFile(animated, vp8(1, 1)), webpFile(webpChunk("ANMF", Buffer.alloc(0)), vp8(1, 1)),
    missingPadding,
  ]) await assert.rejects(parse(photoBatch(bytes, "webp")), /image header/u);
});
