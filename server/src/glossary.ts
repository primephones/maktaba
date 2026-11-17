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
}

export const SEED_GLOSSARY: Term[] = [
  // Sources and methods of law
  { ar: 'الإجماع', forms: ['إجماع', 'الاجماع', 'اجماع'], tr: 'ijmāʿ', en: 'consensus' },
  { ar: 'القياس', forms: ['قياس'], tr: 'qiyās', en: 'analogical reasoning' },
  { ar: 'الاجتهاد', forms: ['اجتهاد'], tr: 'ijtihād', en: 'independent legal reasoning' },
  { ar: 'المجتهد', forms: ['مجتهد', 'المجتهدون', 'مجتهدي'], tr: 'mujtahid', en: 'jurist qualified for ijtihād' },
  { ar: 'التقليد', forms: ['تقليد'], tr: 'taqlīd', en: 'following a school or authority' },
  { ar: 'الاستحسان', forms: ['استحسان'], tr: 'istiḥsān', en: 'juristic preference' },
  { ar: 'المصلحة المرسلة', forms: ['المصالح المرسلة'], tr: 'al-maṣlaḥa al-mursala', en: 'unrestricted public interest' },
  { ar: 'الاستصحاب', forms: ['استصحاب'], tr: 'istiṣḥāb', en: 'presumption of continuity' },
  { ar: 'سد الذرائع', tr: 'sadd al-dharāʾiʿ', en: 'blocking the means to harm' },
  { ar: 'العرف', forms: ['عرف'], tr: 'ʿurf', en: 'custom' },
  { ar: 'العلة', forms: ['علة', 'العلّة'], tr: 'ʿilla', en: 'effective cause (ratio legis)' },
  { ar: 'الحكم الشرعي', tr: 'al-ḥukm al-sharʿī', en: 'legal ruling' },
  { ar: 'الدليل', forms: ['دليل', 'الأدلة', 'أدلة'], tr: 'dalīl', en: 'proof, evidence' },
  { ar: 'أصول الفقه', tr: 'uṣūl al-fiqh', en: 'legal theory' },
  { ar: 'الفروع', forms: ['فروع'], tr: 'furūʿ', en: 'derived rulings' },
  { ar: 'الفقه', forms: ['فقه'], tr: 'fiqh', en: 'jurisprudence' },
  { ar: 'المذهب', forms: ['مذهب', 'المذاهب'], tr: 'madhhab', en: 'school of law' },
  { ar: 'الفتوى', forms: ['فتوى', 'الفتيا'], tr: 'fatwā', en: 'legal opinion' },
  // Rulings
  { ar: 'الفرض', forms: ['فرض'], tr: 'farḍ', en: 'obligatory' },
  { ar: 'الواجب', forms: ['واجب'], tr: 'wājib', en: 'obligatory' },
  { ar: 'المندوب', forms: ['مندوب', 'المستحب', 'مستحب'], tr: 'mandūb', en: 'recommended' },
  { ar: 'المباح', forms: ['مباح'], tr: 'mubāḥ', en: 'permissible' },
  { ar: 'المكروه', forms: ['مكروه'], tr: 'makrūh', en: 'disliked' },
  { ar: 'الحرام', forms: ['حرام', 'المحرم'], tr: 'ḥarām', en: 'forbidden' },
  { ar: 'السنة', forms: ['سنة'], tr: 'sunna', en: 'the Prophetic practice' },
  { ar: 'البدعة', forms: ['بدعة'], tr: 'bidʿa', en: 'reprehensible innovation' },
  // Language of texts
  { ar: 'النص', forms: ['نص'], tr: 'naṣṣ', en: 'explicit text' },
  { ar: 'الظاهر', forms: ['ظاهر'], tr: 'ẓāhir', en: 'apparent meaning' },
  { ar: 'المفهوم', forms: ['مفهوم'], tr: 'mafhūm', en: 'implied meaning' },
  { ar: 'المنطوق', forms: ['منطوق'], tr: 'manṭūq', en: 'stated meaning' },
  { ar: 'العام', forms: ['عام', 'العموم'], tr: 'ʿāmm', en: 'general (wording)' },
  { ar: 'الخاص', forms: ['خاص', 'الخصوص'], tr: 'khāṣṣ', en: 'specific (wording)' },
  { ar: 'المطلق', forms: ['مطلق'], tr: 'muṭlaq', en: 'unqualified' },
  { ar: 'المقيد', forms: ['مقيد'], tr: 'muqayyad', en: 'qualified' },
  { ar: 'المجمل', forms: ['مجمل'], tr: 'mujmal', en: 'ambiguous (needing clarification)' },
  { ar: 'المبين', forms: ['مبين'], tr: 'mubayyan', en: 'clarified' },
  { ar: 'الناسخ', forms: ['ناسخ'], tr: 'nāsikh', en: 'abrogating' },
  { ar: 'المنسوخ', forms: ['منسوخ'], tr: 'mansūkh', en: 'abrogated' },
  { ar: 'النسخ', forms: ['نسخ'], tr: 'naskh', en: 'abrogation' },
  { ar: 'التأويل', forms: ['تأويل'], tr: 'taʾwīl', en: 'interpretation (beyond the apparent meaning)' },
  // Ḥadīth
  { ar: 'الحديث', forms: ['حديث', 'الأحاديث'], tr: 'ḥadīth', en: 'Prophetic report' },
  { ar: 'الإسناد', forms: ['إسناد', 'السند', 'سند', 'الاسناد'], tr: 'isnād', en: 'chain of narration' },
  { ar: 'المتن', forms: ['متن'], tr: 'matn', en: 'text of the report' },
  { ar: 'الصحيح', forms: ['صحيح'], tr: 'ṣaḥīḥ', en: 'authentic' },
  { ar: 'الحسن', forms: ['حسن'], tr: 'ḥasan', en: 'good (sound)' },
  { ar: 'الضعيف', forms: ['ضعيف'], tr: 'ḍaʿīf', en: 'weak' },
  { ar: 'الموضوع', forms: ['موضوع'], tr: 'mawḍūʿ', en: 'fabricated' },
  { ar: 'المرسل', forms: ['مرسل'], tr: 'mursal', en: 'with a missing Companion link' },
  { ar: 'المرفوع', forms: ['مرفوع'], tr: 'marfūʿ', en: 'attributed to the Prophet' },
  { ar: 'الموقوف', forms: ['موقوف'], tr: 'mawqūf', en: 'attributed to a Companion' },
  { ar: 'المتواتر', forms: ['متواتر', 'التواتر'], tr: 'mutawātir', en: 'mass-transmitted' },
  { ar: 'الآحاد', forms: ['آحاد', 'خبر الواحد'], tr: 'āḥād', en: 'singly-transmitted' },
  { ar: 'الجرح والتعديل', tr: 'al-jarḥ wa-l-taʿdīl', en: 'criticism and validation of narrators' },
  { ar: 'الثقة', forms: ['ثقة'], tr: 'thiqa', en: 'trustworthy narrator' },
  { ar: 'الراوي', forms: ['راوي', 'الرواة'], tr: 'rāwī', en: 'narrator' },
  // Creed and worship
  { ar: 'التوحيد', forms: ['توحيد'], tr: 'tawḥīd', en: 'the oneness of God' },
  { ar: 'العقيدة', forms: ['عقيدة'], tr: 'ʿaqīda', en: 'creed' },
  { ar: 'الطهارة', forms: ['طهارة'], tr: 'ṭahāra', en: 'ritual purity' },
  { ar: 'الوضوء', forms: ['وضوء'], tr: 'wuḍūʾ', en: 'ablution' },
  { ar: 'الزكاة', forms: ['زكاة'], tr: 'zakāt', en: 'obligatory alms' },
  { ar: 'الصلاة', forms: ['صلاة'], tr: 'ṣalāt', en: 'ritual prayer' },
];

export interface GlossaryHit {
  term: Term;
  /** The form actually found in the passage. */
  found: string;
}

const fold = (s: string) =>
  s
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

/** The glossary terms that occur in a passage, longest first, so only those go to the AI. */
export function termsIn(text: string, glossary: Term[]): GlossaryHit[] {
  const hay = ` ${fold(text)} `;
  const hits: GlossaryHit[] = [];
  for (const term of glossary) {
    for (const form of [term.ar, ...(term.forms ?? [])]) {
      const f = fold(form);
      // Arabic attaches و ف ب ل ك to the front of words; allow those, but not other letters.
      const re = new RegExp(`(?:^|[\\s\\p{P}]|[وفبلك])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s\\p{P}])`, 'u');
      if (re.test(hay)) {
        hits.push({ term, found: form });
        break;
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
