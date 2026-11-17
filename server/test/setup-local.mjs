// Prepares a fresh local database and test settings for the local server tests.
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

export function setupLocal(dir, mockPort = 8799) {
  rmSync(`${dir}/.wrangler`, { recursive: true, force: true });
  // Test-only values: a stand-in AI service on this machine and a throwaway setup code.
  writeFileSync(`${dir}/.dev.vars`, `SETUP_CODE=test-setup\nGROQ_API_KEY=mock\nPROVIDERS_JSON=[{"id":"groq","baseUrl":"http://127.0.0.1:${mockPort}/v1","dailyRequests":1000}]\n`);
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'maktaba', '--local'], { cwd: dir, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
}
