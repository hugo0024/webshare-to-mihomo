#!/usr/bin/env python3
"""Fetch a Webshare TXT proxy list and write a Mihomo proxy-provider YAML file.

Optional, offline alternative to the Cloudflare app: run it on your own machine
and point a `type: file` proxy provider at the output.

    WEBSHARE_URL='https://proxy.webshare.io/api/v2/proxy/list/download/...' \
        python3 scripts/build_webshare_yaml.py --output dist/webshare.yaml
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

LINE_PATTERN = re.compile(
    r"^(?P<server>[^:]+):(?P<port>\d+):(?P<username>[^:]+):(?P<password>.+)$"
)


def fetch_proxy_list(url: str, timeout: int = 30) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "webshare-mihomo-converter/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_line(line: str) -> dict[str, str | int] | None:
    line = line.strip()
    if not line or line.startswith("#"):
        return None

    match = LINE_PATTERN.match(line)
    if not match:
        return None

    return {
        "server": match.group("server"),
        "port": int(match.group("port")),
        "username": match.group("username"),
        "password": match.group("password"),
    }


def yaml_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def address_names(proxies: list[dict[str, str | int]]) -> list[str]:
    """Name nodes by address so a selected node keeps its exit IP across refreshes.

    Matches the Cloudflare app: a repeated address falls back to address:port,
    then to a counter.
    """
    servers = Counter(str(proxy["server"]) for proxy in proxies)
    endpoints = Counter(f"{proxy['server']}:{proxy['port']}" for proxy in proxies)
    seen: Counter[str] = Counter()
    names = []
    for proxy in proxies:
        endpoint = f"{proxy['server']}:{proxy['port']}"
        if servers[str(proxy["server"])] == 1:
            names.append(str(proxy["server"]))
        elif endpoints[endpoint] == 1:
            names.append(endpoint)
        else:
            seen[endpoint] += 1
            names.append(f"{endpoint} #{seen[endpoint]}")
    return names


def build_proxy_entry(name: str, proxy: dict[str, str | int]) -> str:
    return "\n".join(
        [
            f"  - name: {yaml_quote(name)}",
            "    type: http",
            f"    server: {proxy['server']}",
            f"    port: {proxy['port']}",
            f"    username: {yaml_quote(str(proxy['username']))}",
            f"    password: {yaml_quote(str(proxy['password']))}",
        ]
    )


def convert_to_yaml(text: str) -> str:
    proxies = [parsed for parsed in map(parse_line, text.splitlines()) if parsed]

    if not proxies:
        raise ValueError("No valid proxy lines found in source text")

    names = address_names(proxies)
    entries = [
        build_proxy_entry(f"webshare {name}", proxy) for name, proxy in zip(names, proxies)
    ]
    return "proxies:\n" + "\n".join(entries) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--url",
        default=os.environ.get("WEBSHARE_URL", ""),
        help="Webshare TXT download URL (or set WEBSHARE_URL env var)",
    )
    parser.add_argument(
        "--output",
        default="dist/webshare.yaml",
        help="Output YAML path (default: dist/webshare.yaml)",
    )
    args = parser.parse_args()

    if not args.url:
        print("error: provide --url or set WEBSHARE_URL", file=sys.stderr)
        return 1

    try:
        source = fetch_proxy_list(args.url)
        yaml_content = convert_to_yaml(source)
    except (urllib.error.URLError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(yaml_content, encoding="utf-8")

    proxy_count = yaml_content.count("\n  - name:")
    print(f"wrote {proxy_count} proxies to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
