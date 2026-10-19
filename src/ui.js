// Netflix UI: header, billboard, sliding rows, hover previews, detail modal, grid pages, profile gate.

const S = {
  settings: { previews: true, profileGate: true },
  account: null,
  wl: new Set(), liked: new Set(), top10: new Set(),
  muted: true,
};
const VID = new Map(); // every video we have shown, by id

// Keep the richest known fields when the same video arrives from several feeds.
function remember(vs) {
  for (const v of vs) {
    const o = VID.get(v.id) ?? {};
    for (const k in v) if (v[k] || !(k in o)) o[k] = v[k];
    VID.set(v.id, o);
  }
  return vs;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let TT = null;
try { TT = window.trustedTypes?.createPolicy?.('ytnf', { createHTML: s => s }) ?? null; } catch { /* policy name refused: plain strings */ }
const setHTML = (node, s) => { node.innerHTML = TT ? TT.createHTML(s) : s; return node; };
const el = s => setHTML(document.createElement('template'), s.trim()).content.firstElementChild;
const ic = name => `<span class="ic">${ICON[name]}</span>`;

const watchUrl = v => `/watch?v=${v.id}${v.list ? `&list=${encodeURIComponent(v.list)}` : ''}`;
const perPage = () => { const w = innerWidth; return w >= 1400 ? 6 : w >= 1100 ? 5 : w >= 800 ? 4 : w >= 500 ? 3 : 2; };

let app; // .app element inside our shadow root
function toast(msg) {
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`);
  app.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- cards ----------

function card(v, { rank = false } = {}) {
  const badge = v.live ? '<span class="live">LIVE</span>'
    : isRecent(v.age) ? '<span class="badge">Recently Added</span>' : '';
  return `<a class="card" href="${esc(watchUrl(v))}" data-card="${v.id}" aria-label="${esc(v.title)}">
    <img loading="lazy" src="${thumb(v.id, 'hq720')}" alt="">
    ${!rank && S.top10.has(v.id) ? '<span class="top10">TOP<b>10</b></span>' : ''}${badge}
  </a>`;
}

const progressBar = p => `<div class="prog" aria-hidden="true"><i style="width:${Math.max(2, Math.min(100, p))}%"></i></div>`;
const cell = (v, withProgress) => `<div class="cell">${card(v)}${withProgress && v.progress ? progressBar(v.progress) : ''}</div>`;

function rankNumber(n) {
  const fit = n === 10 ? 'textLength="96" lengthAdjust="spacingAndGlyphs"' : '';
  return `<svg viewBox="0 0 100 154" preserveAspectRatio="xMaxYMid meet"><text x="100" y="140" text-anchor="end" font-size="190"
    font-weight="900" fill="#141414" stroke="#595959" stroke-width="4" font-family="Arial Black,Helvetica,Arial,sans-serif" ${fit}>${n}</text></svg>`;
}
const rankCell = (v, i) => `<div class="rank"><div class="num">${rankNumber(i + 1)}</div>${card(v, { rank: true })}</div>`;

function metaLine(v, length = parseDuration(v.duration)) {
  const lead = v.live ? '<span class="green">Live Now</span>'
    : isRecent(v.age) ? '<span class="green">New</span>'
    : v.views ? `<span class="green">${esc(v.views.replace(/ views?$/, ''))} views</span>` : '';
  return `${lead}${length ? `<span class="box">${runtime(length)}</span>` : ''}<span class="hd">HD</span>`;
}

const channelLink = v => v.channel
  ? `<a href="${esc(v.channelUrl || `/channel/${v.channelId}`)}" data-browse="${esc(v.channelId)}">${esc(v.channel)}</a>` : '';

const listBtn = (id, cls = '') => S.wl.has(id)
  ? `<button class="circle ${cls}" data-act="list" data-id="${id}" data-tip="Remove from My List">${ic('check')}</button>`
  : `<button class="circle ${cls}" data-act="list" data-id="${id}" data-tip="Add to My List">${ic('plus')}</button>`;
const likeBtn = (id, cls = '') =>
  `<button class="circle ${cls}" data-act="like" data-id="${id}" data-tip="${S.liked.has(id) ? 'Rated' : 'I like this'}">${ic(S.liked.has(id) ? 'thumbOn' : 'thumb')}</button>`;
const muteIcon = () => ic(S.muted ? 'volOff' : 'volHigh');

function refreshButtons(id) {
  app.querySelectorAll(`[data-act=list][data-id="${id}"]`).forEach(b => b.replaceWith(el(listBtn(id, b.classList.contains('small') ? 'small' : ''))));
  app.querySelectorAll(`[data-act=like][data-id="${id}"]`).forEach(b => b.replaceWith(el(likeBtn(id, b.classList.contains('small') ? 'small' : ''))));
}

// ---------- inline previews (privacy-enhanced embeds, never touch watch history) ----------
// YouTube rejects embeds hosted on youtube.com (error 152), so previews go through preview.html,
// an extension page that frames the youtube-nocookie embed and relays its postMessage API.

const EMBED_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;
const embeds = new Map(); // contentWindow -> { media, onEnd }
const cmd = (frame, func, args = []) => frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), EMBED_ORIGIN);

window.addEventListener('message', e => {
  if (e.origin !== EMBED_ORIGIN) return;
  const hit = embeds.get(e.source);
  if (!hit) return;
  let d;
  try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  const st = d?.event === 'onStateChange' ? d.info : d?.info?.playerState;
  // Reveal a beat after playback starts, once the embed's own title/bezel overlay has faded.
  if (st === 1 && !hit.revealT) hit.revealT = setTimeout(() => hit.media.classList.add('playing'), 3800);
  if (st === 0) { clearTimeout(hit.revealT); hit.revealT = 0; hit.media.classList.remove('playing'); hit.onEnd?.(); }
});

function startPreview(media, id, start = 0, { delay = 900, onEnd } = {}) {
  if (!S.settings.previews) return null;
  const frame = document.createElement('iframe');
  frame.allow = 'autoplay; encrypted-media';
  frame.tabIndex = -1;
  frame.title = 'Preview';
  const q = new URLSearchParams({ v: id, mute: S.muted ? 1 : 0, start: Math.floor(start) });
  const timer = setTimeout(() => {
    if (!media.isConnected) return;
    frame.src = `${chrome.runtime.getURL('preview.html')}?${q}`;
    media.prepend(frame);
    embeds.set(frame.contentWindow, { media, onEnd });
  }, delay);
  return { frame, stop() { clearTimeout(timer); clearTimeout(embeds.get(frame.contentWindow)?.revealT); embeds.delete(frame.contentWindow); frame.remove(); media.classList.remove('playing'); } };
}

function setMuted(m) {
  S.muted = m;
  app.querySelectorAll('iframe').forEach(f => cmd(f, m ? 'mute' : 'unMute'));
  app.querySelectorAll('[data-act=mute]').forEach(b => setHTML(b, muteIcon()));
}

// ---------- hover preview ----------

let pv = null, pvTimer = 0, pvCard = null;

function closePreview(instant = false) {
  clearTimeout(pvTimer);
  pvCard = null;
  if (!pv) return;
  const { node, preview, from } = pv;
  pv = null;
  preview?.stop();
  Hero.resume();
  if (instant || !from.isConnected) return node.remove();
  node.style.transform = node.dataset.from;
  node.style.opacity = '0';
  setTimeout(() => node.remove(), 300);
}

function openPreview(cardEl) {
  const v = VID.get(cardEl.dataset.card);
  if (!v || !cardEl.isConnected) return;
  closePreview(true);
  const anchor = cardEl.closest('.rank') ?? cardEl;
  const r = anchor.getBoundingClientRect(), base = app.getBoundingClientRect();
  const w = Math.max(r.width * 1.5, 300), h = w * 9 / 16, pad = innerWidth * 0.04;
  const left = Math.max(pad * 0.5, Math.min(r.left + r.width / 2 - w / 2, innerWidth - pad * 0.5 - w));
  const top = r.top + r.height / 2 - h / 2;
  const length = parseDuration(v.duration);
  const watched = v.progress ? `<div class="progline">${progressBar(v.progress)}<span>${Math.round(length * v.progress / 6000)} of ${runtime(length)}</span></div>` : '';
  const node = el(`<div class="pv" style="left:${left - base.left}px;top:${top - base.top}px;width:${w}px">
    <div class="media" data-act="play" data-id="${v.id}">
      <img src="${thumb(v.id, 'hq720')}" alt="">
      <div class="ttl">${esc(v.title)}</div>
      <button class="circle mute" data-act="mute" aria-label="Toggle sound">${muteIcon()}</button>
    </div>
    <div class="body">
      <div class="ctrls">
        <button class="circle solid" data-act="play" data-id="${v.id}" data-tip="Play">${ic('play')}</button>
        ${listBtn(v.id)}${likeBtn(v.id)}
        <span class="grow"></span>
        <button class="circle" data-act="info" data-id="${v.id}" data-tip="Episodes &amp; info">${ic('chevronDown')}</button>
      </div>
      <div class="meta">${metaLine(v, length)}</div>
      <div class="tags">${v.channel ? `<span>${channelLink(v)}</span>` : ''}${v.age ? `<span>${esc(v.age)}</span>` : ''}</div>
      ${watched}
    </div>
  </div>`);
  const from = `translate(${r.left - left}px, ${r.top - top - (r.height * 1.5 - r.height) / 3}px) scale(${r.width / w})`;
  node.dataset.from = from;
  node.style.transformOrigin = '0 0';
  node.style.transform = from;
  app.append(node);
  node.getBoundingClientRect();
  node.style.transform = 'none';
  node.addEventListener('mouseleave', e => { if (!pvCard?.contains(e.relatedTarget)) closePreview(); });
  const start = v.progress ? length * v.progress / 100 : length > 180 ? length * 0.2 : 0;
  pv = { node, from: cardEl, preview: startPreview(node.querySelector('.media'), v.id, start, { delay: 300 }) };
  if (pv.preview) Hero.pause();
}

function bindHover(root) {
  root.addEventListener('mouseover', e => {
    if (pv?.node.contains(e.target)) return;
    const c = e.target.closest('[data-card]');
    if (c === pvCard) return;
    clearTimeout(pvTimer);
    pvCard = c;
    if (c) pvTimer = setTimeout(() => openPreview(c), 480);
    else if (pv && !pv.node.contains(e.target)) closePreview();
  });
  root.addEventListener('mouseleave', () => closePreview());
}

// ---------- rows ----------

const rowIO = new IntersectionObserver(entries => {
  for (const en of entries) if (en.isIntersecting) { rowIO.unobserve(en.target); en.target._fill(); }
}, { rootMargin: '600px 0px' });

function rowShell(def) {
  const node = el(`<section class="row">
    <h2 class="row-h"><a ${def.href ? `href="${esc(def.href)}"` : ''}><span class="t">${esc(def.title)}</span>${def.href ? `<span class="explore">Explore All${ic('chevronRight')}</span>` : ''}</a><div class="pager"></div></h2>
    <div class="slider">
      <button class="arrow l" data-act="page" data-dir="-1" aria-label="Previous" disabled>${ic('chevronLeft')}</button>
      <div class="track">${'<div><div class="skel"></div></div>'.repeat(perPage())}</div>
      <button class="arrow r" data-act="page" data-dir="1" aria-label="Next" disabled>${ic('chevronRight')}</button>
    </div>
  </section>`);
  node._page = 0;
  node._count = 0;
  node._fill = () => fillRow(node, def);
  rowIO.observe(node);
  return node;
}

async function fillRow(node, def) {
  try {
    const res = await def.load();
    let { title = def.title, videos: vids = res } = Array.isArray(res) ? {} : res;
    vids = remember(vids ?? []).slice(0, def.kind === 'top10' ? 10 : 40);
    if (vids.length < (def.min ?? 4)) return dropRow(node);
    if (def.kind === 'top10') vids.forEach(v => S.top10.add(v.id));
    node.querySelector('.t').textContent = title;
    setHTML(node.querySelector('.track'), vids.map((v, i) => def.kind === 'top10' ? rankCell(v, i) : cell(v, def.kind === 'progress')).join(''));
    node._count = vids.length;
    layoutRow(node);
  } catch (err) {
    console.warn('[YouFlix] row failed:', def.title, err);
    dropRow(node);
  }
}

const EMPTY_ROWS = `<div class="page"><p class="empty"><b>Nothing to show here yet.</b>Sign in to YouTube to see your personalised rows.</p></div>`;
function dropRow(node) {
  const list = node.parentElement;
  node.remove();
  if (list && !list.querySelector('.row')) setHTML(list, EMPTY_ROWS);
}

function layoutRow(node, dir = 0) {
  const per = perPage(), pages = Math.max(1, Math.ceil(node._count / per));
  node._page = Math.max(0, Math.min(pages - 1, node._page + dir));
  const shift = Math.min(node._page * per, Math.max(0, node._count - per));
  node.querySelector('.track').style.transform = `translateX(${-shift * 100 / per}%)`;
  node.querySelector('.arrow.l').disabled = node._page === 0;
  node.querySelector('.arrow.r').disabled = node._page >= pages - 1;
  setHTML(node.querySelector('.pager'), pages > 1 ? Array.from({ length: pages }, (_, i) => `<i class="${i === node._page ? 'on' : ''}"></i>`).join('') : '');
}

// ---------- billboard hero ----------

const Hero = (() => {
  let cur = null; // { node, media, preview, v, holds }
  const io = new IntersectionObserver(([en]) => { if (cur) { cur.visible = en.intersectionRatio > 0.35; sync(); } }, { threshold: [0, 0.35, 1] });
  let holds = 0;
  function sync() {
    const f = cur?.preview?.frame;
    if (f) cmd(f, cur.visible && !holds ? 'playVideo' : 'pauseVideo');
  }
  function play() {
    if (!cur) return;
    cur.preview?.stop();
    const v = cur.v, length = parseDuration(v.duration) || cur.length || 0;
    cur.node.classList.remove('ended');
    cur.preview = startPreview(cur.media, v.id, length > 240 ? length * 0.15 : 0, {
      delay: 1500,
      onEnd: () => { cur.node.classList.add('ended'); cur.node.classList.remove('playing'); cur.preview?.stop(); setHTML(cur.node.querySelector('.mute'), ic('replay')); },
    });
  }
  return {
    async mount(node, pick) {
      let h;
      try { h = await pick; } catch (err) { console.warn('[YouFlix] hero failed', err); }
      if (!h?.video || !node.isConnected) return node.remove();
      const v = remember([h.video])[0];
      const hero = el(`<div class="hero">
        <div class="media"><img src="${thumb(v.id, 'maxresdefault')}" alt=""></div>
        <div class="vignette"></div><div class="fade"></div>
        <div class="info">
          <div class="kicker"><b>Y</b>${esc(h.kicker ?? v.channel ?? '')}</div>
          <h1 class="title">${esc(h.title ?? v.title)}</h1>
          <p class="desc">${esc(h.desc ?? v.desc ?? '')}</p>
          <div class="btns">
            <button class="btn white" data-act="play" data-id="${v.id}">${ic('play')}Play</button>
            <button class="btn gray" data-act="info" data-id="${v.id}">${ic('info')}More Info</button>
          </div>
        </div>
        <div class="side"><button class="circle mute" data-act="mute" aria-label="Toggle sound">${muteIcon()}</button>${h.rating ? `<span class="rating">${esc(h.rating)}</span>` : ''}</div>
      </div>`);
      node.replaceWith(hero);
      cur?.preview?.stop();
      cur = { node: hero, media: hero.querySelector('.media'), v, visible: true };
      new MutationObserver(() => hero.classList.toggle('playing', cur?.media.classList.contains('playing') ?? false))
        .observe(cur.media, { attributes: true, attributeFilter: ['class'] });
      io.disconnect();
      io.observe(hero);
      play();
      details(v.id).then(d => {
        if (!h.desc) hero.querySelector('.desc').textContent = d.desc.split('\n').find(l => l.trim().length > 40) ?? d.desc;
        if (!h.rating && d.category) hero.querySelector('.side').insertAdjacentHTML('beforeend', `<span class="rating">${esc(d.category)}</span>`);
        if (d.length && cur?.v.id === v.id) cur.length = d.length;
      }).catch(() => {});
    },
    replay() { if (cur?.node.classList.contains('ended')) { play(); setHTML(cur.node.querySelector('.mute'), muteIcon()); return true; } return false; },
    pause() { holds++; sync(); },
    resume() { holds = Math.max(0, holds - 1); sync(); },
    stop() { cur?.preview?.stop(); cur = null; holds = 0; io.disconnect(); },
  };
})();

// ---------- views ----------

function rowsView({ hero, rows }) {
  const view = el(`<main class="view"><div class="hero-slot hero"></div><div class="rows"></div></main>`);
  const slot = view.querySelector('.hero-slot'), list = view.querySelector('.rows');
  if (hero) Hero.mount(slot, hero); else { slot.remove(); view.classList.add('no-hero'); }
  Promise.resolve(rows).then(defs => {
    for (const d of defs) list.append(rowShell(d));
    if (!list.children.length) setHTML(list, EMPTY_ROWS);
  }).catch(err => console.warn('[YouFlix] rows failed', err));
  return view;
}

const GENRES = [
  ['Trending Music Videos', 'official music video'], ['Gaming', 'gaming'], ['Stand-Up Comedy', 'stand up comedy'],
  ['Documentaries', 'documentary'], ['Movie Trailers', 'official trailer'], ['Science & Technology', 'science explained'],
  ['Sports Highlights', 'sports highlights'], ['Food & Cooking', 'cooking recipe'], ['Travel & Adventure', 'travel vlog'], ['News', 'news today'],
].map(([title, q]) => ({ title, href: searchUrl(q), load: () => pageVideos(searchUrl(q)) }));

const short = (s, n = 48) => s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
const signedInOr = (fn, fallback = []) => () => signedIn() ? fn() : Promise.resolve(fallback);

function homeView() {
  const home = pageVideos('/').catch(() => []);
  const hist = signedIn() ? pageVideos('/feed/history').catch(() => []) : Promise.resolve([]);
  const pick = home.then(async vs => vs.find(v => !v.live) ?? (await GENRES[0].load())[0]).then(video => ({ video }));
  return rowsView({
    hero: pick,
    rows: [
      { title: `Continue Watching${S.account?.name ? ` for ${S.account.name}` : ''}`, kind: 'progress', href: '/feed/history', min: 1,
        load: () => hist.then(vs => vs.filter(v => v.progress > 2 && v.progress < 95)) },
      { title: 'Top Picks for You', load: () => Promise.all([home, pick]).then(([vs, h]) => vs.filter(v => v.id !== h.video.id)) },
      { title: 'Top 10 in Your Feed Today', kind: 'top10', min: 5,
        load: () => home.then(vs => vs.filter(v => !v.live && v.viewCount).sort((a, b) => b.viewCount - a.viewCount).slice(0, 10)) },
      { title: 'New from Your Subscriptions', href: '/feed/subscriptions', load: signedInOr(() => pageVideos('/feed/subscriptions')) },
      { title: 'My List', href: '/playlist?list=WL', min: 1, load: signedInOr(() => pageVideos('/playlist?list=WL')) },
      { title: 'Because You Watched', load: async () => {
        const seed = (await hist)[0];
        return seed ? { title: `Because You Watched ${short(seed.title)}`, videos: (await details(seed.id)).related } : [];
      } },
      { title: 'Watch It Again', href: '/feed/history', load: () => hist.then(vs => vs.filter(v => !v.progress || v.progress >= 95)) },
      { title: 'Liked Videos', href: '/playlist?list=LL', load: signedInOr(() => pageVideos('/playlist?list=LL')) },
      ...GENRES,
    ],
  });
}

function subsView() {
  if (!signedIn()) return signInPage('Subscriptions', 'Sign in to see new episodes from the channels you follow.');
  const subs = pageVideos('/feed/subscriptions');
  return rowsView({
    hero: subs.then(vs => ({ video: vs.find(v => !v.live) ?? vs[0], kicker: 'New Episode' })),
    rows: subs.then(vs => {
      const by = new Map();
      for (const v of vs) if (v.channel) by.set(v.channel, [...(by.get(v.channel) ?? []), v]);
      const groups = [...by.values()].filter(g => g.length >= 2).sort((a, b) => b.length - a.length);
      return [
        { title: 'Latest from Your Subscriptions', load: () => subs },
        { title: 'Live Now', min: 1, load: () => subs.then(all => all.filter(v => v.live)) },
        ...groups.map(g => ({ title: `More from ${g[0].channel}`, href: g[0].channelUrl, min: 2, load: () => Promise.resolve(g) })),
      ];
    }),
  });
}

function newPopularView() {
  const defs = [['Music', 'music'], ['Gaming', 'gaming'], ['News', 'news'], ['Sports', 'sports'], ['Comedy', 'comedy'],
    ['Tech', 'tech review'], ['Movie Trailers', 'trailer'], ['Podcasts', 'podcast'], ['Science', 'science']]
    .map(([t, q]) => ({ title: `Popular This Week in ${t}`, href: searchUrl(q, SP_WEEK_POPULAR), load: () => pageVideos(searchUrl(q, SP_WEEK_POPULAR)) }));
  const top = () => Promise.all(defs.slice(0, 4).map(d => d.load().catch(() => [])))
    .then(all => all.flat().filter(v => !v.live).sort((a, b) => b.viewCount - a.viewCount).slice(0, 10));
  return rowsView({
    hero: top().then(vs => ({ video: vs[0], kicker: '#1 This Week' })),
    rows: [{ title: 'Top 10 on YouTube This Week', kind: 'top10', min: 5, load: top }, ...defs],
  });
}

function channelView(u) {
  const base = u.pathname.match(/^\/(@[^/]+|channel\/[\w-]+|c\/[^/]+|user\/[^/]+)/)[0];
  const home = fetchPage(base);
  const latest = pageVideos(`${base}/videos`).catch(() => []);
  // Channels that only publish playlists get one "season" row per playlist.
  const seasons = Promise.all([home, fetchPage(`${base}/playlists`).catch(() => ({}))])
    .then(([h, p]) => [...new Map([...playlists(h.data), ...playlists(p.data)].map(x => [x.id, x])).values()].slice(0, 8));
  const firstSeason = seasons.then(s => s[0] ? pageVideos(`/playlist?list=${s[0].id}`).catch(() => []) : []);
  return rowsView({
    hero: Promise.all([home, latest]).then(async ([p, vs]) => {
      const c = channelInfo(p.data);
      const video = vs[0] ?? videos(p.data)[0] ?? (await firstSeason)[0];
      return { video, title: c.title, desc: c.desc, kicker: 'Channel', rating: c.subs };
    }),
    rows: Promise.all([home, seasons]).then(([p, ss]) => [
      { title: 'Latest Episodes', load: () => latest, min: 1 },
      ...shelves(p.data).map(s => ({ title: s.title, load: () => Promise.resolve(s.videos), min: 3 })),
      ...ss.map((s, i) => ({ title: s.title || `Season ${i + 1}`, href: `/playlist?list=${s.id}`, min: 2,
        load: () => i === 0 ? firstSeason : pageVideos(`/playlist?list=${s.id}`) })),
    ]),
  });
}

function signInPage(title, line) {
  const link = document.querySelector('a[href*="ServiceLogin"]')?.href
    ?? `https://accounts.google.com/ServiceLogin?service=youtube&continue=${encodeURIComponent(location.href)}`;
  return el(`<main class="view page"><h1>${esc(title)}</h1><div class="empty"><b>${esc(line)}</b><a class="btn-red" href="${esc(link)}">Sign In</a></div></main>`);
}

function gridView(kind, u) {
  const view = el(`<main class="view page"><div class="center-spin"><div class="spin"></div></div></main>`);
  const url = u.pathname + u.search;
  const q = u.searchParams.get('search_query') ?? '';
  const list = u.searchParams.get('list');
  const fixedTitle = { WL: 'My List', LL: 'Liked Videos' }[list] ?? (kind === 'history' ? 'Watch History' : '');
  if ((list === 'WL' || list === 'LL' || kind === 'history') && !signedIn()) return signInPage(fixedTitle, 'Sign in to YouTube to see this list.');
  fetchPage(url).then(p => {
    const vids = remember(videos(p.data));
    const title = fixedTitle || find(p.data, 'playlistMetadataRenderer')?.title || '';
    const related = kind === 'search' ? channels(p.data).slice(0, 8) : [];
    let head = title ? `<h1>${esc(title)}</h1>` : '';
    if (related.length) head += `<div class="related">Explore titles related to: ${related.map(c => `<a href="${esc(c.url)}" data-browse="${esc(c.id)}">${esc(c.title)}</a>`).join('')}</div>`;
    let body;
    if (vids.length) body = `<div class="grid">${vids.map(v => cell(v, true)).join('')}</div>`;
    else if (kind === 'search') body = `<div class="empty"><b>Your search for "${esc(q)}" did not have any matches.</b>Suggestions:<ul><li>Try different keywords</li><li>Looking for a channel? Try its name or @handle</li><li>Try a genre, like comedy, music, gaming or documentary</li></ul></div>`;
    else if (list === 'WL') body = `<div class="empty"><b>You haven't added any titles to your list yet.</b>Hover over any title and press + to save it here.</div>`;
    else body = '<div class="empty"><b>Nothing here yet.</b></div>';
    setHTML(view, head + body);
  }).catch(err => setHTML(view, `<div class="empty"><b>We're having trouble loading this page.</b>${esc(err.message)}</div>`));
  return view;
}

const VIEWS = {
  home: homeView, subs: subsView, newpop: newPopularView, channel: channelView,
  search: u => gridView('search', u), playlist: u => gridView('playlist', u), history: u => gridView('history', u),
};

// ---------- detail modal ----------

let modal = null;
function closeModal() {
  if (!modal) return false;
  modal.preview?.stop();
  modal.node.remove();
  modal = null;
  document.documentElement.classList.remove('ytnf-modal');
  Hero.resume();
  return true;
}

function openModal(id) {
  closePreview(true);
  closeModal();
  const v = VID.get(id) ?? { id, title: '' };
  const node = el(`<div class="modal-wrap" data-act="backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(v.title)}">
      <div class="media">
        <img src="${thumb(id, 'maxresdefault')}" alt="">
        <div class="over">
          <h2>${esc(v.title)}</h2>
          <div class="ctrls">
            <button class="btn white" data-act="play" data-id="${id}">${ic('play')}Play</button>
            ${listBtn(id)}${likeBtn(id)}
            <button class="circle mute" data-act="mute" aria-label="Toggle sound">${muteIcon()}</button>
          </div>
        </div>
      </div>
      <button class="circle close" data-act="close" aria-label="Close">${ic('close')}</button>
      <div class="content"><div class="center-spin" style="min-height:200px"><div class="spin"></div></div></div>
    </div>
  </div>`);
  app.append(node);
  document.documentElement.classList.add('ytnf-modal');
  Hero.pause();
  modal = { node, id };
  const length = parseDuration(v.duration);
  modal.preview = startPreview(node.querySelector('.media'), id, v.progress ? length * v.progress / 100 : length > 180 ? length * 0.2 : 0, { delay: 700 });
  node.querySelector('.modal').focus?.();

  details(id).then(async d => {
    if (modal?.id !== id) return;
    const full = remember([{ id, title: d.title, channel: d.channel, channelId: d.channelId, desc: d.desc }])[0];
    node.querySelector('h2').textContent = full.title;
    const date = d.date ? new Date(d.date) : null;
    const year = date && !isNaN(date) ? date.getFullYear() : '';
    const tags = d.keywords.slice(0, 6);
    const content = node.querySelector('.content');
    setHTML(content, `
      <div class="cols">
        <div>
          <div class="meta"><span class="green">${d.views.toLocaleString()} views</span>${year ? `<span>${year}</span>` : ''}${d.length ? `<span class="box">${runtime(d.length)}</span>` : ''}<span class="hd">HD</span></div>
          <p class="desc clamp">${esc(d.desc)}</p>
          ${d.desc.split('\n').length > 6 || d.desc.length > 420 ? '<button class="more" data-act="more">More</button>' : ''}
        </div>
        <div class="facts">
          <div><span class="label">Channel: </span>${channelLink(full)}</div>
          ${d.category ? `<div><span class="label">Genres: </span>${esc(d.category)}</div>` : ''}
          ${tags.length ? `<div><span class="label">This video is: </span>${esc(tags.join(', '))}</div>` : ''}
        </div>
      </div>
      <div class="eps"></div>
      ${d.related.length ? `<h3>More Like This</h3><div class="mlt">${remember(d.related).slice(0, 12).map(mltItem).join('')}</div>` : ''}
      <h3>About <b style="font-weight:400;margin-left:.3em">${esc(short(full.title, 60))}</b></h3>
      <div class="about">
        <div><span class="label">Channel: </span>${channelLink(full)}</div>
        ${date && !isNaN(date) ? `<div><span class="label">Released: </span>${date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>` : ''}
        <div><span class="label">Views: </span>${d.views.toLocaleString()}</div>
        ${d.category ? `<div><span class="label">Genres: </span>${esc(d.category)}</div>` : ''}
        ${d.length ? `<div><span class="label">Runtime: </span>${runtime(d.length)}</div>` : ''}
      </div>`);
    if (!d.channelId) return;
    const eps = remember(await pageVideos(`/channel/${d.channelId}/videos`).catch(() => [])).slice(0, 10);
    if (modal?.id !== id || !eps.length) return;
    setHTML(content.querySelector('.eps'), `<h3>Episodes <small>Latest from ${esc(d.channel)}</small></h3>
      <div>${eps.map((e, i) => `<div class="ep${e.id === id ? ' cur' : ''}" data-act="play" data-id="${e.id}">
        <div class="n">${i + 1}</div>
        <div class="th"><img loading="lazy" src="${thumb(e.id)}" alt=""><div class="circle play">${ic('play')}</div></div>
        <div class="tx"><div class="eprow"><span>${esc(e.title)}</span><span>${runtime(parseDuration(e.duration))}</span></div><p>${esc([e.age, e.views].filter(Boolean).join(' • '))}</p></div>
      </div>`).join('')}</div>`);
  }).catch(err => {
    if (modal?.id === id) setHTML(node.querySelector('.content'), `<p class="empty">Couldn't load details. ${esc(err.message)}</p>`);
  });
}

const mltItem = v => `<div class="it" data-act="play" data-id="${v.id}">
  <div class="th"><img loading="lazy" src="${thumb(v.id)}" alt="">${v.duration ? `<span class="dur">${runtime(parseDuration(v.duration))}</span>` : ''}<div class="circle play">${ic('play')}</div></div>
  <div class="bd"><div class="row1"><div class="meta">${metaLine(v).replace('<span class="hd">HD</span>', '')}</div>${listBtn(v.id, 'small')}</div>
  <p><b>${esc(v.title)}</b><br>${esc([v.channel, v.age].filter(Boolean).join(' • '))}</p></div>
</div>`;

// ---------- header ----------

const NAV = [['home', 'Home', '/'], ['subs', 'Subscriptions', '/feed/subscriptions'], ['newpop', 'New & Popular', '/#new-popular'], ['mylist', 'My List', '/playlist?list=WL']];

function headerEl() {
  const links = NAV.map(([k, label, href]) => `<a href="${href}" data-nav="${k}">${label}</a>`);
  const node = el(`<header class="hdr">
    <a href="/" aria-label="Home">${wordmark()}</a>
    <div class="browse" tabindex="0">Browse${ic('caret')}<div class="menu">${links.join('')}</div></div>
    <ul class="nav">${links.map(l => `<li>${l}</li>`).join('')}</ul>
    <div class="hdr-r">
      <form class="search" role="search">
        <button type="button" class="ic-btn" data-act="search" aria-label="Search">${ICON.search}</button>
        <input type="text" placeholder="Titles, people, genres" aria-label="Search" hidden>
        <button type="button" class="clear" data-act="clearSearch" aria-label="Clear search" hidden>${ICON.close}</button>
      </form>
      <div class="dd bell"><button class="trigger ic-btn" aria-label="Notifications">${ICON.bell}</button><div class="panel"></div></div>
      <div class="dd prof"><a class="trigger" href="/feed/you" aria-label="Account"><span class="avatar"></span><span class="caret">${ICON.caret}</span></a><div class="panel"></div></div>
    </div>
  </header>`);

  const form = node.querySelector('form'), input = form.querySelector('input'), clear = form.querySelector('.clear');
  let t = 0;
  const go = () => { const q = input.value.trim(); if (q) nav(`/results?search_query=${encodeURIComponent(q)}`); };
  input.addEventListener('input', () => { clear.hidden = !input.value; clearTimeout(t); t = setTimeout(go, 700); });
  form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(t); go(); });
  input.addEventListener('blur', () => { if (!input.value) setSearchOpen(false); });

  const bell = node.querySelector('.bell');
  bell.addEventListener('mouseenter', () => {
    if (bell._loaded || !signedIn()) return;
    bell._loaded = true;
    pageVideos('/feed/subscriptions').then(vs => setHTML(bell.querySelector('.panel'), remember(vs).slice(0, 8).map(v =>
      `<a class="notif" href="${esc(watchUrl(v))}"><img src="${thumb(v.id, 'mqdefault')}" alt=""><div><b>${isRecent(v.age) ? 'New Arrival' : 'New Episode'}</b><span>${esc(v.title)}</span><small>${esc(v.age)}</small></div></a>`).join('')))
      .catch(() => { bell._loaded = false; });
  });
  setHTML(bell.querySelector('.panel'), signedIn() ? '<div class="notif"><span>Loading…</span></div>' : '<div class="notif"><span>Sign in to get new-episode alerts.</span></div>');
  return node;
}

function setSearchOpen(open, value) {
  const form = app.querySelector('.search'), input = form.querySelector('input');
  form.classList.toggle('open', open);
  input.hidden = !open;
  if (value !== undefined) input.value = value;
  form.querySelector('.clear').hidden = !open || !input.value;
  if (open && value === undefined) input.focus();
}

function renderAccount() {
  const prof = app.querySelector('.prof');
  const a = S.account;
  prof.querySelector('.avatar').style.backgroundImage = a?.avatar ? `url("${encodeURI(a.avatar)}")` : '';
  const signIn = document.querySelector('a[href*="ServiceLogin"]')?.href
    ?? `https://accounts.google.com/ServiceLogin?service=youtube&continue=${encodeURIComponent('https://www.youtube.com/')}`;
  setHTML(prof.querySelector('.panel'), `
    ${a ? `<div class="who"><img src="${esc(a.avatar)}" alt=""><span>${esc(a.name)}</span></div>` : ''}
    ${a?.handle ? `<a href="/${esc(a.handle)}">${ic('info')}Your Channel</a>` : ''}
    <a href="/feed/history">${ic('replay')}Watch History</a>
    <a href="/playlist?list=LL">${ic('thumb')}Liked Videos</a>
    <a href="/feed/playlists">${ic('episodes')}Playlists</a>
    <a href="/account">${ic('speed')}Account</a>
    <a href="https://support.google.com/youtube" target="_blank" rel="noopener">${ic('subtitles')}Help Center</a>
    <button data-act="classic">${ic('back')}Switch to classic YouTube</button>
    <hr>
    ${signedIn() ? '<a class="signout" href="/logout">Sign out of YouTube</a>' : `<a class="signout" href="${esc(signIn)}">Sign In</a>`}`);
}

function setActiveNav(route, u) {
  const key = route === 'playlist' && u.searchParams.get('list') === 'WL' ? 'mylist' : route;
  app.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === key));
  if (route === 'search') setSearchOpen(true, u.searchParams.get('search_query') ?? '');
  else if (app.querySelector('.search input') !== app.getRootNode().activeElement) setSearchOpen(false, '');
}

// ---------- footer ----------

const footerEl = () => el(`<footer class="footer">
  <ul>${[['About', 'https://about.youtube/'], ['Press', 'https://blog.youtube/news-and-events/'], ['Copyright', 'https://www.youtube.com/howyoutubeworks/policies/copyright/'],
    ['Contact Us', 'https://www.youtube.com/t/contact_us/'], ['Creators', 'https://www.youtube.com/creators/'], ['Advertise', 'https://www.youtube.com/ads/'],
    ['Developers', 'https://developers.google.com/youtube'], ['Terms', 'https://www.youtube.com/t/terms'], ['Privacy', 'https://policies.google.com/privacy'],
    ['Policy & Safety', 'https://www.youtube.com/about/policies/'], ['How YouTube Works', 'https://www.youtube.com/howyoutubeworks/'], ['Help Center', 'https://support.google.com/youtube']]
    .map(([t, h]) => `<li><a href="${h}" target="_blank" rel="noopener">${t}</a></li>`).join('')}</ul>
  <button class="code" data-act="classic">Switch to classic YouTube</button><br>
  <small>YouFlix is an unofficial skin. Content © its creators, served by YouTube.</small>
</footer>`);

// ---------- profile gate ----------

// Netflix-style default profile face.
const SMILEY = `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="27" y="30" width="10" height="16" rx="2" fill="#fff"/><rect x="63" y="30" width="10" height="16" rx="2" fill="#fff"/>
  <path d="M24 62c14 14 38 14 52 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>`;

function showGate() {
  try { if (!S.settings.profileGate || sessionStorage.getItem('ytnf-gate')) return; } catch { return; }
  const a = S.account;
  const me = a
    ? `<div class="p" tabindex="0" data-act="enter"><div class="pic" style="background-color:#2b6cd4">${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : SMILEY}</div>${esc(a.name)}</div>`
    : `<div class="p" tabindex="0" data-act="enter"><div class="pic" style="background-color:#2b6cd4">${SMILEY}</div>Guest</div>`;
  const gate = el(`<div class="gate" role="dialog" aria-label="Who's watching?">
    ${wordmark()}
    <h1>Who's watching?</h1>
    <div class="profiles">
      ${me}
      <a class="p" href="https://www.youtubekids.com/"><div class="pic kids">kids</div>Kids</a>
      <a class="p" href="/channel_switcher"><div class="pic add">${ic('plus')}</div>Add Profile</a>
    </div>
    <a class="manage" href="/channel_switcher">MANAGE PROFILES</a>
  </div>`);
  app.append(gate);
  gate.querySelector('[data-act=enter]').focus();
}

function enterFromGate() {
  const gate = app.querySelector('.gate');
  if (!gate) return;
  try { sessionStorage.setItem('ytnf-gate', '1'); } catch { /* storage blocked: gate shows again next load */ }
  gate.classList.add('leaving');
  setTimeout(() => gate.remove(), 500);
}

// ---------- actions ----------

async function toggleList(id) {
  if (!signedIn()) return toast('Sign in to YouTube to use My List');
  const add = !S.wl.has(id);
  add ? S.wl.add(id) : S.wl.delete(id);
  refreshButtons(id);
  try {
    await bridge('watchLater', { videoId: id, add });
    pageCache.delete('/playlist?list=WL');
    toast(add ? 'Added to My List' : 'Removed from My List');
  } catch (err) {
    add ? S.wl.delete(id) : S.wl.add(id);
    refreshButtons(id);
    toast("Couldn't update My List");
    console.warn('[YouFlix] watchLater', err);
  }
}

async function toggleLike(id) {
  if (!signedIn()) return toast('Sign in to YouTube to rate titles');
  const like = !S.liked.has(id);
  like ? S.liked.add(id) : S.liked.delete(id);
  refreshButtons(id);
  try {
    await bridge('like', { videoId: id, like });
    pageCache.delete('/playlist?list=LL');
  } catch (err) {
    like ? S.liked.delete(id) : S.liked.add(id);
    refreshButtons(id);
    toast("Couldn't save your rating");
    console.warn('[YouFlix] like', err);
  }
}

const ACTIONS = {
  play: t => { const v = VID.get(t.dataset.id) ?? { id: t.dataset.id }; closePreview(true); closeModal(); nav(watchUrl(v)); },
  info: t => openModal(t.dataset.id),
  list: t => toggleList(t.dataset.id),
  like: t => toggleLike(t.dataset.id),
  mute: () => { if (!Hero.replay()) setMuted(!S.muted); },
  close: () => closeModal(),
  backdrop: (t, e) => { if (e.target === t) closeModal(); },
  more: t => { t.previousElementSibling.classList.remove('clamp'); t.remove(); },
  page: t => { closePreview(true); layoutRow(t.closest('.row'), +t.dataset.dir); },
  search: () => setSearchOpen(!app.querySelector('.search').classList.contains('open')),
  clearSearch: () => { setSearchOpen(true, ''); app.querySelector('.search input').focus(); },
  enter: () => enterFromGate(),
  classic: () => chrome.storage.sync.set({ enabled: false }),
};

function bindActions(root) {
  // Hi-res thumbnails don't exist for every video: missing ones 404 or return a 120px grey placeholder.
  const fallback = e => {
    const i = e.target;
    if (i.tagName === 'IMG' && /\/(hq720|maxresdefault)\.jpg/.test(i.src) && (e.type === 'error' || i.naturalWidth <= 120)) {
      i.src = i.src.replace(/(hq720|maxresdefault)\.jpg.*/, 'hqdefault.jpg');
    }
  };
  root.addEventListener('error', fallback, true);
  root.addEventListener('load', fallback, true);
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act], [data-card], a[href]');
    if (!t || !root.contains(t)) return;
    const modified = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    if (t.dataset.act) {
      if (t.dataset.act !== 'backdrop') e.preventDefault();
      ACTIONS[t.dataset.act]?.(t, e);
      return;
    }
    if (modified) return;
    if (t.dataset.card) { e.preventDefault(); openModal(t.dataset.card); return; }
    const href = t.getAttribute('href');
    if (!href || t.target === '_blank') return;
    const u = new URL(href, location.href);
    if (u.origin !== location.origin || u.pathname === '/logout' || u.pathname === '/channel_switcher') return;
    e.preventDefault();
    closePreview(true);
    closeModal();
    nav(u.pathname + u.search + u.hash, t.dataset.browse || undefined);
  });
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.gate .p[data-act]')) { e.preventDefault(); enterFromGate(); }
  });
}
