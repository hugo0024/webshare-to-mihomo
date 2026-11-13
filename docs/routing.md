# Routing

How `/config.yaml` decides what goes through Webshare, and how to change it.

## Default rules

The profile proxies AI services only and sends everything else direct:

```yaml
rules:
  # Reject Claude UDP before proxy rules; Webshare HTTP nodes support only TCP.
  - AND,((NETWORK,UDP),(GEOSITE,anthropic)),REJECT
  # ...one UDP guard per Claude extra (below)
  - GEOSITE,openai,Proxy
  - GEOSITE,anthropic,Anthropic
  # ...Claude extras (below)
  - GEOSITE,google-gemini,Proxy
  # ...Apple Intelligence rules, if enabled
  - MATCH,DIRECT
```

## Groups

```yaml
proxy-groups:
  - name: Proxy
    type: select
    use:
      - webshare-provider
  - name: Anthropic
    type: select
    proxies:
      - Proxy
    use:
      - webshare-provider
```

Both are manual `select` groups. There are no `url-test`, `fallback` or
per-country groups, and nothing switches servers behind your back.

### Pinning Claude (`Anthropic` group)

`Anthropic` starts on `Proxy`, so Claude uses whichever node `Proxy` uses. Pick a
specific node in `Anthropic` to pin Claude to that exit IP. You can then switch
`Proxy` for ChatGPT or Gemini without moving Claude.

A fixed exit matters most on datacenter proxies, where frequent IP changes look
unusual. Node names contain the IP, so a pinned node keeps the same IP across
provider refreshes. Older positional names like `SG-1` used to move to another
IP whenever Webshare replaced a proxy.

## Claude extras

`GEOSITE,anthropic` covers Anthropic's own domains (anthropic.com, claude.ai,
claude.com, clau.de, and the MCP and user-content domains). The profile adds
these rules right after it, also routed to `Anthropic`:

```yaml
  - DOMAIN,anthropic.com.cdn.cloudflare.net,Anthropic
  - DOMAIN,anthropic.auth0.com,Anthropic
  - DOMAIN,anthropic-com.ghost.io,Anthropic
  - DOMAIN-KEYWORD,datadog,Anthropic
  - DOMAIN-KEYWORD,sentry,Anthropic
  - DOMAIN-SUFFIX,statsigapi.net,Anthropic
  - DOMAIN-KEYWORD,sift,Anthropic
  - DOMAIN-SUFFIX,intercom.io,Anthropic
  - DOMAIN-SUFFIX,intercomcdn.com,Anthropic
  - DOMAIN,cdn.usefathom.com,Anthropic
  - IP-CIDR,160.79.104.0/21,Anthropic,no-resolve
  - IP-CIDR6,2607:6bc0::/32,Anthropic,no-resolve
```

- The domain rules keep the CDN, login, fraud-check and telemetry services that
  claude.ai loads on the same exit as Claude itself.
- The `datadog` keyword covers `browser-intake-us5-datadoghq.com` (not a
  `datadoghq.com` subdomain) and future regional endpoints.
- The keywords are broad. They also send other apps' Datadog, Sentry and Sift
  traffic, including those services' own dashboards, through the `Anthropic`
  node. Remove a keyword if that costs you too much bandwidth.
- The IP ranges belong to Anthropic (AS399358) and catch connections made by IP
  instead of hostname. They contain every prefix that AS announces, so an
  `IP-ASN` rule (which needs an extra ASN database) would add nothing.

The list lives in `ANTHROPIC_EXTRA_RULES` in `src/converter.js`.

## Claude UDP and DNS

Webshare nodes are `type: http` and cannot carry UDP. In TUN mode a browser may
try QUIC/HTTP/3 over UDP/443. Mihomo **skips** a matched proxy that can't do UDP
and continues down the rules. The connection would then reach `MATCH,DIRECT` and
expose your real IP, even while TCP uses the proxy. See
[Mihomo rule priority](https://wiki.metacubex.one/en/config/rules/#priority).

The profile therefore **rejects** UDP to every Claude matcher before its proxy
rule, and browsers retry over TCP through `Anthropic`. The guards cover IPv4 and
IPv6 and leave unrelated UDP alone. They apply in **rule** mode only; global mode
bypasses them. After changing the profile, close existing Claude connections and
open the login page again, rather than reloading an error page.

DNS for Claude's geosite domains and named extras goes through the `Anthropic`
group (`nameserver-policy` with `#Anthropic`). `proxy-server-nameserver` stays
direct, so the proxy hostnames resolve without a DNS-through-proxy loop.
Keyword-only matches have no fixed DNS zone and use the default policy. HTTP
CONNECT still passes their hostname to Webshare, which resolves it remotely.
See [Mihomo DNS configuration](https://wiki.metacubex.one/en/config/dns/) and
[custom DNS](optional-features.md#custom-dns-eg-nextdns).

### Sniffer

```yaml
sniffer:
  enable: true
  parse-pure-ip: true
  override-destination: true
```

When something other than Mihomo answers DNS first (a VPN, Tailscale DNS,
browser "secure DNS"), apps connect by real IP and domain rules can't match.
The sniffer reads the hostname from the TLS/HTTP/QUIC handshake, so `GEOSITE`
rules still match, and Webshare receives a hostname rather than an IPv6 address
it can't reach.

### Things that don't help

- `fingerprint: chrome` and similar options from generic guides don't change the
  browser's TLS handshake inside a plain HTTP CONNECT tunnel.
- Proxying NTP doesn't change your timezone. NTP is UDP, which these nodes can't
  carry, and it syncs UTC, not the system timezone. If an app reports a timezone
  you don't want, launch it with `TZ` set, e.g. `TZ=Asia/Singapore claude`.

## Changing the rules

All rules are generated in `buildConfigYaml` in `src/converter.js`.

- **Proxy another service:** add a `GEOSITE,<name>,Proxy` line above `MATCH`.
  The names come from the
  [MetaCubeX geosite list](https://github.com/MetaCubeX/meta-rules-dat).
- **Proxy everything:** change the last rule to `MATCH,Proxy`. This uses much
  more Webshare bandwidth.
- **Hand-edit instead:** use `config-example.yaml` as a static local profile.

Run `npm test` after changing the rules. The tests check, among other things,
that every `Anthropic` route has its UDP guard above it.
