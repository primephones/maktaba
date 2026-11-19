import { describe, expect, it } from 'vitest';
import { acceptStudy, studyMessages } from '../src/study';

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

describe('for and against', () => {
  const passages = [
    { id: 'p1', text: 'الإجماع حجة قاطعة عند الجمهور', cite: 'Mukhtaṣar, p. 2' },
    { id: 'p2', text: 'وقال بعضهم لا يعلم الإجماع بعد الصحابة', cite: 'Mukhtaṣar, p. 3' },
  ];
  const t = { task: 'debate' as const, question: 'Is consensus a proof?', passages };
  it('keeps each position with its arguments and objections, every point citing a given passage', () => {
    const r = acceptStudy(t, JSON.stringify({ found: true, positions: [{ position: 'It is a proof', held_by: 'the majority', arguments: [{ point: 'The community does not agree on error', ids: ['p1'] }], objections: [{ point: 'It cannot be known after the Companions', ids: ['p2'] }] }], note: '' })) as { found: boolean; positions: Array<{ objections: unknown[] }> };
    expect(r.found).toBe(true);
    expect(r.positions[0].objections).toHaveLength(1);
  });
  it('refuses an answer that cites a passage it was not given, or a point with no source', () => {
    expect(() => acceptStudy(t, JSON.stringify({ found: true, positions: [{ position: 'x', arguments: [{ point: 'y', ids: ['p9'] }], objections: [] }] }))).toThrow(/not given/);
    expect(() => acceptStudy(t, JSON.stringify({ found: true, positions: [{ position: 'x', arguments: [{ point: 'y', ids: [] }], objections: [] }] }))).toThrow(/without its source/);
  });
  it('is put to the AI with the passages and the instruction to use nothing else', () => {
    const [sys, user] = studyMessages(t);
    expect(sys.content).toMatch(/ONLY the numbered passages/);
    expect(user.content).toMatch(/\[p2\] \(Mukhtaṣar, p\. 3\)/);
  });
});

describe('iʿrāb, to learn from', () => {
  it('asks for the case and the reason, and reads the case in any spelling', () => {
    const t = { task: 'irab' as const, sentence: 'قال الشافعي' };
    expect(studyMessages(t)[0].content).toMatch(/"why"/);
    const r = acceptStudy(t, JSON.stringify({ words: [{ word: 'قال', irab: 'فعل ماض مبني على الفتح', case: 'mabnī', role: 'verb', why: 'A past verb is mabnī.', en: 'said' }, { word: 'الشافعي', irab: 'فاعل مرفوع', case: 'Marfūʿ', role: 'subject', why: 'The subject of a verb is marfūʿ.', en: 'al-Shāfiʿī' }] })) as { words: Array<{ case?: string }> };
    expect(r.words.map((w) => w.case)).toEqual(['mabni', 'marfu']);
  });
});

describe('quiz on a chapter', () => {
  const passages = [{ id: 'p1', text: 'والقياس إلحاق فرع بأصل', cite: 'x' }];
  it('keeps well-formed questions and refuses a quiz with too few', () => {
    const q = (n: number) => ({ q: `Q${n}`, options: ['a', 'b', 'c', 'd'], answer: 1, why: 'because', ids: ['p1', 'p9'] });
    const r = acceptStudy({ task: 'quiz', passages }, JSON.stringify({ questions: [q(1), q(2), q(3), { q: 'bad', options: ['a'], answer: 3 }] })) as { questions: Array<{ ids: string[] }> };
    expect(r.questions).toHaveLength(3);
    expect(r.questions[0].ids).toEqual(['p1']);
    expect(() => acceptStudy({ task: 'quiz', passages }, JSON.stringify({ questions: [q(1)] }))).toThrow(/too few/);
  });
});

describe('define a word', () => {
  const t = { task: 'define' as const, word: 'الإجماع', context: 'واعلم أن الإجماع حجة قاطعة عند الجمهور' };
  it('asks for the root, the meanings and the sense in this sentence', () => {
    const m = studyMessages(t);
    expect(m[0].content).toMatch(/root/);
    expect(m[1].content).toContain('الإجماع حجة قاطعة');
  });
  it('keeps a definition, and refuses an empty one', () => {
    const d = acceptStudy(t, JSON.stringify({ translit: 'ijmāʿ', lemma: 'إجماع', root: 'ج م ع', pos: 'verbal noun', meanings: ['agreement'], here: 'consensus of the jurists', technical: 'uṣūl: a decisive proof' })) as { meanings: string[]; root: string };
    expect(d.meanings).toEqual(['agreement']);
    expect(d.root).toBe('ج م ع');
    expect(() => acceptStudy(t, '{"meanings":[],"here":""}')).toThrow();
  });
});

