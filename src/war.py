"""
war.py — WAR (Wins Above Replacement) data via pybaseball baseball-reference.

Fetches current-season batter WAR (total, off, def) and career WAR
for a set of historical legend players used in the comparison modal.
"""

import warnings
warnings.filterwarnings("ignore")

# Approximate runs-per-win scale. bRef uses ~9.5–10.5 depending on season;
# 10 is a fine constant for display purposes.
RUNS_PER_WIN = 10.0

# Legend player IDs in baseball-reference format, keyed by display name.
LEGEND_BREF_IDS = {
    "Barry Bonds":    "bondsba01",
    "Derek Jeter":    "jeterde01",
    "Albert Pujols":  "pujolal01",
    "David Ortiz":    "ortizda01",
    "Johnny Damon":   "damonjo01",
    "Mike Trout":     "troutmi01",
    "Michael Young":  "youngmi02",
    "Nick Swisher":   "swishni01",
}

# Justin Verlander is a pitcher — pulled separately from bwar_pitch.
LEGEND_PITCHER_IDS = {
    "Justin Verlander": "verlaju01",
}


def _safe_float(v):
    try:
        f = float(v)
        return None if (f != f) else round(f, 2)   # NaN → None
    except (TypeError, ValueError):
        return None


def fetch_current_war(season: int) -> list[dict]:
    """
    Return a list of batter WAR rows for `season`, non-pitchers only.
    Falls back to season-1 if the requested season has no published data yet
    (bWAR on baseball-reference can lag mid-season).
    Each row: { player_id, name, team, g, pa, war, off_war, def_war }
    """
    try:
        from pybaseball import bwar_bat
        df = bwar_bat(return_all=False)

        season_df = df[df["year_ID"] == season]
        if season_df.empty:
            fallback = season - 1
            print(f"  [war] No bWAR data for {season} yet — falling back to {fallback}")
            season_df = df[df["year_ID"] == fallback]

        df = season_df
        df = df[df["pitcher"] == "N"]
        df = df.dropna(subset=["WAR"])

        rows = []
        for _, r in df.iterrows():
            off_r = _safe_float(r.get("runs_above_avg_off", 0)) or 0.0
            def_r = _safe_float(r.get("runs_above_avg_def", 0)) or 0.0
            total_war = _safe_float(r.get("WAR"))
            if total_war is None:
                continue

            # dWAR = fielding runs above average / RPW (pure defense component).
            # oWAR = everything else: batting, baserunning, positional adjustment,
            # and replacement-level credit. Computed as total - dWAR so that
            # off_war + def_war == total_war always (matches bRef's own split).
            def_war = round(def_r / RUNS_PER_WIN, 2)
            off_war = round(total_war - def_war, 2)

            rows.append({
                "player_id": int(r["mlb_ID"]) if r.get("mlb_ID") else None,
                "bref_id":   str(r.get("player_ID", "")),
                "name":      str(r.get("name_common", "")),
                "team":      str(r.get("team_ID", "")),
                "g":         int(r.get("G", 0) or 0),
                "pa":        int(r.get("PA", 0) or 0),
                "war":       total_war,
                "off_war":   off_war,
                "def_war":   def_war,
            })

        # Merge traded-player rows (same bref_id across multiple team stints).
        # bWAR splits mid-season trades into one row per team; we sum stats and
        # label the team as "2TM" (matching baseball-reference convention).
        merged: dict[str, dict] = {}
        for row in rows:
            bid = row["bref_id"]
            if bid in merged:
                m = merged[bid]
                m["g"]       += row["g"]
                m["pa"]      += row["pa"]
                m["war"]     = round(m["war"]     + row["war"],     2)
                m["off_war"] = round(m["off_war"] + row["off_war"], 2)
                m["def_war"] = round(m["def_war"] + row["def_war"], 2)
                m["team"]    = "2TM"
            else:
                merged[bid] = dict(row)

        # Attach career WAR history for each player so the frontend can draw
        # their career arc on the legend comparison charts.
        print("  [war] Fetching full career data for current players...")
        full_df = bwar_bat(return_all=True)
        full_batters = full_df[full_df["pitcher"] == "N"]

        for bid, row in merged.items():
            career_sub = full_batters[full_batters["player_ID"] == bid].sort_values("year_ID")
            career = []
            for _, cr in career_sub.iterrows():
                w = _safe_float(cr.get("WAR"))
                if w is None:
                    w = 0.0
                d_r = _safe_float(cr.get("runs_above_avg_def", 0)) or 0.0
                d_war = round(d_r / RUNS_PER_WIN, 2)
                career.append({
                    "year":    int(cr["year_ID"]),
                    "war":     w,
                    "off_war": round(w - d_war, 2),
                    "def_war": d_war,
                })
            row["career"] = career

        rows = sorted(merged.values(), key=lambda x: x["war"], reverse=True)
        return rows

    except Exception as e:
        print(f"  [war] WARNING: could not fetch current WAR: {e}")
        return []


def _career_rows_for(df, bref_id: str, name: str) -> list[dict]:
    """Extract season-by-season career WAR rows for one player."""
    sub = df[df["player_ID"] == bref_id].sort_values("year_ID")
    seasons = []
    for _, r in sub.iterrows():
        war = _safe_float(r.get("WAR"))
        off_r = _safe_float(r.get("runs_above_avg_off", 0)) or 0.0
        def_r = _safe_float(r.get("runs_above_avg_def", 0)) or 0.0
        if war is None:
            war = 0.0

        def_war = round(def_r / RUNS_PER_WIN, 2)
        off_war = round(war - def_war, 2)

        seasons.append({
            "year":    int(r["year_ID"]),
            "war":     war,
            "off_war": off_war,
            "def_war": def_war,
        })
    return seasons


def fetch_legend_war() -> dict:
    """
    Return career season-by-season WAR for all legend players.
    Schema: { "Derek Jeter": [{ year, war, off_war, def_war }, ...], ... }
    """
    result = {}

    try:
        from pybaseball import bwar_bat, bwar_pitch

        bat_df = bwar_bat(return_all=True)
        for display_name, bref_id in LEGEND_BREF_IDS.items():
            rows = _career_rows_for(bat_df, bref_id, display_name)
            if rows:
                result[display_name] = rows
            else:
                print(f"  [war] WARNING: no career data found for {display_name} ({bref_id})")

        # Verlander — pitcher WAR from bwar_pitch
        pit_df = bwar_pitch(return_all=True)
        for display_name, bref_id in LEGEND_PITCHER_IDS.items():
            sub = pit_df[pit_df["player_ID"] == bref_id].sort_values("year_ID")
            seasons = []
            for _, r in sub.iterrows():
                war = _safe_float(r.get("WAR"))
                if war is None:
                    war = 0.0
                seasons.append({
                    "year":    int(r["year_ID"]),
                    "war":     war,
                    "off_war": 0.0,
                    "def_war": 0.0,
                })
            if seasons:
                result[display_name] = seasons

    except Exception as e:
        print(f"  [war] WARNING: could not fetch legend WAR: {e}")

    return result
