import { blobStore, blogGet, blogPost, blogAvatar, readBody, guarded, json, clientIp } from './_lib.js';

export default async function handler(req, res) {
  return guarded(req, res, async () => {
    const store = blobStore();
    if (req.method === 'GET') { const sp = new URL(req.url, 'http://x').searchParams; if (sp.get('av')) return blogAvatar(store, sp.get('av'), sp.get('s'), Date.now()); return blogGet(store, sp.get('slug'), sp.get('slugs'), Date.now()); }
    if (req.method === 'POST') return blogPost(store, await readBody(req, 30000), Date.now(), clientIp(req));
    return json(405, { error: 'method' });
  });
}
