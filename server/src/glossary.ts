/**
 * The starting glossary: the technical terms of fiqh, uṣūl, ḥadīth and ʿaqīda, each with
 * its transliteration and a short English meaning. Translations write a term as
 * "ijmāʿ (consensus)" the first time it appears in a passage, then "ijmāʿ" after that.
 * A book's own glossary entries override these.
 */
export interface Term {
  /** The Arabic word as it usually appears, without vowel marks. */
  ar: string;
  /** Other spellings or forms that should be treated as the same term. */
  forms?: string[];
  tr: string;
  en: string;
  /**
   * What the same letters mean as an ordinary word (in Arabic, or in Urdu and Persian), when
   * that is common: the AI is told to use the term only in its technical sense. Without this,
   * Urdu صحیح "correct", عام "common" or موضوع "topic", or Arabic سنة "year", were pushed
   * towards ṣaḥīḥ, ʿāmm, mawḍūʿ and sunna.
   */
  plain?: string;
}

export const SEED_GLOSSARY: Term[] = [
  // Sources and methods of law
  { ar: 'الإجماع', forms: ['إجماع', 'الاجماع', 'اجماع'], tr: 'ijmāʿ', en: 'consensus' },
  { ar: 'القياس', forms: ['قياس'], tr: 'qiyās', en: 'analogical reasoning', plain: "Urdu قیاس also 'conjecture, guess'" },
  { ar: 'الاجتهاد', forms: ['اجتهاد'], tr: 'ijtihād', en: 'independent legal reasoning' },
  { ar: 'المجتهد', forms: ['مجتهد', 'المجتهدون', 'مجتهدي'], tr: 'mujtahid', en: 'jurist qualified for ijtihād' },
  { ar: 'التقليد', forms: ['تقليد'], tr: 'taqlīd', en: 'following a school or authority', plain: "also 'imitation' in general" },
  { ar: 'الاستحسان', forms: ['استحسان'], tr: 'istiḥsān', en: 'juristic preference' },
  { ar: 'المصلحة المرسلة', forms: ['المصالح المرسلة'], tr: 'al-maṣlaḥa al-mursala', en: 'unrestricted public interest' },
  { ar: 'الاستصحاب', forms: ['استصحاب'], tr: 'istiṣḥāb', en: 'presumption of continuity' },
  { ar: 'سد الذرائع', tr: 'sadd al-dharāʾiʿ', en: 'blocking the means to harm' },
  { ar: 'العرف', forms: ['عرف'], tr: 'ʿurf', en: 'custom', plain: "Urdu عرف also 'alias, also known as'" },
  { ar: 'العلة', forms: ['علة', 'العلّة'], tr: 'ʿilla', en: 'effective cause (ratio legis)', plain: "also 'illness' (and in Urdu 'a vice, bad habit')" },
  { ar: 'الحكم الشرعي', tr: 'al-ḥukm al-sharʿī', en: 'legal ruling' },
  { ar: 'الدليل', forms: ['دليل', 'الأدلة', 'أدلة'], tr: 'dalīl', en: 'proof, evidence' },
  { ar: 'أصول الفقه', tr: 'uṣūl al-fiqh', en: 'legal theory' },
  { ar: 'الفروع', forms: ['فروع'], tr: 'furūʿ', en: 'derived rulings' },
  { ar: 'الفقه', forms: ['فقه'], tr: 'fiqh', en: 'jurisprudence', plain: "also 'understanding' in general" },
  { ar: 'المذهب', forms: ['مذهب', 'المذاهب'], tr: 'madhhab', en: 'school of law', plain: "in Urdu مذہب usually means 'religion'; also 'view, doctrine' in general" },
  { ar: 'الفتوى', forms: ['فتوى', 'الفتيا'], tr: 'fatwā', en: 'legal opinion' },
  // Rulings
  { ar: 'الفرض', forms: ['فرض'], tr: 'farḍ', en: 'obligatory', plain: "Urdu فرض کریں / فرض کیجئے means 'suppose'; also 'duty' in general" },
  { ar: 'الواجب', forms: ['واجب'], tr: 'wājib', en: 'obligatory' },
  { ar: 'المندوب', forms: ['مندوب', 'المستحب', 'مستحب'], tr: 'mandūb', en: 'recommended' },
  { ar: 'المباح', forms: ['مباح'], tr: 'mubāḥ', en: 'permissible' },
  { ar: 'المكروه', forms: ['مكروه'], tr: 'makrūh', en: 'disliked' },
  { ar: 'الحرام', forms: ['حرام', 'المحرم'], tr: 'ḥarām', en: 'forbidden', plain: "also 'sacred, inviolable' (المسجد الحرام 'the Sacred Mosque', الشهر الحرام 'the sacred month'); المحرم is also the month Muḥarram" },
  { ar: 'السنة', forms: ['سنة'], tr: 'sunna', en: 'the Prophetic practice', plain: "the same letters are سَنَة 'year' (في سنة ... 'in the year ...')" },
  { ar: 'البدعة', forms: ['بدعة'], tr: 'bidʿa', en: 'reprehensible innovation' },
  // Language of texts
  { ar: 'النص', forms: ['نص'], tr: 'naṣṣ', en: 'explicit text', plain: "also 'the text, the wording' in general; Urdu نصف 'half' is another word" },
  { ar: 'الظاهر', forms: ['ظاهر'], tr: 'ẓāhir', en: 'apparent meaning', plain: "also 'evident, outward' (Urdu ظاہر ہے 'obviously'); al-Ẓāhir is a divine name" },
  { ar: 'المفهوم', forms: ['مفهوم'], tr: 'mafhūm', en: 'implied meaning', plain: "also 'meaning, sense, what is understood' in general (common in Urdu)" },
  { ar: 'المنطوق', forms: ['منطوق'], tr: 'manṭūq', en: 'stated meaning' },
  { ar: 'العام', forms: ['عام', 'العموم'], tr: 'ʿāmm', en: 'general (wording)', plain: "also 'general, common, public' (Urdu عام لوگ 'ordinary people'); عام is also 'year'" },
  { ar: 'الخاص', forms: ['خاص', 'الخصوص'], tr: 'khāṣṣ', en: 'specific (wording)', plain: "also 'special, particular' (Urdu خاص طور پر 'especially')" },
  { ar: 'المطلق', forms: ['مطلق'], tr: 'muṭlaq', en: 'unqualified', plain: "also 'absolute, at all' (Urdu مطلق نہیں 'not at all'); المطلقة 'a divorced woman'" },
  { ar: 'المقيد', forms: ['مقيد'], tr: 'muqayyad', en: 'qualified' },
  { ar: 'المجمل', forms: ['مجمل'], tr: 'mujmal', en: 'ambiguous (needing clarification)', plain: "also 'in brief, in sum' (مجملاً)" },
  { ar: 'المبين', forms: ['مبين'], tr: 'mubayyan', en: 'clarified', plain: "also mubīn 'clear, manifest' (كتاب مبين) and 'one who makes clear'" },
  { ar: 'الناسخ', forms: ['ناسخ'], tr: 'nāsikh', en: 'abrogating' },
  { ar: 'المنسوخ', forms: ['منسوخ'], tr: 'mansūkh', en: 'abrogated' },
  { ar: 'النسخ', forms: ['نسخ'], tr: 'naskh', en: 'abrogation', plain: "also 'copying' and the Naskh script; Urdu نسخہ 'a copy, a prescription'" },
  { ar: 'التأويل', forms: ['تأويل'], tr: 'taʾwīl', en: 'interpretation (beyond the apparent meaning)' },
  // Ḥadīth
  { ar: 'الحديث', forms: ['حديث', 'الأحاديث'], tr: 'ḥadīth', en: 'Prophetic report' },
  { ar: 'الإسناد', forms: ['إسناد', 'السند', 'سند', 'الاسناد'], tr: 'isnād', en: 'chain of narration', plain: "Urdu سند also 'a certificate, a document, an authority'" },
  { ar: 'المتن', forms: ['متن'], tr: 'matn', en: 'text of the report', plain: "also 'the main text' of a book (that a commentary explains)" },
  { ar: 'الصحيح', forms: ['صحيح'], tr: 'ṣaḥīḥ', en: 'authentic', plain: "also 'correct, right, sound' (very common in Urdu صحیح); al-Ṣaḥīḥ is also the name of al-Bukhārī's and Muslim's collections" },
  { ar: 'الحسن', forms: ['حسن'], tr: 'ḥasan', en: 'good (sound)', plain: "also the name al-Ḥasan, and 'good, beautiful' (Urdu حسن 'beauty')" },
  { ar: 'الضعيف', forms: ['ضعيف'], tr: 'ḍaʿīf', en: 'weak', plain: "also 'weak, frail, old' of a person" },
  { ar: 'الموضوع', forms: ['موضوع'], tr: 'mawḍūʿ', en: 'fabricated', plain: "also 'subject, topic' (in Urdu nearly always 'topic')" },
  { ar: 'المرسل', forms: ['مرسل'], tr: 'mursal', en: 'with a missing Companion link', plain: "also 'sent' (a messenger sent by God)" },
  { ar: 'المرفوع', forms: ['مرفوع'], tr: 'marfūʿ', en: 'attributed to the Prophet', plain: "in grammar 'nominative'; also 'raised'" },
  { ar: 'الموقوف', forms: ['موقوف'], tr: 'mawqūf', en: 'attributed to a Companion', plain: "also 'endowed (waqf)'; Urdu موقوف ہے 'depends on'" },
  { ar: 'المتواتر', forms: ['متواتر', 'التواتر'], tr: 'mutawātir', en: 'mass-transmitted' },
  { ar: 'الآحاد', forms: ['آحاد', 'خبر الواحد'], tr: 'āḥād', en: 'singly-transmitted' },
  { ar: 'الجرح والتعديل', tr: 'al-jarḥ wa-l-taʿdīl', en: 'criticism and validation of narrators' },
  { ar: 'الثقة', forms: ['ثقة'], tr: 'thiqa', en: 'trustworthy narrator', plain: "also 'trust, confidence' in general" },
  { ar: 'الراوي', forms: ['راوي', 'الرواة'], tr: 'rāwī', en: 'narrator' },
  // Creed and worship
  { ar: 'التوحيد', forms: ['توحيد'], tr: 'tawḥīd', en: 'the oneness of God' },
  { ar: 'العقيدة', forms: ['عقيدة'], tr: 'ʿaqīda', en: 'creed' },
  { ar: 'الطهارة', forms: ['طهارة'], tr: 'ṭahāra', en: 'ritual purity' },
  { ar: 'الوضوء', forms: ['وضوء'], tr: 'wuḍūʾ', en: 'ablution' },
  { ar: 'الزكاة', forms: ['زكاة', 'زکوٰۃ', 'زکات'], tr: 'zakāt', en: 'obligatory alms' },
  { ar: 'الصلاة', forms: ['صلاة', 'صلوٰۃ', 'نماز', 'نمازیں', 'نمازوں'], tr: 'ṣalāt', en: 'ritual prayer' },
  { ar: 'الصوم', forms: ['صوم', 'الصيام', 'صيام', 'روزہ', 'روزے', 'روزه'], tr: 'ṣawm', en: 'fasting' },
  { ar: 'الحج', forms: ['حج'], tr: 'ḥajj', en: 'the pilgrimage' },
  { ar: 'الغسل', forms: ['غسل'], tr: 'ghusl', en: 'full ritual bath', plain: "also ghasl 'washing' in general" },
  { ar: 'التيمم', forms: ['تيمم'], tr: 'tayammum', en: 'dry ablution' },
  { ar: 'الأذان', forms: ['أذان', 'اذان'], tr: 'adhān', en: 'call to prayer' },
  // Scholars and schools (common in Urdu and Persian works)
  { ar: 'الفقهاء', forms: ['فقهاء', 'فقہاء'], tr: 'fuqahāʾ', en: 'jurists' },
  { ar: 'الجمهور', forms: ['جمهور', 'جمہور'], tr: 'the majority of scholars', en: 'jumhūr', plain: "in modern Urdu also 'the public, the people'" },
  { ar: 'الحنفية', forms: ['حنفية', 'الأحناف', 'احناف'], tr: 'the Ḥanafīs', en: 'followers of the Ḥanafī school' },
  { ar: 'المسلك', forms: ['مسلک'], tr: 'maslak', en: 'school, way' },
];

export interface GlossaryHit {
  term: Term;
  /** The form actually found in the passage. */
  found: string;
}

/** Folds spelling differences away: vowel marks, hamza seats, and the Urdu and Persian letters. */
const fold = (s: string) =>
  s
    .replace(/[\u200c\u200d]/g, '')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ةۃہھۀە]/g, 'ه')
    .replace(/[ىیےۓ]/g, 'ي')
    .replace(/[کڪ]/g, 'ك')
    .replace(/ں/g, 'ن');

/**
 * The shapes one term takes in Arabic, Urdu and Persian writing: with or without the
 * article; a final tāʾ marbūṭa written as ت (Urdu and Persian طہارت, سنت); a final hamza
 * dropped (Urdu وضو).
 */
function variants(form: string): string[] {
  const f = fold(form);
  const out = new Set([f]);
  const bare = f.replace(/^ال/, '');
  if (bare.length >= 2) out.add(bare);
  for (const v of [...out]) {
    if (v.endsWith('ه')) out.add(`${v.slice(0, -1)}ت`);
    if (v.endsWith('ء')) out.add(v.slice(0, -1));
  }
  return [...out];
}

/** The glossary terms that occur in a passage, longest first, so only those go to the AI. */
export function termsIn(text: string, glossary: Term[]): GlossaryHit[] {
  const hay = ` ${fold(text)} `;
  const hits: GlossaryHit[] = [];
  for (const term of glossary) {
    found: for (const form of [term.ar, ...(term.forms ?? [])]) {
      for (const f of variants(form)) {
        // Arabic attaches و ف ب ل ك to the front of words; allow those, but not other letters.
        const re = new RegExp(`(?:^|[\\s\\p{P}]|[وفبلك])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s\\p{P}])`, 'u');
        if (re.test(hay)) {
          hits.push({ term, found: form });
          break found;
        }
      }
    }
  }
  return hits.sort((a, b) => b.term.ar.length - a.term.ar.length);
}

/** Merges a book's own entries over the shared ones (matched by Arabic term). */
export function mergeGlossary(shared: Term[], book: Term[]): Term[] {
  const byAr = new Map(shared.map((t) => [fold(t.ar), t]));
  for (const t of book) byAr.set(fold(t.ar), t);
  return [...byAr.values()];
}
