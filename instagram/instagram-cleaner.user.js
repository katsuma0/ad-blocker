// ==UserScript==
// @name         Instagram Cleaner (iPhone Safari)
// @namespace    ad-blocker
// @version      1.2.0
// @description  Instagram in Safari with only accounts you follow: no Reels feed, no suggested posts, no ads, no Explore grid. Reels still work from search, people you follow, and DMs.
// @match        *://www.instagram.com/*
// @match        *://instagram.com/*
// @run-at       document-start
// @inject-into  auto
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__igCleanerInstalled) return;
  window.__igCleanerInstalled = true;

  // ===== SETTINGS =====
  // true = no Reels tab / Reels feed. Reels still open when you search for them, when they're
  //        from people you follow, or when someone sends you one.
  const HIDE_REELS_FEED = true;
  // true = your home feed only shows posts and reels from accounts you follow (and your own).
  const ONLY_FOLLOWING_IN_FEED = true;
  // true = remove the grid of recommended posts on the Explore/search page (search still works).
  const HIDE_EXPLORE_GRID = true;
  // true = remove ads ("Sponsored") everywhere.
  const HIDE_ADS = true;
  // true = remove "Suggested for you" accounts, suggested posts and suggested reels.
  const HIDE_SUGGESTIONS = true;
  // true = remove the "Open in the Instagram app" banner and "Open app" / "Use the app" prompts.
  const HIDE_OPEN_APP = true;
  // true = briefly show "Instagram Cleaner is on" when a page loads, so you know it's running.
  const SHOW_STATUS = true;
  // ====================

  // Your own account ID (Instagram keeps it in a readable cookie), so your own posts are never hidden.
  function viewerId() {
    const m = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/);
    return m ? m[1] : null;
  }

  const path = () => location.pathname;
  const onHomeFeed = () => path() === '/' || path() === '';

  // ---------------------------------------------------------------------------
  // Layer 1: clean Instagram's data before it's shown.
  // ---------------------------------------------------------------------------

  // Feed entries that are suggestions rather than posts.
  const SUGGESTION_KEY = /netego|^suggested_|^suggestions?$|^explore_story$|^stories_netego$|^clips_netego$|^bloks_netego$/;

  function findMedia(item) {
    if (!item || typeof item !== 'object') return null;
    const n = item.node && typeof item.node === 'object' ? item.node : null;
    const cand = [item.media, item.media_or_ad, n && n.media, n && n.media_or_ad, n, item];
    for (const c of cand) {
      if (c && typeof c === 'object' && c.user && typeof c.user === 'object' && (c.code || c.shortcode || c.media_type != null)) return c;
    }
    return null;
  }

  function isAd(item, media) {
    const n = item.node && typeof item.node === 'object' ? item.node : {};
    if (item.ad_id || n.ad_id || (item.ad && typeof item.ad === 'object') || (n.ad && typeof n.ad === 'object')) return true;
    if (media && (media.ad_id || media.ad_action || media.injected || media.is_ad || media.ad_metadata || media.is_sponsored)) return true;
    const tn = String(item.__typename || n.__typename || '');
    return /Ad(Item|Media)?$|Sponsored/.test(tn);
  }

  function isSuggestion(item) {
    const n = item.node && typeof item.node === 'object' ? item.node : {};
    for (const k of Object.keys(item).concat(Object.keys(n))) {
      if (SUGGESTION_KEY.test(k) && (item[k] || n[k])) return true;
    }
    return false;
  }

  function isNotFollowed(media) {
    if (!media || !media.user) return false;
    const fs = media.user.friendship_status;
    if (!fs || fs.following !== false) return false; // unknown = keep
    const me = viewerId();
    const uid = String(media.user.pk || media.user.id || '');
    return !(me && uid === me);
  }

  function isReel(media) {
    return !!media && media.product_type === 'clips';
  }

  let removed = 0;

  function shouldDrop(item, home) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const media = findMedia(item);
    if (HIDE_ADS && isAd(item, media)) return true;
    if (HIDE_SUGGESTIONS && isSuggestion(item)) return true;
    if (home && ONLY_FOLLOWING_IN_FEED && isNotFollowed(media)) return true;
    if (home && HIDE_REELS_FEED && isReel(media) && isNotFollowed(media)) return true;
    return false;
  }

  function prune(obj, home, depth) {
    if (!obj || typeof obj !== 'object' || depth > 40) return obj;
    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (shouldDrop(obj[i], home)) {
          obj.splice(i, 1);
          removed++;
        } else prune(obj[i], home, depth + 1);
      }
      return obj;
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (!v || typeof v !== 'object') continue;
      if (HIDE_SUGGESTIONS && SUGGESTION_KEY.test(k)) {
        delete obj[k];
        removed++;
        continue;
      }
      prune(v, home, depth + 1);
    }
    return obj;
  }

  function safePrune(obj) {
    try {
      return prune(obj, onHomeFeed(), 0);
    } catch (e) {
      return obj;
    }
  }

  // Instagram sometimes prefixes JSON with "for (;;);" and sometimes streams several JSON
  // documents separated by newlines. Handle both.
  function cleanText(text) {
    let prefix = '';
    let body = text;
    const m = body.match(/^\s*for\s*\(;;\);/);
    if (m) {
      prefix = m[0];
      body = body.slice(m[0].length);
    }
    try {
      return prefix + JSON.stringify(safePrune(origParse(body)));
    } catch (e) {}
    const lines = body.split('\n');
    let changed = false;
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      try {
        changed = true;
        return JSON.stringify(safePrune(origParse(line)));
      } catch (e) {
        return line;
      }
    });
    return changed ? prefix + out.join('\n') : text;
  }

  const HINT = /friendship_status|netego|suggested|ad_id|ad_action|explore_story|product_type|"injected"/;
  const API_RE = /\/(api\/graphql|graphql\/query|api\/v1\/)/;

  // JSON.parse: catches data embedded in the page and parsed by Instagram's code.
  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const result = origParse.call(this, text, reviver);
    if (typeof text === 'string' && text.length > 200 && HINT.test(text)) safePrune(result);
    return result;
  };

  // fetch
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input) {
      const url = typeof input === 'string' ? input : input && input.url;
      const p = origFetch.apply(this, arguments);
      if (!url || !API_RE.test(url)) return p;
      return p.then(async (res) => {
        try {
          const text = await res.clone().text();
          if (!HINT.test(text)) return res;
          const out = new Response(cleanText(text), { status: res.status, statusText: res.statusText, headers: res.headers });
          try {
            Object.defineProperty(out, 'url', { value: res.url });
          } catch (e) {}
          return out;
        } catch (e) {
          return res;
        }
      });
    };
  }

  // XMLHttpRequest
  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const origOpen = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      this.__igc = typeof url === 'string' && API_RE.test(url);
      this.__igcCache = undefined;
      return origOpen.apply(this, arguments);
    };
    for (const prop of ['responseText', 'response']) {
      const desc = Object.getOwnPropertyDescriptor(XHR.prototype, prop);
      if (!desc || !desc.get) continue;
      Object.defineProperty(XHR.prototype, prop, {
        configurable: true,
        get() {
          const v = desc.get.call(this);
          if (!this.__igc || this.readyState !== 4) return v;
          try {
            if (typeof v === 'string') {
              if (this.__igcCache === undefined) this.__igcCache = HINT.test(v) ? cleanText(v) : v;
              return this.__igcCache;
            }
            if (v && typeof v === 'object' && !(v instanceof ArrayBuffer) && !(v instanceof Blob)) return safePrune(v);
          } catch (e) {}
          return v;
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 2: page rules — Reels feed redirects, Explore grid, page markers.
  // ---------------------------------------------------------------------------

  function routeCheck() {
    const p = path();
    if (HIDE_REELS_FEED) {
      // The Reels tab (endless recommended reels) -> home feed.
      if (/^\/reels\/?$/.test(p)) return location.replace('/');
      // A reel opened in the swipeable Reels viewer -> open just that one reel.
      const m = p.match(/^\/reels\/([\w-]+)\/?$/);
      if (m && m[1] !== 'audio') return location.replace('/reel/' + m[1] + '/');
    }
    const root = document.documentElement;
    if (root) {
      root.classList.toggle('igc-home', onHomeFeed());
      root.classList.toggle('igc-explore', /^\/explore\/?$/.test(p));
    }
  }

  // Catch Instagram's in-app navigation immediately.
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function () {
      const r = orig.apply(this, arguments);
      try {
        routeCheck();
      } catch (e) {}
      return r;
    };
  }
  window.addEventListener('popstate', routeCheck);

  // ---------------------------------------------------------------------------
  // Layer 3: hide anything left on screen (works even if Instagram changes its data).
  // ---------------------------------------------------------------------------

  const CSS = [
    HIDE_REELS_FEED ? `a[href="/reels/"], a[href^="/reels/?"] { display: none !important; }` : '',
    HIDE_EXPLORE_GRID
      ? `html.igc-explore main a[href*="/p/"], html.igc-explore main a[href*="/reel/"],
         html.igc-explore main a[href*="/reels/"] { display: none !important; }`
      : '',
    HIDE_OPEN_APP
      ? `a[href*="apps.apple.com"], a[href*="itunes.apple.com"], a[href^="instagram://"] { display: none !important; }`
      : '',
    `[data-igc-hidden] { display: none !important; }`,
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('igc-style')) return;
    const style = document.createElement('style');
    style.id = 'igc-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // Text as it appears on screen. innerText skips hidden decoy letters, so a label split up
  // like "Sp<hidden>x</hidden>onsored" still reads "Sponsored". Whitespace is squashed.
  const shown = (el) => ((el.innerText != null ? el.innerText : el.textContent) || '').replace(/\s+/g, ' ').trim();
  const raw = (el) => (el.textContent || '').trim();

  const AD_TEXT = /^(sponsored|ad|ads|paid partnership with meta)$/i;
  const SUGGESTION_TEXT =
    /^(suggested for you|suggested posts|suggested post|suggested reels|suggested reel|suggestions for you|suggested accounts|suggested threads|you might like|discover more|recommended for you|based on your activity|more posts for you|popular on instagram|trending reels|reels for you)$/i;
  // Buttons that push you to the Instagram app.
  const OPEN_APP_TEXT =
    /^(open( it)?( in)?( the)?( instagram)?( app)?( now)?|use( the)?( instagram)? app( now)?|get( the)?( instagram)? app( now)?|download( the)?( instagram)?( app)?( now)?|install( the)?( instagram)?( app)?( now)?|switch to( the)? app|continue in( the)? app|view in( the)? app|see (it|this|more) in( the)? app|open instagram( app)?|get instagram|get the full experience)$/i;
  // Text on the banner/popup itself.
  const APP_PROMO_TEXT = /(get the (full )?(instagram )?(app|experience)|instagram is better on the app|see more (posts )?(in|on) the app|continue (in|on) the app|use the app|download (the )?instagram|open (in )?(the )?(instagram )?app)/i;
  const DISMISS_TEXT = /^(not now|close|cancel|no thanks|dismiss|maybe later|continue on web|stay on web|use (the )?(mobile )?web(site)?)$/i;

  function hide(el) {
    if (el && el !== document.body && el !== document.documentElement && !el.hasAttribute('data-igc-hidden')) {
      el.setAttribute('data-igc-hidden', '');
      removed++;
    }
  }

  const POST_SEL = 'article, div[role="article"]';

  // The block (post, carousel, section) that `el` belongs to inside the feed list.
  function feedBlockOf(el) {
    const post = el.closest(POST_SEL);
    if (post) return post;
    // Climb to the element that sits directly in the feed list next to real posts.
    const anyPost = document.querySelector(POST_SEL);
    if (anyPost) {
      const chain = new Set();
      for (let a = anyPost; a; a = a.parentElement) chain.add(a);
      let cur = el;
      while (cur.parentElement && !chain.has(cur.parentElement)) cur = cur.parentElement;
      if (cur.parentElement && cur !== document.body) return cur;
    }
    // No posts on screen to compare with: climb until we reach a section with siblings,
    // but never further than a reasonably sized block (so the whole page is never hidden).
    let cur = el;
    while (cur.parentElement && cur.parentElement !== document.body && cur.parentElement.tagName !== 'MAIN') {
      const parent = cur.parentElement;
      if (parent.childElementCount >= 3 && cur.getBoundingClientRect().height > 80) break;
      cur = parent;
    }
    return cur;
  }

  // Short pieces of text inside `root` (labels, buttons), deepest first.
  function labels(root) {
    const out = [];
    for (const el of root.querySelectorAll('span, div, a, button, h2, h3, h4, [aria-label]')) {
      const t = raw(el);
      if (t.length > 60) continue;
      const aria = el.getAttribute('aria-label') || '';
      if (!t && !aria) continue;
      out.push(el);
    }
    return out;
  }

  function isFollowButton(el) {
    const t = shown(el);
    if (!/^follow$/i.test(t)) return false;
    return el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || !!el.closest('button, [role="button"]');
  }

  let postsHaveDates = false;

  function checkPost(art, home) {
    let reason = null;
    for (const el of labels(art)) {
      const t = shown(el);
      const aria = el.getAttribute('aria-label') || '';
      if (HIDE_ADS && (AD_TEXT.test(t) || AD_TEXT.test(aria))) reason = 'ad';
      else if (HIDE_SUGGESTIONS && SUGGESTION_TEXT.test(t)) reason = 'suggested';
      // Instagram only shows a "Follow" button on posts from accounts you don't follow.
      else if (home && ONLY_FOLLOWING_IN_FEED && isFollowButton(el)) reason = 'not-following';
      if (reason) break;
    }
    // Ads have no post date. A loaded post on Home with media but no date is an ad.
    // Only used when other posts on the page do show dates, so this can never empty your feed.
    if (!reason && HIDE_ADS && home && postsHaveDates && !art.querySelector('time') && art.querySelector('img[src], video'))
      reason = 'ad (no date)';
    return reason;
  }

  function sweep() {
    routeCheck();
    if (!document.body) return;
    const home = onHomeFeed();
    const inDMs = path().startsWith('/direct');

    // Feed posts: hide ads, suggested posts, and (on Home) posts from accounts you don't follow.
    if (home) {
      postsHaveDates = !!document.querySelector('article time, div[role="article"] time');
      document.querySelectorAll(POST_SEL).forEach((art) => {
        if (art.hasAttribute('data-igc-hidden') || art.parentElement.closest('[data-igc-hidden]')) return;
        const reason = checkPost(art, home);
        if (reason) {
          hide(art);
          art.setAttribute('data-igc-reason', reason);
        }
      });
    }

    // "Suggested for you" carousels and similar blocks, wherever they are (except your DMs).
    if (!inDMs && (HIDE_SUGGESTIONS || HIDE_ADS)) {
      document.querySelectorAll('span, h2, h3, h4, div').forEach((el) => {
        if (el.closest('[data-igc-hidden]')) return;
        const t = raw(el);
        if (!t || t.length > 40) return;
        const st = shown(el);
        if ((HIDE_SUGGESTIONS && SUGGESTION_TEXT.test(st)) || (HIDE_ADS && home && AD_TEXT.test(st) && st.length > 2)) {
          // Only act on the innermost element carrying the label.
          for (const c of el.children) if (shown(c) === st) return;
          hide(feedBlockOf(el));
        }
      });
    }

    if (HIDE_OPEN_APP && !inDMs) removeAppPrompts();
  }

  // ---- "Open in app" / "Download now" banners and popups -----------------------------

  // Instagram's own navigation (Home, Search, Messages, Notifications...). Never hide it.
  const NAV_SEL =
    'a[href="/"], a[href^="/direct"], a[href^="/explore"], a[href*="/accounts/activity"], a[href="/reels/"], ' +
    'svg[aria-label="Home"], svg[aria-label="Messenger"], svg[aria-label="Direct"], svg[aria-label="Notifications"], ' +
    'svg[aria-label="New post"], svg[aria-label="Search"], svg[aria-label="Activity Feed"]';

  function isAppButton(el) {
    const t = raw(el);
    if (t.length > 40 && !el.getAttribute('aria-label')) return false;
    const st = shown(el) || el.getAttribute('aria-label') || '';
    if (OPEN_APP_TEXT.test(st)) return true;
    const href = el.getAttribute('href') || '';
    return /apps\.apple\.com|itunes\.apple\.com|^instagram:\/\/|^itms-apps:|app\.link|\/download\/?(\?|$)/i.test(href);
  }

  // The whole banner around an "Open app" button: the fixed/sticky bar, or the slim
  // full-width strip, that holds it. Never Instagram's own nav bar.
  function bannerOf(btn) {
    const vw = window.innerWidth || 400;
    let best = btn;
    for (let cur = btn.parentElement, i = 0; cur && cur !== document.body && i < 8; cur = cur.parentElement, i++) {
      if (cur.tagName === 'MAIN' || cur.tagName === 'ARTICLE') break;
      if (cur.querySelector(NAV_SEL)) break; // reached the nav bar: hide only what's inside it
      const r = cur.getBoundingClientRect();
      if (r.height > 200) break; // bigger than any banner: stop
      best = cur;
      const pos = getComputedStyle(cur).position;
      if (pos === 'fixed' || pos === 'sticky') return cur; // the banner bar itself
      if (r.width >= vw * 0.9 && r.height >= 30 && APP_PROMO_TEXT.test(shown(cur) + ' ' + raw(cur))) return cur;
    }
    return best;
  }

  function removeAppPrompts() {
    document.querySelectorAll('meta[name="apple-itunes-app"]').forEach((m) => m.remove());
    document.querySelectorAll('button, a, [role="button"], [role="link"]').forEach((el) => {
      if (el.closest('[data-igc-hidden]') || !isAppButton(el)) return;
      // A popup asking you to use the app: tap its "Not now" / close button.
      const dialog = el.closest('[role="dialog"], [role="alertdialog"], dialog');
      if (dialog) {
        const dismiss = Array.from(dialog.querySelectorAll('button, [role="button"], a')).find(
          (b) => b !== el && (DISMISS_TEXT.test(shown(b)) || /^(close|dismiss)$/i.test(b.getAttribute('aria-label') || '') || !!b.querySelector('svg[aria-label="Close"]'))
        );
        if (dismiss) {
          dismiss.click();
          return;
        }
        // Never hide a login form: just remove the app link inside it.
        return hide(dialog.querySelector('input[type="password"]') ? el : dialog);
      }
      hide(bannerOf(el));
    });
  }

  function showStatus() {
    if (!SHOW_STATUS || !document.body || document.getElementById('igc-status')) return;
    const el = document.createElement('div');
    el.id = 'igc-status';
    el.textContent = 'Instagram Cleaner is on';
    el.style.cssText =
      'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(20,20,20,.9);color:#fff;font:600 13px/1.2 -apple-system,system-ui,sans-serif;' +
      'padding:8px 14px;border-radius:16px;pointer-events:none;transition:opacity .4s;';
    document.body.appendChild(el);
    setTimeout(() => (el.style.opacity = '0'), 2500);
    setTimeout(() => el.remove(), 3000);
  }

  // Remove Safari's "Open in the Instagram app" banner tag as soon as it appears.
  if (HIDE_OPEN_APP && document.documentElement) {
    const mo = new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes)
          if (n.nodeName === 'META' && n.getAttribute('name') === 'apple-itunes-app') n.remove();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => mo.disconnect(), 5000), { once: true });
  }

  function start() {
    injectCSS();
    showStatus();
    sweep();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        sweep();
      }, 100);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(() => {
      injectCSS();
      sweep();
    }, 1000);
  }

  routeCheck();
  if (document.documentElement) injectCSS();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.__igCleaner = {
    prune: safePrune,
    stats: () => ({ removed, hiddenOnScreen: document.querySelectorAll('[data-igc-hidden]').length }),
  };
})();
