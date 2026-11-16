import type { Reference } from '../db/types';
import { detectLang, isRtl } from './arabic';

export type Citation = Reference['citation'];

/**
 * The parts of a citation in the order a footnote gives them. An Arabic-script source is
 * cited the Arabic way (ج for volume, ص for page, Arabic comma); others the English way.
 */
export function citationParts(c: Citation): { rtl: boolean; sep: string; author?: string; title: string; rest: string[] } {
  const rtl = isRtl(detectLang(`${c.book} ${c.author}`));
  const rest = [
    c.edition,
    c.volume ? (rtl ? `ج ${c.volume}` : `vol. ${c.volume}`) : undefined,
    c.chapter,
    c.page ? (rtl ? `ص ${c.page}` : `p. ${c.page}`) : undefined,
  ].filter((x): x is string => !!x);
  return { rtl, sep: rtl ? '، ' : ', ', author: c.author || undefined, title: c.book, rest };
}

export function formatCitation(c: Citation): string {
  const p = citationParts(c);
  return [p.author, p.title, ...p.rest].filter(Boolean).join(p.sep);
}
