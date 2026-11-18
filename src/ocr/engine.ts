import type { Block, OcrLang } from '../db/types';
import { linesToBlocks, type Line } from '../import/pdfText';

/**
 * Offline text recognition for page images (Tesseract, run on the phone). It works without
 * internet in Arabic, Persian, Urdu and English. Accuracy is good on clean printed Arabic,
 * fair on old prints, and weak on Urdu Nastaliq; every paragraph keeps a confidence score
 * so weak pages can be checked by hand.
 */

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

let current: { langs: string; worker: Promise<TesseractWorker> } | null = null;

const asset = (path: string) => new URL(`tesseract/${path}`, document.baseURI).href;

async function simdSupported(): Promise<boolean> {
  try {
    const { simd } = await import('wasm-feature-detect');
    return await simd();
  } catch {
    return false;
  }
}

async function getWorker(langs: string): Promise<TesseractWorker> {
  if (current?.langs === langs) return current.worker;
  if (current) {
    const old = current.worker;
    current = null;
    void old.then((w) => w.terminate()).catch(() => undefined);
  }
  const worker = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const core = (await simdSupported()) ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
    return createWorker(langs.split('+'), OEM.LSTM_ONLY, {
      workerPath: asset('worker.min.js'),
      corePath: asset(core),
      langPath: asset('lang'),
      cacheMethod: 'none',
      gzip: true,
    });
  })();
  current = { langs, worker };
  worker.catch(() => {
    if (current?.worker === worker) current = null;
  });
  return worker;
}

/** Frees the engine's memory when there is nothing left to recognise. */
export async function releaseEngine(): Promise<void> {
  const c = current;
  current = null;
  if (c) await c.worker.then((w) => w.terminate()).catch(() => undefined);
}

export interface OcrResult {
  blocks: Block[];
  /** Whole-page confidence, 0–100. */
  conf: number;
  printed?: string;
  text: string;
}

/** Recognises one page image and rebuilds its paragraphs, headings and page number. */
export async function recognizePage(image: HTMLCanvasElement | Blob, langs: string, page: number): Promise<OcrResult> {
  const worker = await getWorker(langs);
  const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
  const tLines: Array<{ text: string; conf: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const text = l.text.replace(/\s+/g, ' ').trim();
        if (text) tLines.push({ text, conf: l.confidence, bbox: l.bbox });
      }
    }
  }
  tLines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  // Recognised lines in the same shape as lines read from a PDF (y grows upward there).
  const lines: Line[] = tLines.map((l) => ({
    y: -l.bbox.y0,
    size: Math.max(1, l.bbox.y1 - l.bbox.y0),
    left: l.bbox.x0,
    right: l.bbox.x1,
    text: l.text,
  }));
  const rebuilt = linesToBlocks(lines, page);
  // The page's size, to keep each paragraph's place on it as fractions (for highlighting
  // where the reader is, on the page image).
  let W = 0;
  let H = 0;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    W = image.width;
    H = image.height;
  } else {
    const bmp = await createImageBitmap(image as Blob).catch(() => null);
    W = bmp?.width ?? 0;
    H = bmp?.height ?? 0;
    bmp?.close();
  }
  const blocks: Block[] = rebuilt.blocks.map((b) => {
    // A paragraph's confidence is that of the lines it was built from.
    const parts = tLines.filter((l) => b.text.includes(l.text));
    const conf = parts.length ? Math.round(parts.reduce((n, l) => n + l.conf, 0) / parts.length) : Math.round(data.confidence);
    const box: Block['box'] =
      parts.length && W && H
        ? [
            Math.min(...parts.map((l) => l.bbox.x0)) / W,
            Math.min(...parts.map((l) => l.bbox.y0)) / H,
            Math.max(...parts.map((l) => l.bbox.x1)) / W,
            Math.max(...parts.map((l) => l.bbox.y1)) / H,
          ]
        : undefined;
    return { ...b, ocr: true, conf, ...(box ? { box } : {}) };
  });
  return { blocks, conf: Math.round(data.confidence ?? 0), printed: rebuilt.printed, text: data.text ?? '' };
}

export const OCR_LANGS: Array<[OcrLang, string]> = [['ara', 'Arabic'], ['urd', 'Urdu'], ['fas', 'Persian'], ['pus', 'Pashto'], ['msa', 'Malay'], ['eng', 'English']];
