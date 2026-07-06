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
    Each row: { player_id, name, team, g, pa, war, off_war, def_war }
    """
    try:
        from pybaseball import bwar_bat
        df = bwar_bat(return_all=False)
        df = df[df["year_ID"] == season]
        df = df[df["pitcher"] == "N"]
        df = df.dropna(subset=["WAR"])
        df = df[df["WAR"] != 0]

        rows = []
        for _, r in df.iterrows():
            off_r = _safe_float(r.get("runs_above_avg_off", 0)) or 0.0
            def_r = _safe_float(r.get("runs_above_avg_def", 0)) or 0.0
            total_war = _safe_float(r.get("WAR"))
            if total_war is None:
                continue

            # Convert runs above average to approximate WAR fractions.
            # Each component is scaled by runs-per-win; replacement-level
            # credit (~2 WAR) is added entirely to offense as a convention.
            off_war = round(off_r / RUNS_PER_WIN, 2)
            def_war = round(def_r / RUNS_PER_WIN, 2)

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

        rows.sort(key=lambda x: x["war"], reverse=True)
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

        off_war = round(off_r / RUNS_PER_WIN, 2)
        def_war = round(def_r / RUNS_PER_WIN, 2)

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
