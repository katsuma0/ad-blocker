// ==UserScript==
// @name         Instagram Cleaner (iPhone Safari)
// @namespace    ad-blocker
// @version      1.0.0
// @description  Instagram in Safari with only accounts you follow: no Reels feed, no suggested posts, no ads, no Explore grid. Reels still work from search, people you follow, and DMs.
// @match        *://www.instagram.com/*
// @match        *://instagram.com/*
// @run-at       document-start
// @inject-into  page
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

  const exact = (el) => (el.textContent || '').trim();
  const SUGGESTION_TEXT = /^(suggested for you|suggested posts|suggested reels|suggestions for you|you might like|discover more)$/i;
  const OPEN_APP_TEXT = /^(open( in)?( the)?( instagram)? app|use( the)? app|get( the)? app|switch to( the)? app|open instagram)$/i;

  function hide(el) {
    if (el && !el.hasAttribute('data-igc-hidden')) {
      el.setAttribute('data-igc-hidden', '');
      removed++;
    }
  }

  // Hide the whole feed block (e.g. a "Suggested for you" carousel) that contains `el`,
  // by climbing up to the element that sits directly in the feed list.
  function feedBlockOf(el) {
    const article = document.querySelector('article:not([data-igc-hidden])') || document.querySelector('article');
    if (!article) return el.closest('section, article, div[role="presentation"]') || el.parentElement;
    const chain = new Set();
    for (let a = article; a; a = a.parentElement) chain.add(a);
    let cur = el;
    while (cur.parentElement && !chain.has(cur.parentElement)) cur = cur.parentElement;
    return cur.parentElement ? cur : el;
  }

  function sweep() {
    routeCheck();
    if (!document.body) return;
    const home = onHomeFeed();

    // Feed posts: hide sponsored, suggested, and (on Home) posts from accounts you don't follow.
    document.querySelectorAll('article:not([data-igc-hidden])').forEach((art) => {
      let drop = false;
      for (const el of art.querySelectorAll('span, div, a, button')) {
        if (el.childElementCount > 1) continue;
        const t = exact(el);
        if (!t || t.length > 30) continue;
        if (HIDE_ADS && /^(sponsored|ad)$/i.test(t)) drop = true;
        else if (HIDE_SUGGESTIONS && SUGGESTION_TEXT.test(t)) drop = true;
        // Instagram shows a "Follow" button on posts from accounts you don't follow.
        else if (home && ONLY_FOLLOWING_IN_FEED && /^follow$/i.test(t) && (el.tagName === 'BUTTON' || el.closest('button, [role="button"]') || el.getAttribute('role') === 'button'))
          drop = true;
        if (drop) break;
      }
      if (drop) hide(art);
    });

    // "Suggested for you" carousels and similar blocks between posts.
    if (HIDE_SUGGESTIONS && home) {
      document.querySelectorAll('span, h2, h3, div').forEach((el) => {
        if (el.childElementCount > 1 || el.closest('[data-igc-hidden]')) return;
        if (SUGGESTION_TEXT.test(exact(el))) hide(feedBlockOf(el));
      });
    }

    if (HIDE_OPEN_APP) {
      document.querySelectorAll('meta[name="apple-itunes-app"]').forEach((m) => m.remove());
      document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
        if (el.hasAttribute('data-igc-hidden')) return;
        const t = exact(el);
        if (t.length <= 30 && OPEN_APP_TEXT.test(t)) hide(el);
      });
    }
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
    sweep();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        sweep();
      }, 100);
    }).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(() => {
      injectCSS();
      sweep();
    }, 1000);
  }

  routeCheck();
  if (document.documentElement) injectCSS();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.__igCleaner = { prune: safePrune, stats: () => ({ removed }) };
})();
