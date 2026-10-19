// Netflix-style player chrome laid over YouTube's real <video>. YouTube keeps doing playback,
// ads, captions and autoplay; we drive it through the media element and its hidden buttons.

const Player = (() => {
  let w, raf = 0, idleT = 0, loadT = 0, pauseT = 0, lastMove = 0, curId = '', curList = '', info = null, infoTries = 0;
  let dragging = false, panel = null, seen = {};
  const $ = s => w.querySelector(s);
  const mp = () => document.getElementById('movie_player');
  const video = () => mp()?.querySelector('video.html5-main-video') ?? mp()?.querySelector('video');
  const ytBtn = cls => mp()?.querySelector(cls);
  const fmt = s => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const visible = n => !!n && n.offsetParent !== null && getComputedStyle(n).display !== 'none';
  // YouTube's own player API (via the MAIN-world bridge) keeps its state machine in sync;
  // poking the <video> directly makes YouTube fight back and pauses land late.
  const api = (fn, ...args) => bridge('pcall', { fn, args }, 1500).catch(() => false);
  const seek = t => { const v = video(); if (!v) return; t = Math.max(0, Math.min(t, (v.duration || Infinity) - 0.5)); api('seekTo', t, true).then(ok => { if (!ok) v.currentTime = t; }); };
  // Volume lives on YouTube's 0-100 scale; the <video> element's volume is that times loudness normalisation.
  let ytVol = { volume: 100, muted: false };
  const syncVolume = () => bridge('volume', {}, 1500).then(s => { if (s) { ytVol = s; paintVolume(); } }).catch(() => {});
  const setVolume = pct => {
    pct = Math.round(Math.max(0, Math.min(100, pct)));
    ytVol = { volume: pct, muted: ytVol.muted && pct === 0 };
    paintVolume();
    api('setVolume', pct).then(ok => { if (!ok && video()) video().volume = pct / 100; });
    if (pct > 0) api('unMute');
  };
  const stepVolume = d => bridge('volume', {}, 1500).then(s => setVolume((s?.muted ? 0 : s?.volume ?? ytVol.volume) + d)).catch(() => setVolume(ytVol.volume + d));

  function mount(root) {
    w = el(`<div class="w loading">
      <div class="curtain"><div class="spin"></div></div>
      <div class="hit"></div>
      <div class="spin buffer" hidden></div>
      <div class="flash"></div>
      <div class="paused-info"><small>You're watching</small><h2></h2><div class="ch"></div><p></p><span class="pausedtag">Paused</span></div>
      <div class="chrome top"><button class="back" data-pact="back" aria-label="Back to Browse">${ICON.back}</button></div>
      <div class="chrome bottom">
        <div class="bar-row">
          <div class="bar" role="slider" aria-label="Seek" tabindex="-1">
            <div class="rail"><div class="buf"></div><div class="fill"></div><div class="knob"></div></div>
            <div class="tip"><div class="frame"></div><span></span></div>
          </div>
          <span class="time"></span>
        </div>
        <div class="ctl">
          <button class="b play" data-pact="toggle" aria-label="Play">${ICON.play}</button>
          <button class="b" data-pact="back10" aria-label="Back 10 seconds">${ICON.back10}</button>
          <button class="b" data-pact="fwd10" aria-label="Forward 10 seconds">${ICON.fwd10}</button>
          <div class="vol">
            <div class="pop"><div class="slot"><div class="vbar"><div class="vfill"></div><div class="vknob"></div></div></div></div>
            <button class="b volbtn" data-pact="mute" aria-label="Mute">${ICON.volHigh}</button>
          </div>
          <div class="name"></div>
          <button class="b nextbtn" data-pact="next" aria-label="Next Episode">${ICON.next}</button>
          <button class="b" data-pact="episodes" aria-label="Episodes">${ICON.episodes}</button>
          <button class="b ccbtn" data-pact="subs" aria-label="Audio &amp; Subtitles">${ICON.subtitles}</button>
          <button class="b" data-pact="qualityPanel" aria-label="Video Quality">${ICON.quality}</button>
          <button class="b" data-pact="speed" aria-label="Playback Speed">${ICON.speed}</button>
          <button class="b fsbtn" data-pact="fs" aria-label="Full screen">${ICON.fsEnter}</button>
        </div>
      </div>
      <button class="nextep" data-pact="next" hidden>${ICON.next}Next Episode</button>
    </div>`);
    root.append(w);

    w.addEventListener('click', e => {
      const a = e.target.closest('[data-pact]');
      if (a) { e.preventDefault(); ACT[a.dataset.pact]?.(a); wake(); return; }
      if (e.target.closest('.panel')) return;
      if (panel) return closePanel();
      if (e.target === $('.hit') || e.target.closest('.paused-info')) ACT.toggle();
    });
    $('.hit').addEventListener('dblclick', () => ACT.fs());
    w.addEventListener('mousemove', wake);
    w.addEventListener('mouseleave', () => { const v = video(); if (v && !v.paused && !panel) { w.classList.add('idle'); html.classList.remove('ytnf-ui'); } });
    document.addEventListener('volumechange', e => { if (e.target === video()) syncVolume(); }, true);
    document.addEventListener('fullscreenchange', () => setHTML($('.fsbtn'), document.fullscreenElement ? ICON.fsExit : ICON.fsEnter));

    const bar = $('.bar');
    const ratioAt = e => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    bar.addEventListener('pointerdown', e => {
      const v = video();
      if (!v || !isFinite(v.duration)) return;
      dragging = true;
      bar.setPointerCapture(e.pointerId);
      paintBar(ratioAt(e));
    });
    bar.addEventListener('pointermove', e => {
      const v = video();
      if (!v || !isFinite(v.duration)) return;
      const r = ratioAt(e);
      tip(r, v.duration);
      if (dragging) paintBar(r);
    });
    bar.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      const v = video();
      if (v && isFinite(v.duration)) seek(ratioAt(e) * v.duration);
    });

    const vbar = $('.vbar'), pop = $('.vol .pop');
    const setVol = e => { const r = vbar.getBoundingClientRect(); setVolume((r.bottom - e.clientY) / r.height * 100); };
    vbar.addEventListener('pointerdown', e => { vbar.setPointerCapture(e.pointerId); pop.classList.add('drag'); setVol(e); });
    vbar.addEventListener('pointermove', e => { if (vbar.hasPointerCapture(e.pointerId)) setVol(e); });
    vbar.addEventListener('pointerup', () => pop.classList.remove('drag'));
  }

  function wake() {
    lastMove = performance.now();
    w.classList.remove('idle', 'pause-screen');
    if (curId) html.classList.add('ytnf-ui');
    clearTimeout(idleT);
    // Like Netflix: controls stay up while paused (the pause screen takes over later) and while hovering a control.
    idleT = setTimeout(function hide() {
      const v = video();
      if (panel || dragging || !v || v.paused || w.matches(':has(.bottom:hover, .top:hover)')) return void (idleT = setTimeout(hide, 1000));
      w.classList.add('idle');
      html.classList.remove('ytnf-ui');
    }, 3000);
  }

  function paintVolume() {
    const vol = ytVol.muted ? 0 : ytVol.volume, icon = vol === 0 ? 'volOff' : vol < 50 ? 'volLow' : 'volHigh';
    if (icon !== seen.vol) { seen.vol = icon; setHTML($('.volbtn'), ICON[icon]); }
    $('.vfill').style.height = `${vol}%`;
    $('.vknob').style.bottom = `${vol}%`;
  }

  function flash(icon) {
    const f = $('.flash');
    setHTML(f, ICON[icon]);
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  function paintBar(r) {
    $('.fill').style.width = `${r * 100}%`;
    $('.knob').style.left = `${r * 100}%`;
  }

  // Storyboard sprite frame for the scrub tooltip (spec format: base|w#h#count#cols#rows#interval#name#sigh|...).
  function tip(r, dur) {
    const t = r * dur, tipEl = $('.tip'), frame = $('.frame');
    tipEl.style.left = `${r * 100}%`;
    tipEl.querySelector('span').textContent = fmt(t);
    const spec = info?.id === curId ? info.storyboard : '';
    const [base, ...levels] = spec ? spec.split('|') : [];
    if (!levels.length) { frame.hidden = true; return; }
    const L = levels.length - 1;
    const [fw, fh, count, cols, rows, interval, name, sigh] = levels[L].split('#');
    const n = +count, per = cols * rows;
    const i = Math.min(n - 1, Math.max(0, Math.floor(+interval > 0 ? t * 1000 / +interval : r * n)));
    const sheet = Math.floor(i / per), pos = i % per;
    const url = `${base.replace('$L', L).replace('$N', name.replace('$M', sheet))}&sigh=${sigh}`;
    const scale = 240 / fw;
    Object.assign(frame.style, {
      width: `${fw * scale}px`, height: `${fh * scale}px`, backgroundImage: `url("${url}")`,
      backgroundSize: `${cols * fw * scale}px ${rows * fh * scale}px`,
      backgroundPosition: `${-(pos % cols) * fw * scale}px ${-Math.floor(pos / cols) * fh * scale}px`,
    });
    frame.hidden = false;
  }

  function hasNext() { const b = ytBtn('.ytp-next-button'); return !!b && b.getAttribute('aria-disabled') !== 'true' && getComputedStyle(b).display !== 'none'; }

  const ACT = {
    toggle() {
      const v = video();
      if (!v) return;
      const willPlay = v.paused || v.ended;
      // Pause the element at once for instant feedback, and tell YouTube so it doesn't resume it.
      if (willPlay) api('playVideo').then(ok => { if (!ok) v.play().catch(() => {}); });
      else { v.pause(); api('pauseVideo'); }
      flash(willPlay ? 'play' : 'pause');
    },
    back10() { const v = video(); if (v) { seek(v.currentTime - 10); flash('back10'); } },
    fwd10() { const v = video(); if (v) { seek(v.currentTime + 10); flash('fwd10'); } },
    mute() {
      const v = video();
      if (!v) return;
      const m = !v.muted;
      ytVol = { ...ytVol, muted: m };
      paintVolume();
      api(m ? 'mute' : 'unMute').then(ok => { if (!ok) v.muted = m; });
    },
    next() {
      if (hasNext()) return api('nextVideo').then(ok => { if (!ok) ytBtn('.ytp-next-button')?.click(); });
      details(curId).then(d => d.related[0] && nav(watchUrl(d.related[0]))).catch(() => {});
    },
    fs() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); },
    back() { nav(lastBrowse || '/'); },
    episodes() { openPanel('episodes'); },
    subs() { openPanel('subs'); },
    speed() { openPanel('speed'); },
    rate(b) {
      const r = +b.dataset.rate;
      api('setPlaybackRate', r).then(ok => { if (!ok && video()) video().playbackRate = r; });
      closePanel();
    },
    cc(b) { bridge('captions', { code: b.dataset.code ?? '', kind: b.dataset.kind ?? '' }).catch(() => {}); closePanel(); },
    audio(b) { bridge('audio', { id: b.dataset.id }).catch(() => {}); closePanel(); },
    quality(b) {
      const q = b.dataset.q;
      try { q === 'auto' ? sessionStorage.removeItem('ytnf-quality') : sessionStorage.setItem('ytnf-quality', q); } catch { /* storage blocked */ }
      api('setPlaybackQualityRange', q, q);
      closePanel();
    },
    qualityPanel() { openPanel('quality'); },
    ep(b) { closePanel(); nav(b.dataset.href); },
  };

  function closePanel() { panel?.remove(); panel = null; }

  function openPanel(kind, refresh = false) {
    if (panel?.dataset.kind === kind && !refresh) return closePanel();
    closePanel();
    if (kind === 'speed') {
      const rate = video()?.playbackRate ?? 1;
      panel = el(`<div class="panel speed"><h4>Playback Speed</h4><div class="speeds">${[0.5, 0.75, 1, 1.25, 1.5].map(r =>
        `<button class="${Math.abs(r - rate) < 0.01 ? 'on' : ''}" data-pact="rate" data-rate="${r}"><i></i>${r}x${r === 1 ? ' (Normal)' : ''}</button>`).join('')}</div></div>`);
    } else if (kind === 'subs' || kind === 'quality') {
      panel = el(`<div class="panel ${kind}"><div class="center-spin" style="min-height:120px"><div class="spin" style="width:40px;height:40px"></div></div></div>`);
      const id = curId;
      bridge('pstate').then(st => {
        if (!panel || panel.dataset.kind !== kind || id !== curId) return;
        setHTML(panel, kind === 'subs' ? subsPanel(st) : qualityPanel(st));
        panel.querySelectorAll('.col').forEach(c => c.querySelector('.opt.on')?.scrollIntoView({ block: 'center' }));
      }).catch(() => panel && setHTML(panel, '<div class="na" style="padding:20px 24px">Player settings unavailable</div>'));
    } else {
      panel = el(`<div class="panel episodes"><h4>Up Next</h4><div class="center-spin" style="min-height:160px"><div class="spin"></div></div></div>`);
      const id = curId;
      fetchPage(`/watch?v=${id}${curList ? `&list=${encodeURIComponent(curList)}` : ''}`).then(p => {
        if (!panel || panel.dataset.kind !== 'episodes' || id !== curId) return;
        const d = watchDetails(p, id);
        const list = d.playlist?.videos.length ? d.playlist.videos : d.related;
        panel.querySelector('h4').textContent = d.playlist?.title || 'Up Next';
        panel.querySelector('.center-spin').replaceWith(el(`<div>${remember(list).slice(0, 30).map((v, i) => `
          <div class="ep${v.id === id ? ' cur' : ''}" data-pact="ep" data-href="${esc(watchUrl(v))}">
            <div class="n">${i + 1}</div>
            <div class="th"><img loading="lazy" src="${thumb(v.id)}" alt="">${v.progress ? progressBar(v.progress) : ''}</div>
            <div class="tx"><div class="eprow"><span>${esc(v.title)}</span><span>${runtime(parseDuration(v.duration))}</span></div><p>${esc([v.channel, v.age].filter(Boolean).join(' • '))}</p></div>
          </div>`).join('')}</div>`));
      }).catch(() => panel && setHTML(panel.querySelector('.center-spin'), '<div class="na">Couldn\'t load episodes</div>'));
    }
    panel.dataset.kind = kind;
    w.append(panel);
  }

  const opt = (on, attrs, label) => `<button class="opt ${on ? 'on' : ''}" ${attrs}><span class="ic">${ICON.check}</span><span>${label}</span></button>`;

  // Netflix's "Audio & Subtitles" panel: audio tracks on the left (only for multi-language videos), subtitles on the right.
  function subsPanel(st) {
    const cur = st?.caption;
    const subs = st?.captions ?? [];
    const audio = st?.audio ?? [];
    const subCol = `<div class="col"><h4>Subtitles</h4>
      ${opt(!cur, 'data-pact="cc" data-code=""', 'Off')}
      ${subs.map(t => opt(cur && cur.code === t.code && (cur.kind || '') === (t.kind || ''),
        `data-pact="cc" data-code="${esc(t.code)}" data-kind="${esc(t.kind)}"`, esc(t.name || t.code))).join('')}
      ${subs.length ? '' : '<div class="na">No subtitles for this title</div>'}</div>`;
    const audioCol = audio.length
      ? `<div class="col"><h4>Audio</h4>${audio.map(a => opt(a.id === st.audioId, `data-pact="audio" data-id="${esc(a.id)}"`, esc(a.name))).join('')}</div>` : '';
    return `<div class="cols">${audioCol}${subCol}</div>`;
  }

  function qualityPanel(st) {
    const chosen = (() => { try { return sessionStorage.getItem('ytnf-quality'); } catch { return null; } })();
    const qs = st?.qualities ?? [];
    const curLabel = qs.find(q => q.id === st?.quality)?.label ?? '';
    return `<div class="col"><h4>Video Quality</h4>
      ${opt(!chosen || !qs.some(q => q.id === chosen), 'data-pact="quality" data-q="auto"', `Auto${curLabel ? ` <small>(${esc(curLabel)})</small>` : ''}`)}
      ${qs.map(q => opt(q.id === chosen, `data-pact="quality" data-q="${esc(q.id)}"`, `${esc(q.label)}${q.tag ? ` <small>${esc(q.tag)}</small>` : ''}`)).join('')}
      ${qs.length ? '' : '<div class="na">Quality is fixed for this video</div>'}</div>`;
  }

  // Re-apply the viewer's chosen quality to each new video, like Netflix's per-profile setting.
  function applyQuality() {
    let q = null;
    try { q = sessionStorage.getItem('ytnf-quality'); } catch { return; }
    if (q) api('setPlaybackQualityRange', q, q);
  }

  function loadInfo() {
    bridge('player', {}, 3000).then(i => {
      if (i?.id === curId) {
        info = i;
        applyQuality();
        setHTML($('.name'), `<b>${esc(i.channel)}</b>${esc(i.title)}`);
        $('.paused-info h2').textContent = i.title;
        $('.paused-info .ch').textContent = [i.channel, i.date && new Date(i.date).getFullYear(), i.length && runtime(i.length)].filter(Boolean).join('  •  ');
        $('.paused-info p').textContent = i.desc.slice(0, 400);
      } else if (++infoTries < 20) setTimeout(loadInfo, 500);
    }).catch(() => { if (++infoTries < 20) setTimeout(loadInfo, 1000); });
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    const v = video(), p = mp(), now = performance.now();
    if (!v || !p) { if (now - loadT > 10000) w.classList.remove('loading'); return; }
    const ad = p.classList.contains('ad-showing');
    const err = visible(p.querySelector('.ytp-error'));
    w.classList.toggle('pass', ad || err);
    const flexy = document.querySelector('ytd-watch-flexy')?.getAttribute('video-id');
    if (w.classList.contains('loading') && (ad || err || now - loadT > 8000 ||
        (v.readyState >= 3 && now - loadT > 400 && (!flexy || flexy === curId)))) {
      w.classList.remove('loading');
      wake();
    }

    const paused = v.paused || v.ended;
    if (paused !== seen.paused) {
      seen.paused = paused;
      setHTML($('.play'), paused ? ICON.play : ICON.pause);
      $('.play').setAttribute('aria-label', paused ? 'Play' : 'Pause');
      pauseT = now;
      if (!paused) w.classList.remove('pause-screen');
    }
    if (paused && !ad && info && !panel && !w.classList.contains('pause-screen') && now - pauseT > 5000 && now - lastMove > 5000) {
      w.classList.add('pause-screen', 'idle');
    }
    $('.buffer').hidden = paused || v.readyState >= 3 || w.classList.contains('loading');


    const dur = v.duration, live = info?.live || dur === Infinity;
    if (!dragging && isFinite(dur) && dur > 0) {
      paintBar(v.currentTime / dur);
      const b = v.buffered;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime && b.end(i) >= v.currentTime) $('.buf').style.width = `${b.end(i) / dur * 100}%`;
    }
    $('.time').textContent = live ? 'LIVE' : isFinite(dur) ? fmt(dur - v.currentTime) : '';
    const next = hasNext();
    $('.nextbtn').hidden = !next;
    $('.nextep').hidden = !(next && !ad && isFinite(dur) && dur > 60 && dur - v.currentTime < 20);
    const cc = ytBtn('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true';
    $('.ccbtn').classList.toggle('on', cc);
  }

  let lastBrowse = '/';
  return {
    mount,
    enter(u, from) {
      if (from) lastBrowse = from;
      const id = u.searchParams.get('v') ?? '';
      curList = u.searchParams.get('list') ?? '';
      if (id !== curId) {
        curId = id;
        info = null;
        infoTries = 0;
        seen = {};
        closePanel();
        w.classList.add('loading');
        w.classList.remove('pause-screen');
        setHTML($('.name'), esc(document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '')));
        loadT = performance.now();
        setTimeout(loadInfo, 600);
        setTimeout(syncVolume, 800);
      }
      cancelAnimationFrame(raf);
      tick();
    },
    leave() {
      cancelAnimationFrame(raf);
      html.classList.remove('ytnf-ui');
      closePanel();
      video()?.pause();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      curId = '';
    },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      // Holding a toggle key must not flip play/mute/fullscreen on every auto-repeat.
      if (e.repeat && /^( |k|K|m|M|f|F)$/.test(e.key)) return true;
      const v = video();
      switch (e.key) {
        case ' ': case 'k': case 'K': ACT.toggle(); break;
        case 'ArrowLeft': case 'j': ACT.back10(); break;
        case 'ArrowRight': case 'l': ACT.fwd10(); break;
        case 'ArrowUp': stepVolume(10); break;
        case 'ArrowDown': stepVolume(-10); break;
        case 'm': case 'M': ACT.mute(); break;
        case 'f': case 'F': ACT.fs(); break;
        case 'N': if (e.shiftKey) ACT.next(); else return false; break;
        case 'Escape': if (panel) { closePanel(); break; } return false;
        default: return false;
      }
      wake();
      return true;
    },
  };
})();
