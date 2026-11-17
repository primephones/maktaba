# Maktaba server

The app's private server. It holds the AI keys (the phone never does), keeps a daily
account of what each free AI service has been used for, translates whole books a little
at a time until they are finished, and lets only the owner's people use it.

It runs on Cloudflare's free plan: a Worker, a D1 database and a schedule every five
minutes. Nothing here costs money.

## What it does

| Request | What for |
|---|---|
| `POST /v1/setup` | The owner's phone claims the server, once, with the setup code. |
| `POST /v1/invites`, `POST /v1/join` | The owner invites up to two people; each gets their own key. |
| `GET /v1/status` | Today's use of each AI service and each feature, limits, and when they reset. |
| `POST /v1/translate` | Translate a few paragraphs now (reading ahead, re-drafting a paragraph). |
| `POST /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/results` | Translate a whole book on the server, picking up results as they are ready. |

Every request except setup and join needs the person's sync key
(`Authorization: Bearer HSY-…`). The server stores only a hash of it.

## Rules it keeps

- **Nothing invented.** Every answer is checked before it is accepted: each paragraph present,
  every number kept, no commentary, no untranslated text left in. A batch that fails goes to
  the next service; it is never saved half-right.
- **Private books stay private.** Books marked private only go to services that do not train
  on what they are sent (Groq). Gemini's free tier may use requests to improve Google's
  products, so it only sees books that are not marked private.
- **Never stops silently.** When every free allowance is used up, a book pauses with the exact
  reason and the time it will resume, then carries on by itself.
- **Never pays twice.** Each translated paragraph is stored; the same text is never sent again.

## Setting it up (about 15 minutes, all free)

1. Make a free Cloudflare account, then on a computer run, in this folder:
   `npm install`, `npx wrangler login`, `npx wrangler d1 create maktaba`
   and copy the database id it prints into `wrangler.toml`.
2. `npx wrangler d1 migrations apply maktaba --remote`
3. Make free API keys at Google AI Studio (Gemini) and Groq, then store them:
   `npx wrangler secret put GEMINI_API_KEY`, `npx wrangler secret put GROQ_API_KEY`,
   and a long random `SETUP_CODE`.
4. `npx wrangler deploy`. In the app, open Settings › AI and sync, enter the server's address
   and the setup code.

## Testing

- `npm test`: the translation checks, glossary and routing rules.
- `npm run test:live`: runs the real server locally against a stand-in AI service and walks
  through claiming, translating, a whole book pausing when the allowance runs out, resuming,
  and invitations.
