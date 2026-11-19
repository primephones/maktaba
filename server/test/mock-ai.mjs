// A stand-in AI service with the OpenAI-style API, for testing the server without real
// keys. It "translates" each paragraph faithfully enough to pass the checks, and starts
// answering 429 (allowance used up) after LIMIT requests.
import { createServer } from 'node:http';

const LIMIT = Number(process.env.LIMIT ?? 1000);
let calls = 0;
/** What the AI was last sent, for tests to look at. */
const last = [];
createServer(async (req, res) => {
  // Answers pages in a browser too (the app calling the reader's own AI directly).
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-goog-api-key');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  let body = '';
  for await (const c of req) body += c;
  if (req.url === '/calls') {
    res.end(JSON.stringify({ calls }));
    return;
  }
  if (req.url === '/last') {
    res.end(JSON.stringify(last));
    return;
  }
  if (req.url === '/reset') {
    calls = 0;
    res.end('{}');
    return;
  }
  // The list of models, as every OpenAI-style service offers it.
  if (req.method === 'GET' && /\/models$/.test(req.url)) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'test-model' }] }));
    return;
  }
  calls++;
  try {
    last.push(JSON.parse(body).messages);
    if (last.length > 30) last.shift();
  } catch {
    /* not JSON */
  }
  if (calls > LIMIT) {
    res.writeHead(429, { 'retry-after': '1' });
    res.end('{"error":{"message":"Rate limit exceeded: free-models-per-day"}}');
    return;
  }
  const { messages } = JSON.parse(body);
  const user = messages.find((m) => m.role === 'user').content;
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const reply = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 50, completion_tokens: 80 } }));
  };
  if (system.includes('give the words most likely')) return reply({ ar: ['الإجماع', 'حجة'], en: ['consensus'] });
  if (system.includes('Write a short quiz')) {
    const ids = [...user.matchAll(/\[(p\d+)\]/g)].map((m) => m[1]);
    return reply({ questions: Array.from({ length: 5 }, (_, i) => ({ q: `Question ${i + 1}: what does the chapter say qiyās is?`, options: ['Joining a branch case to a root case for a shared cause', 'A report from the Prophet', 'The agreement of the scholars', 'A custom of the people'], answer: 0, why: 'The chapter defines qiyās as joining a branch to a root in the ruling for a shared cause.', ids: [ids[i % ids.length] ?? 'p1'] })) });
  }
  if (system.includes('You are the second translator')) {
    const items = [...user.matchAll(/\[([^\]]+)\]\nOriginal: [^\n]*\nDraft: ([^\n]*)/g)].map((m) => ({ id: m[1], en: m[2] }));
    return reply({
      paragraphs: items.map((it, i) =>
        i === 1
          ? { id: it.id, ok: false, en: `${it.en} (corrected: "qiyās" is analogy, not opinion)`, changes: [{ was: 'opinion', now: 'analogy', why: 'qiyās is analogy, a technical term' }] }
          : { id: it.id, ok: true, en: it.en, changes: [] },
      ),
    });
  }
  if (system.includes('the arguments for and against each')) {
    const ids = [...user.matchAll(/\[(p\d+)\]/g)].map((m) => m[1]);
    if (!ids.length) return reply({ found: false, positions: [], note: 'Not in the passages.' });
    return reply({
      found: true,
      positions: [
        { position: 'Consensus (ijmāʿ) is a decisive proof.', held_by: 'the majority of the uṣūlīs', arguments: [{ point: 'The scholars of the community do not agree upon an error.', ids: [ids[0]] }], objections: [{ point: 'Some held that a consensus after the Companions cannot be known.', ids: [ids[ids.length - 1]] }] },
      ],
      note: '',
    });
  }
  if (system.includes('ONLY the numbered passages')) {
    const m = user.match(/\[(p\d+)\][^\n]*\n([^\n]+)/);
    const words = m ? m[2].split(/\s+/).slice(0, 4).join(' ') : '';
    return reply({ found: !!m, answer: m ? `The passages say that consensus is a decisive proof [${m[1]}].` : 'Not in the passages.', quotes: m ? [{ id: m[1], text: words }] : [] });
  }
  if (system.includes('Summarise the chapter')) {
    const ids = [...user.matchAll(/\[(p\d+)\]/g)].map((m) => m[1]);
    return reply({ summary: `The chapter defines analogy (qiyās) [${ids[0]}].\nIt names consensus as a proof [${ids[1] ?? ids[0]}] and cites a passage that does not exist [p999].` });
  }
  if (system.includes('You explain a passage')) return reply({ explanation: 'This passage says that consensus (ijmāʿ) is a decisive proof.', terms: [{ term: 'ijmāʿ', meaning: 'consensus' }] });
  if (system.includes('iʿrāb')) {
    const cases = ['marfu', 'mansub', 'majrur', 'mabni'];
    const why = { marfu: 'It is the subject (fāʿil) of the verb before it, and a subject is marfūʿ; the sign is the ḍamma.', mansub: 'It is the object of the verb, so it is manṣūb; the sign is the fatḥa.', majrur: 'It comes after the preposition fī, which makes the noun after it majrūr; the sign is the kasra.', mabni: 'It is a particle: particles are mabnī and do not change.' };
    return reply({ words: user.trim().split(/\s+/).slice(0, 6).map((w, i) => ({ word: w, irab: 'اسم مرفوع', case: cases[i % 4], role: ['subject of the verb', 'object', 'after a preposition', 'particle'][i % 4], why: why[cases[i % 4]], en: 'a word' })), note: '' });
  }
  const part = user.slice(user.indexOf('Translate these paragraphs:'));
  const paras = [...part.matchAll(/\[([^\]]+)\][^\n]*\n([^\n]+)/g)].map((m) => ({ id: m[1], text: m[2] }));
  const toAscii = (s) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const out = paras.map((p) => {
    const nums = (toAscii(p.text).match(/[0-9]+/g) ?? []).join(' ');
    const words = Math.max(6, Math.round(p.text.length / 5));
    return { id: p.id, en: `English of paragraph ${p.id}${nums ? ` (numbers ${nums})` : ''}: ${'faithful '.repeat(words).trim()}.`, uncertain: [] };
  });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ paragraphs: out }) } }], usage: { prompt_tokens: 100, completion_tokens: 200 } }));
}).listen(Number(process.env.PORT ?? 8799), '127.0.0.1');
