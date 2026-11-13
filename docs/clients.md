# Clients

Recommended apps for using your profile, and how to set each one up.

| Platform | Recommended app | Cost |
| --- | --- | --- |
| Windows | [Clash Verge Rev](#clash-verge-rev-windows) | free, open source |
| macOS | [Clash Verge Rev](#clash-verge-rev-macos) | free, open source |
| iPhone / iPad | [Stash](#stash-iphone-and-ipad) | paid (App Store) |

**Every app imports the same profile URL.** There is no separate config per
app:

```text
https://YOUR_CLOUDFLARE_HOST/config.yaml?token=YOUR_ACCESS_TOKEN
```

You pick servers in the same `Proxy` and `Anthropic` groups everywhere, and
the same rules apply on every device.

Before you start, finish [steps 1–6 of the setup guide](setup.md) so you have a
working `https://YOUR_CLOUDFLARE_HOST` and `ACCESS_TOKEN`.

- [Clash Verge Rev (Windows)](#clash-verge-rev-windows)
- [Clash Verge Rev (macOS)](#clash-verge-rev-macos)
- [Using Clash Verge Rev (both systems)](#using-clash-verge-rev)
- [Stash (iPhone and iPad)](#stash-iphone-and-ipad)
- [Other platforms](#other-platforms)
- [Using only the provider in your own config](#using-only-the-provider-in-your-own-config)

---

## Clash Verge Rev (Windows)

[Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) is a free
desktop app built on the Mihomo core. It reads this project's default profile
as-is.

### Install

1. Open the [latest release](https://github.com/clash-verge-rev/clash-verge-rev/releases/latest)
   and download the installer for your PC:

   | Your PC | File |
   | --- | --- |
   | Most PCs (Intel / AMD) | `Clash.Verge_<version>_x64-setup.exe` |
   | Windows on ARM | `Clash.Verge_<version>_arm64-setup.exe` |
   | WebView2 can't be installed (some corporate PCs) | `Clash.Verge_<version>_x64_fixed_webview2-setup.exe` |

   Or install it with winget:

   ```powershell
   winget install ClashVergeRev.ClashVergeRev
   ```

2. Run the installer. If Windows SmartScreen says *Windows protected your PC*,
   click **More info → Run anyway**. Download it only from the GitHub release
   page above.
3. Clash Verge Rev needs Microsoft **WebView2**. Windows 11 and up-to-date
   Windows 10 already have it. If the app opens to a blank window, install
   WebView2 from Microsoft, or use the `fixed_webview2` installer.

Windows 7 is not supported.

Continue with [Using Clash Verge Rev](#using-clash-verge-rev).

## Clash Verge Rev (macOS)

### Install

1. Open the [latest release](https://github.com/clash-verge-rev/clash-verge-rev/releases/latest)
   and download the disk image for your Mac:

   | Your Mac | File |
   | --- | --- |
   | Apple silicon (M1 or newer) | `Clash.Verge_<version>_aarch64.dmg` |
   | Intel | `Clash.Verge_<version>_x64.dmg` |

   Not sure which you have? Open the Apple menu **→ About This Mac** and check **Chip**
   (Apple silicon) or **Processor** (Intel).

2. Open the `.dmg` and drag **Clash Verge** into **Applications**.
3. Open it from Applications. If macOS blocks it:
   - *"cannot be opened because Apple cannot check it…"*: open
     **System Settings → Privacy & Security**, scroll down, and click
     **Open Anyway**.
   - *"is damaged and can't be opened"* right after downloading: macOS
     quarantined the download. Remove the quarantine flag, then open the app
     again:

     ```sh
     xattr -dr com.apple.quarantine "/Applications/Clash Verge.app"
     ```

   - *Damaged* after updating: quit the old copy first, delete the app, and
     install again. The project's FAQ says installing over a running copy
     breaks both.

Use macOS 12 (Monterey) or newer.

Continue with [Using Clash Verge Rev](#using-clash-verge-rev).

## Using Clash Verge Rev

These steps are the same on Windows and macOS. Labels are from the English
interface. If yours is in another language, change **Language** in **Settings**.

### 1. Import the profile

1. Open **Profiles**.
2. Paste your profile URL into the box at the top and click **Import**:

   ```text
   https://YOUR_CLOUDFLARE_HOST/config.yaml?token=YOUR_ACCESS_TOKEN
   ```

   Add [options](optional-features.md) for this computer to the end of the URL.
   For example, append `&tailscale=1` if you run the Tailscale app here too.

3. Click the new profile card to make it the **active** profile.

If the import fails with `client error(Connect)`, click **New**, choose
**Remote**, paste the same URL, and save.

In API mode the profile card shows your Webshare bandwidth used and renewal date.

### 2. Choose your servers

1. Open **Proxies** and make sure the mode at the top is **Rule**.
2. In the **Proxy** group, click a node. This is the exit for ChatGPT and Gemini.
3. Optional: in the **Anthropic** group, click a node to pin Claude to that exit
   IP. Leave it on `Proxy` to follow the `Proxy` group.

Run the latency test on a group to measure its nodes first. Any node that times
out is dead or blocked.

### 3. Turn it on

Open **Settings** and turn on one of these:

| Mode | Covers | Needs |
| --- | --- | --- |
| **System Proxy** | Browsers and apps that use the OS proxy setting | Nothing extra. Start here. |
| **Tun Mode** | Every app, including terminals, CLIs and apps that ignore the system proxy | **Service Mode** (below) |

**Service Mode** is a small background service that runs the core with admin
rights, so TUN works without running the whole app as administrator. When you
turn on **Tun Mode**, Clash Verge offers to install it:

- **Windows:** accept, then approve the User Account Control prompt. Some
  antivirus programs block the install; allow Clash Verge if yours does. As an
  alternative, run Clash Verge as administrator.
- **macOS:** accept and enter your Mac password.

You can reinstall the service later from **Settings → Service Mode**.

Clash Verge's own settings override some profile fields: ports, `tun.enable`,
TUN stack and DNS hijack, `ipv6`, `allow-lan` and the controller. The profile
says `tun.enable: false`, but the **Tun Mode** switch decides. The profile's
Tailscale exclusions (`route-exclude-address`) are not overridden, so the
[Tailscale option](optional-features.md#tailscale) still works.

### 4. Start with your computer (optional)

In **Settings**, turn on **Auto Launch** to start at login, and **Silent Start**
to start minimized to the tray / menu bar.

### 5. Check that it works

Open **Connections**, then visit `chatgpt.com` or `claude.ai` in your browser.
Their connections should show a `GEOSITE` or `Anthropic` rule and a Webshare
node in the chain. Other sites show `DIRECT`, which is expected.

### Updating

- The **server list** refreshes every hour by itself.
- The **profile** refreshes every 24 hours. To refresh now, right-click the
  profile and choose **Update**. Do this after you redeploy the Worker or
  change an option.

### Adding your own rules

Don't edit the downloaded profile, because the next update replaces it.
Right-click the profile and choose **Edit Rules** to add rules that are applied
on top of it and survive updates. For example, to proxy one more site, add a
`DOMAIN-SUFFIX` rule for `example.com` with policy `Proxy`. Put it at the
**front** (prepend) so it is checked before `MATCH,DIRECT`.

---

## Stash (iPhone and iPad)

[Stash](https://apps.apple.com/app/stash-rule-based-proxy/id1596063349) is a
paid, rule-based proxy app for iOS and iPadOS (iOS 16 or newer). It imports the
same profile URL as Clash Verge Rev.

### 1. Install

Buy and install **Stash** from the App Store.

### 2. Import the profile

Use the same URL as on your computer:

```text
https://YOUR_CLOUDFLARE_HOST/config.yaml?token=YOUR_ACCESS_TOKEN
```

The easiest way to get it onto the phone is to AirDrop or message it to
yourself, or use a password manager note.

1. Open Stash and go to **Settings**.
2. Open the configuration (profile) list and choose to **download a
   configuration from a URL**.
3. Paste the URL and download it.
4. Make sure the new configuration is **selected** (ticked).

### 3. Start it

1. Go back to the **Home** screen and tap the start button.
2. The first time, iOS asks to **add VPN configurations**. Tap **Allow** and
   confirm with your passcode or Face ID. Stash routes traffic through an iOS
   VPN tunnel on the phone itself. Your traffic doesn't go to a VPN server
   unless a rule sends it to a Webshare node.

### 4. Choose your servers

Open the policy groups, then:

1. In **Proxy**, tap a node. This is the exit for ChatGPT and Gemini.
2. Optional: in **Anthropic**, tap a node to pin Claude to one exit IP.

### Updating and usage

- The server list refreshes every hour, the same as on desktop.
- After you redeploy the Worker or change an option, update the configuration
  from Stash's configuration list to pick up the change.
- In API mode, Stash shows your Webshare bandwidth and renewal date on the
  Home screen.

### Notes for iPhone

- **Tailscale:** iOS runs only one VPN at a time, so Stash and the Tailscale
  app can't be connected together. The [Tailscale option](optional-features.md#tailscale)
  is for computers. Leave it off in the URL you import on the phone.
- **Desktop-only settings:** the profile contains a few settings for desktop
  Mihomo, such as `tun`, the controller settings and the Windows pipe. Stash
  runs as an iOS VPN and handles these itself.
- **GeoSite data:** Stash downloads its GeoSite data from GitHub the first time
  a `GEOSITE` rule is used. If GitHub is unreachable from your network, AI rules
  won't match until that download succeeds.

### Adding your own rules on iOS

Stash supports **override** files (`.stoverride`). These add to a profile
without editing it, and survive profile updates. Lists in an override are
inserted **before** the profile's own list. For example, to proxy one more site:

```yaml
name: My extra rules
rules:
  - DOMAIN-SUFFIX,example.com,Proxy
```

Save it as `my-rules.stoverride`, open it with Stash (from Files or AirDrop),
and turn it on. See the [Stash override docs](https://stash.wiki/configuration/override).

---

## Other platforms

These aren't covered in detail, but they use the Mihomo core and can import the
default profile URL:

- **Linux:** Clash Verge Rev also ships Linux packages on its release page.
- **Android:** Mihomo-based apps such as FlClash or Clash Meta for Android.
- **Bare `mihomo` binary** (servers, routers):

  ```sh
  mkdir -p ~/.config/mihomo
  curl -fsSL -o ~/.config/mihomo/config.yaml \
    "https://YOUR_CLOUDFLARE_HOST/config.yaml?token=YOUR_ACCESS_TOKEN"
  mihomo -d ~/.config/mihomo
  ```

  The profile disables the external controller (`external-controller: ''`)
  because GUI apps don't need it. To pick nodes from a web dashboard, set
  `external-controller: 127.0.0.1:9090` and a real `secret`. Otherwise each
  group uses its first node. Mihomo downloads its GeoSite database on first
  start.

## Using only the provider in your own config

If you already have a config you like, add only the server list:

```yaml
proxy-providers:
  webshare-provider:
    type: http
    url: "https://YOUR_CLOUDFLARE_HOST/webshare.yaml?token=YOUR_ACCESS_TOKEN"
    path: ./proxy_providers/webshare.yaml
    interval: 3600
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204
      interval: 300
```

Then reference it from a group with `use: [webshare-provider]`.
`config-example.yaml` is the full default profile as a static file.
