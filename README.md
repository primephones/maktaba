# Maktaba · مكتبة

A personal library for Islamic scholarship: Arabic, Urdu and Persian books, read on an
Android phone (and in a browser or on an iPhone as a home-screen app).

This is a ground-up rebuild. It is being built in phases, and each phase is tested before
the next begins. Features that are not finished are left out of the app rather than shown
half-working.

## Getting the app

- **Android (Samsung and others):** open the repository's
  [Releases](../../releases) page, take the newest `build-N`, download the `.apk` and open
  it on the phone (allow "Install unknown apps" for your browser or Files app when asked).
  Each release says whether it passed the test on an Android phone.
- **iPhone or any browser:** the same app runs as a web page and can be put on the home
  screen (Share › Add to Home Screen). It works offline once opened.
- **AI and sync** need your own small free server: see [`server/README.md`](server/README.md)
  (about 15 minutes, free Cloudflare account and free AI keys). Everything else works
  without it.

## What works today

- **Adding books:** PDF (text and scanned), EPUB, MOBI/AZW3, Word (DOCX), FB2, plain text,
  Markdown, OpenITI texts and images; shared to Maktaba from other apps too. Duplicates
  are caught. Import resumes if it is interrupted.
- **Scanned books:** text recognition on the phone (Arabic, Urdu, Persian, English),
  offline; pages it is unsure of are flagged for review and can be corrected by hand.
- **Library:** covers drawn as bound books, folders inside folders, reading status,
  filters, sorting, volumes of one work shelved together.
- **Reader:** scroll or page mode; Paper, Sepia, Lamp and Black themes (or follow the
  phone); type controls; right-to-left Arabic and Nastaliq Urdu; vowel marks on or off;
  contents, bookmarks, five highlight colours, notes, footnote popups, go to page, search
  inside the book, zoom for scanned pages; volume keys turn pages.
- **English:** whole-book translation by AI with a fixed glossary of terms; English,
  Original or Both side by side; tap a paragraph to see the original; uncertain renderings
  marked †.
- **Qur'an:** verses quoted in a book are recognised; tap for the verse in Arabic with
  Saheeh International English, offline.
- **Study:** search across every book (Arabic search ignores vowel marks and spelling
  variants); Ask your books (answers only from passages in your books, each cited and
  checked word for word); Explain a passage; Iʿrāb (word-by-word grammar) for Arabic;
  saved references with citations.
- **Listening:** read aloud in English, the original, or both, with the phone's voices;
  Arabic terms in English said by an Arabic voice; speed and sleep timer.
- **Two phones:** reading places, highlights, notes, references, translations and
  settings sync through your server, with an HSY sync key (no Google or email sign-in).
- **Backup:** one file holds the whole library; restore it on any phone.
- **Offline:** everything except AI features works with no internet.

## Not built yet

Ḥadīth popups, the dictionary (Lane's Lexicon), names index, glossary editing, chapter
summaries and comparing books, lock-screen and headphone controls for listening, in-app
book sources (Internet Archive, OpenITI, Shamela), the reading list, and exports (Word,
PDF, EPUB). The full phase plan is in [`docs/PLAN.md`](docs/PLAN.md).

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
