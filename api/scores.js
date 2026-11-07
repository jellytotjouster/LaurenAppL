import { blobStore, scoresGet, scoresPost, readBody, guarded, json } from './_lib.js';

export default async function handler(req, res) {
  return guarded(req, res, async () => {
    const store = blobStore();
    if (req.method === 'GET') return scoresGet(store, new URL(req.url, 'http://x').searchParams.get('me'));
    if (req.method === 'POST') return scoresPost(store, await readBody(req));
    return json(405, { error: 'method' });
  });
}
