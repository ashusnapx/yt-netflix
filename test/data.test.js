// Self-check for src/data.js parsing helpers. Run: node test/data.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = { window: { addEventListener() {} }, location: { origin: 'https://www.youtube.com' }, document: { cookie: '' }, URL, URLSearchParams };
vm.createContext(ctx);
vm.runInContext(`${fs.readFileSync(`${__dirname}/../src/data.js`, 'utf8')}
  ;Object.assign(globalThis, { parseCount, parseDuration, runtime, isRecent, extractJson, videos, shelves, playlists, text });`, ctx);
const { parseCount, parseDuration, runtime, isRecent, extractJson, videos, shelves, playlists } = ctx;

assert.strictEqual(parseCount('1.2M views'), 1.2e6);
assert.strictEqual(parseCount('1,234 views'), 1234);
assert.strictEqual(parseCount('12K watching'), 12000);
assert.strictEqual(parseDuration('1:02:03'), 3723);
assert.strictEqual(parseDuration('4:05'), 245);
assert.strictEqual(runtime(3723), '1h 2m');
assert.strictEqual(runtime(245), '4m');
assert.ok(isRecent('3 days ago') && isRecent('Streamed 5 hours ago') && !isRecent('2 weeks ago') && !isRecent('8 days ago'));

const html = `<script>var ytInitialData = {"a":"}{\\"","b":{"c":[1,2]}};</script>`;
assert.deepStrictEqual(JSON.parse(JSON.stringify(extractJson(html, 'ytInitialData'))), { a: '}{"', b: { c: [1, 2] } });
assert.strictEqual(extractJson('<html></html>', 'ytInitialData'), null);

const data = {
  contents: [
    { videoRenderer: { videoId: 'aaaaaaaaaaa', title: { runs: [{ text: 'Classic' }] }, lengthText: { simpleText: '10:00' },
      ownerText: { runs: [{ text: 'Chan', navigationEndpoint: { browseEndpoint: { browseId: 'UCx', canonicalBaseUrl: '/@chan' } } }] },
      viewCountText: { simpleText: '1,000 views' }, publishedTimeText: { simpleText: '2 days ago' },
      thumbnailOverlays: [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 40 } }] } },
    { videoRenderer: { videoId: 'sssssssssss', title: { runs: [{ text: 'Short' }] }, navigationEndpoint: { reelWatchEndpoint: {} } } },
    { adSlotRenderer: { videoRenderer: { videoId: 'ddddddddddd', title: { simpleText: 'Ad' } } } },
    { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'bbbbbbbbbbb',
      metadata: { lockupMetadataViewModel: { title: { content: 'Lockup' }, metadata: { contentMetadataViewModel: { metadataRows: [
        { metadataParts: [{ text: { content: 'Other' } }] }, { metadataParts: [{ text: { content: '2M views' } }, { text: { content: '1 year ago' } }] }] } } } },
      contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '3:21' } }] } }] } } } },
    { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentId: 'PL123', metadata: { lockupMetadataViewModel: { title: { content: 'Season A' } } } } },
  ],
};
const vs = videos(data);
assert.strictEqual(vs.map(v => v.id).join(), 'aaaaaaaaaaa,bbbbbbbbbbb', 'shorts, ads and playlists are skipped');
assert.strictEqual(vs[0].channelUrl, '/@chan');
assert.strictEqual(vs[0].progress, 40);
assert.strictEqual(vs[1].duration, '3:21');
assert.strictEqual(vs[1].viewCount, 2e6);
assert.strictEqual(vs[1].age, '1 year ago');
assert.deepStrictEqual(JSON.parse(JSON.stringify(playlists(data))), [{ id: 'PL123', title: 'Season A' }]);
assert.strictEqual(shelves({ shelfRenderer: { title: { simpleText: 'Few' }, content: data } }).length, 0, 'shelves need 3+ videos');

console.log('data.js self-check passed');
