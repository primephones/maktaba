import { describe, expect, it } from 'vitest';
import { dropRunningHeaders, isDamaged, itemsToLines, linesToBlocks, mergeAcrossPages, textDamage, type TextItem } from './pdfText';

const item = (str: string, x: number, y: number, w: number, size = 12): TextItem => ({ str, transform: [size, 0, 0, size, x, y], width: w, height: size });

describe('PDF text reconstruction', () => {
  it('orders right-to-left fragments from the right edge', () => {
    const lines = itemsToLines([item('العالمين', 100, 500, 60), item('رب', 165, 500, 15), item('الحمد لله', 185, 500, 70)]);
    expect(lines[0].text).toBe('الحمد لله رب العالمين');
  });
  it('attaches a floating vowel mark to its letter without adding a space', () => {
    const lines = itemsToLines([item('المر', 180, 500, 30), item('ء', 174, 500, 6), item(' ُ', 173, 500, 0), item('في', 150, 500, 18)]);
    expect(lines[0].text).toBe('المرءُ في');
  });
  it('rebuilds paragraphs, de-hyphenates, and lifts the printed page number out', () => {
    const items = [
      item('The first para-', 50, 700, 300), item('graph ends here.', 50, 685, 180),
      item('A second paragraph follows.', 50, 650, 300),
      item('17', 195, 60, 12),
    ];
    const page = linesToBlocks(itemsToLines(items), 3);
    expect(page.printed).toBe('17');
    expect(page.blocks.map((b) => b.text)).toEqual(['The first paragraph ends here.', 'A second paragraph follows.']);
    expect(page.blocks[0]).toMatchObject({ page: 3, printed: '17' });
  });
  it('marks large type as a heading', () => {
    const page = linesToBlocks(itemsToLines([item('Chapter One', 50, 700, 120, 20), item('Body text of the chapter begins here and runs on.', 50, 660, 300), item('It continues on a second line of the same size.', 50, 645, 300)]), 1);
    expect(page.blocks[0]).toMatchObject({ t: 'h', text: 'Chapter One' });
  });
  it('joins a paragraph cut by a page break', () => {
    const a = linesToBlocks(itemsToLines([item('This sentence runs right to the edge of the page and', 50, 700, 300), item('continues without a full stop at the end of the line', 50, 685, 300)]), 1);
    const b = linesToBlocks(itemsToLines([item('onto the next page.', 50, 700, 120), item('Then a new paragraph.', 50, 660, 300)]), 2);
    const merged = mergeAcrossPages([a, b]);
    expect(merged[0].text).toMatch(/end of the line onto the next page\.$/);
    expect(merged.length).toBe(2);
  });
  it('drops running headers but keeps numbered chapter headings', () => {
    const pageWith = (first: TextItem) => linesToBlocks(itemsToLines([first, item('Body text of this page, long enough to be a paragraph line.', 50, 660, 300), item('More body text on the following line of the same page.', 50, 645, 300)]), 1);
    const headers = [1, 2, 3, 4].map((n) => pageWith(item(`Kitab al-Umm ${n}`, 50, 760, 90)));
    dropRunningHeaders(headers);
    expect(headers.every((p) => !p.blocks[0].text.startsWith('Kitab'))).toBe(true);
    const chapters = [1, 2, 3, 4].map((n) => pageWith(item(`Chapter ${n}`, 50, 760, 90, 20)));
    dropRunningHeaders(chapters);
    expect(chapters.map((p) => p.blocks[0].text)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
  });
  it('recognises a text layer with letters missing', () => {
    const good = [item('الحمد لله رب العالمين والصلاة والسلام على رسوله', 50, 700, 300)];
    const bad = [item('فإن العل\u0000 أفضل', 50, 700, 100), item('\u0000', 160, 700, 6), item('الأحكا\u0000', 170, 700, 60)];
    expect(isDamaged(textDamage(good))).toBe(false);
    expect(isDamaged(textDamage(bad))).toBe(true);
    // In Arabic one lost letter is already a misquotation.
    expect(isDamaged(textDamage([item('قال الإمام: العلم ما حف\u0000 وقد أجمع العلماء على ذلك', 50, 700, 300)]))).toBe(true);
    // In English a stray ornament glyph is not.
    expect(isDamaged(textDamage([item('\uF0B7 A bulleted line of ordinary English text in a book.', 50, 700, 300)]))).toBe(false);
  });
});
