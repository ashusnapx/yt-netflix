// Inline SVG icon set, drawn to match Netflix's 24px line/fill style.
const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;

const ICON = {
  play: svg('<path fill="currentColor" d="M5 2.7a1 1 0 0 1 1.48-.88l16.93 9.3a1 1 0 0 1 0 1.76l-16.93 9.3A1 1 0 0 1 5 21.31z"/>'),
  pause: svg('<path fill="currentColor" d="M4.5 3h5v18h-5zM14.5 3h5v18h-5z"/>'),
  info: svg('<path fill="currentColor" fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M1 12a11 11 0 1 1 22 0 11 11 0 0 1-22 0m12-2v8h-2v-8zm-1-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>'),
  plus: svg('<path fill="currentColor" d="M11 11V2h2v9h9v2h-9v9h-2v-9H2v-2z"/>'),
  check: svg('<path fill="currentColor" d="m8.68 19.65-7.4-7.4 1.42-1.42 6.71 6.71L21.3 4.4l1.42 1.42-13.3 13.82a.5.5 0 0 1-.73 0"/>'),
  thumb: svg('<path fill="currentColor" fill-rule="evenodd" d="M10.7 2.3c.36-.84 1.33-1.4 2.32-1.1 1.6.48 2.36 2.04 2.05 3.6L14.5 8H20a3 3 0 0 1 2.9 3.8l-2.2 8A3 3 0 0 1 17.8 22H2V10h4.4zM7 11.4V20h10.8a1 1 0 0 0 .97-.74l2.2-8A1 1 0 0 0 20 10h-7.94l.95-5.6c.12-.66-.16-1.2-.6-1.37zM5 20v-8H4v8z"/>'),
  thumbOn: svg('<path fill="currentColor" d="M10.7 2.3c.36-.84 1.33-1.4 2.32-1.1 1.6.48 2.36 2.04 2.05 3.6L14.5 8H20a3 3 0 0 1 2.9 3.8l-2.2 8A3 3 0 0 1 17.8 22H7V10.6zM2 10h3v12H2z"/>'),
  chevronDown: svg('<path fill="currentColor" d="M19.3 7.3 12 14.6 4.7 7.3 3.3 8.7l8 8a1 1 0 0 0 1.4 0l8-8z"/>'),
  chevronLeft: svg('<path fill="currentColor" d="m15.4 4.4-7.6 7.6 7.6 7.6-1.4 1.4-8.3-8.3a1 1 0 0 1 0-1.4L14 3z"/>'),
  chevronRight: svg('<path fill="currentColor" d="m8.6 19.6 7.6-7.6-7.6-7.6L10 3l8.3 8.3a1 1 0 0 1 0 1.4L10 21z"/>'),
  caret: svg('<path fill="currentColor" d="M11.3 15.7 6 10.4 7.4 9l4.6 4.6L16.6 9l1.4 1.4-5.3 5.3a1 1 0 0 1-1.4 0"/>'),
  search: svg('<path fill="currentColor" fill-rule="evenodd" d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0m-1.48 6.94a9 9 0 1 1 1.41-1.41l5.78 5.77-1.42 1.42z"/>'),
  bell: svg('<path fill="currentColor" fill-rule="evenodd" d="M13 4.07A7 7 0 0 1 19 11v4.25q1.58.59 2.75 1.3l-.5.87-.5.86A16 16 0 0 0 12 16a16 16 0 0 0-8.75 2.28l-.5-.86-.5-.87A14 14 0 0 1 5 15.25V11a7 7 0 0 1 6-6.93V2h2zM7 14.62q2.24-.6 5-.62t5 .62V11a5 5 0 0 0-10 0zM12 22a4 4 0 0 1-3.86-3h7.72A4 4 0 0 1 12 22"/>'),
  close: svg('<path fill="currentColor" d="M10.59 12 2.3 3.7l1.42-1.4L12 10.58l8.3-8.3 1.4 1.42L13.42 12l8.3 8.3-1.42 1.4L12 13.42l-8.3 8.3-1.4-1.42z"/>'),
  back: svg('<path fill="currentColor" d="M6.41 11H21v2H6.41l5.3 5.3-1.42 1.4-7-7a1 1 0 0 1 0-1.4l7-7 1.42 1.4z"/>'),
  back10: svg('<path fill="currentColor" d="M11.02 2.05A10 10 0 1 1 2 12H0a12 12 0 1 0 5-9.75V1H3v4a1 1 0 0 0 1 1h4V4H6a10 10 0 0 1 5.02-1.95"/><text x="12" y="16.3" text-anchor="middle" fill="currentColor" font-size="8.5" font-weight="700" font-family="Arial,sans-serif">10</text>'),
  fwd10: svg('<path fill="currentColor" d="M6.44 3.69A10 10 0 1 0 22 12h2a12 12 0 1 1-5-9.75V1h2v4a1 1 0 0 1-1 1h-4V4h2a10 10 0 0 0-11.56-.31"/><text x="12" y="16.3" text-anchor="middle" fill="currentColor" font-size="8.5" font-weight="700" font-family="Arial,sans-serif">10</text>'),
  volHigh: svg('<path fill="currentColor" fill-rule="evenodd" d="M24 12c0-4.4-1.78-8.39-4.66-11.27l-1.42 1.42A13.9 13.9 0 0 1 22 12c0 3.87-1.57 7.36-4.1 9.9l1.42 1.4A15.9 15.9 0 0 0 24 12M11 4a1 1 0 0 0-1.7-.7L4.58 8H1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3.59l4.7 4.7A1 1 0 0 0 11 20zM5.7 9.7 9 6.42v11.17L5.7 14.3l-.29-.29H2v-4h3.41zM16 12c0-1.66-.67-3.16-1.76-4.24l1.42-1.42A8 8 0 0 1 18 12a8 8 0 0 1-2.34 5.66l-1.42-1.42A6 6 0 0 0 16 12"/>'),
  volLow: svg('<path fill="currentColor" fill-rule="evenodd" d="M11 4a1 1 0 0 0-1.7-.7L4.58 8H1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3.59l4.7 4.7A1 1 0 0 0 11 20zM5.7 9.7 9 6.42v11.17L5.7 14.3l-.29-.29H2v-4h3.41zM16 12c0-1.66-.67-3.16-1.76-4.24l1.42-1.42A8 8 0 0 1 18 12a8 8 0 0 1-2.34 5.66l-1.42-1.42A6 6 0 0 0 16 12"/>'),
  volOff: svg('<path fill="currentColor" fill-rule="evenodd" d="M11 4a1 1 0 0 0-1.7-.7L4.58 8H1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3.59l4.7 4.7A1 1 0 0 0 11 20zM5.7 9.7 9 6.42v11.17L5.7 14.3l-.29-.29H2v-4h3.41zm9.6 4.88L17.88 12l-2.58-2.58 1.42-1.42 2.58 2.59L21.88 8l1.42 1.42L20.71 12l2.59 2.58-1.42 1.42-2.58-2.59L16.72 16z"/>'),
  next: svg('<path fill="currentColor" d="M22 3h-2v18h2zM2 3.7a1 1 0 0 1 1.5-.86l14.07 8.3a1 1 0 0 1 0 1.72L3.5 21.16A1 1 0 0 1 2 20.3z"/>'),
  episodes: svg('<path fill="currentColor" fill-rule="evenodd" d="M8 5h14v8h2V5a2 2 0 0 0-2-2H8zm10 4H4V7h14a2 2 0 0 1 2 2v8h-2zM0 13c0-1.1.9-2 2-2h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm14 6v-6H2v6z"/>'),
  subtitles: svg('<path fill="currentColor" fill-rule="evenodd" d="M0 4a1 1 0 0 1 1-1h22a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4.6l-4.7 3.7a1 1 0 0 1-1.6-.8V19H1a1 1 0 0 1-1-1zm2 1v12h10a1 1 0 0 1 1 1v1.9l3.38-2.69A1 1 0 0 1 17 17h5V5zm7 7H5v-2h4zm10 0h-8v-2h8zM5 15h8v-2H5zm14 0h-4v-2h4z"/>'),
  speed: svg('<path fill="currentColor" fill-rule="evenodd" d="M19.07 19.07A10 10 0 1 0 4.93 4.93a10 10 0 0 0 14.14 14.14m1.41 1.41A12 12 0 1 0 3.52 3.52a12 12 0 0 0 16.96 16.96M11.7 13.7 17 8.4 15.6 7l-5.3 5.3zM4 13h3v-2H4zm13 0h3v-2h-3zM11 4v3h2V4z"/>'),
  fsEnter: svg('<path fill="currentColor" d="M0 5a2 2 0 0 1 2-2h7v2H2v4H0zm22 0h-7V3h7a2 2 0 0 1 2 2v4h-2zM2 15v4h7v2H2a2 2 0 0 1-2-2v-4zm20 4v-4h2v4a2 2 0 0 1-2 2h-7v-2z"/>'),
  fsExit: svg('<path fill="currentColor" d="M24 8h-5V3h-2v5a2 2 0 0 0 2 2h5zM0 16h5v5h2v-5a2 2 0 0 0-2-2H0zm7-8V3H5v5H0v2h5a2 2 0 0 0 2-2m10 13v-5h7v-2h-5a2 2 0 0 0-2 2v5z"/>'),
  replay: svg('<path fill="currentColor" d="M12 4a8 8 0 1 1-8 8H2a10 10 0 1 0 3-7.14V2H3v6a1 1 0 0 0 1 1h6V7H6.34A8 8 0 0 1 12 4"/>'),
};

// Wordmark in the Netflix style: tall condensed red letters on a curved "cinema screen" baseline.
function wordmark(word = 'YOUFLIX') {
  const n = word.length, h = 44, mid = (n - 1) / 2;
  const adv = c => (c === 'I' ? 11 : c === 'L' || c === 'F' ? 20 : 23); // condensed-font advances
  let x = 0;
  const letters = [...word].map((c, i) => {
    const s = 1 - 0.13 * (1 - ((i - mid) / mid) ** 2); // shorter towards the middle
    const cx = x + adv(c) / 2;
    x += adv(c);
    return `<text x="${cx}" y="${h / 2}" transform="translate(0 ${h / 2}) scale(1 ${s.toFixed(3)}) translate(0 ${-h / 2})" text-anchor="middle" dominant-baseline="central">${c}</text>`;
  }).join('');
  return `<svg class="wordmark" viewBox="0 0 ${x} ${h}" aria-label="${word}" role="img"><g fill="#e50914" font-family="'Bebas Neue','League Gothic',Impact,'Arial Narrow Bold',sans-serif" font-size="48" letter-spacing="0">${letters}</g></svg>`;
}
