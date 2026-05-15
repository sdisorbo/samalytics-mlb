import path from 'path'
import fs from 'fs'
import type {
  TeamStanding,
  TeamRatingsHistory,
  Pitcher,
  Player,
  PlayoffOdds,
  PitcherArsenal,
  BatterVsPitch,
  TeamGameLog,
} from './types'

// Resolve data directory: env var → data/output at repo root
const DATA_DIR =
  process.env.MLB_DATA_DIR ??
  path.resolve(process.cwd(), 'data', 'output')

// Past seasons are stored under data/<year>/
export const AVAILABLE_YEARS = ['2025'] as const
export type HistoricalYear = typeof AVAILABLE_YEARS[number]

function getDataDir(year?: string): string {
  if (year && AVAILABLE_YEARS.includes(year as HistoricalYear)) {
    return path.resolve(process.cwd(), 'data', year)
  }
  return DATA_DIR
}

function readJson<T>(filename: string, year?: string): T {
  const dir = getDataDir(year)
  const filePath = path.join(dir, filename)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err) {
    throw new Error(
      `Could not read ${filePath}.\n` +
        `Run "python src/main.py" in mlb-engine first, or set MLB_DATA_DIR in .env.local.\n` +
        String(err)
    )
  }
}

export function getStandings(): TeamStanding[] {
  return readJson<TeamStanding[]>('standings.json')
}

export function getRatingsHistory(): TeamRatingsHistory {
  return readJson<TeamRatingsHistory>('team_ratings_history.json')
}

export function getPitchers(year?: string): Pitcher[] {
  return readJson<Pitcher[]>('pitchers.json', year)
}

export function getPlayers(year?: string): Player[] {
  return readJson<Player[]>('players.json', year)
}

export function getPlayoffOdds(): PlayoffOdds {
  return readJson<PlayoffOdds>('playoff_odds.json')
}

export function getPitcherArsenal(year?: string): PitcherArsenal[] {
  const arsenals = readJson<PitcherArsenal[]>('pitcher_arsenal.json', year)

  // Enrich each entry with zone_pct derived from bb_per_9 in pitchers.json.
  // Formula calibrated to the 2025 dataset (median BB/9 = 3.21):
  //   zone_pct = clamp(0.48 − (bb_per_9 − 3.21) × 0.025, 0.36, 0.58)
  // → elite control (0.9 BB/9) ≈ 54 % in zone
  // → league avg   (3.2 BB/9) ≈ 48 % in zone
  // → poor control (9.1 BB/9) ≈ 36 % in zone
  try {
    const pitchers = readJson<Pitcher[]>('pitchers.json', year)
    const byId = new Map(pitchers.map((p) => [p.player_id, p]))
    for (const a of arsenals) {
      const p = byId.get(a.player_id)
      if (p && p.bb_per_9 != null) {
        a.zone_pct = Math.min(0.58, Math.max(0.36, 0.48 - (p.bb_per_9 - 3.21) * 0.025))
      }
    }
  } catch {
    // pitchers.json unavailable — fall back to default zone_pct in the game
  }

  return arsenals
}

export function getBatterVsPitch(year?: string): BatterVsPitch[] {
  return readJson<BatterVsPitch[]>('batter_vs_pitch.json', year)
}

export function getTeamGameLogs(year?: string): TeamGameLog[] {
  return readJson<TeamGameLog[]>('team_game_logs.json', year)
}
