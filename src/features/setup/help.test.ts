import { describe, expect, it } from 'vitest';
import { helpFor } from './helpText';

describe('help for each problem', () => {
  const cases: Array<[string, RegExp]> = [
    ['The service refused this key. Check you copied all of it.', /did not accept the key/],
    ['Your AI is not available right now.', /allowance has run out/],
    ['No service that keeps private books private has a key set.', /marked private/],
    ['Connect your AI first, in Settings › AI.', /No AI is connected/],
    ['Request had insufficient authentication scopes.', /Drive access was not given/],
    ["The user's Drive storage quota has been exceeded.", /Drive is full/],
    ['Signing in was cancelled.', /not finished/],
    ['Sign in to your Google Drive again.', /sign in again/],
    ['Google sign-in is not switched on for this copy of Maktaba yet.', /not switched on yet/],
    ['Your Google Drive could not be reached. Check your internet connection.', /No connection/],
    ['Something odd', /Something went wrong/],
  ];
  for (const [error, title] of cases) it(error, () => expect(helpFor(error).title).toMatch(title));
  it('every answer has steps to follow', () => {
    for (const [error] of cases) expect(helpFor(error).steps.length).toBeGreaterThan(0);
  });
});
