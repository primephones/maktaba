# Maktaba · مكتبة

A personal library for Islamic scholarship: Arabic, Urdu and Persian books, read on an
Android phone (and in a browser or on an iPhone as a home-screen app).

This is a ground-up rebuild. It is being built in phases, and each phase is tested before
the next begins. Features that are not finished are left out of the app rather than shown
half-working.

## What works today

- **Adding books:** PDF (text and scanned), EPUB, Word (DOCX), FB2, plain text, Markdown,
  OpenITI texts and images. Duplicates are caught. Import resumes if it is interrupted.
- **Library:** covers drawn as bound books, folders inside folders, reading status,
  filters, sorting, and volumes of one work shelved together.
- **Reader:** scroll or page mode, four themes, type controls, proper right-to-left Arabic
  and Nastaliq Urdu, show/hide vowel marks, contents, bookmarks, five highlight colours,
  notes, footnote popups, go to page, search inside the book, zoom for scanned pages.
- **Study:** search across every book (Arabic search ignores vowel marks and spelling
  variants), saved references with citations, copy with citation, printed page numbers
  marked in the text.
- **Offline:** everything above works with no internet.

## Not built yet

English translation, text recognition for scans, AI questions, the dictionary, Qur'an and
ḥadīth popups, read-aloud, sync and backup, in-app book sources, exports. The full phase
plan is in [`docs/PLAN.md`](docs/PLAN.md).

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
```

Every push runs the same checks on GitHub, builds the APK, installs it on an Android
emulator and uses it there (`.github/workflows/build.yml`, `e2e/android.mjs`).

### Layout

```
src/import/     one importer per format, and the resumable import queue
src/features/   home, library, reader, references, search, settings
src/lib/        Arabic text handling, search, citations, PDF loading
src/db/         the data model and the on-device database
e2e/            end-to-end tests (browser and Android)
android/        the Android app shell
```
