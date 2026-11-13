// Offline test: a fake instagram.com that serves feed data and page markup the way
// Instagram does, to check the Instagram Cleaner userscript.
// Run: node test/instagram.test.js
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, '../instagram/instagram-cleaner.user.js'), 'utf8');
const ME = '1000';

const user = (pk, following) => ({ pk, username: 'u' + pk, friendship_status: { following } });
const post = (code, pk, following, extra = {}) => ({
  node: { media: { code, media_type: 1, product_type: 'feed', user: user(pk, following), ...extra } },
});
const reel = (code, pk, following) => ({
  node: { media: { code, media_type: 2, product_type: 'clips', user: user(pk, following) } },
});

const FEED = {
  data: {
    xdt_api__v1__feed__timeline__connection: {
      edges: [
        post('friendPost', '1', true),
        post('strangerPost', '2', false),
        reel('friendReel', '3', true),
        reel('strangerReel', '4', false),
        post('myPost', ME, false),
        post('adPost', '5', false, { ad_id: '123', ad_action: 'install' }),
        { node: { suggested_users: { users: [user('6', false)] } } },
        { node: { clips_netego: { items: [] } } },
        post('unknownStatus', '7', undefined),
      ],
    },
  },
};

const PAGE = (body) => `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<meta name="apple-itunes-app" content="app-id=389801252">
</head><body>${body}</body></html>`;

const HOME = PAGE(`
<nav>
  <a id="navHome" href="/">Home</a><a id="navExplore" href="/explore/">Search</a>
  <a id="navReels" href="/reels/">Reels</a><a id="navDM" href="/direct/inbox/">Messages</a>
  <a id="navProfile" href="/u1000/">Profile</a>
</nav>
<button id="openApp">Open app</button>
<main><div id="feed">
  <div class="row"><article id="aFriend"><header><a href="/u1/">u1</a></header><img><span>nice photo, follow your dreams</span></article></div>
  <div class="row"><article id="aStranger"><header><a href="/u2/">u2</a><div role="button">Follow</div></header><img></article></div>
  <div class="row"><article id="aAd"><header><a href="/u5/">u5</a><span>Sponsored</span></header><img></article></div>
  <div class="row"><article id="aSuggestedPost"><header><span>Suggested for you</span><a href="/u8/">u8</a></header><img></article></div>
  <div class="row" id="suggestBlock"><div><h2><span>Suggested for you</span></h2><div><a href="/u6/">u6</a><button>Follow</button></div></div></div>
  <div class="row"><article id="aFriend2"><header><a href="/u3/">u3</a></header><video></video></article></div>
</div></main>`);

const EXPLORE = PAGE(`
<main>
  <input id="search" placeholder="Search">
  <div id="grid"><a id="tile1" href="/p/abc/"><img></a><a id="tile2" href="/reel/def/"><img></a></div>
</main>`);

const PROFILE = PAGE(`<main><a id="profileTile" href="/p/zzz/"><img></a></main>`);

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
  await ctx.addCookies([{ name: 'ds_user_id', value: ME, domain: 'www.instagram.com', path: '/' }]);
  await ctx.route('https://www.instagram.com/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/graphql') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FEED) });
    if (u.pathname === '/api/v1/feed/timeline/')
      return route.fulfill({ contentType: 'application/json', body: 'for (;;);' + JSON.stringify(FEED) });
    if (u.pathname.startsWith('/explore')) return route.fulfill({ contentType: 'text/html', body: EXPLORE });
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: HOME });
    return route.fulfill({ contentType: 'text/html', body: PROFILE });
  });
  await ctx.addInitScript(SCRIPT);
  const page = await ctx.newPage();

  // ---------- Home feed data ----------
  await page.goto('https://www.instagram.com/');
  const codes = (feed) => feed.data.xdt_api__v1__feed__timeline__connection.edges.map((e) => e.node.media && e.node.media.code);
  const home = await page.evaluate(async () => (await fetch('/api/graphql', { method: 'POST' })).json());
  const kept = codes(home);
  check('home feed: posts from people you follow are kept', kept.includes('friendPost'));
  check('home feed: reels from people you follow are kept', kept.includes('friendReel'));
  check('home feed: your own posts are kept', kept.includes('myPost'));
  check("home feed: posts from accounts you don't follow are removed", !kept.includes('strangerPost'));
  check("home feed: reels from accounts you don't follow are removed", !kept.includes('strangerReel'));
  check('home feed: ads removed', !kept.includes('adPost'));
  check('home feed: "Suggested for you" accounts and suggested reels removed', home.data.xdt_api__v1__feed__timeline__connection.edges.length === kept.filter(Boolean).length);
  check('home feed: posts with unknown follow status are kept (never hide by mistake)', kept.includes('unknownStatus'));

  const xhr = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.open('GET', '/api/v1/feed/timeline/');
        x.onload = () => resolve(x.responseText);
        x.send();
      })
  );
  check('XHR with "for (;;);" prefix: still valid and cleaned', xhr.startsWith('for (;;);') && !xhr.includes('strangerPost') && xhr.includes('friendPost'));

  const parsed = await page.evaluate((s) => JSON.parse(s), JSON.stringify(FEED) + ' '.repeat(10));
  check('embedded page data (JSON.parse) cleaned', !JSON.stringify(parsed).includes('strangerReel') && JSON.stringify(parsed).includes('friendReel'));

  // ---------- Home feed page ----------
  await page.waitForTimeout(400);
  const d = await page.evaluate(() => {
    const vis = (id) => getComputedStyle(document.getElementById(id)).display !== 'none' && !document.getElementById(id).closest('[data-igc-hidden]');
    return {
      friend: vis('aFriend'), friend2: vis('aFriend2'), stranger: vis('aStranger'), ad: vis('aAd'), sugPost: vis('aSuggestedPost'),
      sugBlock: vis('suggestBlock'), navReels: vis('navReels'), navHome: vis('navHome'), navExplore: vis('navExplore'),
      navDM: vis('navDM'), openApp: vis('openApp'), banner: !!document.querySelector('meta[name="apple-itunes-app"]'),
    };
  });
  check('page: posts from people you follow visible (even with "follow" in the caption)', d.friend && d.friend2);
  check('page: post with a "Follow" button (account you don\'t follow) hidden', !d.stranger);
  check('page: "Sponsored" post hidden', !d.ad);
  check('page: "Suggested for you" post hidden', !d.sugPost);
  check('page: "Suggested for you" carousel hidden', !d.sugBlock);
  check('page: Reels tab hidden', !d.navReels);
  check('page: Home, Search and Messages tabs still visible', d.navHome && d.navExplore && d.navDM);
  check('page: "Open app" button and Safari app banner tag removed', !d.openApp && !d.banner);

  // ---------- Profile page: someone you searched for ----------
  await page.goto('https://www.instagram.com/u2/');
  const prof = await page.evaluate(async () => (await fetch('/api/graphql', { method: 'POST' })).json());
  const pk = codes(prof);
  check("profile you visit: their posts and reels show even if you don't follow them", pk.includes('strangerPost') && pk.includes('strangerReel'));
  check('profile you visit: ads still removed', !pk.includes('adPost'));
  check('profile you visit: grid visible', await page.evaluate(() => getComputedStyle(document.getElementById('profileTile')).display !== 'none'));

  // ---------- Explore / search ----------
  await page.goto('https://www.instagram.com/explore/');
  await page.waitForTimeout(300);
  const ex = await page.evaluate(() => ({
    t1: getComputedStyle(document.getElementById('tile1')).display,
    t2: getComputedStyle(document.getElementById('tile2')).display,
    search: getComputedStyle(document.getElementById('search')).display,
  }));
  check('Explore: recommended grid hidden', ex.t1 === 'none' && ex.t2 === 'none');
  check('Explore: search box still works', ex.search !== 'none');
  await page.goto('https://www.instagram.com/explore/search/keyword/?q=cats');
  await page.waitForTimeout(300);
  check('search results (reels/posts you searched for) visible', await page.evaluate(() => getComputedStyle(document.getElementById('tile2')).display !== 'none'));

  // ---------- Reels routing ----------
  await page.goto('https://www.instagram.com/reels/');
  await page.waitForURL((u) => u.pathname === '/', { timeout: 5000 }).catch(() => {});
  check('Reels tab (/reels/) sends you to your home feed', new URL(page.url()).pathname === '/');

  await page.goto('https://www.instagram.com/reels/C1aBcDeFgH/');
  await page.waitForURL(/\/reel\/C1aBcDeFgH\/$/, { timeout: 5000 }).catch(() => {});
  check('a reel sent to you opens on its own (no endless Reels feed after it)', new URL(page.url()).pathname === '/reel/C1aBcDeFgH/');

  await page.goto('https://www.instagram.com/reel/C1aBcDeFgH/');
  await page.waitForTimeout(500);
  check('single reel links (from DMs, search, people you follow) still open', new URL(page.url()).pathname === '/reel/C1aBcDeFgH/');

  await page.goto('https://www.instagram.com/direct/inbox/');
  await page.waitForTimeout(300);
  check('Messages untouched', new URL(page.url()).pathname === '/direct/inbox/');

  // In-app navigation (Instagram is a single-page app)
  await page.goto('https://www.instagram.com/');
  await page.evaluate(() => history.pushState({}, '', '/reels/'));
  await page.waitForURL((u) => u.pathname === '/', { timeout: 5000 }).catch(() => {});
  check('tapping into Reels inside the app also redirects', new URL(page.url()).pathname === '/');

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
})();
