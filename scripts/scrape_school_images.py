from __future__ import annotations

import json
import re
import ssl
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_schools() -> list[dict]:
    text = (ROOT / "site" / "data.js").read_text(encoding="utf-8")
    payload = text.removeprefix("window.SCHOOLS = ").rstrip().removesuffix(";")
    return json.loads(payload)


def image_candidates(url: str) -> list[str]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except Exception:
        response = urllib.request.urlopen(request, timeout=15, context=ssl._create_unverified_context())
    html = response.read().decode("utf-8", "ignore")
    candidates: list[str] = []

    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<img[^>]+(?:src|data-src|data-lazy-src)=["\']([^"\']+)',
    ]
    for pattern in patterns:
        for match in re.findall(pattern, html, flags=re.I):
            if match.startswith("data:"):
                continue
            absolute = urllib.parse.urljoin(url, match)
            if absolute not in candidates:
                candidates.append(absolute)
    return candidates


def main() -> None:
    for school in load_schools():
        if school.get("gallery"):
            continue
        print(f"\n## {school['school']} | {school['official']}")
        try:
            for candidate in image_candidates(school["official"])[:12]:
                print(candidate)
        except Exception as exc:
            print(f"ERROR: {exc}")


if __name__ == "__main__":
    main()
