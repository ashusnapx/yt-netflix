// Data layer: fetch YouTube pages with the user's cookies and normalise their ytInitialData
// into plain video/shelf/channel objects. Also the client side of the MAIN-world bridge.

const text = x => x == null ? '' : typeof x === 'string' ? x
  : x.simpleText ?? x.content ?? x.runs?.map(r => r.text).join('') ?? '';

const isId = id => typeof id === 'string' && /^[\w-]{11}$/.test(id);

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  for (const k in node) {
    const v = node[k];
    if (v && typeof v === 'object' && !visit(k, v)) walk(v, visit);
  }
}

function find(node, key) {
  let hit;
  walk(node, (k, v) => { if (hit !== undefined) return true; if (k === key) { hit = v; return true; } return false; });
  return hit;
}

// "1.2M views" -> 1200000, "1,234 views" -> 1234
function parseCount(s) {
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  return parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase()] ?? 1);
}

// "1:02:03" -> 3723
const parseDuration = s => String(s || '').split(':').reduce((t, p) => t * 60 + (+p || 0), 0);

// Netflix-style runtime: "1h 52m" / "18m" / "45s"
function runtime(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${sec}s`;
}

const isRecent = age => /(\d+ (seconds?|minutes?|hours?)|\b[1-6] days?) ago/.test(age || '');

const thumb = (id, q = 'hqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;

function fromRenderer(v) {
  if (!isId(v.videoId) || v.navigationEndpoint?.reelWatchEndpoint) return null;
  const owner = v.ownerText ?? v.shortBylineText ?? v.longBylineText;
  const be = owner?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
  const overlays = v.thumbnailOverlays ?? [];
  const time = overlays.find(o => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer;
  const views = text(v.viewCountText) || text(v.shortViewCountText);
  return {
    id: v.videoId,
    title: text(v.title),
    channel: text(owner),
    channelId: be?.browseId ?? '',
    channelUrl: be?.canonicalBaseUrl ?? (be?.browseId ? `/channel/${be.browseId}` : ''),
    avatar: (v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail ?? v.channelThumbnail)?.thumbnails?.[0]?.url ?? '',
    views: text(v.shortViewCountText) || views,
    viewCount: parseCount(views),
    age: text(v.publishedTimeText),
    duration: text(v.lengthText) || text(time?.text),
    live: time?.style === 'LIVE' || !!v.badges?.some(b => b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_LIVE_NOW'),
    progress: overlays.find(o => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched ?? 0,
    desc: text(v.descriptionSnippet) || text(v.detailedMetadataSnippets?.[0]?.snippetText),
    list: v.navigationEndpoint?.watchEndpoint?.playlistId ?? '',
  };
}

function fromLockup(v) {
  if (v.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !isId(v.contentId)) return null;
  const meta = v.metadata?.lockupMetadataViewModel ?? {};
  const rows = find(meta, 'metadataRows') ?? [];
  const parts = rows.flatMap(r => (r.metadataParts ?? []).map(p => text(p.text)));
  const badges = [];
  let progress = 0;
  walk(v.contentImage, (k, x) => {
    if (k === 'thumbnailBadgeViewModel') badges.push(x);
    if (k === 'thumbnailOverlayProgressBarViewModel') progress = x.startPercent ?? 0;
    return false;
  });
  const duration = badges.map(b => b.text).find(t => /^\d+(:\d\d)+$/.test(t)) ?? '';
  const views = parts.find(p => /view|watching/i.test(p)) ?? '';
  const channelPart = rows[0]?.metadataParts?.[0];
  const be = find(channelPart, 'browseEndpoint') ?? find(meta.image, 'browseEndpoint');
  return {
    id: v.contentId,
    title: text(meta.title),
    channel: text(channelPart?.text),
    channelId: be?.browseId ?? '',
    channelUrl: be?.canonicalBaseUrl ?? (be?.browseId ? `/channel/${be.browseId}` : ''),
    avatar: find(meta.image, 'sources')?.[0]?.url ?? '',
    views, viewCount: parseCount(views),
    age: parts.find(p => /ago|Streamed|Premiered/i.test(p)) ?? '',
    duration,
    live: badges.some(b => /live/i.test(b.text ?? '') || /LIVE/.test(b.badgeStyle ?? '')),
    progress,
    desc: '',
    list: find(v.rendererContext, 'watchEndpoint')?.playlistId ?? '',
  };
}

const VIDEO_KEYS = new Set(['videoRenderer', 'gridVideoRenderer', 'compactVideoRenderer', 'playlistVideoRenderer',
  'playlistPanelVideoRenderer', 'videoWithContextRenderer', 'endScreenVideoRenderer']);
// Shorts, ads, mixes and playlists have no place on a Netflix shelf.
const SKIP_KEYS = new Set(['reelShelfRenderer', 'reelItemRenderer', 'shortsLockupViewModel', 'adSlotRenderer',
  'promotedSparklesWebRenderer', 'searchPyvRenderer', 'inFeedAdLayoutRenderer', 'radioRenderer', 'compactRadioRenderer',
  'playlistRenderer', 'compactPlaylistRenderer', 'gridPlaylistRenderer', 'channelRenderer', 'feedNudgeRenderer']);

function videos(node) {
  const out = [], seen = new Set();
  walk(node, (k, v) => {
    if (SKIP_KEYS.has(k)) return true;
    let vid;
    if (VIDEO_KEYS.has(k)) vid = fromRenderer(v);
    else if (k === 'lockupViewModel') vid = fromLockup(v);
    else return false;
    if (vid?.title && !seen.has(vid.id)) { seen.add(vid.id); out.push(vid); }
    return true;
  });
  return out;
}

function shelves(node) {
  const out = [];
  walk(node, (k, v) => {
    if (k !== 'shelfRenderer' && k !== 'richShelfRenderer') return SKIP_KEYS.has(k);
    const title = text(v.title) || text(find(v.header, 'title'));
    const vids = videos(v.content ?? v.contents);
    if (title && vids.length >= 3) out.push({ title, videos: vids });
    return true;
  });
  return out;
}

function channels(node) {
  const out = [];
  walk(node, (k, v) => {
    if (k !== 'channelRenderer') return false;
    out.push({ title: text(v.title), url: v.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? `/channel/${v.channelId}`, id: v.channelId });
    return true;
  });
  return out;
}

// Playlist lockups on a channel page, e.g. channels that only publish via playlists.
function playlists(node) {
  const out = [];
  walk(node, (k, v) => {
    if (k !== 'lockupViewModel') return false;
    if (v.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' && v.contentId) out.push({ id: v.contentId, title: text(v.metadata?.lockupMetadataViewModel?.title) });
    return true;
  });
  return out;
}

function channelInfo(data) {
  const md = data?.metadata?.channelMetadataRenderer ?? {};
  let subs = '';
  walk(data?.header, (k, v) => {
    const t = v.content ?? v.simpleText; // walk only visits objects
    if (!subs && typeof t === 'string' && /subscriber/i.test(t)) subs = t;
    return !!subs;
  });
  const banner = find(data?.header, 'imageBannerViewModel')?.image?.sources?.at(-1)?.url
    ?? data?.header?.c4TabbedHeaderRenderer?.banner?.thumbnails?.at(-1)?.url ?? '';
  return { id: md.externalId ?? '', title: md.title ?? '', desc: md.description ?? '', avatar: md.avatar?.thumbnails?.[0]?.url ?? '', url: md.vanityChannelUrl ?? '', banner, subs };
}

function watchDetails(page, id) {
  const vd = page.player?.videoDetails ?? {};
  const mf = page.player?.microformat?.playerMicroformatRenderer ?? {};
  const playlist = find(page.data, 'playlist')?.playlist;
  return {
    id: vd.videoId ?? id,
    title: vd.title ?? '',
    channel: vd.author ?? '',
    channelId: vd.channelId ?? '',
    desc: vd.shortDescription ?? '',
    length: +vd.lengthSeconds || 0,
    views: +vd.viewCount || 0,
    keywords: vd.keywords ?? [],
    category: mf.category ?? '',
    date: mf.publishDate ?? '',
    live: !!vd.isLiveContent,
    related: videos(find(page.data, 'secondaryResults')).filter(v => v.id !== id),
    playlist: playlist ? { title: text(playlist.title), videos: videos(playlist.contents) } : null,
  };
}

// ---------- fetching ----------

function extractJson(html, name) {
  const m = html.match(new RegExp(`(?:var\\s+${name}|window\\["${name}"\\])\\s*=\\s*`));
  if (!m) return null;
  let i = m.index + m[0].length;
  if (html[i] !== '{') return null;
  // Brace-match, skipping over string literals.
  let depth = 0, inStr = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(i, j + 1)); } catch { return null; }
    }
  }
  return null;
}

const pageCache = new Map();
function fetchPage(url, ttl = 10 * 60e3) {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fetch(url, { credentials: 'include', headers: { accept: 'text/html' } })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.text(); })
    .then(html => ({ data: extractJson(html, 'ytInitialData'), player: extractJson(html, 'ytInitialPlayerResponse') }));
  p.catch(() => pageCache.delete(url));
  pageCache.set(url, { t: Date.now(), p });
  return p;
}

const pageVideos = url => fetchPage(url).then(p => videos(p.data));
const details = id => fetchPage(`/watch?v=${id}`).then(p => watchDetails(p, id));

// Search filters (protobuf "sp" params): videos only / this week sorted by views.
const SP_VIDEOS = 'EgIQAQ%3D%3D';
const SP_WEEK_POPULAR = 'CAMSBAgDEAE%3D';
const searchUrl = (q, sp = SP_VIDEOS) => `/results?search_query=${encodeURIComponent(q)}&sp=${sp}`;

// ---------- bridge client ----------

let bridgeSeq = 0;
const bridgeWaiters = new Map();
window.addEventListener('message', e => {
  if (e.source !== window || e.data?.ytnfRes === undefined) return;
  const w = bridgeWaiters.get(e.data.ytnfRes);
  if (!w) return;
  bridgeWaiters.delete(e.data.ytnfRes);
  e.data.ok ? w.resolve(e.data.data) : w.reject(new Error(e.data.data));
});

function bridge(type, payload = {}, timeout = 15000) {
  const id = `ytnf${++bridgeSeq}`;
  return new Promise((resolve, reject) => {
    bridgeWaiters.set(id, { resolve, reject });
    window.postMessage({ ...payload, ytnf: type, id }, location.origin);
    setTimeout(() => { if (bridgeWaiters.delete(id)) reject(new Error(`bridge ${type} timeout`)); }, timeout);
  });
}

const signedIn = () => /(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=/.test(document.cookie);
