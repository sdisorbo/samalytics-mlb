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
  return readJson<PitcherArsenal[]>('pitcher_arsenal.json', year)
}

export function getBatterVsPitch(year?: string): BatterVsPitch[] {
  return readJson<BatterVsPitch[]>('batter_vs_pitch.json', year)
}
