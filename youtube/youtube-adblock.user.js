// ==UserScript==
// @name         YouTube Ad & Shorts Blocker (iPhone Safari)
// @namespace    ad-blocker
// @version      1.3.0
// @description  Removes ads and Shorts on YouTube in Safari for iPhone, plus background play, picture-in-picture, sponsor skipping, auto-HD and remembered speed.
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

  // ===== SETTINGS =====
  // true  = hide YouTube Shorts everywhere and open any Shorts link as a normal video.
  // false = leave Shorts alone.
  const HIDE_SHORTS = true;
  // true  = remove the "Open in the YouTube app" banner and "Open App" buttons/popups.
  const HIDE_OPEN_APP = true;
  // true  = keep the audio playing when you lock your phone or switch to another app.
  const BACKGROUND_PLAY = true;
  // true  = show a picture-in-picture button in the top-left corner of the video.
  const PIP_BUTTON = true;
  // true  = automatically skip sponsor reads and similar segments (uses SponsorBlock's free database).
  const SPONSORBLOCK = true;
  // Which kinds of segments to skip. You can also add: 'intro', 'outro', 'preview', 'filler', 'music_offtopic'.
  const SPONSORBLOCK_CATEGORIES = ['sponsor', 'selfpromo', 'interaction'];
  // Best quality to pick automatically: 'highest', 'hd2160' (4K), 'hd1440', 'hd1080', 'hd720',
  // or false to let YouTube choose. 'hd1080' looks sharp on an iPhone without wasting data.
  const MAX_QUALITY = 'hd1080';
  // true  = remember the playback speed you pick and use it for every video.
  const REMEMBER_SPEED = true;
  // true  = never get paused by "Video paused. Continue watching?"
  const NO_STILL_WATCHING = true;
  // ====================

  // ---------------------------------------------------------------------------
  // Background play: YouTube pauses itself when the page is hidden (screen locked,
  // switched apps). Make the page always look visible, and resume if it pauses anyway.
  // This has to run before YouTube's own code, so it lives up here.
  // ---------------------------------------------------------------------------
  let resumeUntil = 0;
  if (BACKGROUND_PLAY) {
    const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const reallyHidden = () => {
      try {
        return realHidden.get.call(document);
      } catch (e) {
        return false;
      }
    };
    const fake = { hidden: false, webkitHidden: false, visibilityState: 'visible', webkitVisibilityState: 'visible' };
    for (const k in fake) {
      try {
        Object.defineProperty(Document.prototype, k, { configurable: true, get: () => fake[k] });
      } catch (e) {}
    }
    for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
      window.addEventListener(
        type,
        (e) => {
          e.stopImmediatePropagation(); // YouTube never hears about it
          const v = document.querySelector('video');
          if (reallyHidden() && v && !v.paused) resumeUntil = Date.now() + 3000;
        },
        true
      );
    }
    // If something still pauses the video right after you leave the page, start it again.
    document.addEventListener(
      'pause',
      (e) => {
        if (Date.now() < resumeUntil && e.target && e.target.tagName === 'VIDEO') {
          e.target.play().catch(() => {});
        }
      },
      true
    );
  }

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

  // Shorts shelves, Shorts items, and the Shorts tab, as they appear in YouTube's data.
  const SHORTS_RENDERERS = new Set([
    'reelShelfRenderer',
    'reelItemRenderer',
    'shortsLockupViewModel',
    'shortsLockupViewModelV2',
  ]);

  function hasShortsInside(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return false;
    for (const k in obj) {
      if (SHORTS_RENDERERS.has(k) || k === 'reelWatchEndpoint') return true;
      if (hasShortsInside(obj[k], depth + 1)) return true;
    }
    return false;
  }

  function isShortsItem(item) {
    if (!HIDE_SHORTS || !item || typeof item !== 'object') return false;
    for (const k in item) {
      const v = item[k];
      if (SHORTS_RENDERERS.has(k)) return true;
      if (!v || typeof v !== 'object') continue;
      // Shelves of Shorts on the home page / search / channel pages.
      if ((k === 'richSectionRenderer' || k === 'gridShelfViewModel') && hasShortsInside(v, 0)) return true;
      if (k === 'richShelfRenderer' && (v.isShorts || hasShortsInside(v, 0))) return true;
      if (k === 'richItemRenderer' && v.content && hasShortsInside(v.content, 0)) return true;
      // A normal-looking video result that actually opens as a Short.
      if ((k === 'videoRenderer' || k === 'compactVideoRenderer' || k === 'videoWithContextRenderer') &&
          v.navigationEndpoint && v.navigationEndpoint.reelWatchEndpoint) return true;
      // The "Shorts" tab in the bottom bar / sidebar / channel tabs.
      if ((k === 'pivotBarItemRenderer' || k === 'guideEntryRenderer') &&
          JSON.stringify(v).indexOf('FEshorts') >= 0) return true;
      if (k === 'tabRenderer' && v.endpoint && JSON.stringify(v.endpoint).indexOf('/shorts') >= 0) return true;
    }
    return false;
  }

  let removedCount = 0;

  function prune(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 60) return obj;
    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (isAdItem(obj[i]) || isShortsItem(obj[i])) {
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
  const AD_HINT = /adPlacements|adSlots|playerAds|adSlotRenderer|promoted|enforcementMessage|AdRenderer|PromoRenderer|statementBanner|searchPyv|reelShelf|reelItem|shortsLockup|FEshorts|reelWatchEndpoint/;
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
    redirectShorts();
    removeAppBanner();
    hideOpenAppButtons();
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
      video.playbackRate = REMEMBER_SPEED ? savedSpeed() : 1;
    }

    qolTick(player, video, adPlaying);

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

  const SHORTS_CSS = `
    ytm-reel-shelf-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2,
    ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model), ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model-v2),
    ytm-rich-section-renderer:has(ytm-reel-shelf-renderer), ytm-item-section-renderer:has(ytm-reel-shelf-renderer),
    grid-shelf-view-model:has(ytm-shorts-lockup-view-model), grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2),
    ytm-video-with-context-renderer:has(a[href^="/shorts/"]), ytm-compact-video-renderer:has(a[href^="/shorts/"]),
    ytm-rich-item-renderer:has(a[href^="/shorts/"]),
    ytm-pivot-bar-item-renderer:has(.pivot-shorts), ytm-pivot-bar-item-renderer:has(a[href^="/shorts"]),
    yt-tab-shape[tab-title="Shorts"], ytm-chip-cloud-chip-renderer:has(a[href*="shorts"]),
    ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
    ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model), ytd-rich-item-renderer:has(a[href^="/shorts/"]),
    ytd-video-renderer:has(a[href^="/shorts/"]), ytd-grid-video-renderer:has(a[href^="/shorts/"]),
    ytd-compact-video-renderer:has(a[href^="/shorts/"]),
    ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"],
    yt-tab-shape[tab-title="Shorts"], ytd-item-section-renderer:has(ytd-reel-shelf-renderer)
    { display: none !important; }
  `;

  const OPEN_APP_CSS = `
    ytm-mealbar-promo-renderer, ytm-upsell-dialog-renderer, ytm-app-promo-renderer,
    ytm-open-app-button, .mobile-topbar-header-open-app, .open-app-button,
    a[href^="vnd.youtube:"], a[href^="youtube://"], a[href^="intent:"],
    a[href*="apps.apple.com"], a[href*="itunes.apple.com"],
    ytm-button-renderer:has(> a[href^="vnd.youtube:"]), ytm-button-renderer:has(> a[href^="youtube://"]),
    ytm-button-renderer:has(a[href*="apps.apple.com"]), ytm-button-renderer:has(a[href*="itunes.apple.com"]),
    [data-ytab-open-app]
    { display: none !important; }
  `;

  // "Open App" / "Open in app" / "Get the app" style buttons, matched by their text.
  const OPEN_APP_TEXT = /^\s*(open( in)?( the)?( youtube)? app|get( the)?( youtube)? app|use( the)? app|switch to( the)? app)\s*$/i;

  // Safari shows its "Open in the YouTube app" banner because of this tag.
  function removeAppBanner() {
    if (!HIDE_OPEN_APP) return;
    document.querySelectorAll('meta[name="apple-itunes-app"]').forEach((m) => m.remove());
  }

  function hideOpenAppButtons() {
    if (!HIDE_OPEN_APP || !document.body) return;
    document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      if (el.hasAttribute('data-ytab-open-app')) return;
      const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
      if (text.length > 30 || !OPEN_APP_TEXT.test(text)) return;
      const wrap = el.closest('ytm-button-renderer, yt-button-view-model, button-view-model') || el;
      wrap.setAttribute('data-ytab-open-app', '');
    });
  }

  // Open /shorts/VIDEO_ID as a normal video (no swipe-to-next-Short feed).
  function redirectShorts() {
    if (!HIDE_SHORTS) return;
    const m = location.pathname.match(/^\/shorts\/([\w-]{5,})/);
    if (m) location.replace('/watch?v=' + m[1]);
  }

  function injectCSS() {
    if (document.getElementById('ytab-style')) return;
    const style = document.createElement('style');
    style.id = 'ytab-style';
    style.textContent = CSS + (HIDE_SHORTS ? SHORTS_CSS : '') + (HIDE_OPEN_APP ? OPEN_APP_CSS : '') + QOL_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Quality of life: picture-in-picture, sponsor skipping, auto quality,
  // remembered speed, no "Continue watching?" pauses.
  // ---------------------------------------------------------------------------

  const QOL_CSS = `
    #ytab-pip {
      position: absolute; top: 8px; left: 8px; z-index: 1000;
      width: 36px; height: 36px; padding: 0; border: 0; border-radius: 18px;
      background: rgba(0,0,0,.55); color: #fff; opacity: .8;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
    }
    #ytab-pip svg { width: 20px; height: 20px; fill: #fff; }
    .ad-showing #ytab-pip { display: none; }
    #ytab-toast {
      position: fixed; left: 50%; bottom: 72px; transform: translate(-50%, 20px);
      background: rgba(20,20,20,.92); color: #fff; font: 600 14px/1.3 -apple-system, system-ui, sans-serif;
      padding: 10px 16px; border-radius: 20px; z-index: 99999; opacity: 0; pointer-events: none;
      transition: opacity .2s, transform .2s;
    }
    #ytab-toast.show { opacity: 1; transform: translate(-50%, 0); }
  `;

  function toast(msg) {
    if (!document.body) return;
    let el = document.getElementById('ytab-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ytab-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.classList.remove('show'), 2500);
  }

  function isAdPlaying() {
    const p = document.querySelector('.html5-video-player, #movie_player');
    return !!p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
  }

  function currentVideoId() {
    const m = location.search.match(/[?&]v=([\w-]{11})/);
    if (m) return m[1];
    const s = location.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    return s ? s[1] : null;
  }

  // --- Picture-in-picture -----------------------------------------------------
  function togglePiP(video) {
    if (!video) return;
    try {
      if (typeof video.webkitSetPresentationMode === 'function') {
        // Safari on iPhone
        video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } else if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        video.requestPictureInPicture().catch(() => {});
      }
    } catch (e) {}
  }

  function ensurePiPButton(player, video) {
    if (!PIP_BUTTON || !video) return;
    if (video.hasAttribute('disablepictureinpicture')) video.removeAttribute('disablepictureinpicture');
    if (player.querySelector('#ytab-pip')) return;
    const b = document.createElement('button');
    b.id = 'ytab-pip';
    b.type = 'button';
    b.setAttribute('aria-label', 'Picture in picture');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z');
    svg.appendChild(path);
    b.appendChild(svg);
    const onTap = (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePiP(player.querySelector('video'));
    };
    b.addEventListener('click', onTap, true);
    b.addEventListener('touchend', onTap, true);
    player.appendChild(b);
  }

  // --- Sponsor skipping (SponsorBlock) ------------------------------------------
  const SB_NAMES = {
    sponsor: 'sponsor', selfpromo: 'self-promotion', interaction: '"like & subscribe" reminder',
    intro: 'intro', outro: 'outro', preview: 'preview', filler: 'filler', music_offtopic: 'non-music section',
  };
  const sb = { videoId: null, segments: [], skipped: new Set() };

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function loadSegments(id) {
    sb.segments = [];
    sb.skipped = new Set();
    try {
      // Privacy: only the first 4 characters of a hash of the video ID are sent, not the video ID.
      const prefix = (await sha256Hex(id)).slice(0, 4);
      const url =
        'https://sponsor.ajay.app/api/skipSegments/' + prefix +
        '?categories=' + encodeURIComponent(JSON.stringify(SPONSORBLOCK_CATEGORIES)) +
        '&actionTypes=' + encodeURIComponent('["skip"]');
      const res = await (origFetch || fetch).call(window, url, { credentials: 'omit' });
      if (!res.ok) return; // 404 = no segments for this video
      const list = await res.json();
      const hit = Array.isArray(list) && list.find((x) => x.videoID === id);
      if (!hit || sb.videoId !== id) return;
      sb.segments = hit.segments
        .filter((x) => !x.actionType || x.actionType === 'skip')
        .map((x) => ({ start: x.segment[0], end: x.segment[1], category: x.category, uuid: x.UUID }));
    } catch (e) {}
  }

  function sponsorCheck(video) {
    if (!SPONSORBLOCK || !sb.segments.length || isAdPlaying()) return;
    const t = video.currentTime;
    for (const seg of sb.segments) {
      // Each segment is skipped once, so you can still scrub back into it on purpose.
      if (t >= seg.start && t < seg.end - 0.5 && !sb.skipped.has(seg.uuid)) {
        sb.skipped.add(seg.uuid);
        video.currentTime = seg.end;
        toast('Skipped ' + (SB_NAMES[seg.category] || seg.category));
        break;
      }
    }
  }

  // --- Quality ------------------------------------------------------------------
  const QUALITY_ORDER = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

  function applyQuality(player) {
    if (!MAX_QUALITY || typeof player.getAvailableQualityLevels !== 'function') return;
    try {
      const levels = player.getAvailableQualityLevels().filter((q) => QUALITY_ORDER.includes(q));
      if (!levels.length) return;
      const cap = MAX_QUALITY === 'highest' ? 0 : Math.max(0, QUALITY_ORDER.indexOf(MAX_QUALITY));
      const pick = levels.find((q) => QUALITY_ORDER.indexOf(q) >= cap) || levels[levels.length - 1];
      if (typeof player.getPlaybackQuality === 'function' && player.getPlaybackQuality() === pick) return;
      if (typeof player.setPlaybackQualityRange === 'function') player.setPlaybackQualityRange(pick, pick);
      if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(pick);
    } catch (e) {}
  }

  // --- Speed --------------------------------------------------------------------
  const SPEED_KEY = 'ytab-speed';
  function savedSpeed() {
    try {
      const v = parseFloat(localStorage.getItem(SPEED_KEY));
      return v > 0 && v <= 4 ? v : 1;
    } catch (e) {
      return 1;
    }
  }

  function setSpeed(player, video, rate) {
    try {
      if (typeof player.setPlaybackRate === 'function') player.setPlaybackRate(rate);
    } catch (e) {}
    if (video.playbackRate !== rate) video.playbackRate = rate;
  }

  // --- Per-video state ----------------------------------------------------------
  // For a few seconds after a new video starts, YouTube resets speed/quality, so we keep
  // re-applying the user's choices and don't treat YouTube's reset as a new speed choice.
  const vs = { id: undefined, settleUntil: 0 };

  function wireVideo(player, video) {
    if (video.__ytabWired) return;
    video.__ytabWired = true;
    video.addEventListener('timeupdate', () => sponsorCheck(video));
    video.addEventListener('loadstart', () => (vs.settleUntil = Date.now() + 4000));
    video.addEventListener('ratechange', () => {
      if (!REMEMBER_SPEED || isAdPlaying() || Date.now() < vs.settleUntil) return;
      // A new video just started and we haven't caught up yet: this is YouTube resetting, not you.
      if (currentVideoId() !== vs.id) return;
      const r = video.playbackRate;
      if (r > 0 && r <= 4) {
        try {
          localStorage.setItem(SPEED_KEY, String(r));
        } catch (e) {}
      }
    });
  }

  function dismissStillWatching(video) {
    if (!NO_STILL_WATCHING) return;
    try {
      window._lact = Date.now(); // YouTube's "last activity" timestamp
    } catch (e) {}
    document
      .querySelectorAll('yt-confirm-dialog-renderer, ytm-confirm-dialog-renderer, tp-yt-paper-dialog, ytm-dialog, dialog')
      .forEach((d) => {
        if (!/still watching|continue watching|video paused/i.test(d.textContent || '')) return;
        const btn =
          d.querySelector('#confirm-button button') ||
          d.querySelector('#confirm-button') ||
          Array.from(d.querySelectorAll('button')).find((b) => /^\s*(yes|continue|keep watching)/i.test(b.textContent || ''));
        if (btn) btn.click();
        if (video && video.paused) video.play().catch(() => {});
      });
  }

  function qolTick(player, video, adPlaying) {
    dismissStillWatching(video);
    if (!video) return;
    wireVideo(player, video);
    ensurePiPButton(player, video);

    const id = currentVideoId();
    if (id !== vs.id) {
      vs.id = id;
      vs.settleUntil = Date.now() + 4000;
      sb.videoId = id;
      sb.segments = [];
      if (SPONSORBLOCK && id) loadSegments(id);
    }
    if (adPlaying) return;
    if (Date.now() < vs.settleUntil) {
      applyQuality(player);
      if (REMEMBER_SPEED) setSpeed(player, video, savedSpeed());
    }
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

  redirectShorts();
  // Remove the app-banner tag the moment the page adds it, before Safari can act on it.
  removeAppBanner();
  if (HIDE_OPEN_APP && document.documentElement) {
    const bannerObserver = new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes)
          if (n.nodeName === 'META' && n.getAttribute('name') === 'apple-itunes-app') n.remove();
    });
    bannerObserver.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => bannerObserver.disconnect(), 5000), { once: true });
  }
  if (document.documentElement) injectCSS();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // Exposed for testing / debugging in the console.
  window.__ytAdBlock = { prune: safePrune, stats: () => ({ removed: removedCount }), sponsorSegments: () => sb.segments };
})();
