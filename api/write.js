import { guarded } from './_lib.js';
import { WRITE_HTML } from './_writepage.js';

/* laurenappl.com/write: the page you write on from your phone. It holds nothing private: everything it does needs the owner key. */
export default async function handler(req, res) {
  return guarded(req, res, async () => {
    if (req.method !== 'GET') return { status: 405, type: 'application/json; charset=utf-8', body: '{"error":"method"}' };
    return { status: 200, type: 'text/html; charset=utf-8', body: WRITE_HTML, headers: {
      'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    } };
  });
}
