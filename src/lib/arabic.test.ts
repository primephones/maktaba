import { describe, expect, it } from 'vitest';
import { detectLang, findAll, normalizeForSearch, parseVolume, stripTashkil, stripTashkilWithMap } from './arabic';

describe('Arabic search folding', () => {
  it('ignores vowel marks', () => {
    expect(normalizeForSearch('العِلْمُ')).toBe(normalizeForSearch('العلم'));
  });
  it('ignores hamza spellings, tāʾ marbūṭa and alif maqṣūra', () => {
    expect(normalizeForSearch('الإجماع')).toBe(normalizeForSearch('الاجماع'));
    expect(normalizeForSearch('أحمد')).toBe(normalizeForSearch('احمد'));
    expect(normalizeForSearch('مسألة')).toBe(normalizeForSearch('مساله'));
    expect(normalizeForSearch('فتوى')).toBe(normalizeForSearch('فتوي'));
  });
  it('treats Persian and Urdu kāf and yāʾ as the Arabic letters', () => {
    expect(normalizeForSearch('کتاب')).toBe(normalizeForSearch('كتاب'));
    expect(normalizeForSearch('فارسی')).toBe(normalizeForSearch('فارسي'));
  });
  it('ignores case and Latin diacritics, so "ijma" finds "ijmāʿ"', () => {
    expect(normalizeForSearch('Ijmāʿ')).toContain('ijma');
  });
  it('reports matches as positions in the original, vowelled text', () => {
    const text = 'فإنَّ العِلْمَ أفضلُ';
    const [[start, end]] = findAll(text, normalizeForSearch('العلم'));
    expect(stripTashkil(text.slice(start, end))).toBe('العلم');
  });
});

describe('tashkīl', () => {
  it('maps stripped text back to the original', () => {
    const text = 'العِلْمُ نور';
    const { text: bare, map } = stripTashkilWithMap(text);
    expect(bare).toBe('العلم نور');
    const i = bare.indexOf('نور');
    expect(text.slice(map[i], map[i + 3])).toBe('نور');
  });
});

describe('language detection', () => {
  it('tells Arabic, Urdu, Persian and English apart', () => {
    expect(detectLang('الحمد لله رب العالمين والصلاة والسلام على رسول الله')).toBe('ar');
    expect(detectLang('یہ کتاب اصولِ فقہ کے بنیادی مسائل پر مشتمل ہے، ٹھیک اسی طرح ڈاکٹر صاحب نے')).toBe('ur');
    expect(detectLang('این کتاب درباره اصول فقه است و چند پرسش را پاسخ می‌گوید، چنانکه گفته‌اند')).toBe('fa');
    expect(detectLang('Consensus is the agreement of the jurists.')).toBe('en');
  });
});

describe('volume detection', () => {
  it('reads volume numbers in English, Arabic and Urdu styles', () => {
    expect(parseVolume('Introduction to Usul - Vol 2')).toEqual({ series: 'Introduction to Usul', volume: 2 });
    expect(parseVolume('تاريخ الطبري ج ٣')).toEqual({ series: 'تاريخ الطبري', volume: 3 });
    expect(parseVolume('فتح الباري المجلد الثالث')).toEqual({ series: 'فتح الباري', volume: 3 });
    expect(parseVolume('بہارِ شریعت جلد ۲')).toEqual({ series: 'بہارِ شریعت', volume: 2 });
  });
  it('leaves ordinary titles alone', () => {
    expect(parseVolume('الرسالة')).toBeNull();
    expect(parseVolume('Kitab al-Umm')).toBeNull();
  });
});

describe('searching Urdu and Persian', () => {
  const finds = (text: string, q: string) => findAll(text, normalizeForSearch(q)).length > 0;
  it('matches Urdu written with Arabic letters, and the reverse', () => {
    expect(finds('امام شافعی رحمہ اللہ نے کہا', 'الشافعي')).toBe(false); // the article is part of the word
    expect(finds('امام شافعی رحمہ اللہ نے کہا', 'شافعي')).toBe(true);
    expect(finds('رحمه الله', 'رحمہ اللہ')).toBe(true);
    expect(finds('کتاب الصلوٰۃ', 'كتاب الصلوه')).toBe(true);
  });
  it('ignores nūn ghunna, aspirate hāʾ and yāʾ spellings', () => {
    expect(finds('میں نے یہ کتاب پڑھی', 'مين')).toBe(true);
    expect(finds('انہوں نے فرمایا', 'انهون')).toBe(true);
    expect(finds('بڑے', 'بڑي')).toBe(true);
  });
  it('ignores the invisible joiner inside Persian and Urdu words', () => {
    expect(finds('می‌روم به مدرسه', 'میروم')).toBe(true);
    expect(finds('میروم', 'می‌روم')).toBe(true);
    expect(finds('خانهٔ ما', 'خانه ما')).toBe(true);
  });
  it('reads Urdu and Persian digits', () => {
    expect(finds('صفحہ ۱۲۳', '123')).toBe(true);
  });
});

describe('Pashto and Malay', () => {
  it('tells Pashto from Urdu and Persian by its own letters', () => {
    expect(detectLang('د اسلام په دين کې لمونځ ډېر مهم دی او ښځې او سړي دواړه يې کوي')).toBe('ps');
    expect(detectLang('نماز دین کا ستون ہے اور ہر مسلمان پر فرض ہے')).toBe('ur');
  });
  it('recognises Malay in Jawi and in Latin letters', () => {
    expect(detectLang('ڤرکارا اين اداله ڤنتيڠ دالم اوݢام اسلام دان ڽاتا')).toBe('ms');
    expect(detectLang('Hukum solat lima waktu adalah wajib bagi setiap orang Islam yang telah baligh dan berakal.')).toBe('ms');
    expect(detectLang('The prayer is obligatory on every Muslim who has reached puberty.')).toBe('en');
  });
  it('finds Pashto and Jawi spellings with plain Arabic letters', () => {
    expect(normalizeForSearch('ګناه')).toBe(normalizeForSearch('گناه'));
    expect(normalizeForSearch('ڤرکارا').startsWith(normalizeForSearch('ف'))).toBe(true);
  });
});
