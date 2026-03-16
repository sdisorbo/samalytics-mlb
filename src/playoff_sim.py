"""
playoff_sim.py — MLB playoff bracket simulator

Runs N independent playoff simulations per day.
Each simulation:
  1. Probabilistically draws the 12-team playoff field via bubble_weights
  2. Seeds the bracket per MLB rules
  3. Simulates each series game-by-game using ELO win probabilities
  4. Records how far each team advances

Series formats:
  Wild Card Round : best-of-3  (higher seed hosts all games)
  Division Series : best-of-5  (2-3 format — home team plays games 1,2,5)
  Championship Series : best-of-7  (2-3-2 — home team plays 1,2,6,7)
  World Series : best-of-7  (2-3-2)
"""

import random
from collections import defaultdict

from elo_model import win_probability
from bubble_weights import draw_playoff_field


# ── Series simulation ──────────────────────────────────────────────────────────

# Games hosted by the higher seed (seed A) in each series format
_HOME_GAMES = {
    3: {1, 2, 3},           # Wild Card: higher seed hosts all
    5: {1, 2, 5},           # DS: 2-3 format
    7: {1, 2, 6, 7},        # CS / WS: 2-3-2 format
}


def simulate_series(team_a, team_b, ratings, series_length, team_a_is_home_seed=True):
    """
    Simulate a single playoff series.

    team_a: abbreviation of team with home-field advantage (if team_a_is_home_seed)
    team_b: abbreviation of the other team
    ratings: dict abbr -> ELO float
    series_length: 3, 5, or 7
    team_a_is_home_seed: True if team_a has home field for applicable games

    Returns the winning team's abbreviation.
    """
    wins_needed = (series_length // 2) + 1
    wins_a = wins_b = 0
    game_num = 0
    home_game_set = _HOME_GAMES[series_length]

    while wins_a < wins_needed and wins_b < wins_needed:
        game_num += 1
        # Determine who is at home for this game
        a_is_home = (game_num in home_game_set) == team_a_is_home_seed

        p_a = win_probability(
            ratings.get(team_a, 1500.0),
            ratings.get(team_b, 1500.0),
            home="a" if a_is_home else "b",
        )

        if random.random() < p_a:
            wins_a += 1
        else:
            wins_b += 1

    return team_a if wins_a >= wins_needed else team_b


# ── Bracket seeding ────────────────────────────────────────────────────────────

def seed_bracket(league_field, league_records):
    """
    Assign seeds 1–6 to the 6 teams in one league's playoff field.

    league_field: [div_winner_1, div_winner_2, div_winner_3, wc1, wc2, wc3]
    league_records: dict abbr -> (wins, losses)

    MLB seeding rules:
      Seeds 1–3: Division winners, ordered by best W-L record
      Seeds 4–6: Wild card teams, ordered by best W-L record

    Returns list of 6 abbreviations in seed order [1st, 2nd, …, 6th].
    """
    def win_pct(abbr):
        w, l = league_records.get(abbr, (0, 0))
        total = w + l
        return w / total if total > 0 else 0.0

    div_winners = sorted(league_field[:3], key=win_pct, reverse=True)
    wild_cards = sorted(league_field[3:], key=win_pct, reverse=True)
    return div_winners + wild_cards


# ── League bracket ─────────────────────────────────────────────────────────────

def simulate_league_bracket(seeds, ratings):
    """
    Simulate one league's full bracket (Wild Card → DS → CS).

    seeds: [s1, s2, s3, s4, s5, s6]  (seed 1 = best record div winner)

    Wild Card matchups (higher seed hosts all games):
      s3 vs s6  →  wc_winner_a
      s4 vs s5  →  wc_winner_b

    DS matchups:
      s1 vs lower-seeded WC winner  (s1 hosts)
      s2 vs higher-seeded WC winner  (s2 hosts)

    CS: DS winners, higher seed hosts.

    Returns:
      results: dict abbr -> {made_wc, won_wc, won_ds, won_cs}
      pennant_winner: abbr
    """
    all_teams = set(seeds)
    results = {
        s: {"made_wc": False, "won_wc": False, "won_ds": False, "won_cs": False}
        for s in seeds
    }

    s1, s2, s3, s4, s5, s6 = seeds

    # Wild Card round — WC teams are seeds 3-6
    for t in (s3, s4, s5, s6):
        results[t]["made_wc"] = True

    wca = simulate_series(s3, s6, ratings, 3, team_a_is_home_seed=True)
    wcb = simulate_series(s4, s5, ratings, 3, team_a_is_home_seed=True)
    results[wca]["won_wc"] = True
    results[wcb]["won_wc"] = True

    # Sort WC winners by original seed index (lower index = higher seed)
    wc_winners = sorted([wca, wcb], key=lambda t: seeds.index(t))
    # wc_winners[0] = higher-seeded WC winner, [1] = lower-seeded WC winner

    # Division Series
    # s1 hosts the lower-seeded WC winner; s2 hosts the higher-seeded WC winner
    ds1_winner = simulate_series(s1, wc_winners[1], ratings, 5, team_a_is_home_seed=True)
    ds2_winner = simulate_series(s2, wc_winners[0], ratings, 5, team_a_is_home_seed=True)
    results[ds1_winner]["won_ds"] = True
    results[ds2_winner]["won_ds"] = True

    # Championship Series — higher original seed hosts
    cs_teams = sorted([ds1_winner, ds2_winner], key=lambda t: seeds.index(t))
    cs_winner = simulate_series(cs_teams[0], cs_teams[1], ratings, 7, team_a_is_home_seed=True)
    results[cs_winner]["won_cs"] = True

    return results, cs_winner


# ── Full playoff simulation ────────────────────────────────────────────────────

def simulate_playoffs(playoff_field, ratings, standings_by_league):
    """
    Simulate the complete MLB postseason for one draw of the playoff field.

    playoff_field: 12-element list [AL×6, NL×6] from draw_playoff_field
    ratings: dict abbr -> ELO float
    standings_by_league: dict league_name -> {abbr -> (wins, losses)}

    Returns dict: abbr -> result flags (made_wc/won_wc/won_ds/won_cs/win_ws)
    """
    al_field = playoff_field[:6]
    nl_field = playoff_field[6:]

    def league_records(league_name_fragment):
        for name, records in standings_by_league.items():
            if league_name_fragment in name:
                return records
        return {}

    al_records = league_records("American")
    nl_records = league_records("National")

    al_seeds = seed_bracket(al_field, al_records)
    nl_seeds = seed_bracket(nl_field, nl_records)

    all_results = {}
    al_results, al_pennant = simulate_league_bracket(al_seeds, ratings)
    nl_results, nl_pennant = simulate_league_bracket(nl_seeds, ratings)
    all_results.update(al_results)
    all_results.update(nl_results)

    # World Series — home field to the team with more regular-season wins
    al_wins = al_records.get(al_pennant, (0, 0))[0]
    nl_wins = nl_records.get(nl_pennant, (0, 0))[0]
    al_is_home = al_wins >= nl_wins

    ws_winner = simulate_series(
        al_pennant, nl_pennant, ratings, 7, team_a_is_home_seed=al_is_home
    )
    all_results[ws_winner]["win_ws"] = True

    return all_results


# ── Aggregated simulation runner ───────────────────────────────────────────────

def run_simulations(n_sims, standings_records, ratings):
    """
    Run `n_sims` independent playoff simulations.

    Returns dict: abbr -> {win_wildcard, win_ds, win_cs, win_ws}
    Values are fractions out of n_sims (e.g. 0.3 = "3 of 10 sims").
    """
    # Build standings lookup
    standings_by_league = {}
    for record in standings_records:
        league_name = record.get("league", {}).get("name", "")
        standings_by_league.setdefault(league_name, {})
        for team_rec in record.get("teamRecords", []):
            abbr = team_rec["team"]["abbreviation"]
            wins = team_rec.get("wins", 0)
            losses = team_rec.get("losses", 0)
            standings_by_league[league_name][abbr] = (wins, losses)

    # Draw all playoff fields at once
    playoff_fields = draw_playoff_field(standings_records, n_simulations=n_sims)

    totals = defaultdict(lambda: {"in_playoffs": 0, "win_wildcard": 0, "win_ds": 0, "win_cs": 0, "win_ws": 0})

    for sim_idx, field in enumerate(playoff_fields):
        try:
            results = simulate_playoffs(field, ratings, standings_by_league)
            for team, res in results.items():
                totals[team]["in_playoffs"] += 1
                if res.get("won_wc"):
                    totals[team]["win_wildcard"] += 1
                if res.get("won_ds"):
                    totals[team]["win_ds"] += 1
                if res.get("won_cs"):
                    totals[team]["win_cs"] += 1
                if res.get("win_ws"):
                    totals[team]["win_ws"] += 1
        except Exception as e:
            print(f"  Warning: simulation {sim_idx + 1} failed — {e}")
            continue

    return {
        team: {
            "win_wildcard": round(counts["win_wildcard"] / n_sims, 2),
            "win_ds": round(counts["win_ds"] / n_sims, 2),
            "win_cs": round(counts["win_cs"] / n_sims, 2),
            "win_ws": round(counts["win_ws"] / n_sims, 2),
        }
        for team, counts in totals.items()
    }
