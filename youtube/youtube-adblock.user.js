// ==UserScript==
// @name         YouTube Ad Blocker (iPhone Safari)
// @namespace    ad-blocker
// @version      1.0.0
// @description  Removes video ads, feed ads and promoted content on YouTube in Safari for iPhone.
// @match        *://m.youtube.com/*
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @match        *://music.youtube.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__ytAdBlockInstalled) return;
  window.__ytAdBlockInstalled = true;

  // ---------------------------------------------------------------------------
  // Layer 1: strip ads out of YouTube's data before the player ever sees them.
  // ---------------------------------------------------------------------------

  // Keys on the player response that tell the player to play ads.
  const PLAYER_AD_KEYS = [
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakHeartbeatParams',
    'adBreakParams',
  ];

  // Renderers that represent an ad / promo wherever they appear in a list.
  const AD_RENDERERS = new Set([
    'adSlotRenderer',
    'displayAdRenderer',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer',
    'promotedVideoRenderer',
    'compactPromotedVideoRenderer',
    'compactPromotedItemRenderer',
    'searchPyvRenderer',
    'inFeedAdLayoutRenderer',
    'bannerPromoRenderer',
    'brandVideoSingletonRenderer',
    'brandVideoShelfRenderer',
    'statementBannerRenderer',
    'mealbarPromoRenderer',
    'actionCompanionAdRenderer',
    'companionAdRenderer',
    'adActionInterstitialRenderer',
    'adBreakServiceRenderer',
    'playerLegacyDesktopWatchAdsRenderer',
    'merchandiseShelfRenderer',
    'productListRenderer',
    'reelShelfAdRenderer',
    'adsEngagementPanelContentRenderer',
  ]);

  // Keys removed outright wherever found (anti-adblock popups, ad panels).
  const DROP_KEYS = new Set([
    'enforcementMessageViewModel',
    'playerLegacyDesktopWatchAdsRenderer',
    'adSignalsInfo',
    'mastheadAd',
  ]);

  function isAdItem(item) {
    if (!item || typeof item !== 'object') return false;
    for (const k in item) {
      if (AD_RENDERERS.has(k)) return true;
      const v = item[k];
      // e.g. richItemRenderer.content.adSlotRenderer, richSectionRenderer.content.statementBannerRenderer
      if (v && typeof v === 'object' && v.content && typeof v.content === 'object') {
        for (const ck in v.content) if (AD_RENDERERS.has(ck)) return true;
      }
    }
    // Shorts ads
    if (item.command && item.command.reelWatchEndpoint && item.command.reelWatchEndpoint.adClientParams) return true;
    return false;
  }

  let removedCount = 0;

  function prune(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 60) return obj;
    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (isAdItem(obj[i])) {
          obj.splice(i, 1);
          removedCount++;
        } else {
          prune(obj[i], depth + 1);
        }
      }
      return obj;
    }
    for (const k of PLAYER_AD_KEYS) {
      if (k in obj) {
        delete obj[k];
        removedCount++;
      }
    }
    for (const k of Object.keys(obj)) {
      if (DROP_KEYS.has(k) || AD_RENDERERS.has(k)) {
        delete obj[k];
        removedCount++;
      } else {
        const v = obj[k];
        if (v && typeof v === 'object') prune(v, depth + 1);
      }
    }
    return obj;
  }

  function safePrune(obj) {
    try {
      return prune(obj, 0);
    } catch (e) {
      return obj;
    }
  }

  // 1a. Initial page data (ytInitialPlayerResponse / ytInitialData) set by inline scripts.
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData', 'ytInitialReelWatchSequenceResponse']) {
    let value = window[name];
    if (value) safePrune(value);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          return value;
        },
        set(v) {
          value = safePrune(v);
        },
      });
    } catch (e) {}
  }

  // 1b. JSON.parse — catches data YouTube parses from strings (incl. embedded player config).
  const origParse = JSON.parse;
  const AD_HINT = /adPlacements|adSlots|playerAds|adSlotRenderer|promoted|enforcementMessage|AdRenderer|PromoRenderer|statementBanner|searchPyv/;
  JSON.parse = function (text, reviver) {
    const result = origParse.call(this, text, reviver);
    if (typeof text === 'string' && text.length > 50 && AD_HINT.test(text)) safePrune(result);
    return result;
  };
  try {
    JSON.parse.toString = () => origParse.toString();
  } catch (e) {}

  // 1c. fetch — the mobile site loads player/feed data from /youtubei/v1/*.
  const API_RE = /\/youtubei\/v1\/(player|next|browse|search|reel|guide)/;
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const p = origFetch.apply(this, arguments);
      if (!url || !API_RE.test(url)) return p;
      return p.then(async (res) => {
        try {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('json')) return res;
          const text = await res.clone().text();
          const data = origParse(text);
          safePrune(data);
          const out = new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
          try {
            Object.defineProperty(out, 'url', { value: res.url });
          } catch (e) {}
          return out;
        } catch (e) {
          return res;
        }
      });
    };
    try {
      window.fetch.toString = () => origFetch.toString();
    } catch (e) {}
  }

  // 1d. XMLHttpRequest — some code paths still use XHR.
  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const origOpen = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      this.__ytab = typeof url === 'string' && API_RE.test(url);
      return origOpen.apply(this, arguments);
    };
    for (const prop of ['responseText', 'response']) {
      const desc = Object.getOwnPropertyDescriptor(XHR.prototype, prop);
      if (!desc || !desc.get) continue;
      Object.defineProperty(XHR.prototype, prop, {
        configurable: true,
        get() {
          const v = desc.get.call(this);
          if (!this.__ytab || this.readyState !== 4) return v;
          if (this.__ytabCache !== undefined) return this.__ytabCache;
          try {
            if (typeof v === 'string') {
              this.__ytabCache = JSON.stringify(safePrune(origParse(v)));
            } else if (v && typeof v === 'object') {
              this.__ytabCache = safePrune(v);
            } else return v;
            return this.__ytabCache;
          } catch (e) {
            return v;
          }
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 2: if an ad still reaches the player, skip it instantly.
  // ---------------------------------------------------------------------------

  const SKIP_BUTTONS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-overlay-close-button',
    'button[class*="skip-ad"]',
    'button[id^="skip-button"]',
  ].join(',');

  function handleAd() {
    const player = document.querySelector('.html5-video-player, #movie_player');
    if (!player) return;
    const adPlaying = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    const video = player.querySelector('video');

    document.querySelectorAll(SKIP_BUTTONS).forEach((b) => {
      try {
        b.click();
      } catch (e) {}
    });

    if (adPlaying && video) {
      video.muted = true;
      try {
        video.playbackRate = 16;
      } catch (e) {}
      if (isFinite(video.duration) && video.duration > 0) {
        video.currentTime = video.duration;
      }
      if (video.paused) video.play().catch(() => {});
      player.__ytabWasAd = true;
    } else if (player.__ytabWasAd && video) {
      // ad finished — restore normal playback
      player.__ytabWasAd = false;
      video.muted = false;
      video.playbackRate = 1;
    }

    // Dismiss "Ad blockers are not allowed" style dialogs if they slip through.
    document
      .querySelectorAll('ytd-enforcement-message-view-model, ytm-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)')
      .forEach((el) => {
        el.remove();
        const v = document.querySelector('video');
        if (v && v.paused) v.play().catch(() => {});
      });
  }

  // ---------------------------------------------------------------------------
  // Layer 3: hide any ad element left on the page.
  // ---------------------------------------------------------------------------

  const CSS = `
    ytm-promoted-sparkles-web-renderer, ytm-promoted-sparkles-text-search-renderer,
    ytm-promoted-video-renderer, ytm-companion-ad-renderer, ytm-companion-slot,
    ytm-ad-slot-renderer, ad-slot-renderer, ytm-display-ad-renderer,
    ytm-statement-banner-renderer, ytm-mealbar-promo-renderer, ytm-brand-video-singleton-renderer,
    ytm-in-feed-ad-layout-renderer, ytm-merch-shelf-renderer, ytm-product-list-renderer,
    ytm-rich-item-renderer:has(> ad-slot-renderer), ytm-rich-item-renderer:has(ytm-ad-slot-renderer),
    ytm-item-section-renderer:has(ytm-promoted-sparkles-web-renderer),
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
    ytd-display-ad-renderer, ytd-companion-slot-renderer, ytd-action-companion-ad-renderer,
    ytd-promoted-video-renderer, ytd-banner-promo-renderer, ytd-statement-banner-renderer,
    ytd-merch-shelf-renderer, ytd-player-legacy-desktop-watch-ads-renderer, #masthead-ad,
    ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    .ytp-ad-module .ytp-ad-overlay-container, .ytp-ad-image-overlay, .ytp-ad-text-overlay,
    .ytp-ad-message-container, #player-ads, .video-ads.ytp-ad-module > .ytp-ad-player-overlay-layout__ad-info-container,
    ytd-enforcement-message-view-model, ytm-enforcement-message-view-model
    { display: none !important; }
  `;

  function injectCSS() {
    if (document.getElementById('ytab-style')) return;
    const style = document.createElement('style');
    style.id = 'ytab-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function start() {
    injectCSS();
    handleAd();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        handleAd();
      }, 50);
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    setInterval(() => {
      injectCSS();
      handleAd();
    }, 500);
  }

  if (document.documentElement) injectCSS();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // Exposed for testing / debugging in the console.
  window.__ytAdBlock = { prune: safePrune, stats: () => ({ removed: removedCount }) };
})();
