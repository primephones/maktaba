import { describe, expect, it } from 'vitest';
import { subjectOf } from './shelving';

const sub = (title: string, author = '') => subjectOf({ title, author })?.id;

describe('the subject of a book, from its title', () => {
  it('knows the ḥadīth collections and their commentaries apart', () => {
    expect(sub('صحيح البخاري')).toBe('hadith');
    expect(sub('سنن أبي داود')).toBe('hadith');
    expect(sub('فتح الباري شرح صحيح البخاري')).toBe('hadith-sharh');
    expect(sub('بذل المجهود في حل سنن أبي داود')).toBe('hadith-sharh');
    expect(sub('الكوكب الدري على جامع الترمذي')).toBe('hadith-sharh');
  });
  it('knows fiqh from uṣūl al-fiqh', () => {
    expect(sub('الهداية شرح بداية المبتدي')).toBe('fiqh');
    expect(sub('رد المحتار على الدر المختار')).toBe('fiqh');
    expect(sub('مختصر في أصول الفقه')).toBe('usul');
    expect(sub('Introduction to Usul - Vol 1')).toBe('usul');
  });
  it('reads Urdu, Persian, Malay and English titles', () => {
    expect(sub('نماز کے احکام')).toBe('fiqh');
    expect(sub('رساله در فقه')).toBe('fiqh');
    expect(sub('Perlembagaan Persekutuan Malaysia')).toBe('law');
    expect(sub('The Constitution of Pakistan')).toBe('law');
    expect(sub('دستور جمهورية مصر العربية')).toBe('law');
  });
  it('says nothing when it cannot tell', () => {
    expect(sub('urdu-risala')).toBeUndefined();
  });
});
