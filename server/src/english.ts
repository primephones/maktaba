/**
 * Whether a text is English rather than a transliteration of Arabic, Urdu or Persian in
 * Latin letters ("Namaz deen ka sutoon hai"), or the original copied back. English prose
 * is full of small function words; transliterations have almost none.
 */
const FUNCTION_WORDS = new Set(
  'the of and to a in is that it for as with was on be by this are from or which not his he they who have has an at but their all one so if we its what there were been them when no him do may would will can said those these such than into upon whom whose shall must also only own other our out over said then thus too us very you your i my me she her'.split(' '),
);

export function looksEnglish(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[؀-ۿ]{12,}/.test(t)) return false;
  const words = t.toLowerCase().match(/[a-z]+/g) ?? [];
  // A heading or a short phrase cannot be judged by its small words.
  if (words.length < 7) return words.length > 0;
  const small = words.filter((w) => FUNCTION_WORDS.has(w)).length;
  return small / words.length >= 0.12;
}
