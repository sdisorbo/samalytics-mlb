"""
playoff_sim.py — MLB playoff bracket simulator

Runs N independent full-season simulations:
  1. Simulate all remaining regular-season games via ELO win probabilities
  2. Determine the 12-team playoff field deterministically from simulated standings
  3. Seed the bracket per MLB rules (3 div winners + 3 wild cards per league)
  4. Simulate each series game-by-game using ELO win probabilities

Series formats:
  Wild Card Round : best-of-3  (higher seed hosts all games)
  Division Series : best-of-5  (2-3 format — home team plays games 1,2,5)
  Championship Series : best-of-7  (2-3-2 — home team plays 1,2,6,7)
  World Series : best-of-7  (2-3-2)
"""

import random
from collections import defaultdict

from elo_model import win_probability


# ── Series simulation ──────────────────────────────────────────────────────────

_HOME_GAMES = {
    3: {1, 2, 3},
    5: {1, 2, 5},
    7: {1, 2, 6, 7},
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
    results = {
        s: {"made_wc": False, "won_wc": False, "won_ds": False, "won_cs": False}
        for s in seeds
    }

    s1, s2, s3, s4, s5, s6 = seeds

    for t in (s3, s4, s5, s6):
        results[t]["made_wc"] = True

    wca = simulate_series(s3, s6, ratings, 3, team_a_is_home_seed=True)
    wcb = simulate_series(s4, s5, ratings, 3, team_a_is_home_seed=True)
    results[wca]["won_wc"] = True
    results[wcb]["won_wc"] = True

    wc_winners = sorted([wca, wcb], key=lambda t: seeds.index(t))

    ds1_winner = simulate_series(s1, wc_winners[1], ratings, 5, team_a_is_home_seed=True)
    ds2_winner = simulate_series(s2, wc_winners[0], ratings, 5, team_a_is_home_seed=True)
    results[ds1_winner]["won_ds"] = True
    results[ds2_winner]["won_ds"] = True

    cs_teams = sorted([ds1_winner, ds2_winner], key=lambda t: seeds.index(t))
    cs_winner = simulate_series(cs_teams[0], cs_teams[1], ratings, 7, team_a_is_home_seed=True)
    results[cs_winner]["won_cs"] = True

    return results, cs_winner


# ── Full playoff simulation ────────────────────────────────────────────────────

def simulate_playoffs(playoff_field, ratings, standings_by_league):
    """
    Simulate the complete MLB postseason for one draw of the playoff field.

    playoff_field: 12-element list [AL×6, NL×6]
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

    al_wins = al_records.get(al_pennant, (0, 0))[0]
    nl_wins = nl_records.get(nl_pennant, (0, 0))[0]
    al_is_home = al_wins >= nl_wins

    ws_winner = simulate_series(
        al_pennant, nl_pennant, ratings, 7, team_a_is_home_seed=al_is_home
    )
    all_results[ws_winner]["win_ws"] = True

    return all_results


# ── Deterministic playoff field from simulated standings ───────────────────────

def _win_pct(wins, losses):
    total = wins + losses
    return wins / total if total > 0 else 0.0


def determine_playoff_field(sim_records, league_divisions):
    """
    Determine the 12-team playoff field from simulated final standings.

    sim_records: dict abbr -> (wins, losses)
    league_divisions: dict league_name -> dict division_name -> [abbr, ...]

    Returns list of 12 abbrs [AL×6, NL×6]:
        [AL_div1, AL_div2, AL_div3, AL_wc1, AL_wc2, AL_wc3,
         NL_div1, NL_div2, NL_div3, NL_wc1, NL_wc2, NL_wc3]
    """
    def league_sort_key(name):
        if "American" in name:
            return 0
        if "National" in name:
            return 1
        return 2

    def sort_key(abbr):
        w, l = sim_records.get(abbr, (0, 1))
        return (_win_pct(w, l), w)

    field = []
    for league_name in sorted(league_divisions.keys(), key=league_sort_key):
        divisions = league_divisions[league_name]
        div_winners = []
        non_div_winners = []

        for div_name in sorted(divisions.keys()):
            teams = divisions[div_name]
            if not teams:
                continue
            winner = max(teams, key=sort_key)
            div_winners.append(winner)
            for t in teams:
                if t != winner:
                    non_div_winners.append(t)

        wc_teams = sorted(non_div_winners, key=sort_key, reverse=True)[:3]
        field.extend(div_winners + wc_teams)

    return field


# ── Aggregated simulation runner ───────────────────────────────────────────────

def run_simulations(n_sims, standings_records, ratings, remaining_games=None):
    """
    Run n_sims full simulations: remaining regular season → playoff field → bracket.

    remaining_games: list of {home_id: abbr, away_id: abbr} (already remapped to abbrs).
                     If None or empty, uses current standings as final standings.

    Returns dict: abbr -> {playoff_probability, win_wildcard, win_ds, win_cs, win_ws}
    playoff_probability is the fraction of sims the team made the playoffs.
    """
    current_records = {}
    standings_by_league = {}
    league_divisions = {}

    for record in standings_records:
        league_name = record.get("league", {}).get("name", "")
        division_name = record.get("division", {}).get("name", "")
        standings_by_league.setdefault(league_name, {})
        league_divisions.setdefault(league_name, {}).setdefault(division_name, [])

        for team_rec in record.get("teamRecords", []):
            abbr = team_rec["team"]["abbreviation"]
            wins = team_rec.get("wins", 0)
            losses = team_rec.get("losses", 0)
            current_records[abbr] = [wins, losses]
            standings_by_league[league_name][abbr] = (wins, losses)
            league_divisions[league_name][division_name].append(abbr)

    # Pre-compute ELO win probabilities for each remaining game
    game_probs = []
    for game in (remaining_games or []):
        home = game["home_id"]
        away = game["away_id"]
        if home not in ratings or away not in ratings:
            continue
        p = win_probability(ratings.get(home, 1500.0), ratings.get(away, 1500.0), home="a")
        game_probs.append((home, away, p))

    totals = defaultdict(
        lambda: {"in_playoffs": 0, "win_wildcard": 0, "win_ds": 0, "win_cs": 0, "win_ws": 0}
    )

    for sim_idx in range(n_sims):
        # Flip each remaining game by ELO probability
        sim_records = {abbr: list(r) for abbr, r in current_records.items()}
        for home, away, p in game_probs:
            if random.random() < p:
                sim_records[home][0] += 1
                sim_records[away][1] += 1
            else:
                sim_records[home][1] += 1
                sim_records[away][0] += 1

        sim_records_t = {abbr: tuple(r) for abbr, r in sim_records.items()}

        # Build simulated standings_by_league for bracket seeding
        sim_standings_by_league = {}
        for league_name, divisions in league_divisions.items():
            sim_standings_by_league.setdefault(league_name, {})
            for div_name, teams in divisions.items():
                for abbr in teams:
                    sim_standings_by_league[league_name][abbr] = sim_records_t.get(abbr, (0, 0))

        # Determine playoff field deterministically from simulated standings
        field = determine_playoff_field(sim_records_t, league_divisions)
        if len(field) < 12:
            continue

        try:
            results = simulate_playoffs(field, ratings, sim_standings_by_league)
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
            "playoff_probability": round(counts["in_playoffs"] / n_sims, 3),
            "win_wildcard": round(counts["win_wildcard"] / n_sims, 3),
            "win_ds": round(counts["win_ds"] / n_sims, 3),
            "win_cs": round(counts["win_cs"] / n_sims, 3),
            "win_ws": round(counts["win_ws"] / n_sims, 3),
        }
        for team, counts in totals.items()
    }
