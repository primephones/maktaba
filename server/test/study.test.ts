import { describe, expect, it } from 'vitest';
import { acceptStudy } from '../src/study';

const passages = [
  { id: 'p1', text: 'واعلم أن الإجماع حجة قاطعة عند جمهور الأصوليين', cite: 'Mukhtaṣar, p. 4' },
  { id: 'p2', text: 'والقياس هو إلحاق فرع بأصل في الحكم لعلة جامعة', cite: 'Mukhtaṣar, p. 9' },
];

describe('answers from the reader’s books', () => {
  it('accepts an answer whose citations and quotes are real', () => {
    const r = acceptStudy({ task: 'ask', question: 'Is ijmāʿ a proof?', passages }, JSON.stringify({
      found: true,
      answer: 'Ijmāʿ (consensus) is a decisive proof according to most legal theorists [p1].',
      quotes: [{ id: 'p1', text: 'الإجماع حجة قاطعة' }],
    })) as { found: boolean; quotes: Array<{ verified: boolean }> };
    expect(r.found).toBe(true);
    expect(r.quotes[0].verified).toBe(true);
  });
  it('rejects an answer citing a passage it was not given', () => {
    expect(() => acceptStudy({ task: 'ask', question: 'q', passages }, '{"found":true,"answer":"Something [p7].","quotes":[]}')).toThrow(/not given/);
  });
  it('flags a quote that is not in the passage', () => {
    const r = acceptStudy({ task: 'ask', question: 'q', passages }, '{"found":true,"answer":"Analogy … [p2].","quotes":[{"id":"p2","text":"والقياس حجة عند الجميع"}]}') as { quotes: Array<{ verified: boolean }> };
    expect(r.quotes[0].verified).toBe(false);
  });
  it('treats an answer with no citations as not found', () => {
    const r = acceptStudy({ task: 'ask', question: 'q', passages }, '{"found":true,"answer":"I think it is allowed.","quotes":[]}') as { found: boolean };
    expect(r.found).toBe(false);
  });
});
