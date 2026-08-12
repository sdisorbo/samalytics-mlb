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


# Savant's pitch-movement leaderboard reports horizontal break as an unsigned
# magnitude. We sign it ourselves so the scatter plot shows arm-side vs
# glove-side. Chart is in pitcher's perspective: +x = pitcher's right side
# (3B side for a RHP). RHP arm-side break is to his right (+x); RHP glove-side
# is to his left (−x). Mirror for LHP.
_ARM_SIDE_PITCHES = {"FF", "SI", "FT", "CH", "FS", "FO", "SC"}
_GLOVE_SIDE_PITCHES = {"FC", "SL", "ST", "SV", "SW", "CU", "KC", "CS"}


def _sign_break_x(magnitude, pitch_type, pitch_hand):
    """Apply sign to an unsigned horizontal-break magnitude."""
    if magnitude is None:
        return None
    if pitch_type in _ARM_SIDE_PITCHES:
        arm_side = True
    elif pitch_type in _GLOVE_SIDE_PITCHES:
        arm_side = False
    else:
        return magnitude  # knuckleball, eephus, unknown — leave unsigned
    # RHP arm-side = +x; LHP arm-side = −x
    if pitch_hand == "R":
        return magnitude if arm_side else -magnitude
    if pitch_hand == "L":
        return -magnitude if arm_side else magnitude
    return magnitude  # unknown hand — leave unsigned


def fetch_pitch_kinematics(season, start_month=3, end_month=11):
    """
    Pulls per-pitch kinematic data from Statcast Search (one row per pitch),
    aggregates per (pitcher_id, pitch_type) to season averages, and returns:
        { (pitcher_id, pitch_type): {
              release_pos_x, release_pos_y, release_pos_z,
              release_extension, release_spin_rate, spin_axis,
              effective_speed, vx0, vy0, vz0, ax, ay, az,
              arm_angle, n
          } }

    All values in Statcast's native frame (catcher-view: +x right, +y toward
    mound, +z up). Sign conversion into our scene happens in the TS animation.

    Pulled month-by-month to keep response sizes manageable. The Statcast
    Search /csv endpoint refuses ranges that span > ~30 days at full volume.
    """
    import calendar

    KINE_COLS = [
        "release_pos_x", "release_pos_y", "release_pos_z",
        "release_extension", "release_spin_rate", "spin_axis",
        "effective_speed", "vx0", "vy0", "vz0", "ax", "ay", "az",
        "arm_angle",
    ]

    sums: dict = {}
    counts: dict = {}

    def _accum(pid: str, pt: str, row: dict):
        key = (pid, pt)
        if key not in sums:
            sums[key] = {c: 0.0 for c in KINE_COLS}
            counts[key] = {c: 0 for c in KINE_COLS}
        for c in KINE_COLS:
            v = _safe_float(row.get(c))
            if v is None:
                continue
            sums[key][c] += v
            counts[key][c] += 1

    for month in range(start_month, end_month + 1):
        last_day = calendar.monthrange(season, month)[1]
        start = f"{season}-{month:02d}-01"
        end = f"{season}-{month:02d}-{last_day:02d}"
        print(f"    Statcast kinematics: {start} - {end}")
        try:
            url = f"{SAVANT_BASE}/statcast_search/csv"
            params = {
                "all": "true",
                "hfSea": f"{season}|",
                "game_date_gt": start,
                "game_date_lt": end,
                "player_type": "pitcher",
                "type": "details",
                "min_pitches": "0",
                "min_results": "0",
                "min_pas": "0",
            }
            resp = requests.get(url, params=params, headers=_HEADERS, timeout=180)
            resp.raise_for_status()
            content = resp.content.decode("utf-8-sig", errors="replace")
            if len(content.strip()) < 200:
                continue
            reader = csv.DictReader(io.StringIO(content))
            n = 0
            for row in reader:
                pid = (row.get("pitcher") or "").strip()
                pt = (row.get("pitch_type") or "").strip()
                if not pid or not pt:
                    continue
                _accum(pid, pt, row)
                n += 1
            print(f"      ingested {n:,} pitches")
            time.sleep(0.5)
        except requests.RequestException as e:
            print(f"      warning: month {month} failed ({e})")
            continue

    # Average
    out: dict = {}
    for key, s in sums.items():
        c = counts[key]
        avg = {}
        for col in KINE_COLS:
            avg[col] = (s[col] / c[col]) if c[col] > 0 else None
        avg["n"] = max(c.values()) if c else 0
        out[key] = avg
    return out


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

    print("    Fetching pitch kinematics (Statcast Search, monthly)...")
    kinematics = fetch_pitch_kinematics(season)
    print(f"      {len(kinematics)} (pitcher, pitch_type) kinematic averages.")

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
                "pitch_hand": (r.get("pitch_hand") or "").strip().upper(),
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
        kine = kinematics.get((pid, pt), {})
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
                "break_x": _sign_break_x(mov.get("break_x"), pt, mov.get("pitch_hand")),
                "break_z": mov.get("break_z"),
                # Per-pitch-type kinematic averages from Statcast Search.
                # All values in Statcast's catcher-view frame; converted to
                # the scene frame in the TS animation code.
                "release_pos_x": kine.get("release_pos_x"),
                "release_pos_y": kine.get("release_pos_y"),
                "release_pos_z": kine.get("release_pos_z"),
                "release_extension": kine.get("release_extension"),
                "release_spin_rate": kine.get("release_spin_rate"),
                "spin_axis": kine.get("spin_axis"),
                "effective_speed": kine.get("effective_speed"),
                "vx0": kine.get("vx0"),
                "vy0": kine.get("vy0"),
                "vz0": kine.get("vz0"),
                "ax": kine.get("ax"),
                "ay": kine.get("ay"),
                "az": kine.get("az"),
                "arm_angle": kine.get("arm_angle"),
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
