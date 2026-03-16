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

function readJson<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename)
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

export function getPitchers(): Pitcher[] {
  return readJson<Pitcher[]>('pitchers.json')
}

export function getPlayers(): Player[] {
  return readJson<Player[]>('players.json')
}

export function getPlayoffOdds(): PlayoffOdds {
  return readJson<PlayoffOdds>('playoff_odds.json')
}

export function getPitcherArsenal(): PitcherArsenal[] {
  return readJson<PitcherArsenal[]>('pitcher_arsenal.json')
}

export function getBatterVsPitch(): BatterVsPitch[] {
  return readJson<BatterVsPitch[]>('batter_vs_pitch.json')
}
