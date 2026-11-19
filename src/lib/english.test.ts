import { describe, expect, it } from 'vitest';
import { looksEnglish } from './english';

describe('is it English?', () => {
  it('knows English prose', () => {
    expect(looksEnglish('Prayer is the pillar of the religion; whoever establishes it establishes the religion.')).toBe(true);
    expect(looksEnglish('Imām al-Shāfiʿī said: knowledge is what benefits, not what is memorised.')).toBe(true);
    expect(looksEnglish('On Prayer')).toBe(true);
  });
  it('knows a transliteration is not a translation', () => {
    expect(looksEnglish('Namaz deen ka sutoon hai. Jis ne namaz qaim ki us ne deen ko qaim kiya, aur jis ne namaz chhor di us ne deen ko dha diya.')).toBe(false);
    expect(looksEnglish('Zikr Allah dilon ka sukoon hai. Quran Majeed mein irshad hai ke khabardar Allah ke zikr hi se dilon ko itminan naseeb hota hai.')).toBe(false);
    expect(looksEnglish('نماز دین کا ستون ہے۔ جس نے نماز قائم کی')).toBe(false);
  });
});
