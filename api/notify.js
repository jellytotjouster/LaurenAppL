import { blobStore, notifyPost, prefsPage, cmtStopPage, readBody, clientIp, guarded, json } from './_lib.js';

export default async function handler(req, res) {
  return guarded(req, res, async () => {
    if (req.method === 'GET') { const q = new URL(req.url, 'https://x.invalid').searchParams; if (q.get('c')) return cmtStopPage(blobStore(), q.get('c'), q.get('t')); return prefsPage(blobStore(), q.get('u'), q.get('t')); }
    if (req.method !== 'POST') return json(405, { error: 'method' });
    return notifyPost(blobStore(), await readBody(req), clientIp(req));
  });
}
