// Runs in the page's MAIN world: the only place that can drive YouTube's SPA router,
// read the player API and sign InnerTube requests. Talks to the content script via postMessage.
(() => {
  const ORIGIN = location.origin;
  const cfg = k => window.ytcfg?.get?.(k);
  const reply = (id, ok, data) => window.postMessage({ ytnfRes: id, ok, data }, ORIGIN);

  const sha1 = async s =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))]
      .map(b => b.toString(16).padStart(2, '0')).join('');

  async function innertube(endpoint, body) {
    const sapisid = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!sapisid) throw new Error('signed-out');
    const ts = Math.floor(Date.now() / 1000);
    const headers = {
      'content-type': 'application/json',
      authorization: `SAPISIDHASH ${ts}_${await sha1(`${ts} ${sapisid} ${ORIGIN}`)}`,
      'x-origin': ORIGIN,
      'x-goog-authuser': String(cfg('SESSION_INDEX') ?? 0),
      'x-youtube-client-name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') ?? 1),
      'x-youtube-client-version': cfg('INNERTUBE_CLIENT_VERSION') ?? '',
    };
    const pageId = cfg('DELEGATED_SESSION_ID'); // brand-account channels
    if (pageId) headers['x-goog-pageid'] = pageId;
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ context: cfg('INNERTUBE_CONTEXT'), ...body }),
    });
    if (!res.ok) throw new Error(`innertube ${endpoint} ${res.status}`);
    return res.json();
  }

  const BROWSE = {
    '/': 'FEwhat_to_watch', '/feed/subscriptions': 'FEsubscriptions', '/feed/history': 'FEhistory',
    '/feed/library': 'FElibrary', '/feed/you': 'FEyou', '/feed/playlists': 'FEplaylist_aggregation',
  };

  function endpointFor(u, browseId) {
    const url = u.pathname + u.search + u.hash;
    const meta = (type, rootVe, apiUrl) => ({ webCommandMetadata: { url, webPageType: type, rootVe, ...(apiUrl && { apiUrl }) } });
    const v = u.searchParams.get('v');
    if (u.pathname === '/watch' && /^[\w-]{11}$/.test(v)) {
      const list = u.searchParams.get('list');
      return { commandMetadata: meta('WEB_PAGE_TYPE_WATCH', 3832), watchEndpoint: { videoId: v, ...(list && { playlistId: list }) } };
    }
    if (u.pathname === '/results') {
      return { commandMetadata: meta('WEB_PAGE_TYPE_SEARCH', 4724, '/youtubei/v1/search'), searchEndpoint: { query: u.searchParams.get('search_query') ?? '' } };
    }
    const list = u.pathname === '/playlist' && u.searchParams.get('list');
    const id = browseId || BROWSE[u.pathname] || (list && `VL${list}`) || u.pathname.match(/^\/channel\/(UC[\w-]{22})/)?.[1];
    if (!id) return null;
    const type = id.startsWith('UC') ? 'WEB_PAGE_TYPE_CHANNEL' : list ? 'WEB_PAGE_TYPE_PLAYLIST' : 'WEB_PAGE_TYPE_BROWSE';
    return { commandMetadata: meta(type, 3854, '/youtubei/v1/browse'), browseEndpoint: { browseId: id } };
  }

  function navigate(url, browseId) {
    const u = new URL(url, ORIGIN);
    const app = document.querySelector('ytd-app');
    const endpoint = u.origin === ORIGIN && app && endpointFor(u, browseId);
    if (!endpoint) return location.assign(u.href);
    let started = false;
    const onStart = () => { started = true; };
    document.addEventListener('yt-navigate-start', onStart, { once: true });
    app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
    // If YouTube's router ignored us, fall back to a real page load.
    setTimeout(() => {
      document.removeEventListener('yt-navigate-start', onStart);
      if (!started && location.pathname + location.search + location.hash !== u.pathname + u.search + u.hash) location.assign(u.href);
    }, 900);
  }

  function playerInfo() {
    const p = document.getElementById('movie_player');
    const r = p?.getPlayerResponse?.();
    const d = p?.getVideoData?.();
    if (!r || !d) return null;
    const vd = r.videoDetails ?? {};
    const mf = r.microformat?.playerMicroformatRenderer ?? {};
    return {
      id: d.video_id, title: d.title || vd.title, channel: d.author || vd.author, channelId: vd.channelId,
      desc: vd.shortDescription ?? '', length: +vd.lengthSeconds || 0, views: +vd.viewCount || 0,
      live: !!d.isLive, date: mf.publishDate ?? '', category: mf.category ?? '',
      storyboard: r.storyboards?.playerStoryboardSpecRenderer?.spec ?? '',
    };
  }

  function findKey(node, key) {
    if (!node || typeof node !== 'object') return undefined;
    if (key in node) return node[key];
    for (const v of Object.values(node)) {
      const hit = findKey(v, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  const text = x => x?.simpleText ?? x?.runs?.map(r => r.text).join('') ?? '';
  const mp = () => document.getElementById('movie_player');
  const str = (x, max = 40) => typeof x === 'string' && x.length <= max ? x : '';

  // Only these player methods may be driven from the content script.
  const PLAYER_FNS = new Set(['playVideo', 'pauseVideo', 'seekTo', 'setVolume', 'mute', 'unMute', 'setPlaybackRate', 'setPlaybackQualityRange', 'nextVideo']);

  function playerState() {
    const p = mp();
    const r = p?.getPlayerResponse?.();
    if (!r) return null;
    const audioNames = new Map((r.streamingData?.adaptiveFormats ?? []).filter(f => f.audioTrack).map(f => [f.audioTrack.id, f.audioTrack.displayName]));
    const cur = p.isSubtitlesOn?.() ? p.getOption?.('captions', 'track') : null;
    return {
      id: p.getVideoData?.()?.video_id ?? '',
      quality: p.getPlaybackQuality?.() ?? '',
      qualities: (p.getAvailableQualityData?.() ?? []).filter(q => q.isPlayable !== false && q.quality !== 'auto')
        .map(q => ({ id: q.quality, label: q.qualityLabel, tag: q.paygatedQualityDetails?.paygatedIndicatorText ?? '' })),
      captions: (r.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [])
        .map(t => ({ code: t.languageCode, kind: t.kind ?? '', vss: t.vssId ?? '', name: text(t.name) })),
      caption: cur?.languageCode ? { code: cur.languageCode, kind: cur.kind ?? '' } : null,
      audio: audioNames.size > 1 ? [...audioNames].map(([id, name]) => ({ id, name })) : [],
      audioId: p.getAudioTrack?.()?.id ?? '',
    };
  }

  const handlers = {
    nav: ({ url, browseId }) => navigate(url, browseId),
    player: () => playerInfo(),
    account: async () => {
      if (!cfg('LOGGED_IN')) return null;
      const h = findKey(await innertube('account/account_menu', {}), 'activeAccountHeaderRenderer');
      return h && { name: text(h.accountName), handle: text(h.channelHandle), avatar: h.accountPhoto?.thumbnails?.at(-1)?.url ?? '' };
    },
    watchLater: ({ videoId, add }) => innertube('browse/edit_playlist', {
      playlistId: 'WL',
      actions: [add ? { addedVideoId: videoId, action: 'ACTION_ADD_VIDEO' } : { removedVideoId: videoId, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }],
    }).then(() => true),
    like: ({ videoId, like }) => innertube(like ? 'like/like' : 'like/removelike', { target: { videoId } }).then(() => true),
    pcall: ({ fn, args }) => {
      if (!PLAYER_FNS.has(fn)) throw new Error(`player method not allowed: ${fn}`);
      const p = mp();
      if (typeof p?.[fn] !== 'function') return false;
      p[fn](...(Array.isArray(args) ? args.filter(a => ['string', 'number', 'boolean'].includes(typeof a)) : []));
      return true;
    },
    pstate: () => playerState(),
    volume: () => { const p = mp(); return p?.getVolume ? { volume: p.getVolume(), muted: !!p.isMuted?.() } : null; },
    captions: ({ code, kind }) => {
      const p = mp();
      if (!p?.setOption) return false;
      if (!str(code)) { if (p.isSubtitlesOn?.()) p.toggleSubtitles(); return true; }
      p.setOption('captions', 'track', { languageCode: str(code), ...(str(kind) && { kind: str(kind) }) });
      return true;
    },
    audio: ({ id }) => {
      const p = mp();
      const t = p?.getAvailableAudioTracks?.().find(x => x.id === str(id, 80));
      if (t) p.setAudioTrack(t);
      return !!t;
    },
  };

  window.addEventListener('message', async e => {
    const m = e.data;
    if (e.source !== window || e.origin !== ORIGIN || !m || typeof m.ytnf !== 'string' || !handlers[m.ytnf]) return;
    if (m.videoId !== undefined && !/^[\w-]{11}$/.test(m.videoId)) return reply(m.id, false, 'bad videoId');
    try { reply(m.id, true, await handlers[m.ytnf](m)); }
    catch (err) { reply(m.id, false, String(err?.message ?? err)); }
  });
})();
