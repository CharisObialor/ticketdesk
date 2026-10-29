// Large photos and screenshots are resized and re-encoded in the browser before upload.
// (Images are already compressed formats, so gzip would not shrink them; resizing and re-encoding does.)
const MAX_DIMENSION = 2048;
const MIN_BYTES = 300 * 1024;
const RESIZABLE = /^image\/(jpeg|png|webp)$/;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function optimiseImage(file: File): Promise<File> {
  if (!RESIZABLE.test(file.type) || file.size < MIN_BYTES || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // WebP keeps transparency and is much smaller; browsers that cannot encode it fall back to JPEG for photos.
    let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') blob = file.type === 'image/jpeg' ? await canvasToBlob(canvas, 'image/jpeg', 0.85) : null;
    if (!blob || blob.size > file.size * 0.9) return file;

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
    return new File([blob], name, { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}
