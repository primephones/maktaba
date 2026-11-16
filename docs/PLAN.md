# Maktaba: the plan

Each phase ends with an APK that is installed and checked on a phone before the next
phase starts. Numbers in brackets refer to the feature list (Part A) in the brief.

| # | Phase | What it delivers | State |
|---|---|---|---|
| 1 | Design and foundation | The look of the app; library, folders, covers [4]; adding books [5.1–5.2]; the reader [7]; offline use [1.3]; search across books; saved references; the installable web app | Built, tested in a browser. Awaiting the on-phone check. |
| 2 | Android shell | Share-to-Maktaba, processing that carries on in the background with a notification and resumes after a restart [5.4], the update notice [1.4], volume-key page turning | Next |
| 3 | Processing | Text recognition for scans in Arabic, Urdu, Persian and English [5.3]; scan review [5.6]; chapters and page numbers rebuilt; a fast search index; Kindle formats | |
| 4 | Server and AI allowance | A private, key-gated server; the usage bar and cost hints [14]; automatic fallback between free services; private books never sent to a service that trains on them | Needs your free accounts |
| 5 | Translation and reading in English | Whole-book translation that resumes and spreads over days [9]; tap for the original [8]; draft labels and uncertainty marks; the glossary | |
| 6 | References and dictionary | Qur'an, ḥadīth and source detection with popups [7.8, 7.9, 10.1]; "what it proves"; issue boards [10.5]; Lane's Lexicon offline [12] | |
| 7 | Search & ask | Answers only from your books, with checked quotes [11]; explain, summarise, iʿrāb | |
| 8 | Read aloud | Offline English voice with Arabic terms pronounced properly; a voice for Arabic passages [13] | |
| 9 | Sync, backup, sharing | The HSY key, offline queue, one-file backup, sharing with 1–2 people [15] | |
| 10 | Sources | Internet Archive, OpenITI, Shamela and Noor Book inside the app; the reading list [6] | Needs your reading-list file |
| 11 | Exports and the rest | Word, PDF and EPUB export [9.11, 10.6]; comparing translations; names index; then the "later" items [17] | |

## Added beyond the brief

- Printed page numbers marked between paragraphs, so any passage can be cited by page.
- Copy with citation: copies a passage with its source, in Arabic convention for Arabic books.
- PDFs whose built-in text has letters missing are detected and shown as page images
  instead of being misquoted.
- Arabic-script books are bound and turn like the real thing: spine on the right, forward
  is a tap on the left.
- An automated test that installs the APK on an Android emulator and uses it, on every change.

## Known limits

- iPhone gets the web app only: reading, search and (later) sync, but no background
  processing or share-to-Maktaba.
- Free AI allowances are small. Whole-book translation will take days, not minutes.
- Offline text recognition is weak for Urdu Nastaliq; the best results will need internet.
- Shamela and Noor Book have no official download route and can change without notice.
