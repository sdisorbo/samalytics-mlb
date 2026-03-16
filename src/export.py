"""
export.py — JSON export layer

Writes all output files to /data/output/ for consumption by the Next.js website.
"""

import json
import os
from datetime import datetime, timezone

# Resolve output directory relative to this file's location (src/)
_SRC_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.normpath(os.path.join(_SRC_DIR, "..", "data", "output"))


def _ensure_output_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def _write(filename, data):
    _ensure_output_dir()
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  [ok] {filename}  ({os.path.getsize(path):,} bytes)")
    return path


# ── Individual exporters ───────────────────────────────────────────────────────

def export_standings(standings_list):
    """
    Export standings.json

    Expected schema per item:
    {
      team, team_abbr, division, elo_rating, elo_change_7d,
      wins, losses, run_diff, playoff_probability,
      win_ds, win_cs, win_ws
    }
    """
    _write("standings.json", standings_list)


def export_ratings_history(history_dict):
    """
    Export team_ratings_history.json

    Schema: { "ATL": [{"date": "2024-04-01", "rating": 1510}, ...], ... }
    """
    _write("team_ratings_history.json", history_dict)


def export_pitchers(pitchers_list):
    """
    Export pitchers.json

    Schema per item:
    { name, team, division, era, fip, xfip, k_per_9, bb_per_9,
      whip, innings_pitched, fip_percentile, ... }
    """
    _write("pitchers.json", pitchers_list)


def export_players(players_list):
    """
    Export players.json

    Schema per item:
    { name, team, position, avg, obp, slg, ops, k_pct, bb_pct,
      avg_exit_velocity, hard_hit_pct, xba, xslg, barrel_pct,
      whiff_pct, chase_rate, <stat>_percentile, ... }
    """
    _write("players.json", players_list)


def export_pitcher_arsenal(arsenal_list):
    """Export pitcher_arsenal.json (Statcast pitch arsenal per pitcher)."""
    _write("pitcher_arsenal.json", arsenal_list)


def export_batter_vs_pitch(batter_list):
    """Export batter_vs_pitch.json (Statcast batter performance vs each pitch type)."""
    _write("batter_vs_pitch.json", batter_list)


def export_playoff_odds(sim_results, n_sims):
    """
    Export playoff_odds.json

    sim_results: dict abbr -> {win_wildcard, win_ds, win_cs, win_ws}
    """
    results_list = [
        {"team": team, **odds}
        for team, odds in sorted(
            sim_results.items(),
            key=lambda x: x[1].get("win_ws", 0.0),
            reverse=True,
        )
    ]

    payload = {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "simulations": n_sims,
        "results": results_list,
    }
    _write("playoff_odds.json", payload)
