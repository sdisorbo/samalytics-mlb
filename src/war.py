"""
war.py — WAR (Wins Above Replacement) data via pybaseball baseball-reference.

Fetches current-season batter WAR (total, off, def) and pitcher WAR, plus career
WAR with per-season batting stats for use in the legend comparison modal.
"""

import warnings
warnings.filterwarnings("ignore")

RUNS_PER_WIN = 10.0

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

LEGEND_PITCHER_IDS = {
    "Justin Verlander": "verlaju01",
}


def _safe_float(v):
    try:
        f = float(v)
        return None if (f != f) else round(f, 2)
    except (TypeError, ValueError):
        return None


def _safe_int(v):
    try:
        return int(v) if v == v else 0
    except (TypeError, ValueError):
        return 0


def _batting_stats_from_row(r) -> dict:
    """Extract per-season batting stats from a bwar_bat row."""
    return {
        "pa":  _safe_int(r.get("PA", 0)),
        "h":   _safe_int(r.get("H", 0)),
        "bb":  _safe_int(r.get("BB", 0)),
        "k":   _safe_int(r.get("SO", 0)),
        "avg": _safe_float(r.get("batting_avg")),
        "obp": _safe_float(r.get("onbase_perc")),
        "slg": _safe_float(r.get("slugging_perc")),
        "ops": _safe_float(r.get("onbase_plus_slugging")),
    }


def _fetch_bwar_bat() -> "pd.DataFrame":
    from pybaseball import bwar_bat
    return bwar_bat(return_all=True)


def _fetch_bwar_pitch() -> "pd.DataFrame":
    from pybaseball import bwar_pitch
    return bwar_pitch(return_all=True)


def fetch_current_war(season: int, bat_df=None) -> list[dict]:
    """
    Return a list of batter WAR rows for `season`, non-pitchers only.
    Pass bat_df to reuse an already-fetched DataFrame and avoid a second download.
    Each row: { player_id, bref_id, name, team, g, pa, war, off_war, def_war,
                player_type, career }
    """
    try:
        if bat_df is None:
            bat_df = _fetch_bwar_bat()
        df = bat_df

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
            def_r = _safe_float(r.get("runs_above_avg_def", 0)) or 0.0
            total_war = _safe_float(r.get("WAR"))
            if total_war is None:
                continue
            def_war = round(def_r / RUNS_PER_WIN, 2)
            off_war = round(total_war - def_war, 2)

            rows.append({
                "player_id":   int(r["mlb_ID"]) if r.get("mlb_ID") else None,
                "bref_id":     str(r.get("player_ID", "")),
                "name":        str(r.get("name_common", "")),
                "team":        str(r.get("team_ID", "")),
                "g":           _safe_int(r.get("G", 0)),
                "pa":          _safe_int(r.get("PA", 0)),
                "war":         total_war,
                "off_war":     off_war,
                "def_war":     def_war,
                "player_type": "batter",
            })

        # Merge multi-team rows
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

        # Reuse the already-fetched full DataFrame for career data
        full_batters = bat_df[bat_df["pitcher"] == "N"]

        for bid, row in merged.items():
            career_sub = full_batters[full_batters["player_ID"] == bid].sort_values("year_ID")
            career = []
            for _, cr in career_sub.iterrows():
                w = _safe_float(cr.get("WAR")) or 0.0
                d_r = _safe_float(cr.get("runs_above_avg_def", 0)) or 0.0
                d_war = round(d_r / RUNS_PER_WIN, 2)
                season_entry = {
                    "year":    int(cr["year_ID"]),
                    "team":    str(cr.get("team_ID", "")),
                    "g":       _safe_int(cr.get("G", 0)),
                    "war":     w,
                    "off_war": round(w - d_war, 2),
                    "def_war": d_war,
                }
                season_entry.update(_batting_stats_from_row(cr))
                career.append(season_entry)
            row["career"] = career

        rows = sorted(merged.values(), key=lambda x: x["war"], reverse=True)
        return rows

    except Exception as e:
        print(f"  [war] WARNING: could not fetch current batter WAR: {e}")
        return []


def fetch_current_pitcher_war(season: int, pitch_df=None) -> list[dict]:
    """
    Return a list of pitcher WAR rows for `season`.
    Pass pitch_df to reuse an already-fetched DataFrame and avoid a second download.
    Each row: { player_id, bref_id, name, team, g, gs, ip, war, player_type, career }
    """
    try:
        if pitch_df is None:
            pitch_df = _fetch_bwar_pitch()
        df = pitch_df

        season_df = df[df["year_ID"] == season]
        if season_df.empty:
            fallback = season - 1
            print(f"  [war] No pitcher bWAR data for {season} — falling back to {fallback}")
            season_df = df[df["year_ID"] == fallback]

        df = season_df
        df = df.dropna(subset=["WAR"])

        rows = []
        for _, r in df.iterrows():
            total_war = _safe_float(r.get("WAR"))
            if total_war is None:
                continue
            ip_outs = _safe_int(r.get("IPouts", 0))
            ip = round(ip_outs / 3, 1)
            if ip < 10:
                continue

            rows.append({
                "player_id":   int(r["mlb_ID"]) if r.get("mlb_ID") else None,
                "bref_id":     str(r.get("player_ID", "")),
                "name":        str(r.get("name_common", "")),
                "team":        str(r.get("team_ID", "")),
                "g":           _safe_int(r.get("G", 0)),
                "gs":          _safe_int(r.get("GS", 0)),
                "ip":          ip,
                "pa":          0,
                "war":         total_war,
                "off_war":     None,
                "def_war":     None,
                "player_type": "pitcher",
            })

        # Merge multi-team rows
        merged: dict[str, dict] = {}
        for row in rows:
            bid = row["bref_id"]
            if bid in merged:
                m = merged[bid]
                m["g"]   += row["g"]
                m["gs"]  += row["gs"]
                m["ip"]  = round(m["ip"] + row["ip"], 1)
                m["war"] = round(m["war"] + row["war"], 2)
                m["team"] = "2TM"
            else:
                merged[bid] = dict(row)

        # Attach career history
        for bid, row in merged.items():
            career_sub = pitch_df[pitch_df["player_ID"] == bid].sort_values("year_ID")
            career = []
            for _, cr in career_sub.iterrows():
                w = _safe_float(cr.get("WAR")) or 0.0
                ip_o = _safe_int(cr.get("IPouts", 0))
                career.append({
                    "year": int(cr["year_ID"]),
                    "team": str(cr.get("team_ID", "")),
                    "g":    _safe_int(cr.get("G", 0)),
                    "gs":   _safe_int(cr.get("GS", 0)),
                    "ip":   round(ip_o / 3, 1),
                    "war":  w,
                    "off_war": None,
                    "def_war": None,
                    "pa": None, "h": None, "bb": None, "k": None,
                    "avg": None, "obp": None, "slg": None, "ops": None,
                })
            row["career"] = career

        rows = sorted(merged.values(), key=lambda x: x["war"], reverse=True)
        return rows

    except Exception as e:
        print(f"  [war] WARNING: could not fetch current pitcher WAR: {e}")
        return []


def _career_rows_for(df, bref_id: str, is_pitcher: bool = False) -> list[dict]:
    """Extract season-by-season career WAR rows (with batting stats for batters)."""
    sub = df[df["player_ID"] == bref_id].sort_values("year_ID")
    seasons = []
    for _, r in sub.iterrows():
        war = _safe_float(r.get("WAR")) or 0.0

        if is_pitcher:
            ip_o = _safe_int(r.get("IPouts", 0))
            entry = {
                "year":    int(r["year_ID"]),
                "team":    str(r.get("team_ID", "")),
                "g":       _safe_int(r.get("G", 0)),
                "gs":      _safe_int(r.get("GS", 0)),
                "ip":      round(ip_o / 3, 1),
                "war":     war,
                "off_war": 0.0,
                "def_war": 0.0,
                "pa": None, "h": None, "bb": None, "k": None,
                "avg": None, "obp": None, "slg": None, "ops": None,
            }
        else:
            def_r = _safe_float(r.get("runs_above_avg_def", 0)) or 0.0
            d_war = round(def_r / RUNS_PER_WIN, 2)
            entry = {
                "year":    int(r["year_ID"]),
                "team":    str(r.get("team_ID", "")),
                "g":       _safe_int(r.get("G", 0)),
                "war":     war,
                "off_war": round(war - d_war, 2),
                "def_war": d_war,
            }
            entry.update(_batting_stats_from_row(r))

        seasons.append(entry)
    return seasons


def fetch_legend_war(bat_df=None, pitch_df=None) -> dict:
    """
    Return career season-by-season WAR (with batting stats) for all legend players.
    Pass bat_df/pitch_df to reuse already-fetched DataFrames.
    Schema: { "Derek Jeter": [{ year, team, g, war, off_war, def_war, pa, h, bb, k,
                                 avg, obp, slg, ops }, ...], ... }
    """
    result = {}

    try:
        if bat_df is None:
            bat_df = _fetch_bwar_bat()
        if pitch_df is None:
            pitch_df = _fetch_bwar_pitch()

        for display_name, bref_id in LEGEND_BREF_IDS.items():
            rows = _career_rows_for(bat_df, bref_id, is_pitcher=False)
            if rows:
                result[display_name] = rows
            else:
                print(f"  [war] WARNING: no career data for {display_name} ({bref_id})")

        for display_name, bref_id in LEGEND_PITCHER_IDS.items():
            rows = _career_rows_for(pitch_df, bref_id, is_pitcher=True)
            if rows:
                result[display_name] = rows

    except Exception as e:
        print(f"  [war] WARNING: could not fetch legend WAR: {e}")

    return result
