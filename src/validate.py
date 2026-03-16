"""
validate.py — PoC validation against the completed 2024 MLB season

Runs the prediction pipeline against 2024 data and compares the model's
playoff odds against actual results (Dodgers won the 2024 World Series).

Usage:
    python src/validate.py

This script is intentionally separate from main.py so it can be run
independently without overwriting live output files.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetch_data import fetch_teams, fetch_standings, fetch_schedule
from elo_model import build_ratings, INITIAL_RATING
from playoff_sim import run_simulations

VALIDATION_SEASON = 2024
N_SIMS = 100  # more sims for stable validation percentages

# ── Actual 2024 playoff results ────────────────────────────────────────────────
ACTUAL_2024_PLAYOFF = {
    "AL": {
        "division_winners": ["BAL", "CLE", "HOU"],
        "wild_cards":       ["NYY", "KC",  "DET"],
    },
    "NL": {
        "division_winners": ["LAD", "MIL", "PHI"],
        "wild_cards":       ["SD",  "ATL", "NYM"],
    },
}

ACTUAL_WS_WINNER    = "LAD"
ACTUAL_ALCS_WINNER  = "NYY"
ACTUAL_NLCS_WINNER  = "LAD"
ACTUAL_ALDS_WINNERS = {"NYY", "CLE"}  # beat KC and HOU respectively
ACTUAL_NLDS_WINNERS = {"LAD", "NYM"}  # beat SD and MIL


def _hr(width=55):
    print("─" * width)


def main():
    print()
    print("=" * 55)
    print("  2024 MLB ELO Model Validation")
    print("=" * 55)
    print()

    # ── Fetch data ─────────────────────────────────────────
    print("Fetching teams...")
    teams = fetch_teams(VALIDATION_SEASON)
    id_to_abbr = {tid: info["abbreviation"] for tid, info in teams.items()}

    print("Fetching final standings...")
    standings_records = fetch_standings(VALIDATION_SEASON)

    print("Fetching game results (may take ~60 s)...")
    games = fetch_schedule(VALIDATION_SEASON)
    games_abbr = [
        {**g, "home_id": id_to_abbr[g["home_id"]], "away_id": id_to_abbr[g["away_id"]]}
        for g in games
        if g["home_id"] in id_to_abbr and g["away_id"] in id_to_abbr
    ]
    print(f"  {len(games_abbr)} regular-season games processed.\n")

    # ── Build ELO ratings ──────────────────────────────────
    team_abbrs = set(id_to_abbr.values())
    ratings, _ = build_ratings(games_abbr, team_abbrs)

    # ── Top 10 ELO ratings ─────────────────────────────────
    _hr()
    print("  Top 10 ELO Ratings — End of 2024 Regular Season")
    _hr()
    top10 = sorted(ratings.items(), key=lambda x: x[1], reverse=True)[:10]
    for rank, (abbr, rating) in enumerate(top10, 1):
        flag = " ◄ WS winner" if abbr == ACTUAL_WS_WINNER else ""
        print(f"  {rank:2}.  {abbr:<5}  {rating:7.1f}{flag}")

    # ── ELO ratings for actual playoff teams ──────────────
    print()
    _hr()
    print("  Actual 2024 Playoff Teams — ELO Ratings")
    _hr()
    all_playoff = (
        ACTUAL_2024_PLAYOFF["AL"]["division_winners"]
        + ACTUAL_2024_PLAYOFF["AL"]["wild_cards"]
        + ACTUAL_2024_PLAYOFF["NL"]["division_winners"]
        + ACTUAL_2024_PLAYOFF["NL"]["wild_cards"]
    )
    playoff_ratings = sorted(
        [(t, ratings.get(t, INITIAL_RATING)) for t in all_playoff],
        key=lambda x: x[1],
        reverse=True,
    )
    print(f"  {'Team':<5}  {'ELO':>7}  League  Seeding")
    _hr()
    for abbr, rating in playoff_ratings:
        lg = "AL" if abbr in ACTUAL_2024_PLAYOFF["AL"]["division_winners"] + ACTUAL_2024_PLAYOFF["AL"]["wild_cards"] else "NL"
        if abbr in ACTUAL_2024_PLAYOFF[lg]["division_winners"]:
            seed_type = "Div Winner"
        else:
            seed_type = "Wild Card "
        flag = "  ◄ WS Winner" if abbr == ACTUAL_WS_WINNER else ""
        print(f"  {abbr:<5}  {rating:7.1f}  {lg}    {seed_type}{flag}")

    # ── Run simulations ────────────────────────────────────
    print()
    print(f"Running {N_SIMS} playoff simulations using 2024 standings & ELO ratings...")
    sim_results = run_simulations(N_SIMS, standings_records, ratings)
    print()

    # ── World Series odds table ────────────────────────────
    _hr()
    print("  World Series Odds (Model) vs Actual Results")
    _hr()
    print(f"  {'Team':<5}  {'WS%':>6}  {'CS%':>6}  {'DS%':>6}  {'WC%':>6}")
    _hr()
    playoff_sims = [
        (t, sim_results.get(t, {})) for t in all_playoff
    ]
    playoff_sims.sort(key=lambda x: x[1].get("win_ws", 0.0), reverse=True)

    for abbr, sim in playoff_sims:
        ws  = sim.get("win_ws", 0.0)
        cs  = sim.get("win_cs", 0.0)
        ds  = sim.get("win_ds", 0.0)
        wc  = sim.get("win_wildcard", 0.0)
        flag = "  ◄ Actual WS winner" if abbr == ACTUAL_WS_WINNER else ""
        print(f"  {abbr:<5}  {ws:5.0%}   {cs:5.0%}   {ds:5.0%}   {wc:5.0%}{flag}")

    # ── Summary ────────────────────────────────────────────
    print()
    _hr()
    print("  Summary")
    _hr()

    ws_favorite = max(playoff_sims, key=lambda x: x[1].get("win_ws", 0.0))
    favorite_abbr = ws_favorite[0]
    print(f"  Model's WS favourite : {favorite_abbr} ({ws_favorite[1].get('win_ws', 0):.0%})")
    print(f"  Actual WS winner     : {ACTUAL_WS_WINNER}")
    print()

    actual_ws_odds = sim_results.get(ACTUAL_WS_WINNER, {}).get("win_ws", 0.0)
    top3 = [t for t, _ in sorted(playoff_sims, key=lambda x: x[1].get("win_ws", 0.0), reverse=True)[:3]]

    if favorite_abbr == ACTUAL_WS_WINNER:
        print("  ✓ Model correctly identified the WS winner as its favourite.")
    elif ACTUAL_WS_WINNER in top3:
        rank = top3.index(ACTUAL_WS_WINNER) + 1
        print(f"  ✓ Model had {ACTUAL_WS_WINNER} as #{rank} WS favourite ({actual_ws_odds:.0%}).")
    else:
        print(f"  ~ Model gave {ACTUAL_WS_WINNER} only {actual_ws_odds:.0%} WS odds.")
        print(f"    Favourite was {favorite_abbr} which was eliminated in the playoffs.")

    # DS/CS accuracy spot-check
    ds_correct = sum(
        1 for t in ACTUAL_ALDS_WINNERS | ACTUAL_NLDS_WINNERS
        if sim_results.get(t, {}).get("win_ds", 0) > 0.25
    )
    print(f"\n  DS winner predictions (>25% win_ds): {ds_correct} / {len(ACTUAL_ALDS_WINNERS | ACTUAL_NLDS_WINNERS)} correct")

    print()
    print("  Validation complete.")
    print()


if __name__ == "__main__":
    main()
