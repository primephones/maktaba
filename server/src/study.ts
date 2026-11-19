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
  | { task: 'debate'; question: string; passages: Passage[] }
  | { task: 'explain'; passage: string; en?: string; cite?: string }
  | { task: 'summarise'; passages: Passage[] }
  | { task: 'quiz'; passages: Passage[] }
  | { task: 'irab'; sentence: string }
  | { task: 'define'; word: string; context: string };

export const featureOf = (t: StudyTask): Feature => (t.task === 'irab' ? 'irab' : t.task === 'explain' || t.task === 'summarise' || t.task === 'quiz' || t.task === 'define' ? 'explain' : 'ask');

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
    case 'debate':
      return [
        {
          role: 'system',
          content: [
            'You set out the positions on a question of Islamic scholarship, and the arguments for and against each, using ONLY the numbered passages given, which come from the reader’s own books. Never use outside knowledge and never cite anything that is not among the passages.',
            'For each position the passages give: state it in one sentence; say who holds it if the passages name them (a scholar, a school such as the Ḥanafīs, "the majority"); list its arguments (a verse, a ḥadīth, an analogy, a principle…); and list the objections or replies the passages make to it.',
            'Every argument and objection cites the ids of the passages it comes from, e.g. ["p3","p7"]. Keep Arabic technical terms in transliteration with their meaning, e.g. qiyās (analogy).',
            'If the passages give only one side, give it, and say in "note" that the other side is not in these books. If they do not address the question, set "found" to false.',
            'Answer in English, with JSON only: {"found":true,"positions":[{"position":"…","held_by":"…","arguments":[{"point":"…","ids":["p3"]}],"objections":[{"point":"…","ids":["p5"]}]}],"note":"…"}',
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
    case 'define':
      return [
        {
          role: 'system',
          content: [
            'You are a dictionary of classical Arabic, Urdu and Persian for an English-speaking student of the Islamic sciences, in the manner of Lane and Hans Wehr.',
            'Define the word given, as it is used in the sentence given. Give:',
            '- "translit": the word in transliteration (e.g. "ijmāʿ");',
            '- "lemma": its dictionary form in its own script (the singular, the masdar or the past verb);',
            '- "root": for an Arabic word or one taken from Arabic, its root letters separated by spaces (e.g. "ج م ع"); otherwise "";',
            '- "pos": its part of speech and form in English (e.g. "verbal noun, form IV");',
            '- "meanings": its main meanings in English, most common first, at most five;',
            '- "here": what it means in this sentence, in one English sentence;',
            '- "technical": if it is a technical term (iṣṭilāḥ) in a science (fiqh, uṣūl, ḥadīth, grammar, theology…), its technical meaning and the science; otherwise "".',
            'Do not invent meanings; if the word is unclear or a misprint, say so in "here".',
            'Answer with JSON only: {"translit":"…","lemma":"…","root":"…","pos":"…","meanings":["…"],"here":"…","technical":"…"}',
          ].join('\n'),
        },
        { role: 'user', content: `Word: ${t.word}\nSentence: ${t.context}` },
      ];
    case 'quiz':
      return [
        {
          role: 'system',
          content: [
            'Write a short quiz to help a serious student check they have understood a chapter of Islamic scholarship, using ONLY the numbered passages given (from the chapter itself).',
            'Write 5 questions in English about what matters in the chapter: its rulings, definitions, the evidence given, the positions and who holds them. Not trivia.',
            'Each question has 4 options, one of them right; the wrong ones must be plausible to someone who did not read carefully. Give the index (0–3) of the right one, a one-sentence "why" from the passage, and the ids of the passages it rests on.',
            'Keep Arabic technical terms in transliteration with their meaning.',
            'Answer with JSON only: {"questions":[{"q":"…","options":["…","…","…","…"],"answer":0,"why":"…","ids":["p2"]}]}',
          ].join('\n'),
        },
        { role: 'user', content: passagesBlock(t.passages) },
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
          content: [
            'You teach iʿrāb (the grammatical analysis of Arabic) to an English-speaking student of the Islamic sciences, who wants to learn why each word takes the case it does.',
            'Analyse every word of the sentence in order, including particles and attached pronouns that matter, in the terms of classical Arabic grammar (Baṣran usage, as in al-Ājurrūmiyya and Qaṭr al-Nadā).',
            'For each word give:',
            '- "word": the word as written;',
            '- "irab": its iʿrāb in Arabic, as a grammar teacher would write it (e.g. "فاعل مرفوع وعلامة رفعه الضمة الظاهرة على آخره");',
            '- "case": one of "marfu", "mansub", "majrur", "majzum" (for these, the word is muʿrab) or "mabni" (indeclinable: particles, most pronouns, past verbs…);',
            '- "role": its role in a few English words (e.g. "subject of the verb", "object", "governed by the preposition fī");',
            '- "why": one or two plain English sentences giving the rule: what makes it take this case, naming the governing word (ʿāmil) where there is one, and the sign of the case (ḍamma, fatḥa, kasra, sukūn, or a letter);',
            '- "en": a short English gloss of the word.',
            'If a reading is uncertain or more than one analysis is possible, say which in "note". Do not invent vowels that change the meaning.',
            'Answer with JSON only: {"words":[{"word":"…","irab":"…","case":"…","role":"…","why":"…","en":"…"}],"note":"…"}',
          ].join('\n'),
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
    case 'debate': {
      const ids = new Set(t.passages.map((p) => p.id));
      const points = (v: unknown) =>
        (Array.isArray(v) ? v : [])
          .map((x) => x as { point?: unknown; ids?: unknown })
          .map((x) => ({ point: String(x.point ?? '').trim(), ids: (Array.isArray(x.ids) ? x.ids : []).map(String) }))
          .filter((x) => x.point);
      const positions = (Array.isArray(data.positions) ? data.positions : [])
        .map((p) => p as Record<string, unknown>)
        .map((p) => ({ position: String(p.position ?? '').trim(), held_by: p.held_by ? String(p.held_by) : '', arguments: points(p.arguments), objections: points(p.objections) }))
        .filter((p) => p.position);
      // Every point must rest on a passage that was given; a citation to anything else means the answer cannot be trusted.
      const all = positions.flatMap((p) => [...p.arguments, ...p.objections]);
      const unknown = all.flatMap((x) => x.ids).filter((id) => !ids.has(id));
      if (unknown.length) throw new Error(`cites passages that were not given: ${[...new Set(unknown)].join(', ')}`);
      if (all.some((x) => !x.ids.length)) throw new Error('a point without its source');
      const found = data.found !== false && positions.length > 0;
      return { found, positions: found ? positions : [], note: String(data.note ?? '') };
    }
    case 'define': {
      const meanings = (Array.isArray(data.meanings) ? data.meanings : []).map((m) => String(m).trim()).filter(Boolean).slice(0, 6);
      const here = String(data.here ?? '').trim();
      if (!meanings.length && !here) throw new Error('no definition');
      return {
        translit: String(data.translit ?? '').trim(),
        lemma: String(data.lemma ?? '').trim(),
        root: String(data.root ?? '').trim(),
        pos: String(data.pos ?? '').trim(),
        meanings,
        here,
        technical: String(data.technical ?? '').trim(),
      };
    }
    case 'quiz': {
      const ids = new Set(t.passages.map((p) => p.id));
      const questions = (Array.isArray(data.questions) ? data.questions : [])
        .map((x) => x as Record<string, unknown>)
        .map((x) => ({ q: String(x.q ?? '').trim(), options: (Array.isArray(x.options) ? x.options : []).map(String), answer: Number(x.answer), why: String(x.why ?? ''), ids: (Array.isArray(x.ids) ? x.ids : []).map(String).filter((i) => ids.has(i)) }))
        .filter((x) => x.q && x.options.length >= 2 && x.options.length <= 5 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.options.length);
      if (questions.length < 3) throw new Error('too few usable questions');
      return { questions };
    }
    case 'summarise': {
      const summary = String(data.summary ?? '').trim();
      if (!summary) throw new Error('empty summary');
      return { summary };
    }
    case 'irab': {
      const CASES = ['marfu', 'mansub', 'majrur', 'majzum', 'mabni'];
      const caseOf = (v: unknown) => {
        const c = String(v ?? '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
        return CASES.find((k) => c.startsWith(k.slice(0, 5))) ?? (/raf/.test(c) ? 'marfu' : /nasb|nas/.test(c) ? 'mansub' : /jarr|jar/.test(c) ? 'majrur' : /jazm/.test(c) ? 'majzum' : /mabn|indecl/.test(c) ? 'mabni' : undefined);
      };
      const words = Array.isArray(data.words)
        ? (data.words as Array<Record<string, unknown>>)
            .map((w) => ({ word: String(w.word ?? ''), irab: String(w.irab ?? ''), en: String(w.en ?? ''), case: caseOf(w.case), role: w.role ? String(w.role) : undefined, why: w.why ? String(w.why) : undefined }))
            .filter((w) => w.word)
        : [];
      if (!words.length) throw new Error('no analysis');
      return { words, note: String(data.note ?? '') };
    }
  }
}
