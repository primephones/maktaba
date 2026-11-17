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
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const reply = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 50, completion_tokens: 80 } }));
  };
  if (system.includes('give the words most likely')) return reply({ ar: ['الإجماع', 'حجة'], en: ['consensus'] });
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
  if (system.includes('iʿrāb')) return reply({ words: user.trim().split(/\s+/).slice(0, 6).map((w) => ({ word: w, irab: 'اسم مرفوع', en: 'a noun' })), note: '' });
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
