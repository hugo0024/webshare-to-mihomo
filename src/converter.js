const LINE_PATTERN = /^([^:]+):(\d+):([^:]+):(.+)$/;
const PROVIDER_PATH = "/webshare.yaml";
const CONFIG_PATH = "/config.yaml";
const API_BASE = "https://proxy.webshare.io/api/v2";
const API_LIST_URL = `${API_BASE}/proxy/list/`;
const API_PAGE_SIZE = 100;
const API_MAX_PAGES = 25;
const USER_AGENT = "webshare-mihomo-converter/1.0";

// Public DNS-over-HTTPS resolvers used when DNS_URL is not set. Set DNS_URL to
// use your own resolver instead (for example a NextDNS profile endpoint).
const DEFAULT_DNS_URLS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/dns-query",
];

// Tailscale's address ranges and MagicDNS suffix. Only added when the Tailscale
// option is on, so tailnet traffic stays on the Tailscale app's interface.
const TAILSCALE_ROUTE_EXCLUDES = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"];
const TAILSCALE_FAKE_IP_FILTER = ["+.ts.net"];

// Domains proxied only when the Apple Intelligence option is on. Covers Apple
// Intelligence + Siri backends and the multi-CDN OHTTP relay hops ChatGPT uses
// (Apple/Akamai/Cloudflare/Fastly). OpenAI domains are intentionally absent — the
// default GEOSITE,openai rule already proxies them.
const APPLE_PROXY_DOMAINS = [
  "guzzoni.apple.com",
  "smoot.apple.com",
  "apple-relay.apple.com",
  "gspe1-ssl.ls.apple.com",
  "apple-relay.akamaized.net",
  "apple-relay.mask.apple-dns.net",
  "apple-intelligence.apple.com",
  "ai.apple.com",
  "apple-relay.cloudflare.com",
  "apple-relay.fastly-edge.com",
  "cp4.cloudflare.com",
];

// Additional Claude hosts share the pinned Anthropic exit. The IP ranges
// (AS399358) also cover connections made by IP rather than hostname.
// The datadog keyword covers browser-intake-us5-datadoghq.com (not a
// datadoghq.com subdomain) and any future regional intake endpoint.
const ANTHROPIC_EXTRA_RULES = [
  "DOMAIN,anthropic.com.cdn.cloudflare.net,Anthropic",
  "DOMAIN,anthropic.auth0.com,Anthropic",
  "DOMAIN,anthropic-com.ghost.io,Anthropic",
  "DOMAIN-KEYWORD,datadog,Anthropic",
  "DOMAIN-KEYWORD,sentry,Anthropic",
  "DOMAIN-SUFFIX,statsigapi.net,Anthropic",
  "DOMAIN-KEYWORD,sift,Anthropic",
  "DOMAIN-SUFFIX,intercom.io,Anthropic",
  "DOMAIN-SUFFIX,intercomcdn.com,Anthropic",
  "DOMAIN,cdn.usefathom.com,Anthropic",
  "IP-CIDR,160.79.104.0/21,Anthropic,no-resolve",
  "IP-CIDR6,2607:6bc0::/32,Anthropic,no-resolve",
];

// HTTP nodes cannot carry UDP. Mihomo skips their rules for UDP and can reach
// MATCH,DIRECT, so reject Claude UDP before any proxy rule. Browsers then retry
// QUIC requests over TCP. Reuse the same matchers for the core and extra hosts.
const ANTHROPIC_MATCHERS = [
  "GEOSITE,anthropic",
  ...ANTHROPIC_EXTRA_RULES.map((rule) => rule.replace(",Anthropic", "")),
];
const ANTHROPIC_UDP_RULES = ANTHROPIC_MATCHERS.map(
  (matcher) => `AND,((NETWORK,UDP),(${matcher})),REJECT`,
);

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(items, indent) {
  return items.map((item) => `${" ".repeat(indent)}- ${yamlQuote(item)}`).join("\n");
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseFlag(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

// A query parameter (per device/profile) overrides the deployment-wide
// environment variable, which overrides the built-in default (off).
function resolveFlag(url, env, queryName, envName) {
  return parseFlag(url.searchParams.get(queryName))
    ?? parseFlag(env[envName])
    ?? false;
}

// DNS_URL holds one or more resolver URLs separated by commas or whitespace.
// The "#Anthropic" suffix is appended to each one for Claude's domains, so a
// URL must not carry its own "#..." part.
export function parseDnsUrls(value) {
  const urls = String(value ?? "")
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return DEFAULT_DNS_URLS;
  }

  for (const url of urls) {
    if (url.includes("#")) {
      throw new Error(`DNS_URL entry must not contain '#': ${url}`);
    }
    if (!/^(https|tls|quic):\/\//.test(url)) {
      throw new Error(`DNS_URL entry must start with https://, tls:// or quic://: ${url}`);
    }
  }
  return urls;
}

function buildAnthropicDnsPolicy(dnsUrls) {
  // Keyword-only telemetry matches have no fixed DNS zone. CONNECT requests
  // still pass their hostname to Webshare for remote resolution.
  const viaAnthropic = dnsUrls.map((url) => `${url}#Anthropic`);
  return ANTHROPIC_MATCHERS.flatMap((matcher) => {
    const [type, domain] = matcher.split(",");
    const key = type === "GEOSITE" ? `geosite:${domain}`
      : type === "DOMAIN" ? domain
      : type === "DOMAIN-SUFFIX" ? `+.${domain}`
      : null;
    return key ? [`    ${yamlQuote(key)}:\n${yamlList(viaAnthropic, 6)}`] : [];
  }).join("\n");
}

// ---------------------------------------------------------------------------
// Node naming
// ---------------------------------------------------------------------------

// Turn a two-letter ISO country code into its flag emoji (e.g. "SG" -> 🇸🇬).
function flagEmoji(code) {
  if (!/^[A-Z]{2}$/.test(code)) {
    return "\u{1F3F3}️"; // white flag fallback for unknown codes
  }
  const BASE = 0x1f1e6;
  return String.fromCodePoint(
    BASE + code.charCodeAt(0) - 65,
    BASE + code.charCodeAt(1) - 65,
  );
}

// Name each node by its server address so a selected node keeps the same exit
// IP across refreshes. Positional numbers (SG-1, SG-2…) shift whenever
// Webshare drops or replaces a proxy, silently moving the selection to
// another IP. Repeated addresses fall back to address:port, then a counter.
function addressNames(proxies) {
  const tally = (keys) =>
    keys.reduce((counts, key) => counts.set(key, (counts.get(key) || 0) + 1), new Map());
  const servers = tally(proxies.map((proxy) => proxy.server));
  const endpoints = tally(proxies.map((proxy) => `${proxy.server}:${proxy.port}`));
  const seen = new Map();

  return proxies.map((proxy) => {
    const endpoint = `${proxy.server}:${proxy.port}`;
    if (servers.get(proxy.server) === 1) {
      return proxy.server;
    }
    if (endpoints.get(endpoint) === 1) {
      return endpoint;
    }
    seen.set(endpoint, (seen.get(endpoint) || 0) + 1);
    return `${endpoint} #${seen.get(endpoint)}`;
  });
}

function proxyEntry(name, proxy) {
  return [
    `  - name: ${yamlQuote(name)}`,
    "    type: http",
    `    server: ${proxy.server}`,
    `    port: ${proxy.port}`,
    `    username: ${yamlQuote(proxy.username)}`,
    `    password: ${yamlQuote(proxy.password)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// TXT download path (used when WEBSHARE_API_KEY is not set)
// ---------------------------------------------------------------------------

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(LINE_PATTERN);
  if (!match) {
    return null;
  }

  return {
    server: match[1],
    port: Number.parseInt(match[2], 10),
    username: match[3],
    password: match[4],
  };
}

export function convertToYaml(text) {
  const proxies = text.split(/\r?\n/).map(parseLine).filter(Boolean);

  if (proxies.length === 0) {
    throw new Error("No valid proxy lines found");
  }

  const names = addressNames(proxies);
  const entries = proxies.map((proxy, index) => proxyEntry(`webshare ${names[index]}`, proxy));
  return `proxies:\n${entries.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Webshare API path (used when WEBSHARE_API_KEY is set) — adds country tags
// ---------------------------------------------------------------------------

function apiHeaders(apiKey) {
  return {
    Authorization: `Token ${apiKey}`,
    "User-Agent": USER_AGENT,
  };
}

async function fetchWebshareProxies(apiKey) {
  const raw = [];

  for (let page = 1; page <= API_MAX_PAGES; page += 1) {
    const url = `${API_LIST_URL}?mode=direct&page=${page}&page_size=${API_PAGE_SIZE}`;
    const response = await fetch(url, { headers: apiHeaders(apiKey) });

    if (!response.ok) {
      throw new Error(`Webshare API returned ${response.status}`);
    }

    const data = await response.json();
    raw.push(...(data.results || []));

    if (!data.next) {
      break;
    }
  }

  if (raw.length === 0) {
    throw new Error("No proxies returned from Webshare API");
  }

  // Auto-prune: drop any proxy Webshare has flagged as invalid (dead).
  const proxies = raw
    .filter((item) => item.valid !== false)
    .map((item) => ({
      server: item.proxy_address,
      port: item.port,
      username: item.username,
      password: item.password,
      country: (item.country_code || "XX").toUpperCase(),
    }));

  if (proxies.length === 0) {
    throw new Error(`All ${raw.length} Webshare proxies are currently invalid`);
  }

  return proxies;
}

// Build the provider file with country-tagged node names, e.g.
// "SG 45.86.1.23 🇸🇬". Country labels make nodes easy to identify in the
// manual selector; the address keeps each name tied to one exit IP.
function convertProxiesToYaml(proxies) {
  const names = addressNames(proxies);
  const entries = proxies.map((proxy, index) =>
    proxyEntry(`${proxy.country} ${names[index]} ${flagEmoji(proxy.country)}`, proxy),
  );
  return `proxies:\n${entries.join("\n")}\n`;
}

// Build a Clash `subscription-userinfo` header value so Clash Verge renders a
// usage + expiry card on the profile. Pulls bandwidth used (stats), the plan's
// bandwidth limit, and the billing-period end date from the Webshare API.
// Returns "" if the data can't be retrieved (caller then omits the header).
async function fetchUsageHeader(apiKey) {
  const headers = apiHeaders(apiKey);

  const subResponse = await fetch(`${API_BASE}/subscription/`, { headers });
  if (!subResponse.ok) {
    return "";
  }
  const subscription = await subResponse.json();
  const expire = subscription.end_date
    ? Math.floor(Date.parse(subscription.end_date) / 1000)
    : 0;

  // Used bandwidth for the current period; plan limit for the bar's total.
  const nowIso = new Date().toISOString();
  const statsUrl = subscription.start_date
    ? `${API_BASE}/stats/aggregate/?timestamp__gte=${encodeURIComponent(subscription.start_date)}&timestamp__lte=${encodeURIComponent(nowIso)}`
    : `${API_BASE}/stats/aggregate/`;
  const planUrl = subscription.plan
    ? `${API_BASE}/subscription/plan/${subscription.plan}/`
    : null;

  const [statsResponse, planResponse] = await Promise.all([
    fetch(statsUrl, { headers }),
    planUrl ? fetch(planUrl, { headers }) : Promise.resolve(null),
  ]);

  let used = 0;
  if (statsResponse && statsResponse.ok) {
    const stats = await statsResponse.json();
    used = Number(stats.bandwidth_total) || 0;
  }

  let total = 0;
  if (planResponse && planResponse.ok) {
    const plan = await planResponse.json();
    const limitGb = Number(plan.bandwidth_limit) || 0; // GB; 0 = unlimited
    total = limitGb > 0 ? Math.round(limitGb * 1024 ** 3) : 0;
  }

  const parts = ["upload=0", `download=${used}`];
  if (total > 0) {
    parts.push(`total=${total}`); // omitted for unlimited plans
  }
  if (expire) {
    parts.push(`expire=${expire}`);
  }
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Config (full Clash profile) builders
// ---------------------------------------------------------------------------

// Claude traffic gets its own Anthropic group so it can be pinned to one exit
// IP while Proxy is switched freely for other services. It follows Proxy until
// a node is picked.
function buildProxyGroups() {
  return `proxy-groups:
  - name: Proxy
    type: select
    use:
      - webshare-provider
  - name: Anthropic
    type: select
    proxies:
      - Proxy
    use:
      - webshare-provider`;
}

// Leave the tailnet to a standalone Tailscale app running beside Mihomo.
function buildTunTailscale(includeTailscale) {
  if (!includeTailscale) return "";
  return `
  # Tailscale option: leave the tailnet to the Tailscale app running beside Mihomo.
  route-exclude-address:
${TAILSCALE_ROUTE_EXCLUDES.map((cidr) => `    - ${cidr}`).join("\n")}`;
}

function buildFakeIpFilter(includeTailscale) {
  if (!includeTailscale) return "";
  return `
  fake-ip-filter:
${yamlList(TAILSCALE_FAKE_IP_FILTER, 4)}`;
}

export function buildConfigYaml(providerUrl, options = {}) {
  const {
    includeApple = false,
    includeTailscale = false,
    dnsUrls = DEFAULT_DNS_URLS,
  } = options;

  // Apple Intelligence's ChatGPT uses a multi-hop OHTTP relay across several CDNs,
  // so its region check uses whatever IP reaches Apple. Proxy the relay + Apple
  // Intelligence/Siri backends (see APPLE_PROXY_DOMAINS), while keeping all other
  // Apple traffic DIRECT. Off by default.
  const appleRule = includeApple
    ? "\n" + APPLE_PROXY_DOMAINS.map((d) => `  - DOMAIN-SUFFIX,${d},Proxy`).join("\n")
    : "";

  // Apps get real IPs when another resolver answers first (a VPN's DNS, Tailscale
  // DNS, browser DoH). Sniff the hostname so GEOSITE rules still match, and send
  // it to Webshare instead of an IPv6 address the HTTP nodes cannot reach.
  const sniffer = `
sniffer:
  enable: true
  parse-pure-ip: true
  override-destination: true
  sniff:
    HTTP:
      ports: [80, 8080-8880]
    TLS:
      ports: [443, 8443]
    QUIC:
      ports: [443, 8443]
  skip-domain:
    - "+.push.apple.com"
`;

  return `mode: rule
mixed-port: 7897
allow-lan: false
log-level: info
ipv6: true
external-controller: ''
secret: set-your-secret
unified-delay: true

external-controller-cors:
  allow-private-network: true
  allow-origins:
    - tauri://localhost
    - http://tauri.localhost
    - https://yacd.metacubex.one
    - https://metacubex.github.io
    - https://board.zash.run.place

tun:
  enable: false
  stack: gvisor
  auto-route: true
  strict-route: false
  auto-detect-interface: true
  dns-hijack:
    - any:53${buildTunTailscale(includeTailscale)}

external-controller-pipe: \\\\.\\pipe\\verge-mihomo

dns:
  enable: true
  listen: 127.0.0.1:1053
  ipv6: true
  respect-rules: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16${buildFakeIpFilter(includeTailscale)}
  default-nameserver:
    - 1.1.1.1
    - 8.8.8.8
  nameserver:
${yamlList(dnsUrls, 4)}
  proxy-server-nameserver:
${yamlList(dnsUrls, 4)}
  nameserver-policy:
${buildAnthropicDnsPolicy(dnsUrls)}
${sniffer}
proxy-providers:
  webshare-provider:
    type: http
    url: ${yamlQuote(providerUrl)}
    path: ./proxy_providers/webshare.yaml
    interval: 3600
    proxy: DIRECT
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204
      interval: 300

${buildProxyGroups()}

rules:
${ANTHROPIC_UDP_RULES.map((rule) => `  - ${rule}`).join("\n")}
  - GEOSITE,openai,Proxy
  - GEOSITE,anthropic,Anthropic
${ANTHROPIC_EXTRA_RULES.map((rule) => `  - ${rule}`).join("\n")}
  - GEOSITE,google-gemini,Proxy${appleRule}
  - MATCH,DIRECT
`;
}

function buildProviderUrl(requestUrl, token) {
  const providerUrl = new URL(PROVIDER_PATH, requestUrl.origin);
  providerUrl.searchParams.set("token", token);
  return providerUrl.toString();
}

const YAML_HEADERS = {
  "Content-Type": "text/yaml; charset=utf-8",
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname !== PROVIDER_PATH && url.pathname !== CONFIG_PATH) {
    return new Response("Not found", { status: 404 });
  }

  const token = url.searchParams.get("token");
  if (!env.ACCESS_TOKEN || !token || token !== env.ACCESS_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const useApi = Boolean(env.WEBSHARE_API_KEY);

  // Full Clash config profile.
  if (url.pathname === CONFIG_PATH) {
    try {
      const options = {
        includeApple: resolveFlag(url, env, "apple", "APPLE_INTELLIGENCE"),
        includeTailscale: resolveFlag(url, env, "tailscale", "TAILSCALE"),
        dnsUrls: parseDnsUrls(env.DNS_URL),
      };
      const headers = {
        ...YAML_HEADERS,
        // The body embeds the access token, so keep it out of shared caches.
        "Cache-Control": "private, max-age=300",
        "profile-update-interval": "24",
      };

      if (useApi) {
        // Best-effort usage bar; never let it break config generation.
        try {
          const info = await fetchUsageHeader(env.WEBSHARE_API_KEY);
          if (info) {
            headers["subscription-userinfo"] = info;
          }
        } catch {
          // ignore — just omit the usage bar
        }
      }

      return new Response(buildConfigYaml(buildProviderUrl(url, token), options), { headers });
    } catch (error) {
      return new Response(`Converter error: ${error.message}`, { status: 500 });
    }
  }

  // Provider file (proxies only). It contains proxy passwords: private cache only.
  const providerHeaders = { ...YAML_HEADERS, "Cache-Control": "private, max-age=300" };
  try {
    if (useApi) {
      const proxies = await fetchWebshareProxies(env.WEBSHARE_API_KEY);
      return new Response(convertProxiesToYaml(proxies), { headers: providerHeaders });
    }

    if (!env.WEBSHARE_URL) {
      return new Response("WEBSHARE_URL is not configured", { status: 500 });
    }

    const source = await fetch(env.WEBSHARE_URL, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!source.ok) {
      return new Response(`Failed to fetch Webshare list (${source.status})`, {
        status: 502,
      });
    }

    return new Response(convertToYaml(await source.text()), { headers: providerHeaders });
  } catch (error) {
    return new Response(`Converter error: ${error.message}`, { status: 500 });
  }
}
