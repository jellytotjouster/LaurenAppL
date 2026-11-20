import { blobStore, webFeed, guarded } from './_lib.js';
import { SITE, SLUG_RE, mergePosts, findPost, shareHtml } from './_share.js';

/* /p/<post>: the link the Share buttons hand out. Apps read the post's own title, line and picture from it; a person is sent straight on to the post. */
export default async function handler(req, res) {
  return guarded(req, res, async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return { status: 405, type: 'text/plain; charset=utf-8', body: 'method' };
    const slug = String(new URL(req.url, 'http://x').searchParams.get('slug') || '').toLowerCase();
    const onward = to => ({ status: 302, type: 'text/plain; charset=utf-8', body: '', headers: { Location: to, 'Cache-Control': 'public, max-age=0, s-maxage=60' } });
    if (!SLUG_RE.test(slug)) return onward('/#blog');
    let statics = [], feed = null;
    try { const r = await fetch(SITE + '/blog/posts.json'); if (r.ok) statics = (await r.json()).posts || []; } catch (e) { /* the page will still open the post by itself */ }
    try { feed = JSON.parse((await webFeed(blobStore(), Date.now())).body); } catch (e) { /* the posts written at /write are only missing from the preview, not from the page */ }
    const post = findPost(mergePosts(statics, feed, Date.now()), slug);
    if (!post) return onward('/#blog/' + slug);
    return { status: 200, type: 'text/html; charset=utf-8', body: shareHtml(post), headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600' } };
  });
}
