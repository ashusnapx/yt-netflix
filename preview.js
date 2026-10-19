// Extension-hosted shim for inline previews. YouTube refuses embeds whose embedding page is
// youtube.com itself (error 152), so the Netflix UI frames this page, which frames the embed and
// relays the embed's postMessage API to the parent.
const EMBED = 'https://www.youtube-nocookie.com';
const q = new URLSearchParams(location.search);
const id = q.get('v');
if (/^[\w-]{11}$/.test(id ?? '')) {
  const params = new URLSearchParams({
    autoplay: 1, mute: q.get('mute') === '0' ? 0 : 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3,
    modestbranding: 1, playsinline: 1, rel: 0, enablejsapi: 1, start: Math.max(0, parseInt(q.get('start'), 10) || 0), origin: location.origin,
    ytnf: 1, // marks our embeds for the Referer rule in rules.json
  });
  const f = document.createElement('iframe');
  f.allow = 'autoplay; encrypted-media';
  f.src = `${EMBED}/embed/${id}?${params}`;
  document.body.append(f);
  let heard = false, tries = 0;
  const ping = setInterval(() => {
    if (heard || ++tries > 40) return clearInterval(ping);
    f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), EMBED);
  }, 250);
  window.addEventListener('message', e => {
    if (e.source === f.contentWindow && e.origin === EMBED) {
      heard = true;
      parent.postMessage(e.data, 'https://www.youtube.com');
    } else if (e.source === parent && e.origin === 'https://www.youtube.com') {
      f.contentWindow?.postMessage(e.data, EMBED);
    }
  });
}
