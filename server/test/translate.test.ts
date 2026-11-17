import { describe, expect, it } from 'vitest';
import { SEED_GLOSSARY, mergeGlossary, termsIn } from '../src/glossary';
import { batches, buildMessages, checkAnswer, parseAnswer } from '../src/translate';

describe('glossary', () => {
  it('finds terms with attached prefixes and spelling variants', () => {
    const hits = termsIn('واعلم أن الاجماع حجة، وبالقياس يلحق الفرع', SEED_GLOSSARY).map((h) => h.term.tr);
    expect(hits).toContain('ijmāʿ');
    expect(hits).toContain('qiyās');
  });
  it('does not match inside other words', () => {
    expect(termsIn('قياسات', SEED_GLOSSARY).map((h) => h.term.tr)).not.toContain('qiyās');
  });
  it('lets a book override a shared term', () => {
    const merged = mergeGlossary(SEED_GLOSSARY, [{ ar: 'القياس', tr: 'qiyās', en: 'analogy' }]);
    expect(merged.find((t) => t.ar === 'القياس')?.en).toBe('analogy');
    expect(merged.length).toBe(SEED_GLOSSARY.length);
  });
});

describe('prompt', () => {
  it('sends only the glossary terms that occur, and keeps paragraph ids', () => {
    const [sys, user] = buildMessages({ lang: 'ar', glossary: SEED_GLOSSARY, paragraphs: [{ id: 'p1', text: 'الإجماع حجة قاطعة' }] });
    expect(sys.content).toMatch(/Be faithful/);
    expect(user.content).toContain('[p1]');
    expect(user.content).toContain('ijmāʿ (consensus)');
    expect(user.content).not.toContain('qiyās');
  });
});

describe('checking answers', () => {
  const src = [{ id: 'a', text: 'قال الشافعي في سنة ٢٠٤ هـ: العلم ما نفع، وليس العلم ما حفظ، وقد أجمع العلماء على ذلك' }];
  it('accepts a faithful answer with its numbers', () => {
    const ans = parseAnswer('```json\n{"paragraphs":[{"id":"a","en":"Al-Shāfiʿī said in the year 204 AH: Knowledge is what benefits, not what is memorised; the scholars agreed on this.","uncertain":[]}]}\n```');
    expect(checkAnswer(src, ans)).toEqual([]);
  });
  it('rejects a dropped number, a missing paragraph and chatter', () => {
    expect(checkAnswer(src, [{ id: 'a', en: 'Al-Shāfiʿī said: Knowledge is what benefits, not what is memorised; the scholars agreed on this.', uncertain: [] }])[0].problem).toMatch(/numbers missing: 204/);
    expect(checkAnswer(src, [])[0].problem).toBe('missing');
    expect(checkAnswer(src, [{ id: 'a', en: 'Here is the translation of the year 204 text you asked for, which says knowledge benefits.', uncertain: [] }]).some((p) => /chatter/.test(p.problem))).toBe(true);
  });
  it('keeps the reasons for uncertain words', () => {
    const ans = parseAnswer('{"paragraphs":[{"id":"a","en":"x†","uncertain":[{"span":"x","reason":"unclear reading"}]}]}');
    expect(ans[0].uncertain).toEqual([{ span: 'x', reason: 'unclear reading' }]);
  });
});

describe('batching', () => {
  it('keeps batches under the size limit without splitting paragraphs', () => {
    const ps = Array.from({ length: 30 }, (_, i) => ({ id: String(i), text: 'ب'.repeat(500) }));
    const b = batches(ps, 2000, 12);
    expect(b.every((x) => x.reduce((n, p) => n + p.text.length, 0) <= 2000)).toBe(true);
    expect(b.flat().length).toBe(30);
  });
});
