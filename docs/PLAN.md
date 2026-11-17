# Maktaba: the plan

Each phase ends with an APK that is installed and checked on a phone before the next
phase starts. Numbers in brackets refer to the feature list (Part A) in the brief.

| # | Phase | What it delivers | State |
|---|---|---|---|
| 1 | Design and foundation | The look of the app; library, folders, covers [4]; adding books [5.1–5.2]; the reader [7]; offline use [1.3]; search across books; saved references; the installable web app | **Done**, tested in a browser and on GitHub |
| 2 | Android shell | Share-to-Maktaba and Open with; work that carries on in the background with a progress notification, and a notice after a restart [5.4]; volume-key page turning, screen on, orientation lock | **Done**; on-emulator test being finished |
| 3 | Processing | Offline text recognition for scans in Arabic, Urdu, Persian and English [5.3]; scan review [5.6]; Kindle (MOBI, AZW3) | **Done** |
| 4 | Server and AI allowance | Private key-gated server; usage bar split by feature, resets, last-known when offline [14]; fallback between free services; private books never sent to a service that trains | **Done** (needs your free accounts to switch on) |
| 5 | Translation and reading in English | Whole-book translation on the server that pauses and resumes by itself [9]; tap for the original [8]; draft labels; † with reasons; translate ahead | **Done**; glossary editing, consistency check, compare AIs and names index still to come |
| 6 | References and dictionary | Qurʾān popups offline [7.8]; saved references with citations | **Partly done**: ḥadīth popups, "what it proves", issue boards, Lane's Lexicon still to come |
| 7 | Search & ask | Answers only from your books, every claim cited and checked [11]; Explain; Iʿrāb with corrections | **Done**; summarise chapter and compare books still to come |
| 8 | Read aloud | Phone voices offline; Arabic terms said by an Arabic voice; Fix a word; speed, sleep timer, English/Original/Both [13] | **Done**; lock-screen and headphone controls still to come |
| 9 | Sync, backup, sharing | HSY key sync with an offline outbox; one-file backup and reminder; invitations for 1–2 people [15] | **Done** |
| 10 | Sources | Internet Archive, OpenITI, Shamela and Noor Book inside the app; the reading list [6] | To do; needs your reading-list file |
| 11 | Exports and the rest | Word, PDF and EPUB export [9.11, 10.6]; comparing translations; names index; the "later" items [17] | To do |

## Added beyond the brief

- Printed page numbers marked between paragraphs, so any passage can be cited by page.
- Copy with citation: copies a passage with its source, in Arabic convention for Arabic books.
- PDFs whose built-in text has letters missing are detected and shown as page images
  instead of being misquoted.
- Arabic-script books are bound and turn like the real thing: spine on the right, forward
  is a tap on the left.
- An automated test that installs the APK on an Android emulator and uses it, on every change.
- Books from your other phone appear in the library waiting for their file; adding the same file
  brings back all their notes, highlights, place and translation.
- Every translated paragraph is stored on the server too, so the same text is never paid for twice.
- Uncertain recognised text is marked in the margin; hand-corrected pages are never overwritten.

## Known limits

- iPhone gets the web app only: reading, search and (later) sync, but no background
  processing or share-to-Maktaba.
- Free AI allowances are small. Whole-book translation will take days, not minutes.
- Offline text recognition is weak for Urdu Nastaliq; the best results will need internet.
- Shamela and Noor Book have no official download route and can change without notice.
