import { blobStore, webFeed, webImg, autoNotify, guarded, json } from './_lib.js';

/* What visitors see of posts written at /write: the feed (blog/feed.json) and the photos (media/u-...).
   Opening the feed (or the daily check below) is also when the site notices a post that has just gone live and e-mails the people who follow it. */
export default async function handler(req, res) {
  return guarded(req, res, async () => {
    if (req.method !== 'GET') return json(405, { error: 'method' });
    const sp = new URL(req.url, 'http://x').searchParams, store = blobStore();
    if (sp.get('img')) return webImg(store, sp.get('img'));
    try { await autoNotify(store, Date.now(), !!sp.get('cron')); } catch (e) { console.error('[appl] automatic e-mail check failed: ' + String(e && e.message || e).slice(0, 200)); }
    if (sp.get('cron')) return json(200, { ok: true });
    return webFeed(store, Date.now());
  });
}
