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
<div id="topNav" style="position:fixed;top:0;left:0;right:0;height:44px">
  <span>Instagram</span><a href="/accounts/activity/">Notifications</a><a href="/direct/inbox/">DM</a>
  <button id="navOpenApp">Open in app now</button>
</div>
<div id="topBanner" style="position:sticky;top:0;height:56px"><div><img src="icon.png"><span>Instagram</span><span>Open in app</span></div><a id="topBannerBtn" href="https://app.link/x">Open</a></div>
<div id="bottomBanner" style="position:fixed;bottom:0;left:0;right:0;height:64px">
  <div><img src="icon.png"><div><span>Instagram</span><span>Get the full experience</span></div></div>
  <a href="https://apps.apple.com/app/instagram/id389801252"><span>Download now</span></a>
</div>
<div role="dialog" id="appDialog"><span>See more on the app</span><button>Open Instagram</button><button id="notNow">Not now</button></div>
<div role="dialog" id="loginDialog"><input type="password"><button>Log in</button><a href="https://apps.apple.com/app/id389801252">Get the app</a></div>
<main><div id="feed">
  <div class="row"><article id="aFriend"><header><a href="/u1/">u1</a> <time datetime="2026-11-13T10:00:00Z">2h</time></header><img src="x.jpg"><span>nice photo, follow your dreams</span></article></div>
  <div class="row"><article id="aStranger"><header><a href="/u2/">u2</a> <time datetime="2026-11-13T10:00:00Z">2h</time><div role="button">Follow</div></header><img src="x.jpg"></article></div>
  <div class="row"><article id="aAd"><header><a href="/u5/">u5</a><span>Sponsored</span></header><img></article></div>
  <div class="row"><article id="aSuggestedPost"><header><span>Suggested for you</span><a href="/u8/">u8</a></header><img></article></div>
  <div class="row" id="suggestBlock"><div><h2><span>Suggested for you</span></h2><div><a href="/u6/">u6</a><button>Follow</button></div></div></div>
  <div class="row"><article id="aFriend2"><header><a href="/u3/">u3</a> <time datetime="2026-11-13T10:00:00Z">2h</time></header><video></video></article></div>
  <!-- Ad whose "Sponsored" label is split up with a hidden decoy letter -->
  <div class="row"><article id="aAdSplit"><header><a href="/brand/">brand</a><span><span>Spo</span><span style="display:none">q</span><span>nsored</span></span></header><img src="x.jpg"></article></div>
  <!-- Ad with no label at all: only giveaway is the missing date -->
  <div class="row"><article id="aAdNoDate"><header><a href="/brand2/">brand2</a></header><img src="x.jpg"><a href="https://l.instagram.com/?u=shop">Shop now</a></article></div>
  <!-- Suggestions block that isn't an <article>, label wrapped in extra elements -->
  <div class="row" id="suggestBlock2"><div><div><span><span>Suggested</span> <span>reels</span></span><a href="/explore/">See all</a></div><div><a href="/reel/r1/">r</a><a href="/reel/r2/">r</a></div></div></div>
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

  await ctx.addInitScript(() => {
    new MutationObserver(() => {
      const s = document.getElementById('igc-status');
      if (s && s.textContent === 'Instagram Cleaner is on') window.__statusSeen = true;
    }).observe(document, { childList: true, subtree: true });
  });

  await ctx.addInitScript(() => {
    document.addEventListener('click', (e) => { if (e.target && e.target.id === 'notNow') window.__notNow = true; }, true);
  });

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
      topNav: vis('topNav'), navOpenApp: vis('navOpenApp'), topBanner: vis('topBanner'), bottomBanner: vis('bottomBanner'),
      notNowClicked: window.__notNow === true, loginDialog: vis('loginDialog'),
      adSplit: vis('aAdSplit'), adNoDate: vis('aAdNoDate'), sugBlock2: vis('suggestBlock2'), status: window.__statusSeen,
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
  check('"Download now" banner at the bottom: whole banner hidden', !d.bottomBanner);
  check('"Open in app" banner at the top: whole banner hidden', !d.topBanner);
  check('"Open in app now" button in the top bar hidden, top bar itself kept', !d.navOpenApp && d.topNav);
  check('"Use the app" popup closed with "Not now"', d.notNowClicked);
  check('login popup never hidden', d.loginDialog);
  check('page: ad with a split-up "Sponsored" label hidden', !d.adSplit);
  check('page: ad with no label (no post date) hidden', !d.adNoDate);
  check('page: "Suggested reels" block with nested label hidden', !d.sugBlock2);
  check('page: "Instagram Cleaner is on" message shown', d.status);

  const safety = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // Pretend Instagram stopped showing dates: posts must NOT be treated as ads.
        document.querySelectorAll('time').forEach((t) => t.remove());
        const fresh = document.createElement('div');
        fresh.innerHTML = '<article id="aNoDates"><header><a href="/u9/">u9</a></header><img src="x.jpg"></article>';
        document.getElementById('feed').appendChild(fresh);
        setTimeout(() => resolve(!document.getElementById('aNoDates').closest('[data-igc-hidden]')), 1500);
      })
  );
  check('safety: if Instagram shows no dates at all, posts are not hidden as ads', safety);

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
