# Setup guide

This guide takes you from nothing to a working Clash Verge profile. It takes
about 15 minutes.

1. [What you need](#1-what-you-need)
2. [Get your Webshare credentials](#2-get-your-webshare-credentials)
3. [Create an access token](#3-create-an-access-token)
4. [Get your own copy of this repo](#4-get-your-own-copy-of-this-repo)
5. [Deploy to Cloudflare](#5-deploy-to-cloudflare): [CLI](#option-a-wrangler-cli), [dashboard + GitHub](#option-b-cloudflare-dashboard--github), or [Pages](#option-c-cloudflare-pages)
6. [Test your URLs](#6-test-your-urls)
7. [Set up your client](#7-set-up-your-client) (Clash Verge Rev on Windows/macOS, Stash on iOS)
8. [Choose your servers](#8-choose-your-servers)
9. [Optional features](#9-optional-features)
10. [Updating, rotating the token, local development](#10-maintenance)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What you need

- A **Webshare** account with at least one proxy (free or paid plan). The profile
  uses Webshare's HTTP proxies with username/password authentication.
- A free **Cloudflare** account. The app runs on the Workers free tier.
- A client app: **Clash Verge Rev** on Windows and macOS, **Stash** on iPhone
  and iPad. Any other Mihomo-based client also works. See [clients.md](clients.md).
- For the CLI route only: **Node.js 18 or newer** and **git**.

## 2. Get your Webshare credentials

The app reads your proxies in one of two ways. Pick one.

### TXT mode (simplest): the download URL

1. Sign in to the Webshare dashboard and open your **proxy list**.
2. Make sure authentication is set to **Username/Password** (not IP
   authorization) and the connection method is **Direct**.
3. Click **Download** and copy the **download link** rather than downloading
   the file. It looks like this:

   ```text
   https://proxy.webshare.io/api/v2/proxy/list/download/<random-token>/-/any/username/direct/-/
   ```

4. Open the link in a browser. You should see one proxy per line in the format
   `host:port:username:password`.

This link is a credential: anyone who has it can read your proxy passwords.
Keep it out of git. It will become the `WEBSHARE_URL` secret.

### API mode (optional, more features): an API key

1. In the Webshare dashboard, open **API → Keys** and create a key.
2. It will become the `WEBSHARE_API_KEY` secret.

With an API key the app:

- names nodes by country and IP, e.g. `SG 45.86.1.23 🇸🇬`;
- drops proxies that Webshare marks as invalid;
- sends a `subscription-userinfo` header, so Clash Verge shows bandwidth used
  and the renewal date on the profile card.

If both are set, `WEBSHARE_API_KEY` wins and `WEBSHARE_URL` is ignored.

## 3. Create an access token

Every request must include `?token=<ACCESS_TOKEN>`. Without the right token the
app returns `401 Unauthorized`, so strangers cannot read your proxy passwords.

Use a long random string of **letters and digits only**. Characters such as `+`,
`/` or `=` (common in base64) get changed inside URLs and cause 401 errors.

```sh
# macOS / Linux
openssl rand -hex 32

# Any OS with Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

```powershell
# Windows PowerShell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Save it in your password manager. It becomes the `ACCESS_TOKEN` secret.

## 4. Get your own copy of this repo

Choose one:

- **Use this template** or **Fork** on GitHub. You need this for
  [Option B](#option-b-cloudflare-dashboard--github) and
  [Option C](#option-c-cloudflare-pages), because Cloudflare deploys from your
  GitHub repo. The repo can be private.
- **Clone** it locally. This is enough for [Option A](#option-a-wrangler-cli).

```sh
git clone https://github.com/<you>/<your-copy>.git webshare-mihomo
cd webshare-mihomo
```

You don't need to edit any code. The only file you might change is
`wrangler.toml`, to rename the Worker.

## 5. Deploy to Cloudflare

### Option A: Wrangler CLI

```sh
npm install
npx wrangler login                        # opens a browser to authorize Wrangler

npx wrangler secret put ACCESS_TOKEN      # paste the token from step 3
npx wrangler secret put WEBSHARE_URL      # TXT mode: paste the download URL
# or, for API mode:
# npx wrangler secret put WEBSHARE_API_KEY

npm run deploy
```

The deploy prints your Worker's address, for example:

```text
https://webshare-mihomo.<your-subdomain>.workers.dev
```

That is `YOUR_CLOUDFLARE_HOST` in the rest of this guide.

> Wrangler may say the Worker doesn't exist the first time you run
> `secret put`, and offer to create it. Answer yes.

### Option B: Cloudflare dashboard + GitHub

Cloudflare builds and deploys every time you push to your repo.

1. Push your copy to GitHub (step 4).
2. In the Cloudflare dashboard, open **Workers & Pages → Create → Workers →
   Import a repository**. Connect GitHub and pick your repo.
3. Settings:

   ```text
   Project name:     webshare-mihomo        (must match `name` in wrangler.toml)
   Root directory:   /
   Build command:    (leave empty)
   Deploy command:   npx wrangler deploy
   ```

4. Click **Deploy**. Until you add secrets, the Worker returns 401.
5. Open the Worker → **Settings → Variables and Secrets → Add**. Choose type
   **Secret** for each of these:

   ```text
   ACCESS_TOKEN = <token from step 3>
   WEBSHARE_URL = <download URL>            # TXT mode
   WEBSHARE_API_KEY = <api key>             # API mode (optional)
   ```

   Then click **Deploy** to apply them.

`wrangler.toml` sets `keep_vars = true`, so variables you add in the dashboard
survive later Git deploys. Secrets always survive.

If you named the Worker something other than `webshare-mihomo`, change `name`
in `wrangler.toml` to match before pushing.

### Option C: Cloudflare Pages

Pages works too. It runs the same code through `functions/[[path]].js`.

1. **Workers & Pages → Create → Pages → Connect to Git**, and pick your repo.
2. Build settings:

   ```text
   Framework preset:        None
   Build command:           npm run pages:build
   Build output directory:  public
   Root directory:          /
   ```

3. After the first deploy, open **Settings → Variables and Secrets** and add the
   same secrets as in Option B. Then **retry the latest deployment**. On Pages,
   new variables only apply to new deployments.

Your host is `https://<project>.pages.dev`. `public/_routes.json` sends only
`/config.yaml` and `/webshare.yaml` to the function.

### Optional: custom domain

If `*.workers.dev` is slow or unreachable from your network, add your own domain:
**Worker → Settings → Domains & Routes → Add → Custom domain**. The domain must be
on your Cloudflare account.

## 6. Test your URLs

Open in a browser, or use `curl`:

```sh
curl "https://YOUR_CLOUDFLARE_HOST/config.yaml?token=YOUR_ACCESS_TOKEN"
```

Expected start:

```yaml
mode: rule
mixed-port: 7897
```

```sh
curl "https://YOUR_CLOUDFLARE_HOST/webshare.yaml?token=YOUR_ACCESS_TOKEN"
```

Expected start (TXT mode):

```yaml
proxies:
  - name: "webshare 82.26.250.254"
    type: http
    server: 82.26.250.254
    port: 7402
    username: "..."
    password: "..."
```

If you get an error instead, see [Troubleshooting](#11-troubleshooting).

## 7. Set up your client

Pick the app for your device and follow its guide in **[clients.md](clients.md)**:

| Platform | Recommended app |
| --- | --- |
| Windows | [Clash Verge Rev](clients.md#clash-verge-rev-windows) |
| macOS | [Clash Verge Rev](clients.md#clash-verge-rev-macos) |
| iPhone / iPad | [Stash](clients.md#stash-iphone-and-ipad) |

Every app imports the same profile URL:

```text
https://YOUR_CLOUDFLARE_HOST/config.yaml?token=YOUR_ACCESS_TOKEN
```

The clients guide also covers Linux, Android, the bare `mihomo` binary, and
adding only the provider to a config of your own.

## 8. Choose your servers

Every client shows the same two groups:

| Group | Carries | Default |
| --- | --- | --- |
| `Proxy` | ChatGPT/OpenAI, Gemini (and Apple Intelligence if enabled) | the first node |
| `Anthropic` | Claude and related hosts | follows `Proxy` |

- Pick a node in `Proxy`.
- Optionally pick a node in `Anthropic` to **pin Claude to one exit IP**. You can
  then switch `Proxy` without moving Claude.

There is no automatic switching. Nodes are named after their IP, so a node you
pick keeps the same exit IP when the list refreshes. Other sites go `DIRECT`,
so a general "what is my IP" site still shows your real IP. That is expected.

How the rules work and how to change them: [routing.md](routing.md).

## 9. Optional features

All of these are off by default. Turn them on per profile with a query
parameter, or for every profile with a Cloudflare variable.

| Feature | Per profile | Deployment-wide variable |
| --- | --- | --- |
| [Tailscale side-by-side](optional-features.md#tailscale) | `&tailscale=1` | `TAILSCALE=true` |
| [Custom DNS / NextDNS](optional-features.md#custom-dns-eg-nextdns) | — | `DNS_URL=https://...` |
| [Apple Intelligence](optional-features.md#apple-intelligence) | `&apple=1` | `APPLE_INTELLIGENCE=true` |

A query parameter always beats the variable. For example, `&tailscale=0` turns
Tailscale off for one device even when `TAILSCALE=true`.

## 10. Maintenance

### Update to a newer version of this repo

Pull or merge the upstream changes into your copy:

- **Option A:** run `npm run deploy` again.
- **Options B and C:** push, and Cloudflare redeploys.

Then update the profile in Clash Verge.

### Rotate the access token

1. Create a new token (step 3).
2. Replace `ACCESS_TOKEN` in Cloudflare: use the dashboard, or run
   `npx wrangler secret put ACCESS_TOKEN`.
3. Re-import the profile using the new token. The old URL stops working
   immediately.

### Local development

```sh
cp .dev.vars.example .dev.vars    # fill in your real values; .dev.vars is git-ignored
npm run dev                       # http://localhost:8787
curl "http://localhost:8787/config.yaml?token=<ACCESS_TOKEN from .dev.vars>"
npm test                          # unit tests, no network or secrets needed
```

### Without Cloudflare

`scripts/build_webshare_yaml.py` converts the TXT list into a provider file on
your own machine. It needs only Python 3.9+ and no dependencies:

```sh
WEBSHARE_URL='https://proxy.webshare.io/api/v2/proxy/list/download/...' \
  python3 scripts/build_webshare_yaml.py --output dist/webshare.yaml
```

Point a `type: file` provider at `dist/webshare.yaml` and rerun the script when
your proxies change.

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `401 Unauthorized` | The `?token=` value doesn't match `ACCESS_TOKEN`, or `ACCESS_TOKEN` isn't set. Tokens with `+ / =` break in URLs. Use a hex token. |
| `404 Not found` | Wrong path. Only `/config.yaml` and `/webshare.yaml` exist. On Pages, check that `public/_routes.json` was deployed. |
| `500 WEBSHARE_URL is not configured` | TXT mode with no `WEBSHARE_URL` secret. Add it. On Pages, redeploy afterwards. |
| `502 Failed to fetch Webshare list (…)` | TXT mode. The download URL is wrong, expired, or was regenerated in Webshare. Copy it again. |
| `500 Converter error: No valid proxy lines found` | The download URL returns something other than `host:port:user:pass` lines. Check the authentication method is Username/Password. |
| `500 Converter error: Webshare API returned 401` | API mode. The `WEBSHARE_API_KEY` is wrong or revoked. |
| `500 Converter error: All N Webshare proxies are currently invalid` | API mode. Webshare marks every proxy as dead. Check your plan in the Webshare dashboard. |
| `500 Converter error: DNS_URL entry …` | `DNS_URL` has a value Mihomo can't use. See [custom DNS](optional-features.md#custom-dns-eg-nextdns). |
| The profile imports but shows no nodes | Update the profile in Clash Verge, then open **Proxies**. Open the `/webshare.yaml` URL in a browser to check the list. |
| AI sites still see your real IP | Check **Connections**: the connection should match an AI rule and use a Webshare node. If it shows `DIRECT` with an IP address as the host, another resolver answered first (VPN DNS, Tailscale DNS, browser "secure DNS"). Turn those off, or use TUN mode. |
| Claude loads, then shows a region error | Close all Claude tabs and connections, pin a node in `Anthropic`, and reopen the login page rather than reloading the error page. See [routing.md](routing.md#claude-udp-and-dns). |
| Tailnet hosts stop working while TUN is on | Turn on the [Tailscale option](optional-features.md#tailscale). |
| `*.workers.dev` doesn't load | Your network may block it. Add a [custom domain](#optional-custom-domain). |
| Stash won't connect while Tailscale is on | iOS runs one VPN at a time. Disconnect Tailscale, or switch between the two. |
| Clash Verge's **System Proxy** switch turns itself off (macOS) | macOS wants an admin password to change network settings. Turn off **Require an administrator password to access system-wide settings** in **System Settings → Privacy & Security → Advanced**. |
| Clash Verge **Tun Mode** won't turn on | Install **Service Mode** (Settings → Service Mode) and approve the admin prompt. Some antivirus programs block it. See [clients.md](clients.md#3-turn-it-on). |
