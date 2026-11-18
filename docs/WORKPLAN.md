# Work plan (kept so work can carry on across sessions)

The owner's standing instructions (18 Nov 2026):
- Reading must be excellent; translations and every AI must work properly.
- Actually look at the screens and see things work (screenshots, the live site at
  https://primephones.github.io/maktaba/ is reachable from the cloud environment).
- Permission to look for better alternatives for everything (models, engines, libraries).
- When usage runs out, carry on when it resets. Do full checks.

## Now
1. Reader: tap or scroll up a little shows all controls, grouped and labelled:
   top (back, title, search, bookmark); bottom (position + Contents, Text, English,
   Study, More). Sheets with clear sections. Intuitive.
2. Full checks of reading in every language (e2e/languages.mjs), and look at screenshots
   of every reader screen and sheet in every theme.
3. Better alternatives: AI models (live lists), PDF/EPUB engines, fonts for Nastaliq.

## Then (owner's list, not done yet)
- Iʿrāb learning: why each word takes its case, with a practice mode.
- AI: arguments and opposing arguments with references from the owner's books; define a
  word; study notes; quiz on a chapter; "what does the sharh say".
- Second checking pass for translations (uṣūl al-fiqh especially).
- Catalogue: the six books of ḥadīth with classical and Deobandi shurūḥ; Ḥanafī fiqh
  with shurūḥ (OpenITI, CC BY-NC-SA, attribution; ids in the session notes).
- Matn → sharḥ: jump from the matn paragraph to the place in its sharḥ.
- Constitutions of Muslim countries, with a few books on them.
- Moving to a new phone: a guided page (Drive or backup file).
- Settings grouped; onboarding that says what each step gives.

## Facts to remember
- Builds: GitHub Actions on branch ccr-0620b64f-krkauh; releases build-NN; Pages live.
- Signing key: android/app/maktaba-release.keystore (password maktaba-release), SHA-1
  D3:5E:25:C7:6F:86:74:24:A6:67:1C:C0:35:5A:8F:0E:9D:D1:27:45.
- Gemini retired 2.5 names; newest seen gemini-3.8-flash (503 when overloaded).
- OpenRouter free models change often; the app picks from the live list.
- Nastaliq PDFs often have unusable text layers; such pages go to the AI as images.
