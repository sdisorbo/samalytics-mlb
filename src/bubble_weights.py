"""
bubble_weights.py — Playoff field probability calculator

MLB playoff format: 12 teams (3 division winners + 3 wild cards per league = 6 per league)

Weight formula: exp(-0.5 * games_back), normalized within teams ≤5 GB of the spot leader.
Teams more than 5 games back receive weight = 0.
"""

import math
import random


# ── Core math ──────────────────────────────────────────────────────────────────

def games_back(leader_w, leader_l, team_w, team_l):
    """Games back of a team relative to the leader for a given spot."""
    return ((leader_w - team_w) + (team_l - leader_l)) / 2.0


def spot_weights(contenders, leader_w, leader_l):
    """
    Compute normalised weights for a single playoff spot.

    contenders: list of (abbr, wins, losses)
    Returns dict: abbr -> weight (0.0–1.0, sums to 1.0)
    """
    raw = {}
    for abbr, w, l in contenders:
        gb = games_back(leader_w, leader_l, w, l)
        raw[abbr] = math.exp(-0.5 * gb) if gb <= 5.0 else 0.0

    total = sum(raw.values())
    if total == 0:
        return {abbr: 0.0 for abbr, _, _ in contenders}
    return {abbr: v / total for abbr, v in raw.items()}


# ── Per-league probability computation ─────────────────────────────────────────

def _league_playoff_probs(divisions):
    """
    Compute playoff probability for each team in one league.

    divisions: dict of division_name -> [(abbr, wins, losses), ...]
    Returns dict: abbr -> playoff_probability
    """
    div_winner_probs = {}   # abbr -> P(wins own division)
    all_teams = []

    # ── Division winner spots (3 per league) ──────────────────────────────────
    for div_name in sorted(divisions):
        teams = divisions[div_name]
        if not teams:
            continue
        all_teams.extend(teams)
        leader = max(teams, key=lambda t: t[1] - t[2])
        weights = spot_weights(teams, leader[1], leader[2])
        for abbr, w in weights.items():
            div_winner_probs[abbr] = w

    # ── Wild card spots (3 per league) ────────────────────────────────────────
    # Sort all league teams by (wins - losses) descending
    sorted_teams = sorted(all_teams, key=lambda t: t[1] - t[2], reverse=True)

    wc_probs = {abbr: 0.0 for abbr, _, _ in all_teams}

    for wc_slot in range(3):
        # The "leader" for this WC slot is notionally the team ranked 3+slot+1
        # in the league (after the 3 expected div winners).
        slot_rank = 3 + wc_slot
        if slot_rank >= len(sorted_teams):
            break
        wc_leader = sorted_teams[slot_rank]
        weights = spot_weights(sorted_teams, wc_leader[1], wc_leader[2])
        for abbr, w in weights.items():
            # Scale by probability of NOT being a division winner
            not_div = 1.0 - div_winner_probs.get(abbr, 0.0)
            wc_probs[abbr] += w * not_div

    # Normalise so exactly 3 WC slots are filled in expectation
    total_wc = sum(wc_probs.values())
    if total_wc > 0:
        scale = 3.0 / total_wc
        wc_probs = {abbr: min(1.0, p * scale) for abbr, p in wc_probs.items()}

    # ── Combine P(div winner) + P(WC | not div winner) ───────────────────────
    probs = {}
    for abbr, _, _ in all_teams:
        p_div = div_winner_probs.get(abbr, 0.0)
        p_wc = wc_probs.get(abbr, 0.0) * (1.0 - p_div)
        probs[abbr] = min(1.0, p_div + p_wc)

    return probs


def calculate_playoff_probabilities(standings_records):
    """
    Given raw standings records from the MLB Stats API, compute a
    playoff_probability (0–1) for every team across both leagues.

    Returns dict: team_abbr -> float
    """
    leagues = {}  # league_name -> {division_name -> [(abbr, wins, losses)]}

    for record in standings_records:
        league_name = record.get("league", {}).get("name", "Unknown League")
        division_name = record.get("division", {}).get("name", "Unknown Division")
        leagues.setdefault(league_name, {}).setdefault(division_name, [])

        for team_rec in record.get("teamRecords", []):
            abbr = team_rec["team"]["abbreviation"]
            wins = team_rec.get("wins", 0)
            losses = team_rec.get("losses", 0)
            leagues[league_name][division_name].append((abbr, wins, losses))

    all_probs = {}
    for league_name, divisions in leagues.items():
        all_probs.update(_league_playoff_probs(divisions))

    return all_probs


# ── Stochastic playoff field draw ──────────────────────────────────────────────

def draw_playoff_field(standings_records, n_simulations=1):
    """
    Draw `n_simulations` independent playoff fields using weighted random selection.

    Each draw returns 12 team abbreviations ordered:
        [AL_div1, AL_div2, AL_div3, AL_wc1, AL_wc2, AL_wc3,
         NL_div1, NL_div2, NL_div3, NL_wc1, NL_wc2, NL_wc3]

    Returns list of lists (one per simulation).
    """
    # Parse standings into leagues → divisions
    leagues = {}
    for record in standings_records:
        league_name = record.get("league", {}).get("name", "")
        division_name = record.get("division", {}).get("name", "")
        leagues.setdefault(league_name, {}).setdefault(division_name, [])

        for team_rec in record.get("teamRecords", []):
            abbr = team_rec["team"]["abbreviation"]
            wins = team_rec.get("wins", 0)
            losses = team_rec.get("losses", 0)
            leagues[league_name][division_name].append((abbr, wins, losses))

    # Stable league order: American first, National second
    def league_sort_key(name):
        if "American" in name:
            return 0
        if "National" in name:
            return 1
        return 2

    sorted_leagues = sorted(leagues.keys(), key=league_sort_key)

    fields = []
    for _ in range(n_simulations):
        field = []

        for league_name in sorted_leagues:
            divisions = leagues[league_name]
            all_league_teams = []
            div_winners = []

            # Draw one division winner per division
            for div_name in sorted(divisions.keys()):
                teams = divisions[div_name]
                if not teams:
                    continue
                all_league_teams.extend(teams)
                leader = max(teams, key=lambda t: t[1] - t[2])
                weights = spot_weights(teams, leader[1], leader[2])
                abbrs = list(weights.keys())
                wts = [weights[a] for a in abbrs]
                winner = random.choices(abbrs, weights=wts, k=1)[0]
                div_winners.append(winner)

            # Draw 3 wild card teams from non-division-winner pool
            wc_pool = sorted(
                [(a, w, l) for a, w, l in all_league_teams if a not in div_winners],
                key=lambda t: t[1] - t[2],
                reverse=True,
            )

            wild_cards = []
            remaining = list(wc_pool)
            for _ in range(3):
                if not remaining:
                    break
                leader = remaining[0]
                weights = spot_weights(remaining, leader[1], leader[2])
                abbrs = list(weights.keys())
                wts = [weights[a] for a in abbrs]
                winner = random.choices(abbrs, weights=wts, k=1)[0]
                wild_cards.append(winner)
                remaining = [(a, w, l) for a, w, l in remaining if a != winner]

            field.extend(div_winners + wild_cards)

        fields.append(field)

    return fields
