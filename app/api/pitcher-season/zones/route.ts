import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ── Zone boundaries ────────────────────────────────────────────────────────────
// 5 cols × 5 rows = 25 cells
// pX left→right breaks: [-2.5, -1.0, -0.33, 0.33, 1.0, 2.5]
// pZ top→bottom breaks: [5.0, 3.5, 2.75, 2.0, 1.4, 0.0]

const X_BREAKS = [-2.5, -1.0, -0.33, 0.33, 1.0, 2.5]
const Z_BREAKS = [5.0, 3.5, 2.75, 2.0, 1.4, 0.0]

const EXCLUDE_EVENTS = new Set([
  'walk', 'intent_walk', 'hit_by_pitch', 'sac_fly', 'sac_bunt', 'catcher_interf',
])

// ── MLB API types ──────────────────────────────────────────────────────────────

interface SeasonStatsResponse {
  stats?: {
    splits?: {
      stat?: {
        era?: string
        whip?: string
        strikeOuts?: number
        baseOnBalls?: number
        inningsPitched?: string
        wins?: number
        losses?: number
      }
    }[]
  }[]
}

interface GameLogSplit {
  game?: { gamePk?: number }
}

interface GameLogResponse {
  stats?: {
    splits?: GameLogSplit[]
  }[]
}

interface PlayEvent {
  isPitch?: boolean
  pitchData?: {
    coordinates?: {
      pX?: number
      pZ?: number
    }
  }
}

interface Play {
  matchup?: { pitcher?: { id?: number } }
  result?: { eventType?: string }
  playEvents?: PlayEvent[]
}

interface FeedLive {
  gameData?: {
    players?: Record<string, { fullName?: string }>
    teams?: {
      away?: { abbreviation?: string; pitchers?: number[] }
      home?: { abbreviation?: string; pitchers?: number[] }
    }
  }
  liveData?: {
    plays?: { allPlays?: Play[] }
    boxscore?: {
      teams?: {
        away?: { team?: { abbreviation?: string } }
        home?: { team?: { abbreviation?: string } }
      }
    }
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface OutcomePitch {
  pX: number
  pZ: number
  eventType: string
}

interface ZoneCell {
  row: number
  col: number
  pa: number
  ab: number
  h: number
  tb: number
  bb: number
  avg: number | null
  slg: number | null
  obp: number | null
  ops: number | null
}

interface ZoneTotals {
  pa: number
  ab: number
  h: number
  tb: number
  bb: number
  avg: number | null
  slg: number | null
  obp: number | null
  ops: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getCol(pX: number): number {
  for (let i = 0; i < X_BREAKS.length - 1; i++) {
    if (pX >= X_BREAKS[i] && pX < X_BREAKS[i + 1]) return i
  }
  return -1
}

function getRow(pZ: number): number {
  for (let i = 0; i < Z_BREAKS.length - 1; i++) {
    if (pZ <= Z_BREAKS[i] && pZ > Z_BREAKS[i + 1]) return i
  }
  return -1
}

function hits(eventType: string): number {
  if (eventType === 'single') return 1
  if (eventType === 'double') return 1
  if (eventType === 'triple') return 1
  if (eventType === 'home_run') return 1
  return 0
}

function totalBases(eventType: string): number {
  if (eventType === 'single') return 1
  if (eventType === 'double') return 2
  if (eventType === 'triple') return 3
  if (eventType === 'home_run') return 4
  return 0
}

function isWalk(eventType: string): boolean {
  return eventType === 'walk' || eventType === 'intent_walk'
}

function computeStats(outcomes: OutcomePitch[]): Omit<ZoneCell, 'row' | 'col'> {
  const pa = outcomes.length
  let ab = 0, h = 0, tb = 0, bb = 0

  for (const o of outcomes) {
    if (!EXCLUDE_EVENTS.has(o.eventType)) ab++
    h  += hits(o.eventType)
    tb += totalBases(o.eventType)
    if (isWalk(o.eventType)) bb++
  }

  const avg  = ab >= 5 ? h / Math.max(ab, 1)       : null
  const slg  = ab >= 5 ? tb / Math.max(ab, 1)      : null
  const obp  = pa >= 5 ? (h + bb) / Math.max(pa, 1) : null
  const ops  = pa >= 5 && obp !== null && slg !== null ? obp + slg : null

  return { pa, ab, h, tb, bb, avg, slg, obp, ops }
}

function round3(n: number | null): number | null {
  return n !== null ? Math.round(n * 1000) / 1000 : null
}

// ── Route handler ──────────────────────────────────────────────────────────────

// GET /api/pitcher-season/zones?pitcherId=605135&season=2025
export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const pitcherIdStr = searchParams.get('pitcherId') ?? ''
  const seasonStr    = searchParams.get('season') ?? String(new Date().getFullYear())

  const pitcherId = parseInt(pitcherIdStr, 10)
  const season    = parseInt(seasonStr, 10)

  if (!pitcherId || isNaN(pitcherId)) {
    return NextResponse.json({ error: 'pitcherId required' }, { status: 400 })
  }

  try {
    // 1. Season stats
    const [seasonRes, gameLogRes] = await Promise.all([
      fetch(
        `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}&gameType=R`,
        { cache: 'no-store' },
      ),
      fetch(
        `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}&gameType=R`,
        { cache: 'no-store' },
      ),
    ])

    let pitcherName = `Pitcher ${pitcherId}`
    let teamAbbr    = '???'
    let seasonStats = { era: 0, whip: 0, k9: 0, bb9: 0, wins: 0, losses: 0, ip: '0.0' }

    if (seasonRes.ok) {
      const sd: SeasonStatsResponse = await seasonRes.json()
      const split = sd.stats?.[0]?.splits?.[0]?.stat
      if (split) {
        const ip    = split.inningsPitched ?? '0.0'
        const ipVal = parseFloat(ip.replace(/\.\d/, m => String(parseInt(m.slice(1), 10) / 3)))
        const k9    = ipVal > 0 ? ((split.strikeOuts ?? 0) / ipVal) * 9 : 0
        const bb9   = ipVal > 0 ? ((split.baseOnBalls ?? 0) / ipVal) * 9 : 0
        seasonStats = {
          era:    parseFloat(split.era ?? '0'),
          whip:   parseFloat(split.whip ?? '0'),
          k9:     Math.round(k9 * 10) / 10,
          bb9:    Math.round(bb9 * 10) / 10,
          wins:   split.wins ?? 0,
          losses: split.losses ?? 0,
          ip,
        }
      }
    }

    // Resolve pitcher name + team from people endpoint
    const peopleRes = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=currentTeam`,
      { cache: 'no-store' },
    )
    if (peopleRes.ok) {
      const pd = await peopleRes.json()
      const person = pd.people?.[0]
      if (person) {
        pitcherName = person.fullName ?? pitcherName
        teamAbbr    = (person.currentTeam?.abbreviation ?? teamAbbr).toUpperCase()
      }
    }

    // 2. Collect unique gamePks from game log
    const gamePks: number[] = []
    if (gameLogRes.ok) {
      const gld: GameLogResponse = await gameLogRes.json()
      const splits = gld.stats?.[0]?.splits ?? []
      const seen = new Set<number>()
      for (const s of splits) {
        const pk = s.game?.gamePk
        if (pk && !seen.has(pk)) {
          seen.add(pk)
          gamePks.push(pk)
        }
      }
    }

    // 3. Fetch all game feeds in parallel (max 40)
    const capped = gamePks.slice(0, 40)
    const feeds = await Promise.all(
      capped.map(pk =>
        fetch(`https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`, { cache: 'no-store' })
          .then(r => (r.ok ? r.json() as Promise<FeedLive> : Promise.resolve(null)))
          .catch(() => null),
      ),
    )

    // 4. Collect outcome pitches
    const allOutcomes: OutcomePitch[] = []
    const cellOutcomes: OutcomePitch[][] = Array.from({ length: 25 }, () => [])

    for (const feed of feeds) {
      if (!feed) continue
      const allPlays: Play[] = feed.liveData?.plays?.allPlays ?? []

      for (const play of allPlays) {
        if (play.matchup?.pitcher?.id !== pitcherId) continue
        const eventType = play.result?.eventType ?? ''
        if (!eventType) continue

        const events: PlayEvent[] = play.playEvents ?? []
        // Find the last pitch event with coordinates
        let lastPitchEvent: PlayEvent | null = null
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i]
          if (
            ev.isPitch &&
            ev.pitchData?.coordinates?.pX != null &&
            ev.pitchData?.coordinates?.pZ != null
          ) {
            lastPitchEvent = ev
            break
          }
        }
        if (!lastPitchEvent) continue

        const pX = lastPitchEvent.pitchData!.coordinates!.pX!
        const pZ = lastPitchEvent.pitchData!.coordinates!.pZ!

        const outcome: OutcomePitch = { pX, pZ, eventType }
        allOutcomes.push(outcome)

        const col = getCol(pX)
        const row = getRow(pZ)
        if (row >= 0 && col >= 0) {
          const idx = row * 5 + col
          cellOutcomes[idx].push(outcome)
        }
      }
    }

    // 5. Build 5×5 zone grid
    const zones: ZoneCell[][] = []
    for (let row = 0; row < 5; row++) {
      const rowCells: ZoneCell[] = []
      for (let col = 0; col < 5; col++) {
        const idx = row * 5 + col
        const stats = computeStats(cellOutcomes[idx])
        rowCells.push({
          row,
          col,
          ...stats,
          avg: round3(stats.avg),
          slg: round3(stats.slg),
          obp: round3(stats.obp),
          ops: round3(stats.ops),
        })
      }
      zones.push(rowCells)
    }

    // 6. Totals
    const totRaw   = computeStats(allOutcomes)
    const totals: ZoneTotals = {
      ...totRaw,
      avg: round3(totRaw.avg),
      slg: round3(totRaw.slg),
      obp: round3(totRaw.obp),
      ops: round3(totRaw.ops),
    }

    return NextResponse.json({
      pitcherName,
      teamAbbr,
      season,
      seasonStats,
      zones,
      totals,
    })
  } catch (err) {
    console.error('[pitcher-season/zones]', err)
    return NextResponse.json({ error: 'Failed to load season data' }, { status: 500 })
  }
}
