import UTIF from "utif";
const maxPixels = 16000000;
function dimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > maxPixels
  )
    throw Error("Use scan images with at most 16 million pixels per page.");
}
async function recognizeCanvas(canvas, recognize) {
  return recognize(
    new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    ),
  );
}
export async function readImage(bytes, format, recognize) {
  if (format === "tif" || format === "tiff") {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const pages = UTIF.decode(buffer);
    if (!pages.length || pages.length > 80)
      throw Error("Use a TIFF with 1 to 80 pages.");
    const texts = [];
    for (const page of pages) {
      dimensions(page.t256?.[0], page.t257?.[0]);
      UTIF.decodeImage(buffer, page);
      const canvas = new OffscreenCanvas(page.width, page.height);
      canvas
        .getContext("2d")
        .putImageData(
          new ImageData(
            new Uint8ClampedArray(UTIF.toRGBA8(page)),
            page.width,
            page.height,
          ),
          0,
          0,
        );
      texts.push(await recognizeCanvas(canvas, recognize));
      if (texts.join("\n").length > 95000)
        throw Error("The extracted image text exceeds the resume limit.");
    }
    return texts.join("\n");
  }
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    dimensions(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return recognizeCanvas(canvas, recognize);
  } finally {
    bitmap.close();
  }
}
