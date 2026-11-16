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
