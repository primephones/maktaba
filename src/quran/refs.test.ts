import { describe, expect, it } from 'vitest';
import { findQuranRefs } from './refs';

describe('finding Qur’an references', () => {
  it('reads the usual Arabic forms', () => {
    const r = (t: string) => findQuranRefs(t).map((m) => m.ref);
    expect(r('قال تعالى ﴿الله لا إله إلا هو الحي القيوم﴾ [البقرة: ٢٥٥]')).toContainEqual({ surah: 2, from: 255, to: 255 });
    expect(r('(سورة آل عمران، الآية 7)')).toEqual([{ surah: 3, from: 7, to: 7 }]);
    expect(r('[النساء: ١١-١٢]')).toEqual([{ surah: 4, from: 11, to: 12 }]);
    expect(r('[الإسراء: 1]')).toEqual([{ surah: 17, from: 1, to: 1 }]);
  });
  it('reads English references in brackets or after Q', () => {
    const r = (t: string) => findQuranRefs(t).map((m) => m.ref);
    expect(r('as God says (2:255).')).toEqual([{ surah: 2, from: 255, to: 255 }]);
    expect(r('see Q 4:11–12 and Qur’an 17:1')).toEqual([{ surah: 4, from: 11, to: 12 }, { surah: 17, from: 1, to: 1 }]);
  });
  it('ignores what cannot be a verse', () => {
    expect(findQuranRefs('at 10:30 in the morning')).toEqual([]);
    expect(findQuranRefs('(2:300)')).toEqual([]);
    expect(findQuranRefs('[البقرة: ٣٠٠]')).toEqual([]);
  });
  it('marks quoted verses for lookup', () => {
    const m = findQuranRefs('قال الله تعالى: ﴿إنما الأعمال بالنيات﴾ وغيرها');
    expect(m[0]).toMatchObject({ kind: 'quote', quote: 'إنما الأعمال بالنيات' });
  });
});
