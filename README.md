# mlb-engine

A personal MLB prediction and rating system inspired by FiveThirtyEight's MLB Predictions page. Runs daily via GitHub Actions, computes ELO ratings and playoff simulations, and exports clean JSON files for a Next.js frontend.

---

## How It Works

1. **Fetch** — pulls standings, game results, and player stats from the free MLB Stats API
2. **ELO** — updates team ratings after every completed game (K=20, HFA=+35)
3. **Playoff probabilities** — weights each team's chance at each of the 12 playoff spots using an exponential games-back formula
4. **Simulation** — runs 10 independent bracket simulations per day to produce `win_ws`, `win_cs`, `win_ds` odds
5. **Export** — writes five JSON files to `data/output/` for the frontend to consume

---

## Quick Start

### Prerequisites

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Run the full pipeline

```bash
python src/main.py
```

Output files are written to `data/output/`.

### Validate against 2024 results

```bash
python src/validate.py
```

Runs 100 playoff simulations using actual 2024 standings and ELO ratings, then compares model World Series odds against the actual winner (Dodgers).

---

## Switching Seasons

Open `src/main.py` and change the single config line at the top:

```python
SEASON = 2025   # ← change this
```

That's it — every API call and downstream computation reads from this variable.

---

## Output Files

All files are written to `data/output/` and committed by the GitHub Actions workflow.

| File | Description |
|------|-------------|
| `standings.json` | All 30 teams with ELO, W-L, playoff probability, and sim results |
| `team_ratings_history.json` | Full ELO rating timeline per team |
| `pitchers.json` | Qualifying starters (≥20 IP) with FIP, K/9, percentiles |
| `players.json` | Qualified batters with OPS, K%, BB%, percentiles |
| `playoff_odds.json` | Aggregated playoff simulation results |

### standings.json schema

```json
[{
  "team": "Dodgers",
  "team_abbr": "LAD",
  "division": "NL West",
  "elo_rating": 1569,
  "elo_change_7d": 9,
  "wins": 47,
  "losses": 26,
  "run_diff": 174,
  "playoff_probability": 0.99,
  "win_ds": 0.7,
  "win_cs": 0.4,
  "win_ws": 0.2
}]
```

---

## GitHub Actions Cron Job

The workflow at `.github/workflows/daily_update.yml` runs at **10:00 AM ET** every day. It:

1. Installs dependencies
2. Runs `python src/main.py`
3. Commits any changed files in `data/output/` with message `Daily MLB update YYYY-MM-DD`
4. Pushes to `main`

During the offseason (November–February) the script prints a notice and exits cleanly — no empty commit is made.

To trigger a manual run: **Actions → Daily MLB Update → Run workflow**.

---

## Connecting to the Next.js Website

The JSON files are committed directly to the repository, so you can serve them via:

### GitHub raw URL

```
https://raw.githubusercontent.com/<user>/mlb-engine/main/data/output/standings.json
```

### jsDelivr CDN (recommended — cached, fast)

```
https://cdn.jsdelivr.net/gh/<user>/mlb-engine@main/data/output/standings.json
```

In your Next.js app:

```ts
// lib/mlb.ts
const CDN = "https://cdn.jsdelivr.net/gh/<user>/mlb-engine@main/data/output";

export async function getStandings() {
  const res = await fetch(`${CDN}/standings.json`, { next: { revalidate: 3600 } });
  return res.json();
}
```

Use `revalidate: 3600` (or ISR) so the site refreshes at most once per hour without a full rebuild.

---

## ELO Model Details

| Parameter | Value |
|-----------|-------|
| Starting rating | 1500 |
| Season carry-over | 1/3 of prior deviation from 1500 |
| K-factor | 20 per game |
| Home field advantage | +35 ELO points |
| Win probability | `1 / (1 + 10^((rB - rA) / 400))` |

---

## Statcast Note

The MLB Stats API does not expose full Statcast data (exit velocity, xBA, xSLG, barrel%, etc.). Those fields are set to `null` in `players.json`. To populate them:

> **TODO**: integrate Baseball Savant CSV export (`https://baseballsavant.mlb.com/statcast_search/csv`) for full Statcast metrics. Download the season CSV, join on `player_id`, and replace the `null` fields in `players.py`.

---

## Project Structure

```
mlb-engine/
├── src/
│   ├── main.py           ← orchestrator (set SEASON here)
│   ├── fetch_data.py     ← MLB Stats API client
│   ├── elo_model.py      ← ELO rating engine
│   ├── bubble_weights.py ← playoff field probabilities
│   ├── playoff_sim.py    ← bracket simulator
│   ├── pitchers.py       ← pitcher stat processor
│   ├── players.py        ← batter stat processor
│   ├── export.py         ← JSON writer
│   └── validate.py       ← 2024 PoC validation
├── data/output/          ← exported JSON (committed by CI)
├── .github/workflows/
│   └── daily_update.yml  ← daily cron job
├── requirements.txt
└── README.md
```
