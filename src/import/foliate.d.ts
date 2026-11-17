declare module 'foliate-js/mobi.js' {
  export function isMOBI(file: Blob): Promise<boolean>;
  export class MOBI {
    constructor(opts: { unzlib: (data: Uint8Array) => Uint8Array });
    open(file: Blob): Promise<unknown>;
  }
}
