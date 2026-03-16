"""
main.py — MLB Prediction Engine orchestrator

Change SEASON below to switch between historical validation and live predictions.
Everything else in the codebase reads from this single variable.
"""

import sys
import os
from datetime import date

# ── Season config ──────────────────────────────────────────
SEASON = 2025   # Change to 2026 when next season begins
# ───────────────────────────────────────────────────────────

N_PLAYOFF_SIMS = 10

# Allow running directly from /src or from the project root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetch_data import fetch_teams, fetch_standings, fetch_schedule
from elo_model import build_ratings, regress_to_mean, get_7day_elo_change, INITIAL_RATING
from playoff_sim import run_simulations
from bubble_weights import calculate_playoff_probabilities
from pitchers import process_pitchers
from players import process_players
import export

# Months with no MLB regular-season games
_OFFSEASON_MONTHS = {11, 12, 1, 2}


def _is_offseason():
    return date.today().month in _OFFSEASON_MONTHS


def _remap_games(games, id_to_abbr):
    """Replace integer team IDs in game dicts with abbreviation strings."""
    remapped = []
    for g in games:
        home = id_to_abbr.get(g["home_id"])
        away = id_to_abbr.get(g["away_id"])
        if home and away:
            remapped.append({**g, "home_id": home, "away_id": away})
    return remapped


def _build_standings_output(standings_records, teams, ratings, history, sim_results, playoff_probs):
    """Merge all computed data into the standings.json schema."""
    today = date.today().isoformat()
    rows = []

    for record in standings_records:
        division_name = record.get("division", {}).get("name", "")
        for team_rec in record.get("teamRecords", []):
            team_id = team_rec["team"]["id"]
            abbr = team_rec["team"].get("abbreviation", "")
            team_info = teams.get(team_id, {})

            elo = round(ratings.get(abbr, INITIAL_RATING), 1)
            elo_7d = get_7day_elo_change(history, abbr, today)
            sim = sim_results.get(abbr, {})

            rows.append(
                {
                    "team": team_info.get("teamName") or team_rec["team"].get("name", ""),
                    "team_abbr": abbr,
                    "division": team_info.get("division") or division_name,
                    "elo_rating": elo,
                    "elo_change_7d": elo_7d,
                    "wins": team_rec.get("wins", 0),
                    "losses": team_rec.get("losses", 0),
                    "run_diff": team_rec.get("runDifferential", 0),
                    "playoff_probability": round(playoff_probs.get(abbr, 0.0), 3),
                    "win_ds": sim.get("win_ds", 0.0),
                    "win_cs": sim.get("win_cs", 0.0),
                    "win_ws": sim.get("win_ws", 0.0),
                }
            )

    return sorted(rows, key=lambda r: r["wins"] - r["losses"], reverse=True)


def main():
    print(f"=== MLB Prediction Engine  |  Season {SEASON} ===\n")

    # Guard against running mid-offseason for the current year
    if _is_offseason() and SEASON == date.today().year:
        print(
            "Currently in the MLB offseason (Nov–Feb).\n"
            "Set SEASON to a completed year for historical analysis,\n"
            "or wait until Spring Training to run live predictions."
        )
        sys.exit(0)

    # ── 1. Teams ──────────────────────────────────────────────────────────────
    print(f"[1/7] Fetching team info for {SEASON}...")
    teams = fetch_teams(SEASON)
    id_to_abbr = {tid: info["abbreviation"] for tid, info in teams.items()}
    print(f"      {len(teams)} teams loaded.")

    # ── 2. Standings ──────────────────────────────────────────────────────────
    print(f"\n[2/7] Fetching standings...")
    standings_records = fetch_standings(SEASON)
    print(f"      {len(standings_records)} division records.")

    # ── 3. ELO ratings ────────────────────────────────────────────────────────
    print(f"\n[3/7] Fetching schedule and building ELO ratings (this may take ~60 s)...")
    games = fetch_schedule(SEASON)
    games_abbr = _remap_games(games, id_to_abbr)
    print(f"      {len(games_abbr)} completed games loaded.")

    team_abbrs = set(id_to_abbr.values())
    ratings, history = build_ratings(games_abbr, team_abbrs)
    print(f"      ELO ratings built for {len(ratings)} teams.")

    # ── 4. Playoff probabilities ──────────────────────────────────────────────
    print(f"\n[4/7] Computing playoff field probabilities...")
    playoff_probs = calculate_playoff_probabilities(standings_records)

    # ── 5. Playoff simulations ────────────────────────────────────────────────
    print(f"\n[5/7] Running {N_PLAYOFF_SIMS} playoff bracket simulations...")
    sim_results = run_simulations(N_PLAYOFF_SIMS, standings_records, ratings)
    print(f"      Done.")

    # ── 6. Pitchers ───────────────────────────────────────────────────────────
    print(f"\n[6/7] Processing pitcher stats (min {20} IP)...")
    pitchers = process_pitchers(SEASON)
    print(f"      {len(pitchers)} qualifying pitchers processed.")

    # ── 7. Batters ────────────────────────────────────────────────────────────
    print(f"\n[7/7] Processing qualified batter stats...")
    players = process_players(SEASON)
    print(f"      {len(players)} qualified batters processed.")

    # ── Export ────────────────────────────────────────────────────────────────
    print(f"\n[Export] Writing output JSON files to {export.OUTPUT_DIR} ...")
    standings_output = _build_standings_output(
        standings_records, teams, ratings, history, sim_results, playoff_probs
    )
    export.export_standings(standings_output)
    export.export_ratings_history(history)
    export.export_pitchers(pitchers)
    export.export_players(players)
    export.export_playoff_odds(sim_results, N_PLAYOFF_SIMS)

    print(f"\n=== Pipeline complete! ===")
    print(f"    Output -> {os.path.abspath(export.OUTPUT_DIR)}")


if __name__ == "__main__":
    main()
