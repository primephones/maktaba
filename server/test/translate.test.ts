import { describe, expect, it } from 'vitest';
import { SEED_GLOSSARY, mergeGlossary, termsIn } from '../src/glossary';
import { acceptAnswer, acceptReview, buildReviewMessages, batches, buildMessages, checkAnswer, parseAnswer } from '../src/translate';

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
  it('rejects a missing paragraph and chatter', () => {
    expect(checkAnswer(src, [])[0].problem).toBe('missing');
    expect(() => acceptAnswer(src, [])).toThrow(/missing/);
    expect(checkAnswer(src, [{ id: 'a', en: 'Here is the translation of the year 204 text you asked for, which says knowledge benefits.', uncertain: [] }]).some((p) => /chatter/.test(p.problem))).toBe(true);
  });
  it('keeps a translation with a dropped number, marked for the reader to check', () => {
    const out = acceptAnswer(src, [{ id: 'a', en: 'Al-Shāfiʿī said: Knowledge is what benefits, not what is memorised; the scholars agreed on this.', uncertain: [] }]);
    expect(out[0].en.endsWith('†')).toBe(true);
    expect(out[0].uncertain[0].reason).toMatch(/numbers missing: 204/);
  });
  it('lets a watermark-only paragraph come back empty, but not a real one', () => {
    const stamp = [{ id: 's', text: 'www.besturdubooks.net' }];
    expect(acceptAnswer(stamp, [{ id: 's', en: '', uncertain: [] }])).toHaveLength(1);
    expect(() => acceptAnswer(src, [{ id: 'a', en: '', uncertain: [] }])).toThrow(/missing/);
  });
  it('tells the AI to leave watermarks out', () => {
    const sys = buildMessages({ lang: 'ur', paragraphs: [{ id: '1', text: 'نماز' }], glossary: [] })[0].content;
    expect(sys).toMatch(/watermark/);
    expect(sys).toMatch(/Urdu works quote Arabic/);
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

describe('Urdu and Persian', () => {
  it('tells the AI how Urdu books quote Arabic and write honorifics, with the glossary terms found in Urdu spelling', () => {
    const [sys, user] = buildMessages({ lang: 'ur', glossary: SEED_GLOSSARY, paragraphs: [{ id: 'p1', text: 'نبی کریم ﷺ نے فرمایا کہ طہارت نصف ایمان ہے۔ امام ابوحنیفہؒ کے نزدیک وضو میں نیت سنت ہے۔' }] });
    expect(sys.content).toMatch(/Urdu works quote Arabic/);
    expect(sys.content).toMatch(/صلی اللہ علیہ وسلم/);
    expect(sys.content).toMatch(/ؒ/);
    expect(user.content).toMatch(/ṭahāra/);
    expect(user.content).toMatch(/wuḍūʾ/);
    expect(user.content).toMatch(/sunna/);
  });
  it('gives Persian its own note, and Arabic none', () => {
    expect(buildMessages({ lang: 'fa', glossary: SEED_GLOSSARY, paragraphs: [{ id: 'p1', text: 'طهارت' }] })[0].content).toMatch(/Persian works quote Arabic/);
    expect(buildMessages({ lang: 'ar', glossary: SEED_GLOSSARY, paragraphs: [{ id: 'p1', text: 'الطهارة' }] })[0].content).not.toMatch(/works quote Arabic/);
  });
  it('keeps Urdu digits in the number check', () => {
    expect(checkAnswer([{ id: 'p1', text: 'فجر کی دو رکعتیں ہیں، اور سورۃ البقرۃ کی آیت ۲۲۲ میں ہے۔' }], [{ id: 'p1', en: 'Fajr has two rakʿas, and verse 222 of al-Baqara says so.', uncertain: [] }])).toEqual([]);
    expect(checkAnswer([{ id: 'p1', text: 'فجر کی دو رکعتیں ہیں، اور سورۃ البقرۃ کی آیت ۲۲۲ میں ہے۔' }], [{ id: 'p1', en: 'Fajr has two rakʿas, and a verse of al-Baqara says so.', uncertain: [] }])[0].problem).toMatch(/222/);
  });
});

describe('second check', () => {
  const items = [
    { id: '1', text: 'والقياس حجة عند الجمهور', en: 'Analogy is a proof according to the majority.' },
    { id: '2', text: 'ولا يجوز القياس في الحدود', en: 'Analogy is permitted in the prescribed punishments.' },
  ];
  it('confirms a faithful draft and corrects a wrong one, keeping what was changed and why', () => {
    const r = acceptReview(items, JSON.stringify({ paragraphs: [
      { id: '1', ok: true, en: items[0].en, changes: [] },
      { id: '2', ok: false, en: 'Analogy is not permitted in the prescribed punishments (ḥudūd).', changes: [{ was: 'is permitted', now: 'is not permitted', why: 'the original negates: lā yajūz' }] },
    ] }));
    expect(r[0]).toMatchObject({ ok: true, en: items[0].en, changes: [] });
    expect(r[1].ok).toBe(false);
    expect(r[1].changes[0].why).toMatch(/negates/);
  });
  it('refuses an answer that drops a paragraph, or cuts a draft down to a fragment', () => {
    expect(() => acceptReview(items, JSON.stringify({ paragraphs: [{ id: '1', ok: true, en: items[0].en }] }))).toThrow(/2: missing/);
    expect(() => acceptReview(items, JSON.stringify({ paragraphs: [{ id: '1', ok: true, en: items[0].en }, { id: '2', ok: false, en: 'No.', changes: [] }] }))).toThrow(/shorter/);
  });
  it('tells the checker to watch negations, speakers and technical terms', () => {
    const sys = buildReviewMessages('ar', items, [])[0].content;
    expect(sys).toMatch(/reverses a negation/);
    expect(sys).toMatch(/fa-in qīla/);
  });
});
