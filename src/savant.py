"""
savant.py — Baseball Savant (Statcast) data fetcher

Fetches pitcher arsenal stats + movement, and batter vs pitch-type splits.
Data source: baseballsavant.mlb.com (free, no API key required)
"""

import io
import csv
import time
import requests

SAVANT_BASE = "https://baseballsavant.mlb.com"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; mlb-engine/1.0)",
    "Accept": "text/csv,*/*",
}


def _get_csv(endpoint, params, retries=3):
    """Fetch a CSV from Baseball Savant and return a list of row dicts."""
    url = f"{SAVANT_BASE}{endpoint}"
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, headers=_HEADERS, timeout=30)
            resp.raise_for_status()
            content = resp.content.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(content))
            return list(reader)
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            print(f"  Warning: Savant request failed ({e}), retrying...")
            time.sleep(2.0)


def _safe_float(val, default=None):
    try:
        if val in (None, "", "null", "NA", "-"):
            return default
        return float(val)
    except (TypeError, ValueError):
        return default


def _parse_name(row):
    """Parse 'Last, First' field into 'First Last'."""
    raw = row.get("last_name, first_name", "")
    parts = raw.split(", ", 1)
    if len(parts) == 2:
        return f"{parts[1]} {parts[0]}"
    return raw


def fetch_pitcher_arsenal(season):
    """
    Fetch and merge pitcher arsenal stats + pitch movement.
    Returns list of dicts:
      { player_id, name, team, pitches: [{ pitch_type, pitch_name,
        usage_pct, whiff_pct, woba_against, xwoba_against,
        hard_hit_pct, run_value_per_100,
        avg_speed, break_x, break_z }] }
    """
    print("    Fetching pitcher arsenal from Baseball Savant...")
    arsenal_rows = _get_csv(
        "/leaderboard/pitch-arsenal-stats",
        {"type": "pitcher", "min": 10, "year": season, "csv": "true"},
    )
    time.sleep(0.5)

    print("    Fetching pitch movement data (all pitch types)...")
    _PITCH_TYPES = ["FF", "SI", "FC", "SL", "ST", "SV", "CU", "KC", "CH", "FS", "KN"]
    movement_rows = []
    for pt in _PITCH_TYPES:
        rows = _get_csv(
            "/leaderboard/pitch-movement",
            {"year": season, "min": 10, "pitch_type": pt, "csv": "true"},
        )
        movement_rows.extend(rows)
        time.sleep(0.2)
    time.sleep(0.3)

    # Build movement lookup: (pitcher_id, pitch_type) -> movement stats
    movement = {}
    for r in movement_rows:
        pid = r.get("pitcher_id", "").strip()
        pt = r.get("pitch_type", "").strip()
        if pid and pt:
            movement[(pid, pt)] = {
                "avg_speed": _safe_float(r.get("avg_speed")),
                "break_x": _safe_float(r.get("pitcher_break_x")),
                "break_z": _safe_float(r.get("pitcher_break_z_induced")),
            }

    # Group arsenal rows by pitcher
    players = {}
    for r in arsenal_rows:
        pid = r.get("player_id", "").strip()
        if not pid:
            continue
        if pid not in players:
            players[pid] = {
                "player_id": int(pid),
                "name": _parse_name(r),
                "team": r.get("team_name_alt", "").strip(),
                "pitches": [],
            }
        pt = r.get("pitch_type", "").strip()
        mov = movement.get((pid, pt), {})
        players[pid]["pitches"].append(
            {
                "pitch_type": pt,
                "pitch_name": r.get("pitch_name", "").strip(),
                "usage_pct": _safe_float(r.get("pitch_usage")),
                "whiff_pct": _safe_float(r.get("whiff_percent")),
                "woba_against": _safe_float(r.get("woba")),
                "xwoba_against": _safe_float(r.get("est_woba")),
                "hard_hit_pct": _safe_float(r.get("hard_hit_percent")),
                "run_value_per_100": _safe_float(r.get("run_value_per_100")),
                "avg_speed": mov.get("avg_speed"),
                "break_x": mov.get("break_x"),
                "break_z": mov.get("break_z"),
            }
        )

    result = list(players.values())
    for p in result:
        p["pitches"].sort(key=lambda x: x["usage_pct"] or 0, reverse=True)
    result.sort(key=lambda p: p["name"])
    return result


def fetch_batter_vs_pitch(season):
    """
    Fetch batter performance vs each pitch type.
    Returns list of dicts:
      { player_id, name, team, vs_pitches: [{ pitch_type, pitch_name,
        pa, woba, xwoba, ba, slg, whiff_pct, hard_hit_pct,
        run_value_per_100 }] }
    """
    print("    Fetching batter vs pitch type from Baseball Savant...")
    rows = _get_csv(
        "/leaderboard/pitch-arsenal-stats",
        {"type": "batter", "min": 10, "year": season, "csv": "true"},
    )

    batters = {}
    for r in rows:
        pid = r.get("player_id", "").strip()
        if not pid:
            continue
        if pid not in batters:
            batters[pid] = {
                "player_id": int(pid),
                "name": _parse_name(r),
                "team": r.get("team_name_alt", "").strip(),
                "vs_pitches": [],
            }
        batters[pid]["vs_pitches"].append(
            {
                "pitch_type": r.get("pitch_type", "").strip(),
                "pitch_name": r.get("pitch_name", "").strip(),
                "pa": int(r.get("pa") or 0),
                "woba": _safe_float(r.get("woba")),
                "xwoba": _safe_float(r.get("est_woba")),
                "ba": _safe_float(r.get("ba")),
                "slg": _safe_float(r.get("slg")),
                "whiff_pct": _safe_float(r.get("whiff_percent")),
                "hard_hit_pct": _safe_float(r.get("hard_hit_percent")),
                "run_value_per_100": _safe_float(r.get("run_value_per_100")),
            }
        )

    result = list(batters.values())
    for b in result:
        b["vs_pitches"].sort(key=lambda x: x["pa"], reverse=True)
    result.sort(key=lambda b: b["name"])
    return result
