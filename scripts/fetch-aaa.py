#!/usr/bin/env python3
"""
Scrape current state-level gas price averages from AAA.
Appends new weekly data points to each state JSON file.
Designed to run weekly via GitHub Actions (Monday 10am ET).
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

AAA_URL = "https://gasprices.aaa.com/todays-state-averages/"
DATA_DIR = Path(__file__).parent.parent / "data"
MIN_STATES = 50
PRICE_MIN = 1.50
PRICE_MAX = 8.00

STATE_ABBREV = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
    "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME",
    "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE",
    "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
    "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}

STATE_PAD_MAP = {
    "CT": "PADD1A", "ME": "PADD1A", "MA": "PADD1A", "NH": "PADD1A",
    "RI": "PADD1A", "VT": "PADD1A",
    "DE": "PADD1B", "DC": "PADD1B", "MD": "PADD1B", "NJ": "PADD1B",
    "NY": "PADD1B", "PA": "PADD1B",
    "FL": "PADD1C", "GA": "PADD1C", "NC": "PADD1C", "SC": "PADD1C",
    "VA": "PADD1C", "WV": "PADD1C",
    "IL": "PADD2", "IN": "PADD2", "IA": "PADD2", "KS": "PADD2",
    "KY": "PADD2", "MI": "PADD2", "MN": "PADD2", "MO": "PADD2",
    "NE": "PADD2", "ND": "PADD2", "OH": "PADD2", "OK": "PADD2",
    "SD": "PADD2", "TN": "PADD2", "WI": "PADD2",
    "AL": "PADD3", "AR": "PADD3", "LA": "PADD3", "MS": "PADD3",
    "NM": "PADD3", "TX": "PADD3",
    "CO": "PADD4", "ID": "PADD4", "MT": "PADD4", "UT": "PADD4",
    "WY": "PADD4",
    "AK": "PADD5", "AZ": "PADD5", "CA": "PADD5", "HI": "PADD5",
    "NV": "PADD5", "OR": "PADD5", "WA": "PADD5",
}

STATE_NAMES = {v: k for k, v in STATE_ABBREV.items()}


def scrape_aaa():
    """Scrape AAA state gas price averages using headless browser (bypasses Cloudflare)."""
    prices = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(AAA_URL, wait_until="networkidle", timeout=60000)

        # Wait for the price table to render
        page.wait_for_selector("table", timeout=30000)
        html = page.content()
        browser.close()

    # Parse the HTML table - state name in first <td>, regular price in second <td>
    row_pattern = re.compile(
        r'<tr[^>]*>\s*'
        r'<td[^>]*>\s*(?:<a[^>]*>)?\s*([A-Za-z\s.]+?)\s*(?:</a>)?\s*</td>'
        r'(?:\s*<td[^>]*>\s*\$?([\d.]+)\s*</td>)',
        re.DOTALL
    )

    for match in row_pattern.finditer(html):
        state_name = match.group(1).strip()
        price_str = match.group(2).strip()

        if state_name in STATE_ABBREV:
            price = float(price_str)
            if PRICE_MIN <= price <= PRICE_MAX:
                prices[STATE_ABBREV[state_name]] = price

    return prices


def update_state_file(state_code, price, scrape_date):
    """Append a new data point to a state's JSON file."""
    state_file = DATA_DIR / f"states/{state_code}.json"

    if state_file.exists():
        with open(state_file) as f:
            data = json.load(f)
    else:
        data = {
            "state": state_code,
            "name": STATE_NAMES.get(state_code, state_code),
            "pad_region": STATE_PAD_MAP.get(state_code, ""),
            "data": [],
        }

    # Check for duplicate date
    existing_dates = {p["date"] for p in data["data"]}
    if scrape_date in existing_dates:
        print(f"  {state_code}: skipping, {scrape_date} already exists")
        return False

    data["data"].append({
        "date": scrape_date,
        "price": round(price, 3),
        "source": "aaa",
    })

    # Sort by date
    data["data"].sort(key=lambda x: x["date"])

    with open(state_file, "w") as f:
        json.dump(data, f, indent=2)
    return True


def main():
    print("Scraping AAA gas prices...")
    prices = scrape_aaa()

    if len(prices) < MIN_STATES:
        print(f"ERROR: Only scraped {len(prices)} states (minimum {MIN_STATES}). Aborting.")
        print("AAA page structure may have changed. Check the scraper.")
        sys.exit(1)

    scrape_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"Scraped {len(prices)} states for {scrape_date}")

    # Calculate national average from state prices
    national_avg = round(sum(prices.values()) / len(prices), 3)
    print(f"Computed national average: ${national_avg}")

    updated = 0
    for state_code, price in sorted(prices.items()):
        if update_state_file(state_code, price, scrape_date):
            updated += 1
            print(f"  {state_code}: ${price:.3f}")

    # Update national.json with AAA-based national average
    national_file = DATA_DIR / "national.json"
    if national_file.exists():
        with open(national_file) as f:
            nat_data = json.load(f)
    else:
        nat_data = {"name": "National Average", "data": []}

    existing_dates = {p["date"] for p in nat_data["data"]}
    if scrape_date not in existing_dates:
        nat_data["data"].append({
            "date": scrape_date,
            "price": national_avg,
            "source": "aaa",
        })
        nat_data["data"].sort(key=lambda x: x["date"])
        with open(national_file, "w") as f:
            json.dump(nat_data, f, indent=2)

    # Update metadata
    meta_file = DATA_DIR / "metadata.json"
    if meta_file.exists():
        with open(meta_file) as f:
            metadata = json.load(f)
    else:
        metadata = {}

    metadata["last_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    metadata["last_update_source"] = "aaa_scrape"
    with open(meta_file, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\nDone! Updated {updated} states.")


if __name__ == "__main__":
    main()
