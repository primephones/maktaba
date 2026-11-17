import { describe, expect, it } from 'vitest';
import { piecesOf, sentences } from './speech';

describe('reading aloud', () => {
  it('hands transliterated Arabic terms to an Arabic voice', () => {
    const p = piecesOf('Ijmāʿ (consensus) is a proof, and qiyās follows it.', 'en', []);
    expect(p.map((x) => x.lang)).toEqual(['ar', 'en', 'ar', 'en']);
    expect(p[0].text).toBe('الإجماع');
    expect(p[2].text).toBe('القياس');
  });
  it('uses the reader’s own fixes first', () => {
    const p = piecesOf('Read al-Shāfiʿī today.', 'en', [{ word: 'al-Shāfiʿī', say: 'الشافعي', lang: 'ar' }]);
    expect(p).toEqual([{ text: 'Read ', lang: 'en' }, { text: 'الشافعي', lang: 'ar' }, { text: ' today.', lang: 'en' }]);
  });
  it('leaves Arabic text whole for an Arabic voice', () => {
    expect(piecesOf('العلم ما نفع', 'ar', [])).toEqual([{ text: 'العلم ما نفع', lang: 'ar' }]);
  });
  it('splits sentences in English and Arabic', () => {
    expect(sentences('One. Two? ثلاثة؟ أربعة.')).toEqual(['One.', 'Two?', 'ثلاثة؟', 'أربعة.']);
  });
});
