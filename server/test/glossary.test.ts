import { describe, expect, it } from 'vitest';
import { SEED_GLOSSARY, termsIn } from '../src/glossary';

const found = (text: string) => termsIn(text, SEED_GLOSSARY).map((h) => h.term.tr);

describe('glossary terms in Arabic, Urdu and Persian writing', () => {
  it('finds Arabic terms with the article, prefixes and vowel marks', () => {
    expect(found('وأجمعوا على أن الإجماع حجة')).toContain('ijmāʿ');
    expect(found('والقِيَاسُ دليلٌ')).toContain('qiyās');
  });
  it('finds the same terms as Urdu writes them', () => {
    const t = found('امام ابوحنیفہؒ کے نزدیک وضو میں نیت سنت ہے، اور طہارت شرط ہے۔ اس پر اجماع ہے، اور قیاس بھی یہی ہے۔');
    expect(t).toEqual(expect.arrayContaining(['wuḍūʾ', 'sunna', 'ṭahāra', 'ijmāʿ', 'qiyās']));
  });
  it('knows Urdu’s own words for worship and the scholars', () => {
    const t = found('پانچوں نمازوں کے اوقات ثابت ہیں۔ احناف کے نزدیک، اور جمہور کے نزدیک۔ فقہاء نے روزہ اور زکوٰۃ کا ذکر کیا۔');
    expect(t).toEqual(expect.arrayContaining(['ṣalāt', 'the Ḥanafīs', 'the majority of scholars', 'fuqahāʾ', 'ṣawm', 'zakāt']));
  });
  it('finds terms as Persian writes them, joiners and all', () => {
    const t = found('فقها کتاب طهارت را پیش از نماز آورده‌اند و امت بر آن اجماع دارند.');
    expect(t).toEqual(expect.arrayContaining(['ṭahāra', 'ṣalāt', 'ijmāʿ']));
  });
  it('does not match inside other words', () => {
    expect(found('الصحيحين')).not.toContain('ṣaḥīḥ');
    expect(found('مقياس')).not.toContain('qiyās');
  });
});
