// Phone photos are 3–12 MB; storing them raw would fill the browser's storage after a few dozen
// pieces. Every upload is re-encoded once into a detail-size image and a small grid thumbnail.
const FULL_MAX = 1600;
const THUMB_MAX = 480;
const QUALITY = 0.82;

export interface ProcessedPhoto {
  image: string;
  thumb: string;
}

function encode(source: CanvasImageSource, width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  // White under transparent PNGs, so the JPEG fallback doesn't turn them black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  // Browsers that can't encode WebP silently return PNG, which is larger than the original JPEG.
  const webp = canvas.toDataURL("image/webp", QUALITY);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", QUALITY);
}

export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    let source: ImageBitmap | HTMLImageElement;
    let width: number;
    let height: number;
    try {
      // Applies the camera's EXIF rotation so portrait shots don't come out sideways.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } catch {
      const image = new Image();
      image.src = url;
      await image.decode();
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    }
    const result = { image: encode(source, width, height, FULL_MAX), thumb: encode(source, width, height, THUMB_MAX) };
    if (source instanceof ImageBitmap) source.close();
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
