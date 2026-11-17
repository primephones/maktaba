// A stand-in for Google Drive's API (the parts Maktaba uses), for testing sync between
// phones through "the reader's own Drive" without a Google account. One shared Drive,
// kept in memory; every request must carry the test token.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8796);
const TOKEN = 'test-token';
const files = new Map();
const sessions = new Map();
let clock = Date.now();
const stamp = () => new Date((clock = Math.max(clock + 1, Date.now()))).toISOString();
const meta = (f) => {
  const { data, ...rest } = f;
  return { ...rest, size: data ? String(data.length) : undefined };
};

function matches(f, q) {
  if (!q) return true;
  return q.split(/\s+and\s+/).every((clause) => {
    clause = clause.trim();
    let m;
    const val = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if ((m = clause.match(/^name\s*=\s*'((?:[^'\\]|\\.)*)'$/))) return f.name === val(m[1]);
    if ((m = clause.match(/^mimeType\s*=\s*'((?:[^'\\]|\\.)*)'$/))) return f.mimeType === val(m[1]);
    if ((m = clause.match(/^trashed\s*=\s*(true|false)$/))) return String(!!f.trashed) === m[1];
    if ((m = clause.match(/^'([^']+)'\s+in\s+parents$/))) return (f.parents ?? []).includes(m[1]);
    if ((m = clause.match(/^createdTime\s*>\s*'([^']+)'$/))) return Date.parse(f.createdTime) > Date.parse(m[1]);
    throw new Error(`unsupported query: ${clause}`);
  });
}

function create(md, data) {
  const now = stamp();
  const f = { id: randomUUID().replace(/-/g, ''), name: md.name, mimeType: md.mimeType ?? 'application/octet-stream', parents: md.parents ?? [], appProperties: md.appProperties ?? {}, createdTime: now, modifiedTime: now, trashed: false, data };
  files.set(f.id, f);
  return f;
}

function parseMultipart(buf, contentType) {
  const boundary = contentType.match(/boundary=([^;]+)/)[1];
  const parts = [];
  const sep = Buffer.from(`--${boundary}`);
  let at = buf.indexOf(sep);
  while (at >= 0) {
    const next = buf.indexOf(sep, at + sep.length);
    if (next < 0) break;
    const part = buf.subarray(at + sep.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    parts.push(part.subarray(split + 4));
    at = next;
  }
  return { meta: JSON.parse(parts[0].toString('utf8')), data: parts[1] };
}

const stats = { requests: 0, uploads: 0, downloads: 0 };

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-upload-content-type, x-upload-content-length, content-range');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('access-control-expose-headers', 'location, range');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const send = (status, obj, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };

  if (url.pathname === '/stats') {
    const all = [...files.values()].filter((f) => !f.trashed).map(meta);
    return send(200, { ...stats, files: all });
  }
  if (url.pathname === '/file') return res.end(files.get(url.searchParams.get('id'))?.data ?? '');

  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: { message: 'Invalid Credentials' } });
  stats.requests++;
  try {
    if (url.pathname === '/drive/v3/about') return send(200, { user: { emailAddress: 'reader@example.com', displayName: 'Test Reader' } });

    if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
      let list = [...files.values()].filter((f) => matches(f, url.searchParams.get('q')));
      list.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
      return send(200, { files: list.map(meta) });
    }
    if (url.pathname === '/drive/v3/files' && req.method === 'POST') return send(200, meta(create(JSON.parse(body.toString('utf8')))));

    if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
      const type = url.searchParams.get('uploadType');
      if (type === 'multipart') {
        const { meta: md, data } = parseMultipart(body, req.headers['content-type']);
        stats.uploads++;
        return send(200, meta(create(md, data)));
      }
      if (type === 'resumable') {
        const sid = randomUUID();
        sessions.set(sid, { md: JSON.parse(body.toString('utf8')), total: Number(req.headers['x-upload-content-length']), parts: [] });
        return send(200, {}, { location: `http://127.0.0.1:${PORT}/upload/session/${sid}` });
      }
    }
    const sess = url.pathname.match(/^\/upload\/session\/(.+)$/);
    if (sess && req.method === 'PUT') {
      const s = sessions.get(sess[1]);
      if (!s) return send(404, { error: { message: 'no session' } });
      s.parts.push(body);
      const have = s.parts.reduce((n, p) => n + p.length, 0);
      if (have < s.total) {
        res.writeHead(308, { range: `bytes=0-${have - 1}` });
        return res.end();
      }
      sessions.delete(sess[1]);
      stats.uploads++;
      return send(200, meta(create(s.md, Buffer.concat(s.parts))));
    }

    const one = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (one) {
      const f = files.get(one[1]);
      if (!f || f.trashed) return send(404, { error: { message: 'File not found' } });
      if (req.method === 'DELETE') {
        files.delete(f.id);
        res.writeHead(204);
        return res.end();
      }
      if (url.searchParams.get('alt') === 'media') {
        stats.downloads++;
        res.writeHead(200, { 'content-type': f.mimeType });
        return res.end(f.data ?? Buffer.alloc(0));
      }
      return send(200, meta(f));
    }
    send(404, { error: { message: `unknown ${req.method} ${url.pathname}` } });
  } catch (e) {
    send(400, { error: { message: String(e.message) } });
  }
}).listen(PORT, '127.0.0.1');
