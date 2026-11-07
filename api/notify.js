import { blobStore, notifyPost, readBody, clientIp, guarded, json } from './_lib.js';

export default async function handler(req, res) {
  return guarded(req, res, async () => {
    if (req.method !== 'POST') return json(405, { error: 'method' });
    return notifyPost(blobStore(), await readBody(req), clientIp(req));
  });
}
