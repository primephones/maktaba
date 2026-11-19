# Work plan (kept so work can carry on across sessions)

The owner's standing instructions (18 Nov 2026):
- Reading must be excellent; translations and every AI must work properly.
- Actually look at the screens and see things work (screenshots, the live site at
  https://primephones.github.io/maktaba/ is reachable from the cloud environment).
- Permission to look for better alternatives for everything (models, engines, libraries).
- When usage runs out, carry on when it resets. Do full checks.

## Done (19 Nov 2026)
- Reader tools: tap, or scroll up a little, shows them; labelled bar (Contents, Text,
  English, Study, More); Text sheet in groups; only the reader's own scrolling hides them.
- Fonts: Gulzar (Urdu Nastaliq) and Scheherazade New (vowelled Arabic) as choices.
- Iʿrāb: case, role and why for each word; Test yourself.
- Ask your books: For and against (positions, arguments, objections, each cited).
- Matn → sharḥ (More › In the commentary), with the place lit up on arrival.
- Book catalogue: 39 OpenITI works (six books, shurūḥ classical and Deobandi, Ḥanafī
  fiqh and shurūḥ, siyāsa); commentaries linked to their matn by themselves.
- Constitutions of 49 Muslim-majority countries (+ Nigeria, Lebanon, Bosnia) from
  Constitute Project, English and Arabic where given; files in data/constitutions.
- Settings grouped; Move to a new phone page; setup says what each step gives.

- Second check of a chapter's English by another AI; quiz on a chapter.

## Done (19 Nov 2026, afternoon), tested with the owner's real Gemini key
- Gemini keys now start AQ. (not AIza): recognised. gemini-2.5-* closed to new keys (404);
  gemini-3.8-flash 20 requests/day; 3.5/3.6 Flash often 70-90 s when busy; 3.5 and 3.1
  Flash-Lite answer in ~2-15 s. Router: up to 8 models, a light one third at the latest,
  a model not answering in 15 s joined by the next (first good answer wins), 60 s cap.
- Thinking kept low (thinkingLevel low on 3.x, budget 0 on 2.5 Flash). Groq: JSON-mode
  400 retried without JSON mode. Errors carry the service's own words.
- When every AI is busy, translating waits and retries by itself (up to ~4 min), saying so.
- Translate ahead runs in the background (src/ai/ahead.ts), with a pill and Stop; As I read
  keeps ~40 paragraphs ahead of the reader; scan pages use it too.
- Scanned pages: per-model rests; a day's pause only when every model is used up for the
  day (a bug paused reading till tomorrow when models were only overloaded, and told the
  reader to add a key); busy AI leaves the book waiting and retried in 3 min.
- Catalogue: Shamela matn spans read as quotations (Fatḥ al-Qadīr), repeated title
  headings and page 0 dropped, paragraphs split at page ends (Tabyīn had a 3.2M-char
  paragraph, which crashed the reader), corpus marks removed. All 39 parsed and checked.
- Pages mode: side taps turn the page on scans. Define a word (root, lemma, meanings,
  sense here, technical meaning), kept per word and sentence.

## Next
- Study notes (per book, collected highlights and notes, exportable).
- Printed edition (archive.org PDF) beside catalogue texts, if the owner wants it.
- Watch Gemini's free models: names and limits change; check the live list now and then.

## Facts to remember
- Builds: GitHub Actions on branch ccr-0620b64f-krkauh; releases build-NN; Pages live.
- Signing key: android/app/maktaba-release.keystore (password maktaba-release), SHA-1
  D3:5E:25:C7:6F:86:74:24:A6:67:1C:C0:35:5A:8F:0E:9D:D1:27:45.
- Gemini: see above; newest seen gemini-3.8-flash; Flash-Lite is the dependable free one.
- OpenRouter free models change often; the app picks from the live list.
- Nastaliq PDFs often have unusable text layers; such pages go to the AI as images.
