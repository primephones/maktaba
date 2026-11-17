// A stand-in AI service with the OpenAI-style API, for testing the server without real
// keys. It "translates" each paragraph faithfully enough to pass the checks, and starts
// answering 429 (allowance used up) after LIMIT requests.
import { createServer } from 'node:http';

const LIMIT = Number(process.env.LIMIT ?? 1000);
let calls = 0;
createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.url === '/calls') {
    res.end(JSON.stringify({ calls }));
    return;
  }
  if (req.url === '/reset') {
    calls = 0;
    res.end('{}');
    return;
  }
  calls++;
  if (calls > LIMIT) {
    res.writeHead(429, { 'retry-after': '1' });
    res.end('{"error":"rate limited"}');
    return;
  }
  const { messages } = JSON.parse(body);
  const user = messages.find((m) => m.role === 'user').content;
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
