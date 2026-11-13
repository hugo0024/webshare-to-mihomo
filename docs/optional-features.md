# Optional features

Everything here is **off by default**. The default profile has no Tailscale
settings, uses public DNS resolvers, and leaves Apple traffic alone.

There are two ways to switch a feature on:

- **Per profile:** add a query parameter to the URL you import, e.g.
  `config.yaml?token=…&tailscale=1`. Each device can turn on what it needs.
- **For every profile:** set a variable on the Worker (**Settings → Variables
  and Secrets**, or `[vars]` in `wrangler.toml`).

A query parameter overrides the variable. `1/true/yes/on` turn a feature on;
`0/false/no/off` turn it off.

- [Tailscale](#tailscale)
- [Custom DNS (e.g. NextDNS)](#custom-dns-eg-nextdns)
- [Apple Intelligence](#apple-intelligence)

---

## Tailscale

**Turn on:** `&tailscale=1`, or `TAILSCALE=true` (override with `&tailscale=0`).

Use this if you run the **Tailscale app on the same machine** as Clash Verge
with **TUN mode** on. Without it, Mihomo's TUN interface captures tailnet
traffic and sends it out `DIRECT`, so tailnet hosts, Taildrop and Tailscale SSH
stop working.

It adds two settings to the profile:

```yaml
tun:
  # ...
  route-exclude-address:      # leave Tailscale's address ranges to the Tailscale interface
    - 100.64.0.0/10
    - fd7a:115c:a1e0::/48

dns:
  # ...
  fake-ip-filter:             # resolve MagicDNS names to their real 100.x addresses
    - "+.ts.net"
```

Tailnet traffic then stays on the Tailscale interface, and AI traffic still goes
through Webshare. Any official Mihomo core works. You don't need
`type: tailscale` outbounds or a custom build.

If you only use **System Proxy** (no TUN), tailnet traffic never reaches Mihomo,
and you don't need this option.

**Stash / iPhone:** leave this off in the URL you import on the phone. iOS runs
only one VPN at a time, so Stash and the Tailscale app can't be connected
together.

### macOS: keep "Use Tailscale DNS" off

When **Use Tailscale DNS** is on in the macOS Tailscale app, macOS sends every
lookup to Tailscale's resolver. Apps then get real addresses instead of
Mihomo's fake-ip ones. Two things break:

- Claude sometimes connects over IPv6, which the HTTP-only Webshare nodes can't carry.
- ChatGPT's bare Cloudflare IPs miss the `GEOSITE,openai` rule.

Turn it off, and resolve MagicDNS names with a macOS split resolver instead.
Find your tailnet name (e.g. `tail1234.ts.net`) in the Tailscale admin console
under **DNS**, then run:

```sh
sudo mkdir -p /etc/resolver
printf 'nameserver 100.100.100.100\n' | sudo tee /etc/resolver/tail1234.ts.net
```

To accept SSH into the Mac over the tailnet, also turn on
**System Settings → General → Sharing → Remote Login**.

Other operating systems can have the same problem when Tailscale manages DNS. If
AI traffic shows up as bare IPs in Clash Verge's **Connections**, try turning
Tailscale DNS off there too.

---

## Custom DNS (e.g. NextDNS)

**Turn on:** set `DNS_URL`. There is no query parameter for this one.

By default the profile resolves names with public DNS-over-HTTPS:

```yaml
dns:
  nameserver:
    - "https://cloudflare-dns.com/dns-query"
    - "https://dns.google/dns-query"
```

Set `DNS_URL` to use your own resolver instead, for example to keep NextDNS
filtering and logs. The value replaces the resolver in three places:

| Setting | What it resolves |
| --- | --- |
| `dns.nameserver` | normal lookups |
| `dns.proxy-server-nameserver` | the Webshare proxy hostnames (queried directly, to avoid a loop) |
| `dns.nameserver-policy` | Claude's domains, queried **through the `Anthropic` group** (`<url>#Anthropic`) |

Rules for the value:

- One or more resolvers, separated by commas.
- Each must start with `https://`, `tls://` or `quic://`.
- Don't add your own `#…` suffix. The app adds `#Anthropic` where needed.

The app checks the value and returns a clear `500` error if it's unusable, rather
than serving a broken profile.

### NextDNS

1. Create a profile at NextDNS and open its **Setup** tab.
2. Copy the **DNS-over-HTTPS** endpoint: `https://dns.nextdns.io/<profile-id>`.
3. Optionally add a device name so lookups are labelled in the NextDNS logs.
   Encode spaces as `%20`:

   ```text
   https://dns.nextdns.io/<profile-id>/Clash%20Verge
   ```

4. Add it to the Worker as `DNS_URL`.

Your NextDNS profile ID is personal: anyone with it can send queries into your
logs and quota. Store it as a **Secret** in the dashboard, and don't commit it
to `wrangler.toml` in a public fork.

To use different resolvers on different devices, deploy a second Worker, or
hand-edit `config-example.yaml`.

---

## Apple Intelligence

**Turn on:** `&apple=1`, or `APPLE_INTELLIGENCE=true` (override with `&apple=0`).

By default, Apple traffic is not proxied. Apple Intelligence's ChatGPT
integration reaches OpenAI through a **multi-hop OHTTP relay** spread across
Apple, Akamai, Cloudflare and Fastly. Proxying OpenAI's own domains is
therefore not enough: the relay hops must also use the proxy.

This option adds targeted rules above `MATCH`:

```yaml
  - DOMAIN-SUFFIX,guzzoni.apple.com,Proxy
  - DOMAIN-SUFFIX,smoot.apple.com,Proxy
  - DOMAIN-SUFFIX,apple-relay.apple.com,Proxy
  - DOMAIN-SUFFIX,gspe1-ssl.ls.apple.com,Proxy
  - DOMAIN-SUFFIX,apple-relay.akamaized.net,Proxy
  - DOMAIN-SUFFIX,apple-relay.mask.apple-dns.net,Proxy
  - DOMAIN-SUFFIX,apple-intelligence.apple.com,Proxy
  - DOMAIN-SUFFIX,ai.apple.com,Proxy
  - DOMAIN-SUFFIX,apple-relay.cloudflare.com,Proxy
  - DOMAIN-SUFFIX,apple-relay.fastly-edge.com,Proxy
  - DOMAIN-SUFFIX,cp4.cloudflare.com,Proxy
```

The rest of Apple's traffic (OS updates, iCloud, App Store) stays `DIRECT`,
which matters on a bandwidth-limited Webshare plan. If you add your own
`apple.com,DIRECT` rule, keep it **below** these. Otherwise the relay leaks
direct.

The option is mainly for Macs running Clash Verge Rev in TUN mode. On iPhone
with Stash it is untested whether iOS sends Apple Intelligence traffic through
a third-party VPN at all.

The list lives in `APPLE_PROXY_DOMAINS` in `src/converter.js`.
`config-example.yaml` has the same rules commented out.
