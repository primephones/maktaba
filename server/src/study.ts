/**
 * Study tasks over the reader's own books: finding search words for a question, answering
 * only from given passages, explaining a passage, and iʿrāb. Every answer is JSON, checked
 * before it is accepted, and the passages are the only source the model may use.
 */
import type { Feature } from './providers';

export interface Passage {
  id: string;
  text: string;
  /** The English of the passage, when it has been translated. */
  en?: string;
  /** Where it comes from, e.g. "al-Risāla, p. 21". */
  cite: string;
}

export type StudyTask =
  | { task: 'keywords'; question: string }
  | { task: 'ask'; question: string; passages: Passage[] }
  | { task: 'explain'; passage: string; en?: string; cite?: string }
  | { task: 'summarise'; passages: Passage[] }
  | { task: 'irab'; sentence: string };

export const featureOf = (t: StudyTask): Feature => (t.task === 'irab' ? 'irab' : t.task === 'explain' || t.task === 'summarise' ? 'explain' : 'ask');

type Msg = { role: 'system' | 'user'; content: string };

const passagesBlock = (ps: Passage[]) =>
  ps.map((p) => `[${p.id}] (${p.cite})\n${p.text}${p.en ? `\nEnglish: ${p.en}` : ''}`).join('\n\n');

export function studyMessages(t: StudyTask): Msg[] {
  switch (t.task) {
    case 'keywords':
      return [
        { role: 'system', content: 'You help search a library of classical Arabic, Urdu and Persian Islamic texts and their English translations. Given a question, give the words most likely to appear in passages that answer it: Arabic terms (as they would be written in classical texts, without vowel marks, including the technical term and its common variants) and English words. Answer with JSON only: {"ar":["…"],"en":["…"]}, at most 8 of each.' },
        { role: 'user', content: t.question },
      ];
    case 'ask':
      return [
        {
          role: 'system',
          content: [
            'You answer questions using ONLY the numbered passages given, which come from the reader’s own books. Never use outside knowledge, never guess, and never cite anything that is not among the passages.',
            'Every sentence of your answer that states something from the passages ends with the id of its passage in square brackets, e.g. [p3]. When you quote, copy the words exactly as they appear in the passage.',
            'If the passages do not answer the question, say so plainly and set "found" to false. If they answer it partly, say what they do and do not cover.',
            'Answer in English. Keep Arabic technical terms in transliteration with their meaning, e.g. ijmāʿ (consensus).',
            'Answer with JSON only: {"found":true,"answer":"…","quotes":[{"id":"p3","text":"exact words from the passage"}]}',
          ].join('\n'),
        },
        { role: 'user', content: `Question: ${t.question}\n\nPassages:\n\n${passagesBlock(t.passages)}` },
      ];
    case 'explain':
      return [
        {
          role: 'system',
          content: 'You explain a passage of classical Islamic scholarship to a serious student: what it says, its technical terms (transliterated, with meaning), the reasoning, and anything the student needs to follow it. Stay with what the passage says; when you add background that is not in the passage, say clearly that it is background. Answer with JSON only: {"explanation":"…","terms":[{"term":"…","meaning":"…"}]}',
        },
        { role: 'user', content: `${t.cite ? `Source: ${t.cite}\n` : ''}Passage:\n${t.passage}${t.en ? `\n\nEnglish:\n${t.en}` : ''}` },
      ];
    case 'summarise':
      return [
        { role: 'system', content: 'Summarise the chapter given in numbered passages, faithfully and only from them, for a serious student. Each point ends with the id of the passage it comes from in square brackets. Answer with JSON only: {"summary":"…"}' },
        { role: 'user', content: passagesBlock(t.passages) },
      ];
    case 'irab':
      return [
        {
          role: 'system',
          content: 'You give the iʿrāb (grammatical analysis) of an Arabic sentence, word by word, in the terms of classical Arabic grammar, written in Arabic as a grammar teacher would (e.g. "مبتدأ مرفوع وعلامة رفعه الضمة الظاهرة"), with a short English gloss for each. Analyse every word in order, including particles. If a reading is uncertain or more than one analysis is possible, say so. Answer with JSON only: {"words":[{"word":"…","irab":"…","en":"…"}],"note":"…"}',
        },
        { role: 'user', content: t.sentence },
      ];
  }
}

const fold = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Parses and checks a study answer. Throws (so the next service is tried) when it fails. */
export function acceptStudy(t: StudyTask, raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>;
  switch (t.task) {
    case 'keywords': {
      const ar = Array.isArray(data.ar) ? data.ar.map(String).filter(Boolean).slice(0, 8) : [];
      const en = Array.isArray(data.en) ? data.en.map(String).filter(Boolean).slice(0, 8) : [];
      if (!ar.length && !en.length) throw new Error('no search words');
      return { ar, en };
    }
    case 'ask': {
      const answer = String(data.answer ?? '').trim();
      if (!answer) throw new Error('empty answer');
      const ids = new Set(t.passages.map((p) => p.id));
      const cited = [...answer.matchAll(/\[([^\]\s]+)\]/g)].map((m) => m[1]);
      // A citation to a passage that was not given means the answer cannot be trusted.
      const unknown = cited.filter((c) => !ids.has(c));
      if (unknown.length) throw new Error(`cites passages that were not given: ${unknown.join(', ')}`);
      const found = data.found !== false && cited.length > 0;
      // Quotes are checked word for word against the passage they claim to come from.
      const quotes = (Array.isArray(data.quotes) ? data.quotes : []).map((q) => q as { id?: string; text?: string }).map((q) => {
        const p = t.passages.find((x) => x.id === q.id);
        const ok = !!p && !!q.text && (fold(p.text).includes(fold(q.text)) || (!!p.en && fold(p.en).includes(fold(q.text))));
        return { id: String(q.id ?? ''), text: String(q.text ?? ''), verified: ok };
      });
      return { found, answer, quotes, cited: [...new Set(cited)] };
    }
    case 'explain': {
      const explanation = String(data.explanation ?? '').trim();
      if (!explanation) throw new Error('empty explanation');
      return { explanation, terms: Array.isArray(data.terms) ? data.terms : [] };
    }
    case 'summarise': {
      const summary = String(data.summary ?? '').trim();
      if (!summary) throw new Error('empty summary');
      return { summary };
    }
    case 'irab': {
      const words = Array.isArray(data.words) ? (data.words as Array<Record<string, unknown>>).map((w) => ({ word: String(w.word ?? ''), irab: String(w.irab ?? ''), en: String(w.en ?? '') })).filter((w) => w.word) : [];
      if (!words.length) throw new Error('no analysis');
      return { words, note: String(data.note ?? '') };
    }
  }
}
