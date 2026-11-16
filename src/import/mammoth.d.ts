declare module 'mammoth/mammoth.browser' {
  interface Image {
    contentType: string;
    readAsArrayBuffer(): Promise<ArrayBuffer>;
  }
  export const images: {
    imgElement(fn: (image: Image) => Promise<{ src: string }>): unknown;
  };
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { convertImage?: unknown },
  ): Promise<{ value: string; messages: unknown[] }>;
}
