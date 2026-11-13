# webshare-mihomo

Turn your [Webshare](https://www.webshare.io/) proxies into a ready-to-import
[Mihomo](https://github.com/MetaCubeX/mihomo) / [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)
profile, served from your own free Cloudflare Worker.

Webshare gives you a plain-text proxy list:

```text
82.26.250.254:7402:username:password
```

Mihomo cannot read that format. This project deploys a small Cloudflare app
that converts it on the fly and serves two URLs:

| URL | What it is | Use it for |
| --- | --- | --- |
| `/config.yaml?token=…` | A complete Mihomo profile (DNS, rules, groups) | Import into Clash Verge as a profile |
| `/webshare.yaml?token=…` | Only the `proxies:` list | A `proxy-providers` entry in your own config |

```text
 Webshare list/API ──► Cloudflare Worker (this repo) ──► /config.yaml ──► Clash Verge / Mihomo
                         secrets live here only           /webshare.yaml
```

This repository contains **no credentials**. Your Webshare URL or API key and
your access token are stored as Cloudflare secrets, never in the code.

## What the profile does

- **Proxies only AI services** (OpenAI/ChatGPT, Anthropic/Claude, Google Gemini).
  Everything else goes `DIRECT`, which saves your Webshare bandwidth.
- **Two selector groups:** `Proxy` for ChatGPT and Gemini, and `Anthropic` for Claude.
  You pick the servers yourself, with no automatic switching. `Anthropic` follows
  `Proxy` until you pin it to one exit IP.
- **Stable node names:** each node is named by its IP, so a pinned node keeps its
  exit IP when Webshare replaces other proxies.
- **Leak guards:** rejects Claude's QUIC/UDP (HTTP proxies can't carry it, so
  browsers fall back to TCP through the proxy), resolves Claude's domains through
  the proxy group, and sniffs hostnames from connections made by IP.
- **Optional API mode:** with a Webshare API key, nodes are tagged by country
  (`SG 45.86.1.23 🇸🇬`), dead proxies are dropped, and Clash Verge shows your
  bandwidth usage and renewal date.

### Optional features (all off by default)

| Feature | Turn on with | What it does |
| --- | --- | --- |
| Tailscale | `?tailscale=1` or `TAILSCALE=true` | Keeps tailnet traffic and `*.ts.net` names away from Mihomo so a Tailscale app can run next to it |
| Custom DNS (e.g. NextDNS) | `DNS_URL=https://dns.nextdns.io/<id>/<device>` | Uses your resolver instead of the public Cloudflare + Google DoH defaults |
| Apple Intelligence | `?apple=1` or `APPLE_INTELLIGENCE=true` | Also proxies the relay that Apple Intelligence uses for ChatGPT |

See [docs/optional-features.md](docs/optional-features.md).

## Quick start

You need a Webshare account, a free Cloudflare account, and Node.js 18+.

```sh
git clone https://github.com/<you>/<your-copy>.git webshare-mihomo
cd webshare-mihomo
npm install
npx wrangler login

openssl rand -hex 32                       # copy the output: this is your ACCESS_TOKEN
npx wrangler secret put ACCESS_TOKEN       # paste the token
npx wrangler secret put WEBSHARE_URL       # paste your Webshare download URL
npm run deploy                             # prints https://webshare-mihomo.<subdomain>.workers.dev
```

Then import this URL into Clash Verge as a profile:

```text
https://webshare-mihomo.<subdomain>.workers.dev/config.yaml?token=<ACCESS_TOKEN>
```

The **[full setup guide](docs/setup.md)** covers each step in detail. It also
covers deploying from the Cloudflare dashboard without the CLI, Cloudflare Pages,
API mode, using the profile in Clash Verge, and troubleshooting.

## Configuration reference

Cloudflare **secrets** (Worker → Settings → Variables and Secrets → type *Secret*):

| Name | Required | Description |
| --- | --- | --- |
| `ACCESS_TOKEN` | yes | Long random string. Every request must carry it as `?token=`. Use letters and digits only. |
| `WEBSHARE_URL` | TXT mode | Your Webshare proxy-list download URL. |
| `WEBSHARE_API_KEY` | API mode | Webshare API key. When set, it is used instead of `WEBSHARE_URL`. |

Optional **variables** (type *Text* or *Secret*):

| Name | Default | Description |
| --- | --- | --- |
| `TAILSCALE` | `false` | Default for the Tailscale option. |
| `APPLE_INTELLIGENCE` | `false` | Default for the Apple Intelligence option. |
| `DNS_URL` | Cloudflare + Google DoH | One or more `https://`, `tls://` or `quic://` resolvers, separated by commas. |

**Query parameters** on `/config.yaml` override the variables for that one profile:
`tailscale=1|0` and `apple=1|0`. This lets each device import a different
variant of the same deployment.

## Repository layout

```text
src/converter.js                # all logic: parsing, naming, profile builder, request handler
src/index.js                    # Cloudflare Worker entry point
functions/[[path]].js           # Cloudflare Pages Function entry point (same handler)
public/                         # Pages output: placeholder page + _routes.json
wrangler.toml                   # Worker config (no secrets)
.dev.vars.example               # template for local secrets used by `npm run dev`
config-example.yaml             # the default profile as a static file, for hand-editing
scripts/build_webshare_yaml.py  # optional offline converter (no Cloudflare needed)
test/converter.test.js          # `npm test` (Node's built-in test runner, no dependencies)
docs/                           # setup guide, optional features, routing details
```

## Security notes

- The provider output contains your proxy usernames and passwords. Anyone with your
  `?token=` URL can use your proxies. Treat the URL like a password.
- To revoke access, change `ACCESS_TOKEN` in Cloudflare and re-import the profile.
- Responses are sent with `Cache-Control: private` so shared caches don't store them.
- Never commit `.dev.vars`, real download URLs, API keys or a NextDNS profile ID.
  `.gitignore` already excludes `.dev.vars` and `.env*`.

## Disclaimer

Not affiliated with Webshare, Cloudflare, Tailscale, MetaCubeX, or any service
the rules mention. Routing traffic through a proxy may be against some services'
terms. You are responsible for how you use this.

## License

[MIT](LICENSE)
