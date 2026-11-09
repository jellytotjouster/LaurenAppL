import { blobStore, scoresGet, scoresPost, readBody, guarded, json, clientIp } from './_lib.js';

export default async function handler(req, res) {
  return guarded(req, res, async () => {
    const store = blobStore();
    if (req.method === 'GET') { const sp = new URL(req.url, 'http://x').searchParams; return scoresGet(store, sp.get('me'), sp.get('fresh') === '1'); }
    if (req.method === 'POST') return scoresPost(store, await readBody(req), Date.now(), clientIp(req));
    return json(405, { error: 'method' });
  });
}
