import { termsIn, type Term } from './glossary';
import { looksEnglish } from './english';

/**
 * How a passage is put to the AI and how its answer is checked. The rule above all others:
 * nothing is invented. Every paragraph comes back with its English, and anything the model
 * was unsure of is marked with † and a reason, never smoothed over.
 */

export type SourceLang = 'ar' | 'ur' | 'fa' | 'ps' | 'ms';

export interface Paragraph {
  id: string;
  text: string;
  /** Heading, quotation or ordinary paragraph: affects style only. */
  kind?: 'h' | 'p' | 'quote';
}

export interface Uncertain {
  /** The words in the English that are uncertain (marked with † after them). */
  span: string;
  reason: string;
}

export interface Translated {
  id: string;
  en: string;
  uncertain: Uncertain[];
}

export interface TranslateRequest {
  lang: SourceLang;
  paragraphs: Paragraph[];
  glossary: Term[];
  /** Title of the book and of the chapter, for context only. */
  bookTitle?: string;
  chapter?: string;
  /** The English of the paragraph just before this batch, so the voice stays continuous. */
  previous?: string;
}

const LANG_NAME: Record<SourceLang, string> = { ar: 'classical Arabic', ur: 'Urdu', fa: 'Persian (Fārsī)', ps: 'Pashto', ms: 'Malay (in Latin script or Jawi)' };

const SHORT_NAME: Record<SourceLang, string> = { ar: 'Arabic', ur: 'Urdu', fa: 'Persian', ps: 'Pashto', ms: 'Malay' };

/** The rules every translation follows (also used when a scanned page is read and translated in one go). */
export function translationRules(lang: SourceLang): string {
  return [
    `You translate ${LANG_NAME[lang]} works of Islamic scholarship (fiqh, uṣūl, ḥadīth, tafsīr, ʿaqīda, history) into English for a serious student.`,
    '',
    'Rules, in order of importance:',
    '1. Be faithful. Translate what the text says and nothing more. Do not add explanations, do not merge or drop clauses, do not soften or modernise the meaning. If a sentence is elliptical, keep it elliptical rather than guessing.',
    '2. Mark every uncertainty. If a word or phrase is ambiguous, corrupt, or you are not sure of it, put † immediately after the English words concerned and list it under "uncertain" with a short reason (for example: "the manuscript reading is unclear", "could also mean …", "unknown place name").',
    '3. Use the glossary. Write each listed term in its transliteration followed by the English in brackets the first time it appears in a paragraph, e.g. "ijmāʿ (consensus)", and the transliteration alone after that. Keep transliteration consistent with the glossary exactly.',
    '4. Qurʾān: translate the meaning of quoted verses and keep the surah:verse reference if the text gives one. Ḥadīth: translate the chain of narrators as "So-and-so narrated to us from So-and-so…" with names transliterated.',
    '5. Names of people and places are transliterated (with ʿ, ʾ and macrons). Honorifics are kept, in every spelling and abbreviation: ﷺ, ؐ, صلى الله عليه وسلم, صلی اللہ علیہ وسلم, (ص) → "(may God bless him and grant him peace)"; ؑ, عليه السلام, علیہ السلام, (ع) → "(peace be upon him)"; ؓ, رضي الله عنه, رضی اللہ عنہ, (رض) → "(may God be pleased with him)" (or "her"/"them" as the form shows); ؒ, رحمه الله, رحمۃ اللہ علیہ, رحمہ اللہ, (ره) → "(may God have mercy on him)"; ﷻ, جل جلاله, عز وجل → "(Mighty and Majestic)"; تعالى, تعالیٰ → "the Exalted".',
    ...(lang === 'ar'
      ? []
      : [
          `5a. ${SHORT_NAME[lang]} works quote Arabic (Qurʾān, ḥadīth, juristic texts) inside the ${SHORT_NAME[lang]}. Translate the Arabic quotation too, inside quotation marks, and then the author’s own words; if the author paraphrases the quotation, translate both as written rather than merging them. Religious words the language takes from Persian (e.g. ${lang === 'ur' ? 'نماز, روزہ' : 'نماز, روزه'}) are given as the matching Arabic term from the glossary (ṣalāt, ṣawm).`,
        ]),
    '6. Write clear, natural English with the formality of the original. Keep the paragraph structure exactly: one English paragraph for each source paragraph, with the same id.',
    '7. Scanned and downloaded books often carry a watermark or stamp (a library, publisher or website name, a web address, a phone number, "for free distribution", a seal) that can slip into the text. It is not part of the book: leave it out of the English without comment. If a whole paragraph is only such a stamp, give an empty "en" for it.',
  ].join('\n');
}

export function buildMessages(req: TranslateRequest): Array<{ role: 'system' | 'user'; content: string }> {
  const all = req.paragraphs.map((p) => p.text).join('\n');
  const hits = termsIn(all, req.glossary);
  const glossaryLines = hits.map((h) => `- ${h.found} → ${h.term.tr} (${h.term.en})`).join('\n');

  const system = [
    translationRules(req.lang),
    '',
    'Answer with JSON only, in this shape:',
    '{"paragraphs":[{"id":"…","en":"…","uncertain":[{"span":"…","reason":"…"}]}]}',
  ].join('\n');

  const context = [
    req.bookTitle ? `Book: ${req.bookTitle}` : '',
    req.chapter ? `Chapter: ${req.chapter}` : '',
    req.previous ? `The English of the paragraph just before (for continuity only, do not translate it again):\n${req.previous}` : '',
    glossaryLines ? `Glossary terms in this passage:\n${glossaryLines}` : '',
  ].filter(Boolean).join('\n\n');

  const body = req.paragraphs
    .map((p) => `[${p.id}]${p.kind === 'h' ? ' (heading)' : p.kind === 'quote' ? ' (quotation)' : ''}\n${p.text}`)
    .join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: `${context ? `${context}\n\n` : ''}Translate these paragraphs:\n\n${body}` },
  ];
}

/** Pulls the JSON out of a model's answer, tolerating code fences and stray prose. */
export function parseAnswer(raw: string): Translated[] {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in the answer');
  text = text.slice(start, end + 1);
  const data = JSON.parse(text) as { paragraphs?: Array<{ id?: unknown; en?: unknown; uncertain?: unknown }> };
  if (!Array.isArray(data.paragraphs)) throw new Error('The answer has no paragraphs');
  return data.paragraphs.map((p) => ({
    id: String(p.id ?? ''),
    en: typeof p.en === 'string' ? p.en.trim() : '',
    uncertain: Array.isArray(p.uncertain)
      ? p.uncertain
          .map((u) => u as { span?: unknown; reason?: unknown })
          .filter((u) => typeof u.span === 'string' && typeof u.reason === 'string')
          .map((u) => ({ span: String(u.span), reason: String(u.reason) }))
      : [],
  }));
}

const DIGITS = /[0-9٠-٩۰-۹]+/g;
const toAscii = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

export interface Problem {
  id: string;
  problem: string;
  /** A doubt worth flagging to the reader, not a reason to throw the translation away. */
  soft?: boolean;
}

/**
 * Checks an answer before it is accepted. A batch with any problem is sent again (to
 * another model if need be); it is never saved half-right.
 */
export function checkAnswer(source: Paragraph[], answer: Translated[]): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map(answer.map((a) => [a.id, a]));
  for (const p of source) {
    const a = byId.get(p.id);
    if (!a) {
      problems.push({ id: p.id, problem: 'missing' });
      continue;
    }
    if (!a.en) {
      // Left empty on purpose only for a stamp or watermark, which is short.
      if (p.text.replace(/\s/g, '').length > 60) problems.push({ id: p.id, problem: 'missing' });
      continue;
    }
    // Every number in the source (dates, verse numbers, counts) should survive; a number
    // written out in words, or a stamp's phone number left out, is not worth losing the
    // translation over, so it is flagged for the reader instead.
    const nums = (toAscii(p.text).match(DIGITS) ?? []).filter((n) => n.length <= 4);
    const enNums = new Set(a.en.match(/[0-9]+/g) ?? []);
    const lost = nums.filter((n) => !enNums.has(String(Number(n))));
    if (lost.length) problems.push({ id: p.id, problem: `numbers missing: ${lost.join(', ')}`, soft: true });
    // English should be neither a fragment nor padded with commentary.
    const ratio = a.en.length / Math.max(1, p.text.length);
    if (p.text.length > 40 && ratio < 0.3) problems.push({ id: p.id, problem: 'too short: parts may be missing' });
    else if (p.text.length > 40 && ratio < 0.45) problems.push({ id: p.id, problem: 'shorter than expected: check nothing is missing', soft: true });
    if (p.text.length > 40 && ratio > 5) problems.push({ id: p.id, problem: 'too long: may contain added explanation' });
    else if (p.text.length > 40 && ratio > 4) problems.push({ id: p.id, problem: 'longer than expected: check nothing was added', soft: true });
    if (/^(here is|translation:|sure[,!])/i.test(a.en) || /as an ai|i cannot/i.test(a.en)) problems.push({ id: p.id, problem: 'chatter instead of translation' });
    // A transliteration in Latin letters is not a translation.
    if (/[؀-ۿ]/.test(p.text) && a.en.length > 40 && !looksEnglish(a.en.replace(/†/g, ''))) problems.push({ id: p.id, problem: 'not English: a transliteration, not a translation' });
    // Untranslated Arabic left in the English (beyond a short quoted term).
    const arabicLeft = (a.en.match(/[؀-ۿ]/g) ?? []).length;
    if (arabicLeft > 12) problems.push({ id: p.id, problem: 'untranslated text left in' });
  }
  for (const a of answer) if (!source.some((p) => p.id === a.id)) problems.push({ id: a.id, problem: 'unknown paragraph id', soft: true });
  return problems;
}

/**
 * Accepts an answer: throws if anything is really wrong (the batch is then sent again, to
 * another model if need be, and never saved half-right); doubts are kept with the
 * paragraph, marked for the reader to check. Paragraphs the model invented are dropped.
 */
export function acceptAnswer(source: Paragraph[], answer: Translated[]): Translated[] {
  const problems = checkAnswer(source, answer);
  const hard = problems.filter((p) => !p.soft);
  if (hard.length) throw new Error(hard.map((p) => `${p.id}: ${p.problem}`).join('; '));
  const ids = new Set(source.map((p) => p.id));
  return answer
    .filter((a) => ids.has(a.id))
    .map((a) => {
      const doubts = problems.filter((p) => p.id === a.id).map((p) => ({ span: '', reason: p.problem }));
      // A † at the end lets the reader tap to see the doubt.
      return doubts.length ? { ...a, en: /†\s*$/.test(a.en) ? a.en : `${a.en} †`, uncertain: [...a.uncertain, ...doubts] } : a;
    });
}

/** Splits a long run of paragraphs into batches small enough for one request. */
export function batches(paragraphs: Paragraph[], maxChars = 3500, maxItems = 12): Paragraph[][] {
  const out: Paragraph[][] = [];
  let cur: Paragraph[] = [];
  let size = 0;
  for (const p of paragraphs) {
    if (cur.length && (size + p.text.length > maxChars || cur.length >= maxItems)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ------------------------------------------------------------------------------- second check

export interface ReviewItem {
  id: string;
  text: string;
  en: string;
}
export interface Reviewed {
  id: string;
  /** The draft was faithful as it stood. */
  ok: boolean;
  en: string;
  changes: Array<{ was: string; now: string; why: string }>;
}

/**
 * A second translator checks a draft against the original: faithful drafts are confirmed
 * as they are; anything mistranslated, left out or added is corrected, and each change is
 * given with its reason, so the reader can see what was changed and why.
 */
export function buildReviewMessages(lang: SourceLang, items: ReviewItem[], glossary: Term[]): Array<{ role: 'system' | 'user'; content: string }> {
  const all = items.map((p) => p.text).join('\n');
  const hits = termsIn(all, glossary);
  const system = [
    `You are the second translator, checking an English draft of a ${LANG_NAME[lang]} work of Islamic scholarship against the original, for a serious student. Uṣūl al-fiqh, fiqh and ḥadīth terms must be exact.`,
    'For each paragraph: if the English is faithful and complete, return it exactly as it is, with "ok": true and no changes. Do not polish style.',
    'If it mistranslates, leaves something out, adds something not in the original, reverses a negation, confuses who is speaking (the author, an objector "fa-in qīla", the reply "qulnā"), or renders a technical term wrongly, correct it: return the corrected English with "ok": false, and list each change as {"was": "draft words", "now": "corrected words", "why": "a short reason"}.',
    'Keep the draft’s transliteration and its † marks where they still apply, and the same paragraph ids.',
    hits.length ? `Glossary (use these renderings): ${hits.map((h) => `${h.found} → ${h.term.tr} (${h.term.en})`).join('; ')}` : '',
    'Answer with JSON only: {"paragraphs":[{"id":"…","ok":true,"en":"…","changes":[]}]}',
  ].filter(Boolean).join('\n');
  const body = items.map((p) => `[${p.id}]\nOriginal: ${p.text}\nDraft: ${p.en}`).join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Check these paragraphs:\n\n${body}` },
  ];
}

/** Reads and checks a second translator's answer: every paragraph must come back, with English. */
export function acceptReview(items: ReviewItem[], raw: string): Reviewed[] {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  text = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const data = JSON.parse(text) as { paragraphs?: Array<Record<string, unknown>> };
  const got = new Map((data.paragraphs ?? []).map((p) => [String(p.id ?? ''), p] as const));
  return items.map((it) => {
    const p = got.get(it.id);
    if (!p) throw new Error(`${it.id}: missing`);
    const en = typeof p.en === 'string' && p.en.trim() ? p.en.trim() : it.en;
    const changes = (Array.isArray(p.changes) ? p.changes : [])
      .map((c) => c as Record<string, unknown>)
      .filter((c) => typeof c.now === 'string')
      .map((c) => ({ was: String(c.was ?? ''), now: String(c.now), why: String(c.why ?? '') }));
    const ok = p.ok === true || en === it.en;
    if (!ok && en.length < it.en.length * 0.4) throw new Error(`${it.id}: the correction is much shorter than the draft`);
    return { id: it.id, ok, en: ok ? it.en : en, changes: ok ? [] : changes };
  });
}
