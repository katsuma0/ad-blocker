# iPhone Ad Blocker

Two parts that together block as many ads on an iPhone as iOS allows. Neither one needs a Mac, a paid developer account, or jailbreaking.

| Part | What it blocks | Where |
|---|---|---|
| **1. YouTube ad & Shorts blocker** (`youtube/youtube-adblock.user.js`) | Pre-roll and mid-roll video ads, home and search feed ads, promoted videos, banners, "ad blockers aren't allowed" popups, **and YouTube Shorts** | **YouTube in Safari** |
| **2. Ad-blocking DNS** (`dns/AdBlock-DNS.mobileconfig`) | Ad and tracker servers (Google AdMob, Unity Ads, AppLovin, Facebook Audience Network, and many more) | **Every app** and Safari |

## Read this first: what iOS allows

**No ad blocker can remove ads inside the YouTube or Instagram apps on a normal iPhone.** That includes this one and every App Store ad blocker.

- **YouTube app:** ads come from the same Google servers as the videos, and iOS doesn't let other apps change what the YouTube app shows. Blocking the ads would also block the videos.
- **Instagram app:** sponsored posts are ordinary posts sent from Instagram's own servers.
- **Other apps** (games, free utilities, and so on) usually load ads from separate ad networks. The DNS part blocks most of those.

So the plan is: **watch YouTube in Safari** (m.youtube.com), where part 1 removes the ads, and use part 2 for everything else. The only official way to get an ad-free YouTube *app* is YouTube Premium.

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

## Files
```
youtube/youtube-adblock.user.js   YouTube ad + Shorts blocker and extras (Safari, via the Userscripts app)
dns/AdBlock-DNS.mobileconfig      System-wide ad-blocking DNS profile
test/test.js                      Automated test of the YouTube blocker
```
