"""
players.py — Batter stat processor

Pulls season hitting stats for all players and filters to those with at least
PA_PER_GAME * games_played plate appearances (default 2.5 PA/game).

TODO: integrate Baseball Savant CSV export for full Statcast metrics
      (avg_exit_velocity, hard_hit_pct, xba, xslg, barrel_pct, whiff_pct, chase_rate)
"""

from fetch_data import fetch_batter_stats, fetch_teams, fetch_standings

PA_PER_GAME = 2.5  # minimum plate appearances per team game played


def _safe_float(value, default=None):
    try:
        if value in (None, "", "-.--", "-.---", ".---"):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _percentile(values, target, higher_is_better=True):
    if not values:
        return 50
    n_below = sum(1 for v in values if v < target)
    raw = round(n_below / len(values) * 100)
    return raw if higher_is_better else 100 - raw


def process_players(season):
    """
    Fetch and process batter stats for `season`.
    Includes players with PA >= PA_PER_GAME * max_team_games_played.
    Returns a list of player dicts enriched with percentile ranks.

    Note: Statcast fields are None until Baseball Savant integration is added.
    TODO: integrate Baseball Savant CSV export for full Statcast metrics
    """
    teams = fetch_teams(season)
    splits = fetch_batter_stats(season)

    # Derive games played threshold from current standings
    standings = fetch_standings(season)
    max_games = 1
    for record in standings:
        for team_rec in record.get("teamRecords", []):
            games = team_rec.get("wins", 0) + team_rec.get("losses", 0)
            if games > max_games:
                max_games = games
    min_pa = int(PA_PER_GAME * max_games)

    players = []

    for split in splits:
        stat = split.get("stat", {})
        player = split.get("player", {})
        team = split.get("team", {})
        position = split.get("position", {})

        team_id = team.get("id")
        team_info = teams.get(team_id, {})
        abbr = team_info.get("abbreviation") or team.get("abbreviation", "")

        pa = int(stat.get("plateAppearances", 0) or 0)
        if pa < min_pa:
            continue

        ab = int(stat.get("atBats", 0) or 0)
        k = int(stat.get("strikeOuts", 0) or 0)
        bb = int(stat.get("baseOnBalls", 0) or 0)

        avg = _safe_float(stat.get("avg"))
        obp = _safe_float(stat.get("obp"))
        slg = _safe_float(stat.get("slg"))
        ops = _safe_float(stat.get("ops"))

        k_pct = round(k / pa * 100, 1) if pa > 0 else None
        bb_pct = round(bb / pa * 100, 1) if pa > 0 else None

        players.append(
            {
                "player_id": player.get("id"),
                "name": player.get("fullName", ""),
                "team": abbr,
                "team_name": team_info.get("name") or team.get("name", ""),
                "division": team_info.get("division", ""),
                "position": position.get("abbreviation", ""),
                "avg": avg,
                "obp": obp,
                "slg": slg,
                "ops": ops,
                "k_pct": k_pct,
                "bb_pct": bb_pct,
                # Statcast fields — not available from MLB Stats API
                # TODO: integrate Baseball Savant CSV export for full Statcast metrics
                "avg_exit_velocity": None,
                "hard_hit_pct": None,
                "xba": None,
                "xslg": None,
                "barrel_pct": None,
                "whiff_pct": None,
                "chase_rate": None,
            }
        )

    # ── Compute percentile ranks for available stats ──────────────────────────
    avg_vals = [p["avg"] for p in players if p["avg"] is not None]
    obp_vals = [p["obp"] for p in players if p["obp"] is not None]
    slg_vals = [p["slg"] for p in players if p["slg"] is not None]
    ops_vals = [p["ops"] for p in players if p["ops"] is not None]
    k_vals = [p["k_pct"] for p in players if p["k_pct"] is not None]
    bb_vals = [p["bb_pct"] for p in players if p["bb_pct"] is not None]

    for p in players:
        p["avg_percentile"] = _percentile(avg_vals, p["avg"], True) if p["avg"] is not None else 50
        p["obp_percentile"] = _percentile(obp_vals, p["obp"], True) if p["obp"] is not None else 50
        p["slg_percentile"] = _percentile(slg_vals, p["slg"], True) if p["slg"] is not None else 50
        p["ops_percentile"] = _percentile(ops_vals, p["ops"], True) if p["ops"] is not None else 50
        p["k_pct_percentile"] = _percentile(k_vals, p["k_pct"], False) if p["k_pct"] is not None else 50
        p["bb_pct_percentile"] = _percentile(bb_vals, p["bb_pct"], True) if p["bb_pct"] is not None else 50

    players.sort(key=lambda p: (p["ops"] if p["ops"] is not None else 0.0), reverse=True)
    return players
