import { blobStore, adminPost, adminOk, readBody, guarded, json } from './_lib.js';
import { ADMIN_HTML } from './_adminpage.js';

export default async function handler(req, res) {
  return guarded(req, res, async () => {
    if (req.method === 'GET') {
      return { status: 200, type: 'text/html; charset=utf-8', body: ADMIN_HTML, headers: {
        'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      } };
    }
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const expected = process.env.ADMIN_KEY;
    if (!expected || expected.length < 16) return json(503, { error: 'not set up' });
    if (!adminOk(String(req.headers['x-admin-key'] || ''), expected)) { await new Promise(ok => setTimeout(ok, 700)); return json(401, { error: 'key' }); }
    return adminPost(blobStore(), await readBody(req, 1300000));          // only after the key is right: a photo goes through here
  });
}
