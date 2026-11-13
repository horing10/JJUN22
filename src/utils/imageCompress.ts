function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

export async function compressImageUrlToDataUrl(
  srcUrl: string,
  maxDim = 1080,
  maxChars = 650000
): Promise<string | null> {
  try {
    const img = await loadImageElement(srcUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return null;

    let scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    let quality = 0.76;

    for (let attempt = 0; attempt < 5; attempt++) {
      const targetW = Math.max(1, Math.round(srcW * scale));
      const targetH = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= maxChars) {
        return dataUrl;
      }

      scale *= 0.78;
      quality = Math.max(0.45, quality - 0.1);
    }

    return null;
  } catch {
    return null;
  }
}
