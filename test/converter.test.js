import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest, parseDnsUrls } from "../src/converter.js";

const BASE_ENV = { ACCESS_TOKEN: "access-secret" };

async function getConfig(path, env = BASE_ENV) {
  const url = new URL(path, "https://proxy.example");
  url.searchParams.set("token", "access-secret");
  return handleRequest(new Request(url), env);
}

async function configText(path, env) {
  const response = await getConfig(path, env);
  assert.equal(response.status, 200, await response.clone().text());
  return response.text();
}

function rulesOf(yaml) {
  return yaml.split("\nrules:\n")[1].trim().split("\n").map((line) => line.trim().slice(2));
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

test("requests without the right token are rejected", async () => {
  const wrong = await handleRequest(
    new Request("https://proxy.example/config.yaml?token=nope"),
    BASE_ENV,
  );
  assert.equal(wrong.status, 401);

  const missing = await handleRequest(new Request("https://proxy.example/config.yaml"), BASE_ENV);
  assert.equal(missing.status, 401);

  const unconfigured = await handleRequest(
    new Request("https://proxy.example/config.yaml?token=anything"),
    {},
  );
  assert.equal(unconfigured.status, 401);
});

test("unknown paths are not served", async () => {
  assert.equal((await getConfig("/config-tailscale.yaml")).status, 404);
  assert.equal((await getConfig("/")).status, 404);
});

// ---------------------------------------------------------------------------
// Defaults: no Tailscale, public DNS
// ---------------------------------------------------------------------------

test("the default config has no Tailscale settings", async () => {
  const yaml = await configText("/config.yaml");

  assert.doesNotMatch(yaml, /route-exclude-address/);
  assert.doesNotMatch(yaml, /100\.64\.0\.0\/10/);
  assert.doesNotMatch(yaml, /ts\.net/);
  assert.doesNotMatch(yaml, /fake-ip-filter/);
  assert.doesNotMatch(yaml, /type: tailscale/);
  assert.match(yaml, /- MATCH,DIRECT/);
});

test("the default config uses public DNS resolvers", async () => {
  const yaml = await configText("/config.yaml");

  assert.match(
    yaml,
    /\n {2}nameserver:\n {4}- "https:\/\/cloudflare-dns\.com\/dns-query"\n {4}- "https:\/\/dns\.google\/dns-query"\n/,
  );
  assert.match(
    yaml,
    /proxy-server-nameserver:\n {4}- "https:\/\/cloudflare-dns\.com\/dns-query"\n/,
  );
  assert.match(
    yaml,
    /"geosite:anthropic":\n {6}- "https:\/\/cloudflare-dns\.com\/dns-query#Anthropic"\n {6}- "https:\/\/dns\.google\/dns-query#Anthropic"\n/,
  );
  assert.doesNotMatch(yaml, /nextdns/i);
});

// ---------------------------------------------------------------------------
// Optional: Tailscale
// ---------------------------------------------------------------------------

const TAILSCALE_TUN =
  /- any:53\n {2}#[^\n]*\n {2}route-exclude-address:\n {4}- 100\.64\.0\.0\/10\n {4}- fd7a:115c:a1e0::\/48\n/;
const TAILSCALE_FAKE_IP = /fake-ip-range: 198\.18\.0\.1\/16\n {2}fake-ip-filter:\n {4}- "\+\.ts\.net"\n/;

test("?tailscale=1 leaves the tailnet to a standalone Tailscale app", async () => {
  const yaml = await configText("/config.yaml?tailscale=1");

  assert.match(yaml, TAILSCALE_TUN);
  assert.match(yaml, TAILSCALE_FAKE_IP);
});

test("TAILSCALE=true turns Tailscale on by default, and ?tailscale=0 turns it off", async () => {
  const env = { ...BASE_ENV, TAILSCALE: "true" };

  assert.match(await configText("/config.yaml", env), TAILSCALE_TUN);
  assert.doesNotMatch(await configText("/config.yaml?tailscale=0", env), /route-exclude-address/);
});

// ---------------------------------------------------------------------------
// Optional: custom DNS (for example NextDNS)
// ---------------------------------------------------------------------------

test("DNS_URL replaces the resolvers everywhere, including the Anthropic policy", async () => {
  const custom = "https://dns.nextdns.io/abc123/My%20Laptop";
  const yaml = await configText("/config.yaml", { ...BASE_ENV, DNS_URL: custom });

  assert.match(yaml, /\n {2}nameserver:\n {4}- "https:\/\/dns\.nextdns\.io\/abc123\/My%20Laptop"\n {2}proxy-server-nameserver:/);
  assert.match(yaml, /proxy-server-nameserver:\n {4}- "https:\/\/dns\.nextdns\.io\/abc123\/My%20Laptop"\n {2}nameserver-policy:/);
  assert.match(yaml, /"geosite:anthropic":\n {6}- "https:\/\/dns\.nextdns\.io\/abc123\/My%20Laptop#Anthropic"\n/);
  assert.doesNotMatch(yaml, /cloudflare-dns\.com/);
});

test("DNS_URL accepts several resolvers and rejects unusable ones", () => {
  assert.deepEqual(parseDnsUrls("https://a.example/dns-query, tls://b.example"), [
    "https://a.example/dns-query",
    "tls://b.example",
  ]);
  assert.deepEqual(parseDnsUrls("  "), [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/dns-query",
  ]);
  assert.throws(() => parseDnsUrls("https://a.example/dns-query#Proxy"), /must not contain '#'/);
  assert.throws(() => parseDnsUrls("8.8.8.8"), /must start with/);
});

test("a bad DNS_URL is reported instead of producing a broken profile", async () => {
  const response = await getConfig("/config.yaml", { ...BASE_ENV, DNS_URL: "dns.example" });
  assert.equal(response.status, 500);
  assert.match(await response.text(), /DNS_URL entry must start with/);
});

// ---------------------------------------------------------------------------
// Optional: Apple Intelligence
// ---------------------------------------------------------------------------

test("the Apple option adds the relay rules above MATCH", async () => {
  assert.doesNotMatch(await configText("/config.yaml"), /guzzoni/);

  for (const [path, env] of [
    ["/config.yaml?apple=1", BASE_ENV],
    ["/config.yaml", { ...BASE_ENV, APPLE_INTELLIGENCE: "true" }],
  ]) {
    const rules = rulesOf(await configText(path, env));
    const apple = rules.indexOf("DOMAIN-SUFFIX,guzzoni.apple.com,Proxy");
    assert.ok(apple >= 0 && apple < rules.indexOf("MATCH,DIRECT"));
  }
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("the config sniffs hostnames from connections made by IP", async () => {
  const yaml = await configText("/config.yaml");

  assert.match(
    yaml,
    /\nsniffer:\n {2}enable: true\n {2}parse-pure-ip: true\n {2}override-destination: true\n/,
  );
  assert.match(yaml, / {4}TLS:\n {6}ports: \[443, 8443\]\n/);
});

test("the config routes Claude and its extras to the Anthropic group", async () => {
  const yaml = await configText("/config.yaml");
  assert.match(
    yaml,
    /- name: Anthropic\n {4}type: select\n {4}proxies:\n {6}- Proxy\n {4}use:\n {6}- webshare-provider\n/,
  );
  assert.match(yaml, /- GEOSITE,openai,Proxy\n/);
  assert.match(
    yaml,
    /- GEOSITE,anthropic,Anthropic\n {2}- DOMAIN,anthropic\.com\.cdn\.cloudflare\.net,Anthropic\n {2}- DOMAIN,anthropic\.auth0\.com,Anthropic\n/,
  );
  assert.match(yaml, /- DOMAIN-KEYWORD,sift,Anthropic\n/);
  assert.match(yaml, /- IP-CIDR,160\.79\.104\.0\/21,Anthropic,no-resolve\n/);
  assert.match(
    yaml,
    /- IP-CIDR6,2607:6bc0::\/32,Anthropic,no-resolve\n {2}- GEOSITE,google-gemini,Proxy/,
  );
});

test("Claude UDP is rejected before HTTP proxy rules", async () => {
  for (const path of ["/config.yaml", "/config.yaml?apple=1&tailscale=1"]) {
    const rules = rulesOf(await configText(path));
    const coreGuard = "AND,((NETWORK,UDP),(GEOSITE,anthropic)),REJECT";
    assert.ok(rules.indexOf(coreGuard) >= 0);
    assert.ok(rules.indexOf(coreGuard) < rules.indexOf("GEOSITE,anthropic,Anthropic"));
    for (const rule of rules.filter((line) => line.includes(",Anthropic"))) {
      const matcher = rule.replace(",Anthropic", "");
      const guardIndex = rules.indexOf(`AND,((NETWORK,UDP),(${matcher})),REJECT`);
      assert.ok(guardIndex >= 0 && guardIndex < rules.indexOf(rule), `unguarded route: ${rule}`);
    }
    assert.ok(!rules.includes("NETWORK,UDP,REJECT"));
    assert.ok(rules.includes("MATCH,DIRECT"));
  }
});

test("the profile points its provider at /webshare.yaml with the same token", async () => {
  const yaml = await configText("/config.yaml?apple=1");
  assert.match(yaml, /url: "https:\/\/proxy\.example\/webshare\.yaml\?token=access-secret"\n/);
});

// ---------------------------------------------------------------------------
// Provider file
// ---------------------------------------------------------------------------

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => handler(String(input));
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("TXT nodes are named by address, with fallbacks for repeated gateways", async () => {
  const list = [
    "82.26.250.254:7402:user:pass",
    "45.86.1.23:6001:user:pass",
    "p.webshare.io:80:user-1:pass",
    "p.webshare.io:80:user-2:pass",
  ].join("\n");
  const response = await withFetch(
    () => new Response(list),
    () => getConfig("/webshare.yaml", { ...BASE_ENV, WEBSHARE_URL: "https://list.example" }),
  );
  const yaml = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /^private/);
  assert.match(yaml, /name: "webshare 82\.26\.250\.254"/);
  assert.match(yaml, /name: "webshare 45\.86\.1\.23"/);
  assert.match(yaml, /name: "webshare p\.webshare\.io:80 #1"/);
  assert.match(yaml, /name: "webshare p\.webshare\.io:80 #2"/);
});

test("TXT mode without WEBSHARE_URL explains what is missing", async () => {
  const response = await getConfig("/webshare.yaml");
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "WEBSHARE_URL is not configured");
});

test("API node names stay tied to their IP when an earlier proxy is pruned", async () => {
  const proxy = (address, valid) => ({
    proxy_address: address,
    port: 6001,
    username: "user",
    password: "pass",
    country_code: "sg",
    valid,
  });
  const response = await withFetch(
    () =>
      Response.json({
        results: [proxy("82.26.250.254", false), proxy("45.86.1.23", true)],
        next: null,
      }),
    () => getConfig("/webshare.yaml", { ...BASE_ENV, WEBSHARE_API_KEY: "key" }),
  );
  const yaml = await response.text();

  assert.equal(response.status, 200);
  assert.match(yaml, /name: "SG 45\.86\.1\.23 🇸🇬"\n {4}type: http\n {4}server: 45\.86\.1\.23\n/);
  assert.doesNotMatch(yaml, /82\.26\.250\.254/);
});
