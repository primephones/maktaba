/** A place to open a book at, handed from search or references to the reader. */
export interface Jump {
  section: number;
  block: number;
  /** Character range to flash briefly so the eye finds it. */
  flash?: [number, number];
}

const pending = new Map<string, Jump>();

export const setJump = (bookId: string, jump: Jump) => pending.set(bookId, jump);

export function takeJump(bookId: string): Jump | undefined {
  const j = pending.get(bookId);
  pending.delete(bookId);
  return j;
}
