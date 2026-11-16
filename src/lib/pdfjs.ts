import type { PDFDocumentProxy } from 'pdfjs-dist';

let lib: Promise<typeof import('pdfjs-dist')> | null = null;

/** pdf.js is large, so it is loaded only when a PDF is actually opened or imported. */
function pdfjs() {
  if (!lib) {
    lib = (async () => {
      const [mod, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      mod.GlobalWorkerOptions.workerSrc = worker.default;
      return mod;
    })();
  }
  return lib;
}

const asset = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

export async function loadPdf(file: Blob): Promise<PDFDocumentProxy> {
  const mod = await pdfjs();
  const task = mod.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
  });
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password and add it again.');
    if (name === 'InvalidPDFException') throw new Error('This PDF is damaged and could not be opened.');
    throw e;
  }
}

/** Open documents per book, so the reader does not re-parse the file for every page image. */
const open = new Map<string, Promise<PDFDocumentProxy>>();

export function pdfForBook(bookId: string, getFile: () => Promise<Blob | undefined>): Promise<PDFDocumentProxy> {
  let p = open.get(bookId);
  if (!p) {
    p = (async () => {
      const file = await getFile();
      if (!file) throw new Error('The original file for this book is missing. Add the book again.');
      return loadPdf(file);
    })();
    open.set(bookId, p);
    p.catch(() => open.delete(bookId));
  }
  return p;
}

export function closePdf(bookId: string) {
  const p = open.get(bookId);
  open.delete(bookId);
  p?.then((doc) => doc.loadingTask.destroy()).catch(() => undefined);
}
