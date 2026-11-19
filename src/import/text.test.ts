import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseOpenITI, parsePlainText } from './text';
import { splitLargeSections } from './sections';

const OPENITI = `######OpenITI#
#META# 010.AuthorNAME :: الشافعي
#META# 020.BookTITLE :: الرسالة
#META#Header#End#

### | باب كيف البيان
# قال الشافعي: والبيان اسم جامع ms001
~~ لمعاني مجتمعة الأصول PageV01P021
# ممن نزل القرآن بلسانه.
### || فصل
# ومختلفة عند من يجهل لسان العرب. ms002 PageV02P005
`;

describe('OpenITI import', () => {
  const book = parseOpenITI(OPENITI);
  const all = book.sections.flatMap((s) => s.blocks);
  it('reads the title and author from the header', () => {
    expect(book.title).toBe('الرسالة');
    expect(book.author).toBe('الشافعي');
  });
  it('never lets page or milestone codes into the text', () => {
    const text = all.map((b) => b.text).join(' ');
    expect(text).not.toMatch(/PageV|ms\d|~~|#|META/);
  });
  it('joins continuation lines into one paragraph', () => {
    expect(all[1].text).toBe('قال الشافعي: والبيان اسم جامع لمعاني مجتمعة الأصول');
  });
  it('keeps the printed page, with the volume from the second volume on', () => {
    expect(all[2].printed).toBe('21');
    expect(all[all.length - 1].printed).toBe('2/5');
  });
  it('turns headers into headings and a contents list', () => {
    expect(all[0]).toMatchObject({ t: 'h', text: 'باب كيف البيان' });
    expect(book.toc.map((t) => t.title)).toEqual(['باب كيف البيان', 'فصل']);
  });
});

describe('plain text and Markdown import', () => {
  it('joins hard-wrapped lines and finds chapter headings', () => {
    const book = parsePlainText('Chapter 1\n\nFirst line\nsecond line.\n\nباب الطهارة\n\nنص الفقرة.');
    const blocks = book.sections.flatMap((s) => s.blocks);
    expect(blocks[1].text).toBe('First line second line.');
    expect(blocks.filter((b) => b.t === 'h').map((b) => b.text)).toEqual(['Chapter 1', 'باب الطهارة']);
  });
  it('keeps bold and italic as spans over the right characters', () => {
    const book = parseMarkdown('# Title\n\nThis is **bold** and *slanted* text.');
    const p = book.sections[0].blocks[1];
    expect(p.text).toBe('This is bold and slanted text.');
    expect(p.spans?.map((s) => [p.text.slice(s.s, s.e), s.k])).toEqual([['bold', 'b'], ['slanted', 'i']]);
    expect(book.title).toBe('Title');
  });
});

describe('splitting long sections', () => {
  it('keeps contents entries pointing at the same paragraph', () => {
    const blocks = Array.from({ length: 700 }, (_, i) => ({ t: 'p' as const, text: `para ${i}` }));
    const { sections, toc } = splitLargeSections([{ title: 'Long', blocks }], [{ title: 'Deep', section: 0, block: 650, level: 1 }]);
    expect(sections.length).toBe(3);
    expect(sections[toc[0].section].blocks[toc[0].block!].text).toBe('para 650');
  });
});

describe('very large books without headings (as many OpenITI shurūḥ are)', () => {
  it('are split by size too, each part named by its printed page, with contents', () => {
    const para = (v: number, p: number) => ({ t: 'p' as const, text: 'ق'.repeat(3000), printed: `${v}/${p}` });
    const blocks = Array.from({ length: 200 }, (_, i) => para(1 + Math.floor(i / 100), (i % 100) + 1));
    const { sections, toc } = splitLargeSections([{ title: 'Text', blocks }], []);
    expect(sections.length).toBeGreaterThan(4);
    expect(sections.every((s) => s.blocks.reduce((n, b) => n + b.text.length, 0) <= 120_000)).toBe(true);
    expect(sections[0].title).toBe('Vol. 1, p. 1');
    expect(sections.at(-1)!.title).toMatch(/^Vol\. 2, p\. \d+$/);
    expect(toc).toHaveLength(sections.length);
    expect(toc[1]).toMatchObject({ section: 1, block: 0 });
  });
  it('drop the numbering marks before a quoted matn', () => {
    const book = parseOpenITI('######OpenITI#\n#META#Header#End#\n# | 1 ( قوله باب كيف كان بدء الوحي )\n~~ قال الشارح هذا باب\n');
    expect(book.sections[0].blocks[0].text.startsWith('( قوله باب')).toBe(true);
  });
});
