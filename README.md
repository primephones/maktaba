# Maktaba · مكتبة

A personal library for Islamic scholarship: Arabic and Urdu books first, Persian too, read
in English on an Android phone (and in a browser or on an iPhone as a home-screen app).

This is a ground-up rebuild. It is being built in phases, and each phase is tested before
the next begins. Features that are not finished are left out of the app rather than shown
half-working.

## Getting the app

- **The link to share:** <https://primephones.github.io/maktaba/>. Whoever opens it gets
  their own empty library, and signs in with **their own cloud** (Google Drive) and **their
  own AI** (OpenRouter sign-in, or a free Gemini or Groq key). Nothing of anyone else's is
  shared or used. On an iPhone, put it on the home screen (Share › Add to Home Screen).
- **Android (Samsung and others):** the repository's [Releases](../../releases) page; take
  the newest `build-N`, download the `.apk` and open it on the phone.
- Settings › **Share Maktaba** sends the link from inside the app.
- **Setting up, for everyone:** a guide in the app (Home › *Set up Maktaba*, or Settings ›
  *Help & setup*) walks each person through their own cloud and their own AI, step by step:
  what they will see, what to tap, the right page opened for them. What they paste is
  checked (a web address instead of a key, a key cut short, a key from another service), and
  every problem comes with what it means and what to do.
- One-time setup by the owner (the link, Google Drive sign-in, a signing key for updates):
  [`docs/SETUP.md`](docs/SETUP.md).

## Each person's own logins

| | What it is | Where it lives |
|---|---|---|
| **Your cloud** | Google Drive. Maktaba asks only for the files it makes, in a folder called Maktaba: the original books (Maktaba/Books) and notes, places, highlights and translations (Maktaba/Sync). A new phone gets the whole library from there. | The reader's own Drive. |
| **Your AI** | Sign in with OpenRouter, or a free Google Gemini or Groq key, or any OpenAI-compatible service. The phone talks to it directly. Whole books are translated on the phone, paced to the free allowance. | The key stays on the phone: never synced, never in a backup. |
| Advanced: own server | The optional private Maktaba server (`server/`), for someone who wants books translated while the phone is off. | A free Cloudflare account. |

## What works today

- **Adding books:** PDF (text and scanned), EPUB, MOBI/AZW3, Word (DOCX), FB2, plain text,
  Markdown, OpenITI texts and images; shared to Maktaba from other apps too. Duplicates
  are caught. Import resumes if it is interrupted.
- **Scanned books:** shown as printed, each page with its English beneath. The reader's AI
  (Gemini, else OpenRouter's free image models) reads and translates each page in one go;
  Urdu, Persian and Pashto (Nastaliq) are read only by the AI. Clean Arabic and Latin
  print can also be read offline on the phone. English scans are left as printed.
- **Library:** covers drawn as bound books, folders inside folders, reading status,
  filters, sorting, volumes of one work shelved together.
- **Reader:** scroll or page mode; Paper, Sepia, Lamp and Black themes (or follow the
  phone); type controls; right-to-left Arabic and Nastaliq Urdu; vowel marks on or off;
  contents, bookmarks, five highlight colours, notes, footnote popups, go to page, search
  inside the book, zoom for scanned pages; volume keys turn pages.
- **English:** whole-book translation by AI with a fixed glossary of terms; English,
  Original or Both side by side; tap a paragraph to see the original; uncertain renderings
  marked †; a second AI can check a chapter, confirming or correcting each paragraph with
  the reason. Each service is asked which models it offers, so retired models are never
  stuck to; Settings › Your AI › Test my AI says plainly what works.
- **Qur'an:** verses quoted in a book are recognised; tap for the verse in Arabic with
  Saheeh International English, offline.
- **Study:** search across every book (Arabic search ignores vowel marks and spelling
  variants); Ask your books (answers only from passages in your books, each cited and
  checked word for word), or the arguments for and against each position; Summarise a
  chapter; Quiz on a chapter; Explain a passage; Iʿrāb for Arabic, with each word's case,
  role and the reason, and Test yourself; saved references with citations.
- **Book catalogue:** the six books of ḥadīth with classical and Deobandi commentaries,
  Ḥanafī fiqh with its commentaries, classical works on government (OpenITI, CC BY-NC-SA),
  and the constitutions of 49 Muslim countries in English and Arabic where given
  (Constitute Project, CC BY-NC); a commentary is linked to its matn, and More › In the
  commentary opens it where it explains the paragraph being read.
- **Listening:** read aloud in English, the original, or both, with the phone's voices;
  Arabic terms in English said by an Arabic voice; speed and sleep timer.
- **Your phones in step:** reading places, highlights, notes, references, translations,
  settings and the books themselves, through your own Google Drive (the later change wins).
- **Backup:** one file holds the whole library; restore it on any phone.
- **The original:** every book's file is kept exactly as added. In the reader, Original
  shows the printed PDF page being read (or opens any other file in its own app); in Book
  details, Open or Save a copy.
- **Offline:** everything except AI features works with no internet.

## Not built yet

Ḥadīth popups, the dictionary (Lane's Lexicon), names index, glossary editing, comparing
books, lock-screen and headphone controls for listening, more book sources (Internet
Archive, Shamela), the reading list, and exports (Word, PDF, EPUB). The full phase plan is in [`docs/PLAN.md`](docs/PLAN.md).

## Main technical choices

| Choice | Why |
|---|---|
| One codebase (TypeScript + React), wrapped for Android with Capacitor | The Android app and the web/iPhone app cannot drift apart, and browser engines set Arabic and Nastaliq type very well. |
| Every format is converted to one model: book → sections → paragraphs | Translation, tap-for-original, search, highlights and references all need to point at an exact paragraph, whatever the file was. |
| Everything is stored on the device (IndexedDB) | Works offline; an update installed over the old version keeps the library. |
| A PDF page whose built-in text has letters missing is shown as an image of the page | Many Arabic PDFs silently drop letters. Showing the page is honest; showing the damaged text would misquote the book. |
| No leftover screens | Nothing is inherited from another reader app. A screen exists only if it was written for Maktaba and works. |

## Working on it

```sh
npm install
npm run dev          # the app at http://localhost:5173
npm test             # unit tests
npm run build
npm run e2e          # drives the built app in a phone-sized browser (needs Playwright)
npm run e2e:themes   # every screen in every theme: contrast and covered text
node e2e/motion.mjs  # opening books, going back, dragging sheets
```

Every push runs the same checks on GitHub, builds the APK, installs it on an Android
emulator and uses it there (`.github/workflows/build.yml`, `e2e/android.mjs`).

### Layout

```
src/import/     one importer per format, and the resumable import queue
src/features/   home, library, reader, references, search, settings, review
src/ai/ src/sync/  the server client: translation, study, sync between phones
src/ocr/        text recognition for scanned pages
src/quran/ src/speech/ src/backup/  Qur'an popups, reading aloud, backup files
src/lib/        Arabic text handling, search, citations, PDF loading
src/db/         the data model and the on-device database
e2e/            end-to-end tests (browser and Android)
android/        the Android app shell (and its native plugin)
server/         your private AI and sync server (Cloudflare Worker)
```
