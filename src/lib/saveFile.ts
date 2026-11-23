import { isAndroidApp, plugin } from '../native/maktaba';

const CHUNK = 768 * 1024;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface Saved {
  /** Where the reader will find it, in words. */
  location: string;
  share?: () => Promise<void>;
}

/**
 * Saves a file for the reader to keep: into Downloads/Maktaba on Android (in pieces, so
 * a large backup never has to fit in memory), or as a download in a browser.
 */
export async function saveFile(blob: Blob, name: string, mime: string, onProgress?: (done: number, total: number) => void): Promise<Saved> {
  if (isAndroidApp()) {
    const { id } = await plugin.saveFileBegin({ name, mime });
    for (let at = 0; at < blob.size; at += CHUNK) {
      const part = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
      await plugin.saveFileChunk({ id, data: toBase64(part) });
      onProgress?.(Math.min(blob.size, at + CHUNK), blob.size);
    }
    const res = await plugin.saveFileEnd({ id });
    return { location: res.location, share: () => plugin.shareFile({ uri: res.uri, mime, title: 'Send the backup' }) };
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  onProgress?.(blob.size, blob.size);
  return { location: 'your Downloads folder' };
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  fb2: 'application/x-fictionbook+xml',
  html: 'text/html',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * A file name a browser will keep. Browsers drop a download's name when it is written in
 * Arabic script (the file then arrives as "download", without its extension), so those
 * letters are left out there, keeping the rest and the extension.
 */
export function downloadName(name: string): string {
  if (!/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(name)) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\u200c-\u200f]+/g, ' ').replace(/^[\s\-–·,]+|[\s\-–·,]+$/g, '').replace(/\s{2,}/g, ' ');
  return `${stem ? `Maktaba - ${stem}` : 'Maktaba book'}${ext}`;
}

export function mimeOf(fileName: string, fallback?: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? fallback ?? 'application/octet-stream';
}

/**
 * Opens a book's original file, untouched, in the phone's own app for it (a PDF viewer, an
 * e-book reader, Word). In a browser it opens in a new tab, or downloads if the browser
 * cannot show it. If no app on the phone opens that kind of file, the share sheet offers
 * other places to send it.
 */
export async function openOriginal(blob: Blob, fileName: string): Promise<'opened' | 'shared' | 'downloaded'> {
  const mime = blob.type || mimeOf(fileName);
  if (isAndroidApp()) {
    const { id } = await plugin.saveFileBegin({ name: fileName, mime, temp: true });
    for (let at = 0; at < blob.size; at += CHUNK) {
      await plugin.saveFileChunk({ id, data: toBase64(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer())) });
    }
    const res = await plugin.saveFileEnd({ id });
    try {
      await plugin.openFile({ uri: res.uri, mime, title: 'Open the original with' });
      return 'opened';
    } catch {
      await plugin.shareFile({ uri: res.uri, mime, title: 'Send the original file' });
      return 'shared';
    }
  }
  const typed = blob.type ? blob : new Blob([blob], { type: mime });
  const url = URL.createObjectURL(typed);
  const viewable = /^(application\/pdf|text\/|image\/)/.test(mime);
  if (viewable && window.open(url, '_blank')) {
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
    return 'opened';
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

/**
 * Hands a file to the phone's share sheet (WhatsApp, email, Drive…). Where there is no share
 * sheet, it is saved as a download instead.
 */
export async function shareBlob(blob: Blob, name: string, title: string): Promise<'shared' | 'saved'> {
  const mime = blob.type || mimeOf(name);
  if (isAndroidApp()) {
    const { id } = await plugin.saveFileBegin({ name, mime, temp: true });
    for (let at = 0; at < blob.size; at += CHUNK) {
      await plugin.saveFileChunk({ id, data: toBase64(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer())) });
    }
    const res = await plugin.saveFileEnd({ id });
    await plugin.shareFile({ uri: res.uri, mime, title });
    return 'shared';
  }
  const file = new File([blob], name, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  await saveFile(blob, name, mime);
  return 'saved';
}
