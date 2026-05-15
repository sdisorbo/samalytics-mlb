"""
game_atbats.py — Per-batter, per-game run value from Statcast

Pulls Statcast pitch-by-pitch data month-by-month, filters to
plate-appearance-ending events, and aggregates delta_run_exp by
(batting_team × game × batter) to produce per-batter and per-team
run value (RV) for every game in the season.

Output schema — list, one entry per team:
{
  "team": "NYY",
  "games": [
    {
      "date": "2025-04-01",
      "game_pk": 748483,
      "opponent": "BOS",
      "home": true,
      "actual_runs": 5,       # filled by enrich_with_schedule()
      "team_rv": 0.45,
      "batters": [
        { "name": "Aaron Judge", "pa": 4, "rv": 0.38 },
        ...                    # sorted descending by rv
      ]
    },
    ...                        # sorted ascending by date
  ]
}
"""

import io
import csv
import time
import calendar
import datetime
import requests

SAVANT_BASE = "https://baseballsavant.mlb.com"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; mlb-engine/1.0)",
    "Accept": "text/csv,*/*",
}


def _safe_float(val, default=0.0):
    try:
        if val in (None, "", "null", "NA", "-"):
            return default
        return float(val)
    except (TypeError, ValueError):
        return default


def _parse_name(raw):
    """Convert 'Last, First' → 'First Last'. Pass through anything else."""
    parts = raw.split(", ", 1)
    if len(parts) == 2:
        return f"{parts[1]} {parts[0]}"
    return raw


def _week_ranges(season, start_month=3, end_month=11):
    """Yield (start_str, end_str) tuples in 6-day windows covering the season.

    Six-day chunks keep each request well under Statcast's ~40k-row CSV cap
    (a typical week is ~15 games × ~300 pitches × 6 days ≈ 27k rows).
    """
    start = datetime.date(season, start_month, 1)
    # Season ends no later than Nov 30
    season_end = datetime.date(season, end_month, calendar.monthrange(season, end_month)[1])
    today = datetime.date.today()
    end_bound = min(season_end, today)

    while start <= end_bound:
        chunk_end = min(start + datetime.timedelta(days=5), end_bound)
        yield start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")
        start = chunk_end + datetime.timedelta(days=1)


def fetch_game_atbats(season, start_month=3, end_month=11):
    """
    Pull Statcast pitch-by-pitch data for the season in 6-day chunks (to stay
    under the ~40k-row CSV cap), filter to PA-ending events (events != ''),
    and aggregate delta_run_exp by team × game × batter.

    Returns a list of team dicts (see module docstring for schema).
    actual_runs will be None until enrich_with_schedule() is called.
    """
    # team_abbr → game_pk_str → { is_home, opponent, batters: {name: {rv, pa}} }
    team_game_batter: dict = {}
    # game_pk_str → { date, home_team, away_team }
    game_meta: dict = {}

    for start, end in _week_ranges(season, start_month, end_month):
        print(f"    Game atbats: {start} → {end}")

        try:
            params = {
                "all":          "true",
                "hfSea":        f"{season}|",
                "game_date_gt": start,
                "game_date_lt": end,
                "player_type":  "batter",
                "type":         "details",
                "min_pitches":  "0",
                "min_results":  "0",
                "min_pas":      "0",
            }
            resp = requests.get(
                f"{SAVANT_BASE}/statcast_search/csv",
                params=params,
                headers=_HEADERS,
                timeout=180,
            )
            resp.raise_for_status()
            content = resp.content.decode("utf-8-sig", errors="replace")
            if len(content.strip()) < 200:
                print(f"      No data returned for {start}–{end}, skipping.")
                time.sleep(0.5)
                continue

            reader = csv.DictReader(io.StringIO(content))
            pa_count = 0

            for row in reader:
                # Keep only PA-ending rows
                event = (row.get("events") or "").strip()
                if not event:
                    continue

                game_pk = (row.get("game_pk") or "").strip()
                if not game_pk:
                    continue

                game_date    = (row.get("game_date")     or "").strip()
                home_team    = (row.get("home_team")     or "").strip().upper()
                away_team    = (row.get("away_team")     or "").strip().upper()
                inning_topbt = (row.get("inning_topbot") or "").strip()

                # Top of inning → away team is batting
                if inning_topbt == "Top":
                    batting_team  = away_team
                    fielding_team = home_team
                    is_home       = False
                else:
                    batting_team  = home_team
                    fielding_team = away_team
                    is_home       = True

                if not batting_team:
                    continue

                # player_name in a batter-type query is the batter's name
                raw_name    = (row.get("player_name") or "").strip()
                batter_name = _parse_name(raw_name) if raw_name else "Unknown"

                rv = _safe_float(row.get("delta_run_exp"), 0.0)

                # Store game metadata (consistent across rows for same game_pk)
                if game_pk not in game_meta:
                    game_meta[game_pk] = {
                        "date":      game_date,
                        "home_team": home_team,
                        "away_team": away_team,
                    }

                # Accumulate rv + pa
                if batting_team not in team_game_batter:
                    team_game_batter[batting_team] = {}
                tg = team_game_batter[batting_team]

                if game_pk not in tg:
                    tg[game_pk] = {
                        "is_home":  is_home,
                        "opponent": fielding_team,
                        "batters":  {},
                    }

                if batter_name not in tg[game_pk]["batters"]:
                    tg[game_pk]["batters"][batter_name] = {"rv": 0.0, "pa": 0}

                tg[game_pk]["batters"][batter_name]["rv"] += rv
                tg[game_pk]["batters"][batter_name]["pa"] += 1
                pa_count += 1

            print(f"      {pa_count:,} PA-ending events ingested")
            time.sleep(0.5)

        except requests.RequestException as e:
            print(f"      Warning: month {month} failed ({e}), continuing.")
            continue

    # Build output list sorted by team then game date
    result = []
    for team, games in sorted(team_game_batter.items()):
        game_list = []
        for gk, gdata in sorted(
            games.items(),
            key=lambda kv: game_meta.get(kv[0], {}).get("date", "")
        ):
            meta     = game_meta.get(gk, {})
            team_rv  = 0.0
            batters_out = []

            for bname, bdata in gdata["batters"].items():
                batters_out.append({
                    "name": bname,
                    "pa":   bdata["pa"],
                    "rv":   round(bdata["rv"], 3),
                })
                team_rv += bdata["rv"]

            # Sort batters by rv descending so top contributors are first
            batters_out.sort(key=lambda x: x["rv"], reverse=True)

            game_list.append({
                "date":         meta.get("date", ""),
                "game_pk":      int(gk),
                "opponent":     gdata["opponent"],
                "home":         gdata["is_home"],
                "actual_runs":  None,        # filled by enrich_with_schedule()
                "team_rv":      round(team_rv, 3),
                "batters":      batters_out,
            })

        result.append({"team": team, "games": game_list})

    return result


def enrich_with_schedule(team_game_logs, schedule_games):
    """
    Join actual_runs from the schedule into team_game_logs in-place.

    schedule_games must already have home_id / away_id remapped to
    team abbreviations (i.e. the output of _remap_games() in main.py).
    Each game dict must have 'game_id', 'home_id', 'away_id',
    'home_score', 'away_score'.
    """
    # Build lookup: game_id (str) → schedule row
    sched = {str(g["game_id"]): g for g in schedule_games if "game_id" in g}

    for team_entry in team_game_logs:
        team = team_entry["team"]
        for game in team_entry["games"]:
            pk  = str(game["game_pk"])
            row = sched.get(pk)
            if not row:
                continue
            if team == row.get("home_id"):
                game["actual_runs"] = row.get("home_score")
            elif team == row.get("away_id"):
                game["actual_runs"] = row.get("away_score")

    return team_game_logs
