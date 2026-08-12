"""
elo_model.py — ELO rating system for MLB teams

Rules:
  - Every team starts at 1500 at the beginning of each season
  - Season-to-season carry-over: regress 2/3 of the deviation from 1500 back to mean
    (i.e. keep 1/3 of deviation), e.g. 1600 → 1533
  - K-factor: 20 per game
  - Home field advantage: +35 ELO points to the home team
  - Win probability: 1 / (1 + 10^((rating_b - rating_a) / 400))
"""

import datetime
from collections import defaultdict

INITIAL_RATING = 1500.0
K_FACTOR = 20.0
HOME_ADVANTAGE = 35.0
CARRYOVER_FRACTION = 1.0 / 3.0  # keep 1/3 of deviation from mean


# ── Core ELO math ──────────────────────────────────────────────────────────────

def win_probability(rating_a, rating_b, home="a"):
    """
    Win probability for team A vs team B.

    home: 'a' = A is at home, 'b' = B is at home, None = neutral site
    Returns P(A wins).
    """
    if home == "a":
        adj_a = rating_a + HOME_ADVANTAGE
        adj_b = rating_b
    elif home == "b":
        adj_a = rating_a
        adj_b = rating_b + HOME_ADVANTAGE
    else:
        adj_a = rating_a
        adj_b = rating_b
    return 1.0 / (1.0 + 10.0 ** ((adj_b - adj_a) / 400.0))


def update_ratings(rating_a, rating_b, a_won, home="a"):
    """
    Update ELO ratings after one game.

    a_won: True if team A won, False if team B won
    Returns (new_rating_a, new_rating_b).
    """
    exp_a = win_probability(rating_a, rating_b, home)
    score_a = 1.0 if a_won else 0.0
    score_b = 1.0 - score_a

    new_a = rating_a + K_FACTOR * (score_a - exp_a)
    new_b = rating_b + K_FACTOR * (score_b - (1.0 - exp_a))
    return new_a, new_b


def regress_to_mean(rating, fraction=CARRYOVER_FRACTION):
    """Apply season-start mean regression (carry fraction of deviation into new season)."""
    return INITIAL_RATING + fraction * (rating - INITIAL_RATING)


# ── Full-season rating builder ──────────────────────────────────────────────────

def build_ratings(games, team_abbrs, initial_ratings=None):
    """
    Process all completed games in chronological order and compute:
      - Final ELO ratings per team
      - Full rating history per team (one entry per game played)

    Args:
        games:           list of game dicts from fetch_data.fetch_schedule,
                         with home_id/away_id already remapped to abbreviations
        team_abbrs:      set of all known team abbreviations
        initial_ratings: optional dict of abbr -> starting rating
                         (use regress_to_mean output for multi-season runs)

    Returns:
        ratings: dict  abbr -> float (current ELO)
        history: dict  abbr -> [{"date": "YYYY-MM-DD", "rating": float}, ...]
    """
    # Initialise ratings
    ratings = {}
    for abbr in team_abbrs:
        if initial_ratings and abbr in initial_ratings:
            ratings[abbr] = float(initial_ratings[abbr])
        else:
            ratings[abbr] = INITIAL_RATING

    history = defaultdict(list)

    # Record opening ratings on the first game date (or a synthetic start date)
    games_sorted = sorted(games, key=lambda g: g["date"])
    opening_date = games_sorted[0]["date"] if games_sorted else "season-start"
    for abbr in team_abbrs:
        history[abbr].append({"date": opening_date, "rating": round(ratings[abbr], 1)})

    # Process game by game
    for game in games_sorted:
        home = game["home_id"]
        away = game["away_id"]

        if home not in ratings or away not in ratings:
            continue  # skip unknown teams (e.g. non-MLB exhibition games)

        home_won = game["home_score"] > game["away_score"]
        new_home, new_away = update_ratings(ratings[home], ratings[away], home_won, home="a")

        ratings[home] = new_home
        ratings[away] = new_away

        game_date = game["date"]
        history[home].append({"date": game_date, "rating": round(new_home, 1)})
        history[away].append({"date": game_date, "rating": round(new_away, 1)})

    return ratings, dict(history)


# ── Derived metrics ─────────────────────────────────────────────────────────────

def get_7day_elo_change(history, abbr, current_date_str):
    """Return how much a team's ELO rating has changed over the past 7 days."""
    if abbr not in history or not history[abbr]:
        return 0.0

    team_history = history[abbr]
    current_rating = team_history[-1]["rating"]

    cutoff = (
        datetime.date.fromisoformat(current_date_str) - datetime.timedelta(days=7)
    ).isoformat()

    past_rating = None
    for entry in reversed(team_history):
        if entry["date"] <= cutoff:
            past_rating = entry["rating"]
            break

    if past_rating is None:
        past_rating = team_history[0]["rating"]

    return round(current_rating - past_rating, 1)
