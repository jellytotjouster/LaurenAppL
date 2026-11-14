import { blobStore, webFeed, webImg, guarded, json } from './_lib.js';

/* What visitors see of posts written at /write: the feed (blog/feed.json) and the photos (media/u-...). */
export default async function handler(req, res) {
  return guarded(req, res, async () => {
    if (req.method !== 'GET') return json(405, { error: 'method' });
    const sp = new URL(req.url, 'http://x').searchParams, store = blobStore();
    if (sp.get('img')) return webImg(store, sp.get('img'));
    return webFeed(store, Date.now());
  });
}
