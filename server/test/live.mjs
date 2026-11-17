// Runs the real server locally (Cloudflare's runtime + local database) against the
// stand-in AI service, and walks through what the app will do.
import { spawn } from 'node:child_process';

const S = 'http://127.0.0.1:8787';
const MOCK = 'http://127.0.0.1:8799';
const failures = [];
let passed = 0;
const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  FAILED', what);
  if (ok) passed++;
  else failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = 'HSY-ABCD-EFGH-JKLM-NPQR-STUV';
const other = 'HSY-WXYZ-2345-6789-ABCD-EFGH';
const call = async (path, { method = 'GET', body, as = key } = {}) => {
  const res = await fetch(S + path, { method, headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const mock = spawn('node', ['test/mock-ai.mjs'], { env: { ...process.env, LIMIT: '6' }, stdio: 'inherit' });
const server = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8787', '--test-scheduled'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(S)).ok) break;
    } catch {
      /* starting */
    }
    await wait(500);
  }

  console.log('Claiming the server');
  check((await call('/v1/status')).status === 401, 'without a key, the server refuses');
  check((await call('/v1/setup', { method: 'POST', body: { code: 'wrong' } })).status === 403, 'a wrong setup code is refused');
  check((await call('/v1/setup', { method: 'POST', body: { code: 'test-setup', name: 'Owner' } })).data.role === 'owner', 'the owner claims it with the setup code');
  check((await call('/v1/setup', { method: 'POST', body: { code: 'test-setup' }, as: other })).status === 403, 'nobody else can claim it afterwards');
  check((await call('/v1/status', { as: other })).status === 401, 'a stranger’s key gets nothing');

  console.log('Translating');
  const t = await call('/v1/translate', { method: 'POST', body: { lang: 'ar', paragraphs: [{ id: 'a', text: 'قال الشافعي سنة ٢٠٤: الإجماع حجة قاطعة عند جمهور الأصوليين.' }] } });
  check(t.status === 200 && t.data.results?.[0]?.provider === 'groq' && /204/.test(t.data.results[0].en), `a paragraph is translated (${t.status} ${JSON.stringify(t.data).slice(0, 160)})`);
  const again = await call('/v1/translate', { method: 'POST', body: { lang: 'ar', paragraphs: [{ id: 'a', text: 'قال الشافعي سنة ٢٠٤: الإجماع حجة قاطعة عند جمهور الأصوليين.' }] } });
  check(again.data.results?.[0]?.cached === true, 'the same paragraph again comes from the store, using no allowance');
  const priv = await call('/v1/translate', { method: 'POST', body: { lang: 'ar', private: true, prefer: ['gemini'], paragraphs: [{ id: 'b', text: 'نص خاص لا يرسل إلى خدمة تتدرب على البيانات أبدا.' }] } });
  check(priv.status === 200 && priv.data.results?.[0]?.provider === 'groq', 'a private paragraph goes only to a service that does not train');

  console.log('Whole book');
  const paragraphs = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, text: `الفقرة رقم ${i + 1}: واعلم أن القياس هو إلحاق فرع بأصل في الحكم لعلة جامعة بينهما.`, chapter: 'باب القياس' }));
  const job = await call('/v1/jobs', { method: 'POST', body: { bookKey: 'b1', title: 'كتاب', lang: 'ar', paragraphs } });
  check(job.status === 200 && job.data.total === 60, 'a whole book is handed to the server');
  await wait(4000);
  let st = (await call(`/v1/jobs/${job.data.id}`)).data.job;
  console.log('   job after first run:', st.state, st.done, '/', st.total, st.last_error ?? '');
  check(st.state === 'waiting' && st.done > 0 && st.done < 60 && /allowance/i.test(st.last_error ?? ''), 'when the allowance runs out, the book pauses and says why');
  check(st.next_run_at > Date.now() - 5000, 'and it says when it will resume');
  const status = (await call('/v1/status')).data;
  const groq = status.providers.find((p) => p.id === 'groq');
  check(groq.usedToday >= 6 && groq.dailyLimit > 0, `the usage screen shows each service’s use against its limit (${groq.usedToday} of ${groq.dailyLimit})`);
  check(status.features.translate >= 6 && status.resetAt > Date.now(), 'usage is split by feature, with the reset time');

  // The allowance comes back (the stand-in resets); the scheduled run picks the book up again.
  await fetch(`${MOCK}/reset`);
  await wait(1500);
  for (let i = 0; i < 12 && st.state !== 'done'; i++) {
    await fetch(`${S}/__scheduled?cron=*/5+*+*+*+*`);
    await wait(1500);
    await fetch(`${MOCK}/reset`);
    st = (await call(`/v1/jobs/${job.data.id}`)).data.job;
  }
  check(st.state === 'done' && st.done === 60, `the scheduled run carries on until the book is finished (${st.state} ${st.done}/60)`);
  const res = (await call(`/v1/jobs/${job.data.id}/results?since=0`)).data;
  check(res.items.length === 60 && res.items.every((i) => /^English of paragraph/.test(i.en)), 'every paragraph comes back, matched to its id');

  console.log('Sharing');
  const inv = await call('/v1/invites', { method: 'POST', body: { name: 'Brother', dailyShare: 50 } });
  check(/^INV-/.test(inv.data.code ?? ''), 'the owner makes an invitation');
  check((await call('/v1/join', { method: 'POST', body: { invite: inv.data.code }, as: other })).data.role === 'member', 'the invited person joins with their own key');
  check((await call('/v1/invites', { method: 'POST', body: {}, as: other })).status === 403, 'only the owner can invite');
  check((await call('/v1/status', { as: other })).data.member.dailyShare === 50, 'their own share of the allowance is set');
} catch (e) {
  console.log('TEST ERROR', e);
  failures.push(String(e));
} finally {
  if (failures.length) console.log(log.split('\n').filter((l) => /error|Error|✘/.test(l)).slice(-20).join('\n'));
  server.kill();
  mock.kill();
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
