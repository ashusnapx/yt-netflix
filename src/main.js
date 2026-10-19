// Boot + router. Decides per URL whether our Netflix UI owns the page, YouTube's player is skinned,
// or (for pages we don't redesign, e.g. Shorts, Studio, settings) YouTube shows through untouched.

const DEFAULTS = { enabled: true, profileGate: true, previews: true };
const html = document.documentElement;

function routeOf(u) {
  const p = u.pathname;
  if (p === '/watch' && u.searchParams.get('v')) return 'watch';
  // YouTube removed /feed/trending (it now redirects home), so New & Popular lives on a hash of the home URL.
  if (p === '/') return u.hash === '#new-popular' ? 'newpop' : 'home';
  if (p === '/feed/subscriptions') return 'subs';
  if (p === '/results' && u.searchParams.get('search_query')) return 'search';
  if (p === '/playlist' && u.searchParams.get('list')) return 'playlist';
  if (p === '/feed/history') return 'history';
  if (/^\/(@[^/]+|channel\/[\w-]+|c\/[^/]+|user\/[^/]+)\/?($|featured|videos|streams|playlists|about)/.test(p)) return 'channel';
  return null;
}

function setModeClass(route) {
  html.classList.toggle('ytnf-overlay', !!route && route !== 'watch');
  html.classList.toggle('ytnf-watch', route === 'watch');
}

// Hide YouTube before it paints; undone below if the extension is switched off.
html.classList.add('ytnf-on', 'ytnf-boot');
setModeClass(routeOf(new URL(location.href)));
// Registered at document_start so it runs before YouTube's own hotkey handlers and can stop them.
window.addEventListener('keydown', e => onKey(e), true);
// Some YouTube builds act on keyup/keypress too; swallow the rest of any key press we handled.
const handledKeys = new Set();
for (const type of ['keyup', 'keypress']) {
  window.addEventListener(type, e => {
    if (!handledKeys.has(e.code)) return;
    if (type === 'keyup') handledKeys.delete(e.code);
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}

let host = null, viewEl = null, pending = null, active = false;
let cur = { key: '', route: null };
const scrollMem = new Map();

function nav(url, browseId) {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin) { location.href = u.href; return; }
  const target = u.pathname + u.search + u.hash;
  if (target === location.pathname + location.search + location.hash && !pending) return sync();
  pending = { u, t: Date.now() };
  sync();
  bridge('nav', { url: target, ...(browseId && { browseId }) }, 3000).catch(() => location.assign(u.href));
}

function sync() {
  if (!active) return;
  const real = new URL(location.href);
  const keyOf = x => x.pathname + x.search + x.hash;
  if (pending && (keyOf(pending.u) === keyOf(real) || Date.now() - pending.t > 6000)) pending = null;
  const u = pending?.u ?? real;
  const key = keyOf(u);
  if (key === cur.key) return;
  const route = routeOf(u);
  const prev = cur;

  if (prev.route && prev.route !== 'watch') scrollMem.set(prev.key, scrollY);
  if (prev.route === 'watch' && route !== 'watch') Player.leave();
  closePreview(true);
  closeModal();
  setModeClass(route);
  cur = { key, route };
  host.hidden = !route;
  if (!route) return;

  if (route === 'watch') {
    app.classList.add('watching');
    Hero.pause();
    Player.enter(u, prev.route && prev.route !== 'watch' ? prev.key : null);
    return;
  }
  app.classList.remove('watching');
  if (viewEl?.dataset.key === key) {
    viewEl.hidden = false;
    Hero.resume();
  } else {
    Hero.stop();
    viewEl?.remove();
    viewEl = (VIEWS[route] ?? homeView)(u);
    viewEl.dataset.key = key;
    app.querySelector('.footer').before(viewEl);
  }
  setActiveNav(route, u);
  requestAnimationFrame(() => scrollTo(0, scrollMem.get(key) ?? 0));
}

function onKey(e) {
  if (!active || !host || host.hidden) return;
  const path = e.composedPath();
  const ours = path.includes(host);
  const typing = ours && path[0]?.matches?.('input, textarea, [contenteditable]');
  if (cur.route !== 'watch') e.stopImmediatePropagation(); // YouTube's hotkeys have nothing to act on here
  if (e.key === 'Escape' && (closeModal() || app.querySelector('.gate'))) { enterFromGate(); e.preventDefault(); return; }
  if (typing) {
    if (e.key === 'Escape') { path[0].value = ''; path[0].blur(); setSearchOpen(false); }
    return;
  }
  if (cur.route === 'watch' && Player.key(e)) { handledKeys.add(e.code); e.preventDefault(); e.stopImmediatePropagation(); }
}

function start(settings) {
  active = true;
  S.settings = settings;
  host = document.createElement('div');
  host.id = 'ytnf-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = chrome.runtime.getURL('src/ui.css');
  const unboot = () => html.classList.remove('ytnf-boot');
  css.addEventListener('load', unboot);
  css.addEventListener('error', unboot);
  setTimeout(unboot, 4000);
  app = document.createElement('div');
  app.className = 'app';
  shadow.append(css, app);
  app.append(headerEl(), footerEl());
  Player.mount(app);
  bindActions(app);
  bindHover(app);
  html.append(host);

  window.addEventListener('popstate', () => { pending = null; sync(); });
  window.addEventListener('hashchange', () => { pending = null; sync(); });
  document.addEventListener('yt-navigate-start', sync);
  document.addEventListener('yt-navigate-finish', sync);
  setInterval(sync, 400); // catches any URL change YouTube makes without telling us
  let lastPer = perPage();
  window.addEventListener('resize', () => {
    const per = perPage();
    if (per === lastPer) return;
    lastPer = per;
    app.style.setProperty('--per', per);
    app.querySelectorAll('.row').forEach(r => r._count && layoutRow(r));
  });
  app.style.setProperty('--per', lastPer);
  window.addEventListener('scroll', () => {
    app.querySelector('.hdr').classList.toggle('solid', scrollY > 0);
    if (pv) closePreview();
  }, { passive: true });

  sync();
  renderAccount();
  if (signedIn()) {
    bridge('account').then(a => { S.account = a; renderAccount(); refreshGate(); }).catch(err => console.warn('[YouFlix] account', err));
    pageVideos('/playlist?list=WL').then(vs => vs.forEach(v => S.wl.add(v.id))).catch(() => {});
    pageVideos('/playlist?list=LL').then(vs => vs.forEach(v => S.liked.add(v.id))).catch(() => {});
  }
  if (cur.route && cur.route !== 'watch') showGate();
}

// Re-render the gate once the account name/avatar arrives.
function refreshGate() {
  const gate = app.querySelector('.gate:not(.leaving)');
  if (!gate) return;
  gate.remove();
  showGate();
}

chrome.storage.sync.get(DEFAULTS).then(settings => {
  if (!settings.enabled) {
    html.classList.remove('ytnf-on', 'ytnf-boot', 'ytnf-overlay', 'ytnf-watch');
    return;
  }
  const go = () => start(settings);
  document.body ? go() : document.addEventListener('DOMContentLoaded', go, { once: true });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.enabled) return location.reload();
  for (const k in changes) S.settings[k] = changes[k].newValue;
});
