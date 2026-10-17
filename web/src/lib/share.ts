/**
 * Shares an image and caption to WhatsApp. On phones the native share sheet sends the
 * picture itself; elsewhere the image is downloaded and WhatsApp opens with the caption.
 */
export async function shareImage(dataUrl: string, text: string, filename: string): Promise<'shared' | 'fallback' | 'cancelled'> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  return 'fallback';
}
