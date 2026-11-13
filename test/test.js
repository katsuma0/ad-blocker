// Offline test: serves a fake m.youtube.com page that behaves like YouTube's ad
// system and checks the userscript removes / skips every ad.
// Run: node test/test.js
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, '../youtube/youtube-adblock.user.js'), 'utf8');

// Tiny silent WebM-free "video": we fake duration via a data-driven stub instead of real media.
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<script>
  // Inline initial data, exactly like YouTube does it
  var ytInitialPlayerResponse = {
    videoDetails: { videoId: 'abc', title: 'Real video' },
    streamingData: { formats: [1] },
    adPlacements: [{ adPlacementRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }]
  };
  var ytInitialData = { contents: { items: [
    { richItemRenderer: { content: { videoRenderer: { videoId: 'v1' } } } },
    { richItemRenderer: { content: { adSlotRenderer: { ad: 1 } } } },
    { promotedSparklesWebRenderer: { ad: 1 } },
    { richSectionRenderer: { content: { statementBannerRenderer: { ad: 1 } } } },
    { richItemRenderer: { content: { videoRenderer: { videoId: 'v2' } } } },
    { richSectionRenderer: { content: { richShelfRenderer: { isShorts: true, contents: [{ richItemRenderer: { content: { shortsLockupViewModel: { id: 's1' } } } }] } } } },
    { richItemRenderer: { content: { shortsLockupViewModel: { id: 's2' } } } },
    { reelShelfRenderer: { items: [{ reelItemRenderer: { videoId: 's3' } }] } }
  ]},
  pivotBar: { items: [
    { pivotBarItemRenderer: { pivotIdentifier: 'FEwhat_to_watch', navigationEndpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } } } },
    { pivotBarItemRenderer: { pivotIdentifier: 'FEshorts', navigationEndpoint: { browseEndpoint: { browseId: 'FEshorts' } } } },
    { pivotBarItemRenderer: { pivotIdentifier: 'FEsubscriptions', navigationEndpoint: { browseEndpoint: { browseId: 'FEsubscriptions' } } } }
  ]}};
</script></head><body>
<div id="movie_player" class="html5-video-player"><video></video></div>
<ytm-promoted-sparkles-web-renderer id="promo">AD</ytm-promoted-sparkles-web-renderer>
<ytm-companion-ad-renderer id="companion">AD</ytm-companion-ad-renderer>
<div id="real">real content</div>
<ytm-reel-shelf-renderer id="shortsShelf">SHORTS</ytm-reel-shelf-renderer>
<ytm-pivot-bar-item-renderer id="shortsTab"><div class="pivot-shorts">Shorts</div></ytm-pivot-bar-item-renderer>
<ytm-pivot-bar-item-renderer id="homeTab"><div class="pivot-w2w">Home</div></ytm-pivot-bar-item-renderer>
<ytm-video-with-context-renderer id="shortResult"><a href="/shorts/xyz12345678">a short</a></ytm-video-with-context-renderer>
<ytm-video-with-context-renderer id="videoResult"><a href="/watch?v=xyz12345678">a video</a></ytm-video-with-context-renderer>
</body></html>`;

const PLAYER_API = {
  videoDetails: { videoId: 'next' },
  adPlacements: [{ x: 1 }],
  playerAds: [{ x: 1 }],
};
const SEARCH_API = {
  contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
    { videoRenderer: { videoId: 'normal1', navigationEndpoint: { watchEndpoint: { videoId: 'normal1' } } } },
    { reelShelfRenderer: { items: [{ reelItemRenderer: { videoId: 'sh1' } }] } },
    { videoRenderer: { videoId: 'short1', navigationEndpoint: { reelWatchEndpoint: { videoId: 'short1' } } } },
    { videoRenderer: { videoId: 'normal2', navigationEndpoint: { watchEndpoint: { videoId: 'normal2' } } } },
  ] } }] } },
};
const NEXT_API = {
  contents: {
    results: [
      { compactVideoRenderer: { videoId: 'ok' } },
      { compactPromotedVideoRenderer: { ad: 1 } },
      { adSlotRenderer: { ad: 1 } },
    ],
  },
  overlay: { enforcementMessageViewModel: { text: 'Ad blockers violate YouTube Terms' } },
};

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
  await ctx.route('https://m.youtube.com/**', (route) => {
    const u = route.request().url();
    if (u.includes('/youtubei/v1/player'))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PLAYER_API) });
    if (u.includes('/youtubei/v1/search'))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(SEARCH_API) });
    if (u.includes('/youtubei/v1/next'))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(NEXT_API) });
    return route.fulfill({ contentType: 'text/html', body: PAGE });
  });
  // Same as Userscripts' @run-at document-start + @inject-into page
  await ctx.addInitScript(SCRIPT);
  const page = await ctx.newPage();
  await page.goto('https://m.youtube.com/watch?v=abc');

  const init = await page.evaluate(() => ({
    pr: window.ytInitialPlayerResponse,
    feed: window.ytInitialData.contents.items,
  }));
  check('initial player response: adPlacements removed', !('adPlacements' in init.pr));
  check('initial player response: playerAds removed', !('playerAds' in init.pr));
  check('initial player response: adSlots removed', !('adSlots' in init.pr));
  check('initial player response: real video kept', init.pr.videoDetails.videoId === 'abc' && init.pr.streamingData);
  check('home feed: ads and Shorts removed, 2 videos kept', init.feed.length === 2 && JSON.stringify(init.feed).indexOf('adSlot') < 0);
  check('home feed: no Shorts left', !/shortsLockup|reelShelf|reelItem/.test(JSON.stringify(init.feed)));
  const tabs = await page.evaluate(() => window.ytInitialData.pivotBar.items.map((i) => i.pivotBarItemRenderer.pivotIdentifier));
  check('bottom bar: Shorts tab removed, Home & Subscriptions kept', tabs.join() === 'FEwhat_to_watch,FEsubscriptions');

  const player = await page.evaluate(async () => (await fetch('/youtubei/v1/player?key=x', { method: 'POST' })).json());
  check('fetch /player: ads stripped', !player.adPlacements && !player.playerAds && player.videoDetails.videoId === 'next');

  const next = await page.evaluate(async () => (await fetch('/youtubei/v1/next')).json());
  check('fetch /next: promoted results removed', next.contents.results.length === 1);
  check('fetch /next: anti-adblock popup removed', !JSON.stringify(next).includes('enforcementMessage'));

  const search = await page.evaluate(async () => (await fetch('/youtubei/v1/search')).json());
  const ids = search.contents.sectionListRenderer.contents[0].itemSectionRenderer.contents.map((c) => c.videoRenderer && c.videoRenderer.videoId);
  check('search: Shorts shelf and Short results removed, normal videos kept', ids.join() === 'normal1,normal2');

  const xhr = await page.evaluate(
    () =>
      new Promise((r) => {
        const x = new XMLHttpRequest();
        x.open('POST', '/youtubei/v1/player');
        x.onload = () => r(JSON.parse(x.responseText));
        x.send();
      })
  );
  check('XHR /player: ads stripped', !xhr.adPlacements && !xhr.playerAds);

  const parsed = await page.evaluate(() => JSON.parse('{"adPlacements":[1],"playerAds":[2],"videoDetails":{"id":"z"}}'));
  check('JSON.parse path: ads stripped', !parsed.adPlacements && parsed.videoDetails.id === 'z');

  const hidden = await page.evaluate(() => ({
    promo: getComputedStyle(document.getElementById('promo')).display,
    comp: getComputedStyle(document.getElementById('companion')).display,
    real: getComputedStyle(document.getElementById('real')).display,
  }));
  check('ad elements hidden by CSS', hidden.promo === 'none' && hidden.comp === 'none');
  const shortsDom = await page.evaluate(() => {
    const d = (id) => getComputedStyle(document.getElementById(id)).display;
    return { shelf: d('shortsShelf'), tab: d('shortsTab'), home: d('homeTab'), sr: d('shortResult'), vr: d('videoResult') };
  });
  check('Shorts shelf, Shorts tab and Short results hidden', shortsDom.shelf === 'none' && shortsDom.tab === 'none' && shortsDom.sr === 'none');
  check('Home tab and normal video results still visible', shortsDom.home !== 'none' && shortsDom.vr !== 'none');
  check('real content still visible', hidden.real !== 'none');

  // Simulate an ad that still makes it into the player + a skip button.
  const skip = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const v = document.querySelector('video');
        Object.defineProperty(v, 'duration', { value: 15, configurable: true });
        let t = 0;
        Object.defineProperty(v, 'currentTime', { get: () => t, set: (x) => (t = x), configurable: true });
        let clicked = false;
        const btn = document.createElement('button');
        btn.className = 'ytp-skip-ad-button';
        btn.onclick = () => (clicked = true);
        document.getElementById('movie_player').appendChild(btn);
        document.getElementById('movie_player').classList.add('ad-showing');
        setTimeout(() => resolve({ t, clicked, muted: v.muted, rate: v.playbackRate }), 700);
      })
  );
  check('ad in player: jumped to end', skip.t === 15);
  check('ad in player: skip button clicked', skip.clicked);
  check('ad in player: muted while ad runs', skip.muted === true);

  const after = await page.evaluate(
    () =>
      new Promise((resolve) => {
        document.getElementById('movie_player').classList.remove('ad-showing');
        setTimeout(() => {
          const v = document.querySelector('video');
          resolve({ muted: v.muted, rate: v.playbackRate });
        }, 700);
      })
  );
  check('after ad: sound and speed restored', after.muted === false && after.rate === 1);

  const dialog = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const d = document.createElement('ytm-enforcement-message-view-model');
        document.body.appendChild(d);
        setTimeout(() => resolve(!document.querySelector('ytm-enforcement-message-view-model')), 700);
      })
  );
  check('anti-adblock dialog removed from page', dialog);

  // Opening a Shorts link should land on the normal video player instead.
  await page.goto('https://m.youtube.com/shorts/dQw4w9WgXcQ');
  await page.waitForURL(/watch\?v=/, { timeout: 5000 }).catch(() => {});
  check('Shorts link opens as a normal video (/watch?v=…)', page.url() === 'https://m.youtube.com/watch?v=dQw4w9WgXcQ');

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
})();
