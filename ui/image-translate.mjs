// 图内文字翻译只改文字、不改商品。每张图同时保留原图与译文两份文件令牌，
// useTranslated 只决定提交时用哪一份；切换它不会丢掉另一份。
export function translationTargets(images, { scope = 'current', imageId = null } = {}) {
  const list = Array.isArray(images) ? images : [];
  const usable = image => Boolean(image?.token) && !image.excluded;
  if (scope === 'all') return list.filter(usable);
  const image = list.find(item => item?.id === imageId) ?? null;
  return image && usable(image) ? [image] : [];
}

export function withTranslated(image, translated) {
  if (!translated?.token) throw new Error('译文缺少文件。');
  return { ...image, translated: { ...translated }, useTranslated: true, uploadedUrl: '', uploadedToken: '' };
}

// 原图与译文都留着，只改提交时用哪一份；已上传的希音地址随之失效。
export function withSourceVersion(image, useTranslated) {
  return { ...image, useTranslated: Boolean(useTranslated), uploadedUrl: '', uploadedToken: '' };
}

export function translationRecord({ token, mime, size, width, height, modelId, createdAt }) {
  return {
    token,
    mime: mime || '',
    size: Number(size) || 0,
    width: Number(width) || 0,
    height: Number(height) || 0,
    modelId: modelId || '',
    createdAt: Number(createdAt) || Date.now()
  };
}

export function mergeTranslationResults(images, results) {
  const merged = new Map((Array.isArray(results) ? results : [])
    .filter(item => item?.imageId && item?.translated?.token)
    .map(item => [item.imageId, item.translated]));
  return (Array.isArray(images) ? images : []).map(image => (merged.has(image.id) ? withTranslated(image, merged.get(image.id)) : image));
}

export function translationFailures(batch) {
  return (batch?.items ?? [])
    .filter(item => ['failed', 'unknown', 'save-failed'].includes(item.state))
    .map(item => ({ name: item.name ?? '', message: item.error || '没有生成译文' }));
}
