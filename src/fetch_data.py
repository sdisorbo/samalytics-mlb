"""
fetch_data.py — MLB Stats API client

All functions accept a `season` parameter. No year is hardcoded.
Base URL: https://statsapi.mlb.com/api/v1
"""

import time
import requests
from datetime import date
from dateutil.relativedelta import relativedelta

BASE_URL = "https://statsapi.mlb.com/api/v1"


def _get(endpoint, params=None, retries=3):
    """Make a GET request to the MLB Stats API with basic retry logic."""
    url = f"{BASE_URL}{endpoint}"
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            print(f"  Warning: request failed ({e}), retrying...")
            time.sleep(1.5)


def fetch_teams(season):
    """Return a dict mapping teamId -> team info dict."""
    data = _get("/teams", {"sportId": 1, "season": season})
    teams = {}
    for t in data.get("teams", []):
        teams[t["id"]] = {
            "id": t["id"],
            "name": t["name"],
            "abbreviation": t.get("abbreviation", ""),
            "teamName": t.get("teamName", t["name"]),
            "league": t.get("league", {}).get("name", ""),
            "leagueId": t.get("league", {}).get("id", 0),
            "division": t.get("division", {}).get("name", ""),
            "divisionId": t.get("division", {}).get("id", 0),
            "venue": t.get("venue", {}).get("name", ""),
        }
    return teams


def fetch_standings(season):
    """Return raw standings records list for both leagues."""
    data = _get(
        "/standings",
        {
            "leagueId": "103,104",
            "season": season,
            "standingsTypes": "regularSeason",
            "hydrate": "team,division,league",
        },
    )
    return data.get("records", [])


def fetch_schedule(season, start_date=None, end_date=None):
    """
    Fetch all completed regular-season game results for a season.

    Fetches month-by-month to keep API responses manageable.
    Returns a list of game dicts:
      {game_id, date, home_id, away_id, home_score, away_score, venue}
    """
    season_start = start_date or date(season, 3, 15)
    season_end = end_date or date(season, 10, 5)

    all_games = []
    current = season_start

    while current <= season_end:
        chunk_end = min(
            current + relativedelta(months=1) - relativedelta(days=1),
            season_end,
        )
        params = {
            "sportId": 1,
            "startDate": current.strftime("%Y-%m-%d"),
            "endDate": chunk_end.strftime("%Y-%m-%d"),
            "gameType": "R",
            "hydrate": "linescore",
        }
        data = _get("/schedule", params)

        for day in data.get("dates", []):
            for game in day.get("games", []):
                if game.get("status", {}).get("abstractGameState") != "Final":
                    continue
                linescore = game.get("linescore", {})
                home_score = linescore.get("teams", {}).get("home", {}).get("runs")
                away_score = linescore.get("teams", {}).get("away", {}).get("runs")
                if home_score is None or away_score is None:
                    continue
                all_games.append(
                    {
                        "game_id": game["gamePk"],
                        "date": day["date"],
                        "home_id": game["teams"]["home"]["team"]["id"],
                        "away_id": game["teams"]["away"]["team"]["id"],
                        "home_score": int(home_score),
                        "away_score": int(away_score),
                        "venue": game.get("venue", {}).get("name", ""),
                    }
                )

        current = chunk_end + relativedelta(days=1)
        time.sleep(0.15)  # polite rate limiting

    return all_games


def fetch_pitcher_stats(season):
    """Fetch season pitching splits for all pitchers. Returns list of split dicts."""
    splits = []
    offset = 0
    limit = 500

    while True:
        data = _get(
            "/stats",
            {
                "stats": "season",
                "group": "pitching",
                "season": season,
                "playerPool": "All",
                "limit": limit,
                "offset": offset,
            },
        )
        batch = data.get("stats", [{}])[0].get("splits", [])
        splits.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
        time.sleep(0.1)

    return splits


def fetch_batter_stats(season):
    """Fetch season batting splits for qualified hitters. Returns list of split dicts."""
    splits = []
    offset = 0
    limit = 500

    while True:
        data = _get(
            "/stats",
            {
                "stats": "season",
                "group": "hitting",
                "season": season,
                "playerPool": "Qualified",
                "limit": limit,
                "offset": offset,
            },
        )
        batch = data.get("stats", [{}])[0].get("splits", [])
        splits.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
        time.sleep(0.1)

    return splits
