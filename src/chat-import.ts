/** A private, portable batch prepared in chat. It never supplies sync or account state. */
export const CHAT_IMPORT_MAX_BYTES = 30 * 1024 * 1024;
export const CHAT_IMPORT_MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const CHAT_IMPORT_MAX_ITEMS = 10;

export interface ChatImportRender {
  provider: string;
  model: string;
  createdAt: string;
  sourcePhotoSha256: string;
  prompt?: string;
  referenceUrl?: string;
}

export interface PreparedChatImportItem {
  id: string;
  name: string;
  category: string;
  brand?: string;
  color?: string;
  size?: string;
  photos: { front: string; label?: string; back?: string; render?: string };
  ai?: { render: ChatImportRender };
}

export interface PreparedChatImport {
  format: "digital-closet-chat-import";
  version: 1;
  items: PreparedChatImportItem[];
}

type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`Could not import this file: ${message}`);
}

function object(value: unknown, allowed: readonly string[], where: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${where} must be an object.`);
  const record = value as JsonObject;
  if (Object.keys(record).some((key) => !allowed.includes(key))) fail(`${where} contains an unsupported field.`);
  return record;
}

function text(value: unknown, maximum: number, where: string, multiline = false): string {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (typeof value !== "string" || !value.trim() || value.length > maximum || controls.test(value)) {
    fail(`${where} must be text between 1 and ${maximum} characters.`);
  }
  return value.trim();
}

function optionalText(record: JsonObject, key: string, maximum: number, where: string): string | undefined {
  return Object.hasOwn(record, key) ? text(record[key], maximum, `${where} ${key}`) : undefined;
}

interface PhotoDimensions { width: number; height: number }

/** Read bounded headers before asking the browser to allocate a decoded bitmap. */
function photoDimensions(bytes: Uint8Array<ArrayBuffer>, mime: string, where: string): PhotoDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = (): never => fail(`${where} has an invalid or unsupported image header.`);
  let dimensions: PhotoDimensions | undefined;
  if (mime === "png") {
    // PNG requires IHDR as its first chunk: 13 data bytes plus its CRC.
    if (bytes.length < 33 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) invalid();
    dimensions = { width: view.getUint32(16), height: view.getUint32(20) };
  } else if (mime === "jpeg") {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) invalid();
      const marker = bytes[offset++];
      if (marker === 0x01) continue; // TEM is the only length-free marker allowed here.
      // A valid image must declare its dimensions before scan data or end-of-image.
      if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || marker === 0xda || (marker >= 0xd0 && marker <= 0xd7)) invalid();
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        if (length < 8) invalid();
        const components = bytes[offset + 7];
        if (!components || length !== 8 + 3 * components || !bytes[offset + 2]) invalid();
        dimensions = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
        break;
      }
      offset += length;
    }
  } else {
    // RIFF's declared size and each padded chunk must fit the actual file.
    if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let offset = 12;
    let canvas: PhotoDimensions | undefined;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) invalid();
      const kind = view.getUint32(offset);
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + length;
      const next = end + (length % 2);
      if (end > bytes.length || next > bytes.length) invalid();
      if (kind === 0x56503858) { // VP8X: extended canvas dimensions.
        if (offset !== 12 || canvas || length !== 10 || (bytes[start] & 0xc3) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) invalid();
        const uint24 = (index: number) => bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16);
        canvas = { width: uint24(start + 4) + 1, height: uint24(start + 7) + 1 };
      } else if (kind === 0x56503820) { // VP8 lossy key frame.
        if (dimensions || length < 10 || (bytes[start] & 1) || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) invalid();
        dimensions = { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff };
      } else if (kind === 0x5650384c) { // VP8L: lossless packed dimensions.
        if (dimensions || length < 5 || bytes[start] !== 0x2f) invalid();
        const packed = view.getUint32(start + 1, true);
        if (packed >>> 29) invalid();
        dimensions = { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
      } else if (kind === 0x414e494d || kind === 0x414e4d46) invalid(); // Animated WebP is not a still photo.
      offset = next;
    }
    if (canvas && dimensions && (canvas.width !== dimensions.width || canvas.height !== dimensions.height)) invalid();
  }
  const result = dimensions ?? invalid();
  if (!result.width || !result.height) invalid();
  if (Math.max(result.width, result.height) > 10_000 || result.width * result.height > 40_000_000) {
    fail(`${where} is too large. Use a photo at 40 megapixels or less with no edge over 10,000 pixels.`);
  }
  return result;
}

function photo(value: unknown, where: string): { dataUrl: string; bytes: Uint8Array<ArrayBuffer> } {
  if (typeof value !== "string") fail(`${where} must be an embedded JPEG, WebP or PNG photo.`);
  const match = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[2].length % 4 !== 0) fail(`${where} must be an embedded JPEG, WebP or PNG photo.`);
  const encoded = match[2];
  const byteLength = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (byteLength > CHAT_IMPORT_MAX_PHOTO_BYTES) fail(`${where} exceeds the 12 MB photo limit.`);
  let raw: string;
  try { raw = atob(encoded); } catch { fail(`${where} has invalid image data.`); }
  // Reject noncanonical padding as well as invalid characters, before a decoder sees it.
  if (btoa(raw) !== encoded) fail(`${where} has invalid image data.`);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const prefix = (...expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
  const valid = match[1] === "jpeg" ? prefix(0xff, 0xd8, 0xff)
    : match[1] === "png" ? prefix(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      : prefix(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!valid) fail(`${where} does not match its image type.`);
  photoDimensions(bytes, match[1], where);
  return { dataUrl: value, bytes };
}

function renderMetadata(value: unknown, where: string): ChatImportRender {
  const record = object(value, ["provider", "model", "createdAt", "sourcePhotoSha256", "prompt", "referenceUrl"], where);
  const createdAt = text(record.createdAt, 40, `${where} date`);
  const parsedDate = Date.parse(createdAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(createdAt) || !Number.isFinite(parsedDate)
    || new Date(parsedDate).toISOString().replace(".000Z", "Z") !== createdAt.replace(".000Z", "Z")) {
    fail(`${where} date must be an ISO UTC timestamp.`);
  }
  const sourcePhotoSha256 = text(record.sourcePhotoSha256, 64, `${where} source hash`).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(sourcePhotoSha256)) fail(`${where} source hash must be SHA-256.`);
  const referenceUrl = optionalText(record, "referenceUrl", 2048, where);
  if (referenceUrl) {
    let url: URL;
    try { url = new URL(referenceUrl); } catch { fail(`${where} reference must be an HTTPS URL.`); }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) fail(`${where} reference must be an HTTPS URL.`);
  }
  return {
    provider: text(record.provider, 80, `${where} provider`),
    model: text(record.model, 120, `${where} model`),
    createdAt,
    sourcePhotoSha256,
    ...(Object.hasOwn(record, "prompt") ? { prompt: text(record.prompt, 6000, `${where} prompt`, true) } : {}),
    ...(referenceUrl ? { referenceUrl } : {}),
  };
}

/** Validate the entire batch before the UI decodes/compresses any images or saves anything. */
export async function parseChatImport(source: string): Promise<PreparedChatImport> {
  if (new TextEncoder().encode(source).byteLength > CHAT_IMPORT_MAX_BYTES) fail("the file exceeds the 30 MB batch limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { fail("choose a valid Digital Closet JSON file."); }
  const batch = object(parsed, ["format", "version", "items"], "The file");
  if (batch.format !== "digital-closet-chat-import" || batch.version !== 1) fail("this file format or version is not supported.");
  if (!Array.isArray(batch.items) || batch.items.length < 1 || batch.items.length > CHAT_IMPORT_MAX_ITEMS) {
    fail("a batch must contain between 1 and 10 pieces.");
  }
  const ids = new Set<string>();
  const items: PreparedChatImportItem[] = [];
  for (let index = 0; index < batch.items.length; index++) {
    const where = `Piece ${index + 1}`;
    const entry = object(batch.items[index], ["id", "name", "category", "brand", "color", "size", "photos", "ai"], where);
    const id = text(entry.id, 36, `${where} ID`).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) fail(`${where} needs a stable UUID.`);
    if (ids.has(id)) fail("the same piece ID appears twice.");
    ids.add(id);
    const images = object(entry.photos, ["front", "label", "back", "render"], `${where} photos`);
    const front = photo(images.front, `${where} front photo`);
    const photos: PreparedChatImportItem["photos"] = { front: front.dataUrl };
    for (const key of ["label", "back", "render"] as const) {
      if (Object.hasOwn(images, key)) photos[key] = photo(images[key], `${where} ${key} photo`).dataUrl;
    }
    let ai: PreparedChatImportItem["ai"];
    if (Object.hasOwn(entry, "ai")) {
      const metadata = object(entry.ai, ["render"], `${where} AI metadata`);
      const render = renderMetadata(metadata.render, `${where} render`);
      if (!photos.render) fail(`${where} has render metadata without a render photo.`);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", front.bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (render.sourcePhotoSha256 !== hash) fail(`${where} render does not reference its front photo.`);
      ai = { render };
    } else if (photos.render) fail(`${where} render needs AI provenance metadata.`);
    const item: PreparedChatImportItem = {
      id,
      name: text(entry.name, 120, `${where} name`),
      category: text(entry.category, 80, `${where} collection`),
      photos,
      ...(ai ? { ai } : {}),
    };
    for (const key of ["brand", "color", "size"] as const) {
      const value = optionalText(entry, key, key === "size" ? 40 : 80, where);
      if (value !== undefined) item[key] = value;
    }
    items.push(item);
  }
  return { format: "digital-closet-chat-import", version: 1, items };
}
