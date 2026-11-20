/* What WhatsApp, Facebook, Messenger, X and the rest read when a blog post is shared: that post's own title, a line from it and its picture.
   The page itself is one file with the posts inside it, so a link ending in #blog/... would always show the front-page card. The Share buttons use /p/<post> instead:
   it answers with the post's details for the apps, and sends a person straight on to the post. */
export const SITE = 'https://laurenappl.com';
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const DEFAULT_IMAGE = SITE + '/media/site/og-blog.jpg';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* the same posts the blog shows: the ones published from the Blog Lab, plus the ones written at /write (those win by id, and can hide one); no drafts, nothing due later */
export function mergePosts(statics, feed, now = Date.now()) {
  let list = Array.isArray(statics) ? statics.filter(Boolean) : [];
  if (feed && Array.isArray(feed.posts)) {
    const gone = new Set((Array.isArray(feed.deleted) ? feed.deleted : []).map(String));
    const mine = new Set(feed.posts.filter(Boolean).map(p => String(p.id)));
    list = list.filter(p => !gone.has(String(p.id)) && !mine.has(String(p.id))).concat(feed.posts.filter(Boolean));
  }
  return list.filter(p => p && !p.draft && p.title && p.slug && !(p.publishAt && Date.parse(p.publishAt) > now));
}
export const findPost = (posts, slug) => posts.find(p => String(p.slug) === slug) || null;

/* a line or two of the post in plain words: its own excerpt if it has one, otherwise the start of the writing with the formatting marks taken out */
export function plainLine(p, max = 200) {
  let t = String(p.excerpt || '').trim() || String(p.body || '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_>#~]/g, '').replace(/^\s*[-+]\s+/gm, '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, '') + '…';
}

/* the post's own picture if it has one on this website; otherwise the Lozza's Logic card (a picture embedded in the post itself is too big for a link card) */
export function pickImage(p) {
  const c = String(p.cover || '').trim();
  if (/^https:\/\/[^\s"<>]+$/i.test(c)) return c;
  if (/^\/?media\/[A-Za-z0-9._\/~-]+$/.test(c)) return SITE + '/' + c.replace(/^\//, '');
  return DEFAULT_IMAGE;
}

export function shareHtml(p) {
  const slug = String(p.slug), url = SITE + '/p/' + slug, to = '/#blog/' + slug;
  const title = String(p.title) + ' | Lozza’s Logic', desc = plainLine(p) || 'A post on Lozza’s Logic, the LaurenAppL blog.';
  const img = pickImage(p), alt = String(p.coverAlt || '').trim() || (img === DEFAULT_IMAGE ? 'Lozza’s Logic: a blog, by LaurenAppL' : String(p.title));
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(p.date || '')) ? String(p.date).slice(0, 10) : '';
  return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title><meta name="robots" content="noindex,follow"><meta name="description" content="' + esc(desc) + '">' +
    '<meta property="og:type" content="article"><meta property="og:site_name" content="LaurenAppL"><meta property="og:title" content="' + esc(title) + '">' +
    '<meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="' + esc(url) + '"><meta property="og:image" content="' + esc(img) + '"><meta property="og:image:alt" content="' + esc(alt) + '">' +
    (date ? '<meta property="article:published_time" content="' + esc(date) + '">' : '') +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:description" content="' + esc(desc) + '"><meta name="twitter:image" content="' + esc(img) + '">' +
    '<meta http-equiv="refresh" content="0;url=' + esc(to) + '"></head><body style="font-family:system-ui,sans-serif;padding:24px"><p><a href="' + esc(to) + '">Read “' + esc(p.title) + '” on LaurenAppL</a></p>' +
    '<script>location.replace(' + JSON.stringify(to) + ');</script></body></html>';
}
