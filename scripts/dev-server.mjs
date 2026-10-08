// Local development server: serves /public with the same security headers as
// netlify.toml and routes /api/* to the Netlify function handlers.
// Run with `npm run dev` (uses the SphereMail mock). http://localhost:8888
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import plans from '../netlify/functions/plans.mjs';
import signupCode from '../netlify/functions/signup-code.mjs';
import signup from '../netlify/functions/signup.mjs';
import cspReport from '../netlify/functions/csp-report.mjs';
import registration from '../netlify/functions/registration.mjs';
import incorporation from '../netlify/functions/incorporation.mjs';

const ROOT = new URL('../public/', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8888);
const routes = { '/api/plans': plans, '/api/signup/code': signupCode, '/api/signup': signup, '/api/csp-report': cspReport, '/api/registration': registration, '/api/incorporation': incorporation };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml' };

// Pull the global headers out of netlify.toml so local testing matches production.
const toml = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
const block = toml.split('[[headers]]').find((b) => /for = "\/\*"/.test(b)) || '';
const globalHeaders = {};
for (const m of block.matchAll(/^\s{4}([A-Za-z-]+) = "((?:[^"\\]|\\.)*)"\s*$/gm)) globalHeaders[m[1]] = m[2].replace(/\\"/g, '"');
delete globalHeaders['Strict-Transport-Security'];
if (globalHeaders['Content-Security-Policy']) globalHeaders['Content-Security-Policy'] = globalHeaders['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const handler = routes[url.pathname];
  if (handler) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const response = await handler(request, { ip: req.socket.remoteAddress });
    res.writeHead(response.status, { ...globalHeaders, ...Object.fromEntries(response.headers) });
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let path;
  try { path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''); } catch { res.writeHead(400).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  let file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(400).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { ...globalHeaders, 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = await readFile(join(ROOT, '404.html'));
    res.writeHead(404, { ...globalHeaders, 'content-type': TYPES['.html'] });
    res.end(data);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`The Business Loft — http://localhost:${PORT} (SphereMail ${process.env.SPHEREMAIL_MOCK === '1' ? 'MOCK' : 'LIVE'})`));
