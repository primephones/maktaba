/**
 * Help at the moment something goes wrong: every error from setting up a cloud or an AI,
 * or from using one, comes with what it means and what to do, in plain steps.
 */

export interface Help {
  title: string;
  steps: string[];
  /** A place in the app that fixes it. */
  action?: { label: string; to: string };
}

const RULES: Array<{ test: RegExp; help: Help }> = [
  {
    test: /insufficient|scope|access to google drive was not given|access_denied/i,
    help: {
      title: 'Google Drive access was not given',
      steps: [
        'Tap Connect Google Drive again.',
        'When Google lists what Maktaba asks for (“See, edit, create and delete only the specific Google Drive files you use with this app”), make sure the box next to it is ticked.',
        'Then tap Continue. Maktaba still sees only its own folder.',
      ],
    },
  },
  {
    test: /storage quota|storagequota|drive is full|quota has been exceeded/i,
    help: {
      title: 'Your Google Drive is full',
      steps: [
        'Every Google account has 15 GB free, shared with Gmail and Google Photos. Yours is full, so new books cannot be saved there.',
        'Your books are safe on this phone. Free some space at drive.google.com (or Google Photos), and Maktaba carries on by itself.',
        'Google also sells more space (Google One) if you want it.',
      ],
    },
  },
  {
    test: /cancelled|popup_closed/i,
    help: {
      title: 'Signing in was not finished',
      steps: ['Nothing is wrong: tap the button again and finish choosing your account.', 'On a computer, allow pop-up windows for this site if the sign-in window does not appear.'],
    },
  },
  {
    test: /sign in to your google drive again|needs_consent|could not open/i,
    help: {
      title: 'Google asks you to sign in again',
      steps: ['This happens now and then (for example after a password change). Tap Connect Google Drive and choose the same account. Nothing is lost.'],
      action: { label: 'Open Your cloud', to: '/settings/cloud' },
    },
  },
  {
    test: /not switched on for this copy|sign-in is not set up/i,
    help: {
      title: 'Google Drive is not switched on yet',
      steps: [
        'Whoever shared Maktaba with you is still finishing its Google sign-in. Try again in a day or two.',
        'Until then your library stays on this phone. A backup file (Settings › Backup) keeps it safe meanwhile.',
      ],
      action: { label: 'Make a backup', to: '/settings/backup' },
    },
  },
  {
    test: /refused this key|invalid api key|api key not valid|incorrect api key|401|unauthor/i,
    help: {
      title: 'The service did not accept the key',
      steps: [
        'Check the whole key was copied: use the copy button next to the key, not a finger selection.',
        'If you made the key a while ago it may have been deleted. Make a new one on the same page and paste that.',
        'Make sure the key is pasted under the right service (Maktaba says which service a key belongs to).',
      ],
    },
  },
  {
    // Busy, not used up: the free models are overloaded for a while (Google's often are).
    test: /^(?!.*(?:allowance (?:is )?used up|used up|quota exceeded)).*(?:overloaded|high demand|busy for a moment|took too long|could not be reached;|service error 5\d\d)/i,
    help: {
      title: 'The free AI models are busy right now',
      steps: [
        'Google’s free models are often overloaded for a few minutes at a time. Nothing is wrong with your key.',
        'Translating ahead and the pages of scanned books wait and ask again by themselves. For anything else, try again in a minute or two.',
        'A second free service (OpenRouter or Groq) lets Maktaba carry on with that one meanwhile.',
      ],
      action: { label: 'Add another AI service', to: '/setup/ai' },
    },
  },
  {
    test: /allowance (is )?used up|allowance used up|no free ai service|not available right now|429|rate.?limit|quota exceeded for/i,
    help: {
      title: 'Today’s free allowance has run out',
      steps: [
        'Free AI accounts allow a set number of requests each day. Yours is used up for now.',
        'It comes back by itself (Settings › Your AI shows when). Book translations pause and carry on then without you doing anything.',
        'To keep going today, add a second free service. With two, Maktaba moves to the other one by itself.',
      ],
      action: { label: 'Add another AI service', to: '/setup/ai' },
    },
  },
  {
    test: /private books private|keeps private books/i,
    help: {
      title: 'This book is marked private',
      steps: [
        'Private books only go to an AI service that does not learn from what it is sent. Of the free ones, that is Groq.',
        'Add a free Groq key, or turn off “Private book” in the book’s details.',
      ],
      action: { label: 'Add Groq', to: '/setup/ai' },
    },
  },
  {
    test: /connect your ai|no ai service has a key|not connected/i,
    help: {
      title: 'No AI is connected yet',
      steps: ['Translation, Ask, Explain and summaries use your own free AI account. Connecting one takes about two minutes.'],
      action: { label: 'Connect your AI', to: '/setup/ai' },
    },
  },
  {
    test: /could not be reached|offline|network|failed to fetch|internet/i,
    help: {
      title: 'No connection',
      steps: ['Check you are online (Wi-Fi or mobile data), then try again.', 'Reading works offline; changes and translations wait and continue when you are back online.'],
    },
  },
  {
    test: /openrouter did not finish|started on another device/i,
    help: {
      title: 'The OpenRouter sign-in did not finish',
      steps: ['Tap Sign in with OpenRouter again, and finish in the same browser it opens.', 'Or add a free Google Gemini key instead: it is the best free option for Arabic.'],
      action: { label: 'Other ways to connect', to: '/setup/ai' },
    },
  },
];

export function helpFor(error: string): Help {
  return (
    RULES.find((r) => r.test.test(error))?.help ?? {
      title: 'Something went wrong',
      steps: ['Try again in a moment.', 'If it keeps happening, Settings › Help has answers to common problems.'],
      action: { label: 'Open Help', to: '/settings/help' },
    }
  );
}

