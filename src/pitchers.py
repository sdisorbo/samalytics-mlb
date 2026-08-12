"""
pitchers.py — Starting pitcher stats processor

Pulls season pitching stats from the MLB Stats API and computes:
  - FIP = (13*HR + 3*BB - 2*K) / IP + 3.10
  - xFIP note: not available from MLB Stats API
  - Per-9-inning rates
  - League percentile ranks for each stat

TODO: integrate Baseball Savant CSV export for full Statcast metrics
      (xFIP, xERA, barrel%, whiff%, chase rate, avg exit velocity)
"""

from fetch_data import fetch_pitcher_stats, fetch_teams

MIN_IP = 20.0
FIP_CONSTANT = 3.10


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_innings(ip_value):
    """Convert '120.1' (120 IP + 1 out) to 120.333 decimal innings."""
    try:
        s = str(ip_value)
        if "." in s:
            full, outs = s.split(".", 1)
            return int(full) + int(outs) / 3.0
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def _safe_float(value, default=None):
    try:
        if value in (None, "", "-.--", "-.---"):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _calculate_fip(hr, bb, k, ip):
    """Return FIP or None if IP is zero."""
    if ip <= 0:
        return None
    return round((13 * hr + 3 * bb - 2 * k) / ip + FIP_CONSTANT, 2)


def _percentile(values, target, higher_is_better=True):
    """
    Compute percentile rank of `target` within `values` (0–100).
    higher_is_better=True  → high target = high percentile (e.g. K/9)
    higher_is_better=False → low target = high percentile (e.g. ERA)
    """
    if not values:
        return 50
    n_below = sum(1 for v in values if v < target)
    raw = round(n_below / len(values) * 100)
    return raw if higher_is_better else 100 - raw


# ── Main processor ─────────────────────────────────────────────────────────────

def process_pitchers(season):
    """
    Fetch and process pitcher stats for `season`.
    Returns a list of pitcher dicts, each enriched with percentile ranks.
    """
    teams = fetch_teams(season)
    splits = fetch_pitcher_stats(season)

    pitchers = []

    for split in splits:
        stat = split.get("stat", {})
        player = split.get("player", {})
        team = split.get("team", {})

        ip = _parse_innings(stat.get("inningsPitched", 0))
        if ip < MIN_IP:
            continue

        team_id = team.get("id")
        team_info = teams.get(team_id, {})
        abbr = team_info.get("abbreviation") or team.get("abbreviation", "")

        hr = int(stat.get("homeRunsAllowed", stat.get("homeRuns", 0)) or 0)
        bb = int(stat.get("baseOnBalls", 0) or 0)
        k = int(stat.get("strikeOuts", 0) or 0)

        era = _safe_float(stat.get("era"))
        whip = _safe_float(stat.get("whip"))
        fip = _calculate_fip(hr, bb, k, ip)

        k9 = round((k / ip) * 9, 2) if ip > 0 else 0.0
        bb9 = round((bb / ip) * 9, 2) if ip > 0 else 0.0

        pitchers.append(
            {
                "player_id": player.get("id"),
                "name": player.get("fullName", ""),
                "team": abbr,
                "team_name": team_info.get("name") or team.get("name", ""),
                "division": team_info.get("division", ""),
                "era": era,
                "fip": fip,
                # xFIP requires Statcast data not available via MLB Stats API
                # TODO: integrate Baseball Savant CSV export for full Statcast metrics
                "xfip": None,
                "k_per_9": k9,
                "bb_per_9": bb9,
                "whip": whip,
                "innings_pitched": round(ip, 1),
                "strikeouts": k,
                "walks": bb,
                "home_runs_allowed": hr,
            }
        )

    # ── Compute league percentile ranks ───────────────────────────────────────
    era_vals = [p["era"] for p in pitchers if p["era"] is not None]
    fip_vals = [p["fip"] for p in pitchers if p["fip"] is not None]
    k9_vals = [p["k_per_9"] for p in pitchers]
    bb9_vals = [p["bb_per_9"] for p in pitchers]
    whip_vals = [p["whip"] for p in pitchers if p["whip"] is not None]

    for p in pitchers:
        p["era_percentile"] = _percentile(era_vals, p["era"], higher_is_better=False) if p["era"] is not None else 50
        p["fip_percentile"] = _percentile(fip_vals, p["fip"], higher_is_better=False) if p["fip"] is not None else 50
        p["k9_percentile"] = _percentile(k9_vals, p["k_per_9"], higher_is_better=True)
        p["bb9_percentile"] = _percentile(bb9_vals, p["bb_per_9"], higher_is_better=False)
        p["whip_percentile"] = _percentile(whip_vals, p["whip"], higher_is_better=False) if p["whip"] is not None else 50

    # Sort by FIP ascending (best pitchers first)
    pitchers.sort(key=lambda p: (p["fip"] if p["fip"] is not None else 99.0))
    return pitchers
