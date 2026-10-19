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
    w.addEventListener('mouseleave', () => { const v = video(); if (v && !v.paused && !panel) w.classList.add('idle'); });
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
      if (v && isFinite(v.duration)) v.currentTime = ratioAt(e) * v.duration;
    });

    const vbar = $('.vbar'), pop = $('.vol .pop');
    const setVol = e => {
      const r = vbar.getBoundingClientRect(), v = video();
      if (!v) return;
      v.volume = Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height));
      if (v.volume > 0) v.muted = false;
    };
    vbar.addEventListener('pointerdown', e => { vbar.setPointerCapture(e.pointerId); pop.classList.add('drag'); setVol(e); });
    vbar.addEventListener('pointermove', e => { if (vbar.hasPointerCapture(e.pointerId)) setVol(e); });
    vbar.addEventListener('pointerup', () => pop.classList.remove('drag'));
  }

  function wake() {
    lastMove = performance.now();
    w.classList.remove('idle', 'pause-screen');
    clearTimeout(idleT);
    // Like Netflix: controls stay up while paused (the pause screen takes over later) and while hovering a control.
    idleT = setTimeout(function hide() {
      const v = video();
      if (panel || dragging || !v || v.paused || w.matches(':has(.bottom:hover, .top:hover)')) return void (idleT = setTimeout(hide, 1000));
      w.classList.add('idle');
    }, 3000);
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
      // Drive the media element directly; YouTube's player follows its play/pause events.
      if (willPlay) v.play()?.catch?.(() => ytBtn('.ytp-play-button')?.click()); else v.pause();
      flash(willPlay ? 'play' : 'pause');
    },
    back10() { const v = video(); if (v) { v.currentTime = Math.max(0, v.currentTime - 10); flash('back10'); } },
    fwd10() { const v = video(); if (v) { v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10); flash('fwd10'); } },
    mute() { const v = video(); if (v) v.muted = !v.muted; },
    next() {
      if (hasNext()) return ytBtn('.ytp-next-button').click();
      details(curId).then(d => d.related[0] && nav(watchUrl(d.related[0]))).catch(() => {});
    },
    fs() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); },
    back() { nav(lastBrowse || '/'); },
    episodes() { openPanel('episodes'); },
    subs() { openPanel('subs'); },
    speed() { openPanel('speed'); },
    rate(b) { const v = video(); if (v) v.playbackRate = +b.dataset.rate; openPanel('speed', true); },
    cc(b) {
      const yt = ytBtn('.ytp-subtitles-button');
      if (yt && (yt.getAttribute('aria-pressed') === 'true') !== (b.dataset.on === '1')) yt.click();
      setTimeout(() => openPanel('subs', true), 150);
    },
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
    } else if (kind === 'subs') {
      const yt = ytBtn('.ytp-subtitles-button');
      const available = !!yt && getComputedStyle(yt).display !== 'none' && yt.getAttribute('aria-disabled') !== 'true';
      const on = yt?.getAttribute('aria-pressed') === 'true';
      panel = el(`<div class="panel subs"><h4>Subtitles</h4>
        <button class="opt ${on ? '' : 'on'}" data-pact="cc" data-on="0">${ICON.check}Off</button>
        ${available ? `<button class="opt ${on ? 'on' : ''}" data-pact="cc" data-on="1">${ICON.check}On</button>` : '<div class="na">No subtitles for this title</div>'}
      </div>`);
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
            <div class="tx"><div class="top"><span>${esc(v.title)}</span><span>${runtime(parseDuration(v.duration))}</span></div><p>${esc([v.channel, v.age].filter(Boolean).join(' • '))}</p></div>
          </div>`).join('')}</div>`));
      }).catch(() => panel && setHTML(panel.querySelector('.center-spin'), '<div class="na">Couldn\'t load episodes</div>'));
    }
    panel.dataset.kind = kind;
    w.append(panel);
  }

  function loadInfo() {
    bridge('player', {}, 3000).then(i => {
      if (i?.id === curId) {
        info = i;
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

    const vol = v.muted ? 0 : v.volume, volIcon = vol === 0 ? 'volOff' : vol < 0.5 ? 'volLow' : 'volHigh';
    if (volIcon !== seen.vol) { seen.vol = volIcon; setHTML($('.volbtn'), ICON[volIcon]); }
    $('.vfill').style.height = `${vol * 100}%`;
    $('.vknob').style.bottom = `${vol * 100}%`;

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
      }
      cancelAnimationFrame(raf);
      tick();
    },
    leave() {
      cancelAnimationFrame(raf);
      closePanel();
      video()?.pause();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      curId = '';
    },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      const v = video();
      switch (e.key) {
        case ' ': case 'k': case 'K': ACT.toggle(); break;
        case 'ArrowLeft': case 'j': ACT.back10(); break;
        case 'ArrowRight': case 'l': ACT.fwd10(); break;
        case 'ArrowUp': if (v) { v.volume = Math.min(1, v.volume + 0.1); if (v.muted) ACT.mute(); } break;
        case 'ArrowDown': if (v) v.volume = Math.max(0, v.volume - 0.1); break;
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
