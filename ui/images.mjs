export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MIN_SQUARE_PIXELS = 900;
export const RECOMMENDED_PORTRAIT = { width: 1340, height: 1785 };

export const IMAGE_TYPES = Object.freeze({ main: 1, detail: 2, square: 5, color: 6, detail2: 7 });
export const ROLE_LABEL = Object.freeze({ main: '主图', detail: '详情图', square: '方图', color: '色块图', detail2: '细节图' });

export function imageTypeFor(role) {
  return IMAGE_TYPES[role] ?? IMAGE_TYPES.detail;
}

export function base64Bytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export function readImageSize(base64) {
  let bytes;
  try { bytes = typeof base64 === 'string' ? base64Bytes(base64) : base64; } catch { return null; }
  if (!bytes || bytes.length < 24) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (!length || length < 2) break;
      const isSof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
      if (isSof) return { mime: 'image/jpeg', height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
      offset += 2 + length;
    }
    return { mime: 'image/jpeg', width: 0, height: 0 };
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { mime: 'image/webp', width: 0, height: 0 };
  }
  return null;
}

export function validateImage(image) {
  const issues = [];
  const push = (level, message) => issues.push({ level, message });
  if (!image?.token) push('error', '尚未转存');
  if (image?.mime && !['image/jpeg', 'image/png'].includes(image.mime)) push('error', '需为 JPG 或 PNG');
  if (Number(image?.size) > MAX_IMAGE_BYTES) push('error', '超过希音 3 MB 上限');
  if (image?.role === 'main' && image?.width && image?.height) {
    const square = Math.abs(image.width - image.height) <= Math.min(image.width, image.height) * 0.05;
    if (square && Math.min(image.width, image.height) < MIN_SQUARE_PIXELS) push('warning', '方图低于 ' + MIN_SQUARE_PIXELS + ' px');
    if (!square && Math.min(image.width, image.height) < Math.min(RECOMMENDED_PORTRAIT.width, RECOMMENDED_PORTRAIT.height)) push('warning', '低于建议尺寸 ' + RECOMMENDED_PORTRAIT.width + '×' + RECOMMENDED_PORTRAIT.height);
  }
  return issues;
}

export function imageNeedsConversion(image) {
  return Boolean(image && (image.mime !== 'image/jpeg' && image.mime !== 'image/png'));
}

// 1688 的主图经常是 WebP/AVIF。希音只收 JPG/PNG，这里在插件页面内
// 用 canvas 转成白底 JPEG，不改变图内文字与商品外观。
export async function convertToJpeg(base64, mime, quality = 0.92) {
  const bytes = base64Bytes(base64);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime || 'image/webp' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('图片转换失败。');
  return { base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), mime: 'image/jpeg', width: canvas.width, height: canvas.height };
}
