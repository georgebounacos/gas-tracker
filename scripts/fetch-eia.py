#!/usr/bin/env python3
"""
Fetch historical gasoline price data from EIA API v2.
Pulls national average, PAD district regions, and the 9 states with direct EIA coverage.
Writes JSON files to data/ directory.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
import urllib.request
import urllib.parse
import time

API_KEY = "k7tr9xsZlu5XqGvxDslI5d0JUkWxKGGXtyecENbZ"
BASE_URL = "https://api.eia.gov/v2/petroleum/pri/gnd/data/"
DATA_DIR = Path(__file__).parent.parent / "data"

# EIA duoarea codes for national, PAD regions, and the 9 states with coverage
EIA_AREAS = {
    # National
    "NUS": {"name": "National Average", "type": "national", "file": "national.json"},
    # PAD regions
    "R10": {"name": "East Coast (PADD 1)", "type": "pad", "file": "pad-regions/padd1.json"},
    "R1X": {"name": "New England (PADD 1A)", "type": "pad", "file": "pad-regions/padd1a.json"},
    "R1Y": {"name": "Central Atlantic (PADD 1B)", "type": "pad", "file": "pad-regions/padd1b.json"},
    "R1Z": {"name": "Lower Atlantic (PADD 1C)", "type": "pad", "file": "pad-regions/padd1c.json"},
    "R20": {"name": "Midwest (PADD 2)", "type": "pad", "file": "pad-regions/padd2.json"},
    "R30": {"name": "Gulf Coast (PADD 3)", "type": "pad", "file": "pad-regions/padd3.json"},
    "R40": {"name": "Rocky Mountain (PADD 4)", "type": "pad", "file": "pad-regions/padd4.json"},
    "R50": {"name": "West Coast (PADD 5)", "type": "pad", "file": "pad-regions/padd5.json"},
    # 9 states with direct EIA weekly data
    "SCA": {"name": "California", "type": "state", "state_code": "CA"},
    "SCO": {"name": "Colorado", "type": "state", "state_code": "CO"},
    "SFL": {"name": "Florida", "type": "state", "state_code": "FL"},
    "SMA": {"name": "Massachusetts", "type": "state", "state_code": "MA"},
    "SMN": {"name": "Minnesota", "type": "state", "state_code": "MN"},
    "SNY": {"name": "New York", "type": "state", "state_code": "NY"},
    "SOH": {"name": "Ohio", "type": "state", "state_code": "OH"},
    "STX": {"name": "Texas", "type": "state", "state_code": "TX"},
    "SWA": {"name": "Washington", "type": "state", "state_code": "WA"},
}

# State to PAD region mapping (all 50 states + DC)
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

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine",
    "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska",
    "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

# States with direct EIA data
EIA_STATES = {"CA", "CO", "FL", "MA", "MN", "NY", "OH", "TX", "WA"}


def fetch_eia_data(duoarea, product="EPM0", start="2000-01-01"):
    """Fetch weekly gasoline price data from EIA API v2."""
    params = {
        "api_key": API_KEY,
        "frequency": "weekly",
        "data[0]": "value",
        "facets[product][]": product,
        "facets[duoarea][]": duoarea,
        "start": start,
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        "offset": 0,
        "length": 5000,
    }

    all_data = []
    while True:
        url = BASE_URL + "?" + urllib.parse.urlencode(params, doseq=True)
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())

        rows = result.get("response", {}).get("data", [])
        if not rows:
            break

        all_data.extend(rows)
        total = int(result.get("response", {}).get("total", 0))
        params["offset"] += len(rows)
        if params["offset"] >= total:
            break
        time.sleep(0.3)

    return all_data


def build_data_points(raw_data, source_type):
    """Convert EIA API rows to our JSON format."""
    points = []
    for row in raw_data:
        val = row.get("value")
        if val is None:
            continue
        points.append({
            "date": row["period"],
            "price": round(float(val), 3),
            "source": source_type,
        })
    return points


def write_json(filepath, data):
    """Write JSON file with consistent formatting."""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Wrote {filepath} ({len(data.get('data', []))} points)")


def main():
    print("Fetching EIA historical data...")

    # Fetch national + PAD regions + 9 states
    for area_code, info in EIA_AREAS.items():
        print(f"Fetching {info['name']} ({area_code})...")
        raw = fetch_eia_data(area_code)
        points = build_data_points(raw, "eia_state" if info["type"] == "state" else "eia")

        if info["type"] == "national":
            out = {"name": "National Average", "data": points}
            write_json(DATA_DIR / info["file"], out)
        elif info["type"] == "pad":
            out = {"name": info["name"], "data": points}
            write_json(DATA_DIR / info["file"], out)
        elif info["type"] == "state":
            sc = info["state_code"]
            out = {
                "state": sc,
                "name": info["name"],
                "pad_region": STATE_PAD_MAP[sc],
                "data": points,
            }
            write_json(DATA_DIR / f"states/{sc}.json", out)

        time.sleep(0.5)

    # Create stub files for all states without direct EIA data
    # These will be populated by fetch-aaa.py
    for sc, name in STATE_NAMES.items():
        state_file = DATA_DIR / f"states/{sc}.json"
        if not state_file.exists():
            out = {
                "state": sc,
                "name": name,
                "pad_region": STATE_PAD_MAP[sc],
                "data": [],
            }
            write_json(state_file, out)

    # Write metadata
    metadata = {
        "last_updated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_update_source": "eia_historical",
        "eia_states": sorted(EIA_STATES),
        "state_pad_map": STATE_PAD_MAP,
        "state_names": STATE_NAMES,
    }
    write_json(DATA_DIR / "metadata.json", metadata)

    print("\nDone! EIA historical data loaded.")


if __name__ == "__main__":
    main()
