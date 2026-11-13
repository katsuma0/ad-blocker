# iPhone Ad Blocker

Two parts that together block as many ads on an iPhone as iOS allows. Neither one needs a Mac, a paid developer account, or jailbreaking.

| Part | What it blocks | Where |
|---|---|---|
| **1. YouTube ad blocker** (`youtube/youtube-adblock.user.js`) | Pre-roll and mid-roll video ads, home and search feed ads, promoted videos, banners, "ad blockers aren't allowed" popups | **YouTube in Safari** |
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

### How it works
The script uses three layers, so an ad would have to get past all of them:
1. **Removes ads from YouTube's data** before the player sees them. It strips `adPlacements`, `playerAds`, `adSlots` and promoted feed items from the page data and from every `/youtubei/v1/player`, `next`, `browse` and `search` response (both `fetch` and XHR). The player never learns there was an ad.
2. **Skips ads instantly** if one still starts. It mutes the ad, jumps to the end, and clicks Skip. Sound and speed come back once the video resumes.
3. **Hides ad elements** on the page with CSS (banners, companion ads, promoted cards, the anti-adblock dialog).

### Testing
```bash
node test/test.js
```
This runs the script in a headless browser that imitates an iPhone. It loads a fake m.youtube.com that serves ads the way YouTube does (inline page data, fetch, XHR, an ad playing in the player, a skip button, the anti-adblock popup) and checks that each one is blocked.

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
youtube/youtube-adblock.user.js   YouTube ad blocker (Safari, via the Userscripts app)
dns/AdBlock-DNS.mobileconfig      System-wide ad-blocking DNS profile
test/test.js                      Automated test of the YouTube blocker
```
