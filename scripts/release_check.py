#!/usr/bin/env python3
"""Release consistency checks for SEO/deploy metadata.

Checks that:
1) robots.txt sitemap URL matches deployed base URL.
2) sitemap.xml <lastmod> can be updated to deploy date.
3) index.html canonical URL matches sitemap primary URL.
4) Every crawlable HTML page is represented in sitemap.xml.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def normalize_base_url(url: str) -> str:
    return url.rstrip("/")


def normalize_site_url(base_url: str, relative_html: Path) -> str:
    rel = relative_html.as_posix()
    if rel == "index.html":
        return f"{base_url}/"
    if rel.endswith("/index.html"):
        return f"{base_url}/{rel[:-10]}/"
    return f"{base_url}/{rel}"


def extract_robots_sitemap(robots_path: Path) -> str:
    content = robots_path.read_text(encoding="utf-8")
    match = re.search(r"^\s*Sitemap:\s*(\S+)\s*$", content, flags=re.MULTILINE | re.IGNORECASE)
    if not match:
        raise ValueError(f"No 'Sitemap:' entry found in {robots_path}")
    return match.group(1)


def extract_canonical(index_path: Path) -> str:
    content = index_path.read_text(encoding="utf-8")
    match = re.search(
        r'<link\s+[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\'][^>]*>',
        content,
        flags=re.IGNORECASE,
    )
    if not match:
        raise ValueError(f"No canonical <link> found in {index_path}")
    return match.group(1)


def update_lastmod_in_text(sitemap_path: Path, deploy_date: str) -> bool:
    original = sitemap_path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r"(<lastmod>)(\d{4}-\d{2}-\d{2})(</lastmod>)",
        rf"\g<1>{deploy_date}\g<3>",
        original,
    )
    if count == 0:
        raise ValueError("No <lastmod> entries found in sitemap.xml")
    if updated != original:
        sitemap_path.write_text(updated, encoding="utf-8")
        return True
    return False


def collect_crawlable_html(repo_root: Path) -> set[str]:
    urls: set[str] = set()
    for html in repo_root.rglob("*.html"):
        rel = html.relative_to(repo_root)
        parts = rel.parts
        if any(p.startswith(".") for p in parts):
            continue
        if parts[0] in {"node_modules", "site-artifact"}:
            continue
        if rel.name == "404.html":
            # GitHub Pages fallback page is not guaranteed to be a crawl target.
            continue
        urls.add(rel.as_posix())
    return urls


def load_sitemap_locs_and_lastmods(sitemap_path: Path) -> tuple[set[str], list[str]]:
    tree = ET.parse(sitemap_path)
    root = tree.getroot()
    locs: set[str] = set()
    lastmods: list[str] = []

    for url_node in root.findall("sm:url", NS):
        loc_node = url_node.find("sm:loc", NS)
        if loc_node is None or not (loc_node.text and loc_node.text.strip()):
            raise ValueError("Found <url> entry without <loc>")
        locs.add(loc_node.text.strip())

        lm_node = url_node.find("sm:lastmod", NS)
        if lm_node is not None and lm_node.text:
            lastmods.append(lm_node.text.strip())

    if not locs:
        raise ValueError("No <loc> entries found in sitemap.xml")

    return locs, lastmods


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and optionally update release SEO metadata.")
    parser.add_argument("--repo-root", default=".", help="Path to repository root")
    parser.add_argument("--base-url", required=True, help="Deployed base URL, e.g. https://example.com/app")
    parser.add_argument(
        "--date",
        default=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"),
        help="Deploy date for sitemap lastmod (YYYY-MM-DD, default: current UTC date)",
    )
    parser.add_argument(
        "--write-lastmod",
        action="store_true",
        help="Update all sitemap.xml <lastmod> tags to --date before validation.",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    robots_path = repo_root / "robots.txt"
    sitemap_path = repo_root / "sitemap.xml"
    index_path = repo_root / "index.html"

    base_url = normalize_base_url(args.base_url)
    expected_sitemap_url = f"{base_url}/sitemap.xml"

    try:
        dt.datetime.strptime(args.date, "%Y-%m-%d")
    except ValueError as err:
        print(f"Invalid --date '{args.date}': {err}", file=sys.stderr)
        return 1

    if args.write_lastmod:
        changed = update_lastmod_in_text(sitemap_path, args.date)
        action = "updated" if changed else "already current"
        print(f"sitemap.xml lastmod: {action} ({args.date})")

    errors: list[str] = []

    robots_sitemap = extract_robots_sitemap(robots_path)
    if robots_sitemap != expected_sitemap_url:
        errors.append(
            f"robots.txt Sitemap mismatch: expected '{expected_sitemap_url}', found '{robots_sitemap}'"
        )

    sitemap_locs, sitemap_lastmods = load_sitemap_locs_and_lastmods(sitemap_path)

    primary_url = f"{base_url}/"
    if primary_url not in sitemap_locs:
        errors.append(f"sitemap.xml is missing primary URL '{primary_url}'")

    canonical_url = extract_canonical(index_path)
    if canonical_url != primary_url:
        errors.append(
            f"index.html canonical mismatch: expected '{primary_url}', found '{canonical_url}'"
        )

    if args.write_lastmod:
        wrong_dates = sorted({lm for lm in sitemap_lastmods if lm != args.date})
        if wrong_dates:
            errors.append(
                "sitemap.xml has stale <lastmod> values after update: " + ", ".join(wrong_dates)
            )

    crawlable = collect_crawlable_html(repo_root)
    expected_page_urls = {normalize_site_url(base_url, Path(rel)) for rel in crawlable}
    missing_from_sitemap = sorted(expected_page_urls - sitemap_locs)
    if missing_from_sitemap:
        errors.append(
            "sitemap.xml is missing crawlable page URL(s): " + ", ".join(missing_from_sitemap)
        )

    if errors:
        print("Release metadata check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Release metadata check passed.")
    print(f"- Base URL: {base_url}")
    print(f"- robots sitemap URL: {robots_sitemap}")
    print(f"- canonical URL: {canonical_url}")
    print(f"- crawlable pages verified: {len(expected_page_urls)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
