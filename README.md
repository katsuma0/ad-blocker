# iPhone Ad Blocker

Three parts that together block as many ads and distractions on an iPhone as iOS allows. None of them needs a Mac, a paid developer account, or jailbreaking.

| Part | What it blocks | Where |
|---|---|---|
| **1. YouTube ad & Shorts blocker** (`youtube/youtube-adblock.user.js`) | Pre-roll and mid-roll video ads, home and search feed ads, promoted videos, banners, "ad blockers aren't allowed" popups, **and YouTube Shorts** | **YouTube in Safari** |
| **2. Ad-blocking DNS** (`dns/AdBlock-DNS.mobileconfig`) | Ad and tracker servers (Google AdMob, Unity Ads, AppLovin, Facebook Audience Network, and many more) | **Every app** and Safari |
| **3. Instagram cleaner** (`instagram/instagram-cleaner.user.js`) | The Reels feed, suggested posts and reels, ads, "Suggested for you" and the Explore grid. Your feed shows only accounts you follow. | **Instagram in Safari** |

## Read this first: what iOS allows

**No ad blocker can remove ads inside the YouTube or Instagram apps on a normal iPhone.** That includes this one and every App Store ad blocker.

- **YouTube app:** ads come from the same Google servers as the videos, and iOS doesn't let other apps change what the YouTube app shows. Blocking the ads would also block the videos.
- **Instagram app:** sponsored posts are ordinary posts sent from Instagram's own servers, so DNS blocking can't separate them. instagram.com in Safari can be cleaned up, though (Part 3).
- **Other apps** (games, free utilities, and so on) usually load ads from separate ad networks. The DNS part blocks most of those.

So the plan is: **use YouTube and Instagram in Safari** (m.youtube.com and instagram.com), where parts 1 and 3 clean them up, and use part 2 for everything else. The only official way to get an ad-free YouTube *app* is YouTube Premium.

---

## Part 1: YouTube with no ads, in Safari (about 3 minutes)

1. Install **Userscripts** from the App Store. It's free and open source, made by Justin Wasack (quoid).
2. Open the **Userscripts** app and tap **Set Userscripts Directory**. Pick or create a folder, for example *On My iPhone → Userscripts*.
3. Turn the extension on: **Settings → Apps → Safari → Extensions → Userscripts**. Turn it **On**, then under permissions set **All Websites → Allow**. (On older iOS: **Settings → Safari → Extensions**.)
4. Add the script:
   - Open [`youtube/youtube-adblock.user.js`](youtube/youtube-adblock.user.js) on GitHub in Safari. Tap **Raw**, then select all and **Copy**.
   - Open Safari, tap the **aA** (or puzzle-piece) icon in the address bar, then **Userscripts**, then **+**, then **New JS**.
   - Delete the template, paste the script, and tap **Save**.
5. Go to **m.youtube.com** in Safari and play a video. If Safari asks whether Userscripts can access youtube.com, choose **Always Allow**.

**Tip:** to stop YouTube links opening in the app, press and hold a YouTube link and choose **Open in Safari**. Or delete the YouTube app so links always open in Safari.

### Hiding YouTube Shorts
Shorts are hidden by default. With the script on:
- Shorts shelves and Shorts videos are removed from the home page, search results, watch suggestions and channel pages.
- The **Shorts** tab is gone from the bottom bar (and from the sidebar and channel tabs on the desktop site).
- Opening a Shorts link (for example one a friend sent) plays it as a normal video, so there's no endless swipe-to-the-next-Short feed.

To bring Shorts back, open the script in the Userscripts app, change `const HIDE_SHORTS = true;` near the top to `false`, and save.

### Hiding "Open in the YouTube app"
Also on by default:
- Safari's **"Open in the YouTube app" banner** at the top of the page is removed. The script deletes the hidden `apple-itunes-app` tag that makes Safari show it.
- YouTube's own **"Open App"** buttons and **"Get the YouTube app"** popups are hidden.

If the Safari banner still appears, swipe down to reload the page once. To turn this off, change `const HIDE_OPEN_APP = true;` near the top of the script to `false`.

### Extras: background play, picture-in-picture, sponsor skipping, HD, speed
All on by default. Each has its own switch near the top of the script (set it to `false` to turn it off).

| Feature | What it does | Switch |
|---|---|---|
| **Background play** | Audio keeps playing when you lock your phone or switch apps. If iOS still pauses it, press play once on the lock screen. | `BACKGROUND_PLAY` |
| **Picture-in-picture** | Adds a small PiP button in the top-left corner of the video, so the video keeps playing in a floating window over other apps. | `PIP_BUTTON` |
| **Skip sponsors** | Automatically skips sponsor reads, self-promotion and "like & subscribe" reminders, with a short "Skipped sponsor" message. Segments come from [SponsorBlock](https://sponsor.ajay.app), a free community database, so very new or small videos may not have any yet. Each segment is skipped once, so you can scrub back to watch it. | `SPONSORBLOCK` |
| **Choose what to skip** | Also available: `'intro'`, `'outro'`, `'preview'`, `'filler'`, `'music_offtopic'`. | `SPONSORBLOCK_CATEGORIES` |
| **Always HD** | Picks the best quality up to 1080p automatically. Mobile YouTube often starts blurry. Set it to `'highest'` for 4K, or `'hd720'` to save data. | `MAX_QUALITY` |
| **Remember speed** | Change the speed once (for example 1.5x) and every video after that plays at that speed. | `REMEMBER_SPEED` |
| **No "Continue watching?"** | YouTube won't pause long videos or playlists to ask if you're still there. | `NO_STILL_WATCHING` |

**SponsorBlock privacy:** the script never sends which video you're watching. It sends only the first 4 characters of a hash of the video ID, gets back the segments for every video sharing that prefix, and picks out yours on your phone.

### How it works
The script uses three layers, so an ad would have to get past all of them:
1. **Removes ads from YouTube's data** before the player sees them. It strips `adPlacements`, `playerAds`, `adSlots` and promoted feed items from the page data and from every `/youtubei/v1/player`, `next`, `browse` and `search` response (both `fetch` and XHR). The player never learns there was an ad.
2. **Skips ads instantly** if one still starts. It mutes the ad, jumps to the end, and clicks Skip. Sound and speed come back once the video resumes.
3. **Hides ad elements** on the page with CSS (banners, companion ads, promoted cards, the anti-adblock dialog).

Shorts are handled the same way: they're removed from YouTube's data, hidden with CSS, and `/shorts/` links are redirected to `/watch`.

### Testing
```bash
node test/test.js
```
This runs the script in a headless browser that imitates an iPhone. It loads a fake m.youtube.com that serves ads and Shorts the way YouTube does (inline page data, fetch, XHR, an ad playing in the player, a skip button, the anti-adblock popup, Shorts shelves, the Shorts tab, a Shorts link, the "Open in app" banner tag and buttons, a fake SponsorBlock server, a fake player for quality and speed, picture-in-picture, screen-lock events and the "Continue watching?" popup) and checks that each one is blocked.

### If YouTube changes something
YouTube changes its ad system often. If ads come back:
- Make sure the script is enabled in the Userscripts menu on m.youtube.com.
- Pull the latest version of this script and paste it in again.

---

## Part 2: block ads in every app (about 1 minute)

1. On your iPhone, open [`dns/AdBlock-DNS.mobileconfig`](dns/AdBlock-DNS.mobileconfig) on GitHub. Tap **Raw**, then tap the **Share** button → **Save to Files**.
2. In the **Files** app, tap the file. iOS will say **Profile Downloaded**.
3. Open **Settings**, tap **Profile Downloaded** near the top, then tap **Install** (enter your passcode). iOS labels it "Unverified" because it isn't signed. That's normal for a personal profile.
4. Check that it's on: **Settings → General → VPN & Device Management → DNS**. *Ad Blocker DNS* should be selected.

This sends all DNS lookups over encrypted HTTPS to **AdGuard DNS** (a free public ad-blocking DNS service), which refuses to resolve known ad and tracker servers.

**To turn it off:** go to **Settings → General → VPN & Device Management**, tap *Ad Blocker DNS*, then **Remove Profile**.

**Notes:**
- If you also use a VPN app, the VPN's DNS may override this one.
- If a website or app breaks (for example, links in shopping or deal emails that go through ad-tracking redirects), remove the profile for a moment.

---

## Part 3: Instagram with only people you follow, in Safari (about 2 minutes)

Uses the same **Userscripts** app as Part 1. If you've already set it up for YouTube, skip to step 2.

1. Set up Userscripts and turn on its Safari extension (Part 1, steps 1–3).
2. Add the script the same way as the YouTube one. Either:
   - download [`instagram/instagram-cleaner.user.js`](instagram/instagram-cleaner.user.js) and move it into your Userscripts folder in the Files app, or
   - copy its text and paste it via Safari → **aA** → **Userscripts** → **+** → **New JS**.
3. Open **instagram.com** in Safari and log in. If Safari asks whether Userscripts can access instagram.com, choose **Always Allow**.

**Tip:** to stop Instagram links opening in the app, delete the Instagram app, or press and hold a link and choose **Open in Safari**. You can add instagram.com to your Home Screen for quick access (Share → **Add to Home Screen**). Safari extensions don't run in Home Screen web apps, though, so open it in Safari itself to keep the filtering.

### Still seeing ads or "Suggested for you"?
When you open instagram.com, a small **"Instagram Cleaner is on"** message should appear at the top for a few seconds.

**If you don't see that message, the script isn't running.** Check each of these:
1. You're in **Safari** at instagram.com, not the Instagram app.
2. **Settings → Apps → Safari → Extensions → Userscripts** is **On**, and **instagram.com** (or All Websites) is set to **Allow**.
3. In Safari on instagram.com, tap **aA** → **Userscripts**. *Instagram Cleaner* should be listed with its switch on. If Safari shows a permission prompt there, choose **Always Allow on This Website**.
4. In the Files app, the script's name ends in **.user.js**, not `.txt`, and it's inside the Userscripts folder.
5. Swipe down to reload instagram.com.

**If an "Open" app banner is still at the very top**, check whether it has the Instagram app icon, a small **✕** on the left and a grey Safari-style look. If so, it's Safari's built-in banner, not part of the page. The script removes the tag that triggers it, but if Safari got to it first, tap **✕** and reload.

**If you do see the message but ads or suggestions still show up**, send a screenshot or tell me exactly what the label says, plus your Instagram language. Then I can match it.

### What you'll see
| Where | What happens |
|---|---|
| **Home feed** | Only posts and reels from accounts you follow, plus your own. Suggested posts, suggested reels, "Suggested for you" and ads are gone. |
| **Reels tab** | Removed. Going to it takes you to your home feed. |
| **A reel someone sends you** | Opens normally, on its own, so it doesn't drop you into the endless Reels feed. |
| **Search** | Works normally: people, hashtags, and posts and reels you search for. The recommended grid under the search box is hidden. |
| **Someone's profile** | Shows normally, even if you don't follow them, because you went there on purpose (from search or a link). |
| **Messages** | Untouched. |
| **"Open in app" / "Download now"** | Instagram's app banners (top and bottom) are removed. "Use the app" popups are closed with **Not now**. Safari's own app banner is suppressed too. |

### Settings
Each part has its own switch at the top of the script. Set any of them to `false` to turn that part off: `HIDE_REELS_FEED`, `ONLY_FOLLOWING_IN_FEED`, `HIDE_EXPLORE_GRID`, `HIDE_ADS`, `HIDE_SUGGESTIONS`, `HIDE_OPEN_APP`.

### How it works
1. **Cleans Instagram's data.** In every feed response, the script removes posts whose author you don't follow (`friendship_status.following === false`), ads (`ad_id`, `injected`, …) and suggestion blocks (`suggested_users`, `*_netego`, `explore_story`). This covers both `fetch` and XHR, including Instagram's `for (;;);`-prefixed and multi-line responses, plus data embedded in the page. If the follow status isn't known, the post is kept, so nothing is hidden by mistake. Your own posts are never hidden.
2. **Redirects Reels.** `/reels/` goes to the home feed, and `/reels/<id>/` becomes `/reel/<id>/`, a single reel with nothing to swipe to.
3. **Hides what's left on screen.** This works even if Instagram blocks the data cleaning. On the home feed it hides:
   - posts that show a **Follow** button (Instagram only shows one for accounts you don't follow)
   - posts labelled **Sponsored**, including labels split up with hidden letters
   - ads with no label, spotted because they have no post date (only when other posts on the page show dates, so your feed can never be emptied by mistake)
   - **Suggested for you / Suggested posts / Suggested reels** blocks
   - the Reels tab and the Explore grid

The script uses `@inject-into auto`. Normally it runs inside the page and does all three layers. If Instagram's security settings block that, Userscripts runs it alongside the page instead, and layers 2 and 3 still work.

The on-screen rules look for Instagram's English labels ("Follow", "Sponsored", "Suggested for you"). If your Instagram is in another language, the data cleaning still works, but tell me your language and I'll add its labels.

### Testing
```bash
node test/instagram.test.js
```
This runs the script against a fake instagram.com and checks:
- feed data: people you follow, strangers, your own posts, ads, suggestions, unknown follow status, `for (;;);` responses and embedded page data
- the home-feed page
- a profile you searched for
- Explore and search
- every Reels route, including in-app navigation
- that Messages is untouched

---

## Files
```
youtube/youtube-adblock.user.js   YouTube ad + Shorts blocker and extras (Safari, via the Userscripts app)
dns/AdBlock-DNS.mobileconfig      System-wide ad-blocking DNS profile
instagram/instagram-cleaner.user.js  Instagram: only people you follow, no Reels feed (Safari, via Userscripts)
test/test.js                      Automated test of the YouTube blocker
test/instagram.test.js            Automated test of the Instagram cleaner
```
