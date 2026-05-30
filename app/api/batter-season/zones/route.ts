import { NextResponse } from 'next/server'
import { PITCH_NAMES } from '@/lib/pitcherGame'

export const dynamic = 'force-dynamic'

const TEAM_ID_TO_ABBR: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}

// ── Zone boundaries ────────────────────────────────────────────────────────────
// 5 cols × 5 rows = 25 cells
// pX left→right breaks: [-2.5, -1.0, -0.33, 0.33, 1.0, 2.5]
// pZ top→bottom breaks: [5.0, 3.5, 2.75, 2.0, 1.4, 0.0]

const X_BREAKS = [-2.5, -1.0, -0.33, 0.33, 1.0, 2.5]
const Z_BREAKS = [5.0, 3.5, 2.75, 2.0, 1.4, 0.0]

const EXCLUDE_EVENTS = new Set([
  'walk', 'intent_walk', 'hit_by_pitch', 'sac_fly', 'sac_bunt', 'catcher_interf',
])

const RV_WEIGHTS: Record<string, number> = {
  walk: 0.33, intent_walk: 0.33, hit_by_pitch: 0.34,
  single: 0.47, double: 0.77, triple: 1.07, home_run: 1.40,
  strikeout: -0.30,
}
function getRV(eventType: string): number {
  return RV_WEIGHTS[eventType] ?? -0.27
}
const SWING_CODES = new Set(['S','W','T','F','X','D','E','L','M','O','Q','R'])
const WHIFF_CODES = new Set(['S','W','M','Q'])

// ── MLB API types ──────────────────────────────────────────────────────────────

interface BatterSeasonStatsResponse {
  stats?: {
    splits?: {
      stat?: {
        avg?: string
        obp?: string
        slg?: string
        ops?: string
        strikeOuts?: number
        baseOnBalls?: number
        atBats?: number
        plateAppearances?: number
        hits?: number
        homeRuns?: number
        rbi?: number
        stolenBases?: number
      }
    }[]
  }[]
}

interface GameLogSplit {
  game?: { gamePk?: number }
  team?: { id?: number; abbreviation?: string }
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
  details?: {
    type?: { code?: string }
    code?: string
  }
  hitData?: {
    coordinates?: {
      coordX?: number
      coordY?: number
    }
  }
}

interface Play {
  matchup?: { batter?: { id?: number } }
  result?: { eventType?: string }
  playEvents?: PlayEvent[]
}

interface FeedLive {
  gameData?: {
    players?: Record<string, { fullName?: string }>
    teams?: {
      away?: { abbreviation?: string }
      home?: { abbreviation?: string }
    }
  }
  liveData?: {
    plays?: { allPlays?: Play[] }
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface OutcomePitch {
  pX: number
  pZ: number
  eventType: string
}

interface AllPitch {
  pX: number
  pZ: number
  pitchType: string
  eventType: string  // only set on outcome pitch (last pitch of PA); otherwise ''
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
  total_pitches: number
  zone_pct: number | null
  avg_rv: number | null
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

interface SeasonStats {
  avg: number
  obp: number
  slg: number
  ops: number
  k_pct: number
  bb_pct: number
  whiff_pct: number
  hr: number
  rbi: number
  sb: number
  hits: number
  ab: number
  pa: number
}

interface SprayPoint {
  x: number
  y: number
  eventType: string
  pitchType: string
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

function computeStats(outcomes: OutcomePitch[]): Omit<ZoneCell, 'row' | 'col' | 'total_pitches' | 'zone_pct' | 'avg_rv'> {
  const pa = outcomes.length
  let ab = 0, h = 0, tb = 0, bb = 0

  for (const o of outcomes) {
    if (!EXCLUDE_EVENTS.has(o.eventType)) ab++
    h  += hits(o.eventType)
    tb += totalBases(o.eventType)
    if (isWalk(o.eventType)) bb++
  }

  const avg  = ab >= 5 ? h / Math.max(ab, 1)        : null
  const slg  = ab >= 5 ? tb / Math.max(ab, 1)       : null
  const obp  = pa >= 5 ? (h + bb) / Math.max(pa, 1) : null
  const ops  = pa >= 5 && obp !== null && slg !== null ? obp + slg : null

  return { pa, ab, h, tb, bb, avg, slg, obp, ops }
}

function computeZoneCell(
  row: number,
  col: number,
  outcomes: OutcomePitch[],
  allPitchesInCell: AllPitch[],
): ZoneCell {
  const stats = computeStats(outcomes)
  const total_pitches = allPitchesInCell.length
  // avg RV per PA in this zone
  const rv_sum = outcomes.reduce((s, o) => s + getRV(o.eventType), 0)
  const avg_rv = outcomes.length >= 1 ? round3(rv_sum / outcomes.length) : null

  return {
    row,
    col,
    ...stats,
    avg:      round3(stats.avg),
    slg:      round3(stats.slg),
    obp:      round3(stats.obp),
    ops:      round3(stats.ops),
    total_pitches,
    zone_pct: null,
    avg_rv,
  }
}

function round3(n: number | null): number | null {
  return n !== null ? Math.round(n * 1000) / 1000 : null
}

function buildZoneGrid(allPitchesByCell: AllPitch[][]): ZoneCell[][] {
  const zones: ZoneCell[][] = []
  for (let row = 0; row < 5; row++) {
    const rowCells: ZoneCell[] = []
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col
      const cellPitches = allPitchesByCell[idx]
      const outcomes: OutcomePitch[] = cellPitches
        .filter(p => p.eventType !== '')
        .map(p => ({ pX: p.pX, pZ: p.pZ, eventType: p.eventType }))
      rowCells.push(computeZoneCell(row, col, outcomes, cellPitches))
    }
    zones.push(rowCells)
  }
  return zones
}

function applyZonePct(grid: ZoneCell[][]): ZoneCell[][] {
  const total = grid.flat().reduce((s, c) => s + c.total_pitches, 0)
  if (total === 0) return grid
  return grid.map(row =>
    row.map(cell => ({
      ...cell,
      zone_pct: round3(cell.total_pitches / total),
    })),
  )
}

// ── Route handler ──────────────────────────────────────────────────────────────

// GET /api/batter-season/zones?batterId=592450&season=2025
export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const batterIdStr = searchParams.get('batterId') ?? ''
  const seasonStr   = searchParams.get('season') ?? String(new Date().getFullYear())

  const batterId = parseInt(batterIdStr, 10)
  const season   = parseInt(seasonStr, 10)

  if (!batterId || isNaN(batterId)) {
    return NextResponse.json({ error: 'batterId required' }, { status: 400 })
  }

  try {
    // 1. Season stats (hitting) + game log
    const [seasonRes, gameLogRes] = await Promise.all([
      fetch(
        `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=season&group=hitting&season=${season}&gameType=R`,
        { cache: 'no-store' },
      ),
      fetch(
        `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=gameLog&group=hitting&season=${season}&gameType=R`,
        { cache: 'no-store' },
      ),
    ])

    let batterName = `Batter ${batterId}`
    let teamAbbr   = ''
    let seasonStats: SeasonStats = {
      avg: 0, obp: 0, slg: 0, ops: 0, k_pct: 0, bb_pct: 0, whiff_pct: 0,
      hr: 0, rbi: 0, sb: 0, hits: 0, ab: 0, pa: 0,
    }

    if (seasonRes.ok) {
      const sd: BatterSeasonStatsResponse = await seasonRes.json()
      const split = sd.stats?.[0]?.splits?.[0]?.stat
      if (split) {
        const pa = split.plateAppearances ?? 0
        const k_pct = pa > 0 ? ((split.strikeOuts ?? 0) / pa) * 100 : 0
        const bb_pct = pa > 0 ? ((split.baseOnBalls ?? 0) / pa) * 100 : 0
        seasonStats = {
          avg:  parseFloat(split.avg ?? '0'),
          obp:  parseFloat(split.obp ?? '0'),
          slg:  parseFloat(split.slg ?? '0'),
          ops:  parseFloat(split.ops ?? '0'),
          k_pct:  Math.round(k_pct * 10) / 10,
          bb_pct: Math.round(bb_pct * 10) / 10,
          whiff_pct: 0,
          hr:   split.homeRuns ?? 0,
          rbi:  split.rbi ?? 0,
          sb:   split.stolenBases ?? 0,
          hits: split.hits ?? 0,
          ab:   split.atBats ?? 0,
          pa,
        }
      }
    }

    // Resolve batter name + team from people endpoint
    const peopleRes = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${batterId}?hydrate=currentTeam`,
      { cache: 'no-store' },
    )
    if (peopleRes.ok) {
      const pd = await peopleRes.json()
      const person = pd.people?.[0]
      if (person) {
        batterName = person.fullName ?? batterName
        const ct = person.currentTeam
        teamAbbr = (ct?.abbreviation ?? (ct?.id ? TEAM_ID_TO_ABBR[ct.id] : '') ?? '').toUpperCase()
      }
    }

    // 2. Collect unique gamePks from game log; also try to get team from game log splits
    const gamePks: number[] = []
    if (gameLogRes.ok) {
      const gld: GameLogResponse = await gameLogRes.json()
      const splits = gld.stats?.[0]?.splits ?? []

      // Use game log team abbreviation as primary source if not already set
      if (!teamAbbr) {
        const glTeam = gld.stats?.[0]?.splits?.[0]?.team
        const glAbbr = glTeam?.abbreviation ?? (glTeam?.id ? TEAM_ID_TO_ABBR[glTeam.id as number] : '')
        if (glAbbr) teamAbbr = glAbbr.toUpperCase()
      }

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

    // 4. Collect all pitches seen by this batter (both outcome and non-outcome)
    const allOutcomes: OutcomePitch[] = []
    // per-cell: all pitches (for zone_pct), and per-cell outcomes (for avg/obp/slg/ops)
    const allPitchesByCell: AllPitch[][] = Array.from({ length: 25 }, () => [])

    // per-pitch-type: map from pitchType code -> AllPitch[]
    const pitchTypeMap: Map<string, AllPitch[]> = new Map()

    // spray chart points
    const sprayPoints: SprayPoint[] = []

    const HIT_EVENTS = new Set(['single', 'double', 'triple', 'home_run'])

    let swings = 0, whiffs = 0

    for (const feed of feeds) {
      if (!feed) continue
      const allPlays: Play[] = feed.liveData?.plays?.allPlays ?? []

      for (const play of allPlays) {
        if (play.matchup?.batter?.id !== batterId) continue
        const playEventType = play.result?.eventType ?? ''

        const events: PlayEvent[] = play.playEvents ?? []

        // Find the last pitch event index with coords (outcome pitch)
        let lastPitchIdx = -1
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i]
          if (
            ev.isPitch &&
            ev.pitchData?.coordinates?.pX != null &&
            ev.pitchData?.coordinates?.pZ != null
          ) {
            lastPitchIdx = i
            break
          }
        }

        // Loop ALL pitch events with coords
        let lastPitchType = 'UN'
        for (let i = 0; i < events.length; i++) {
          const ev = events[i]
          if (!ev.isPitch) continue
          const pX = ev.pitchData?.coordinates?.pX
          const pZ = ev.pitchData?.coordinates?.pZ
          if (pX == null || pZ == null) continue

          const pitchType = ev.details?.type?.code ?? 'UN'
          lastPitchType = pitchType

          const pitchCode = ev.details?.code
          if (pitchCode) {
            if (SWING_CODES.has(pitchCode)) {
              swings++
              if (WHIFF_CODES.has(pitchCode)) whiffs++
            }
          }

          // eventType only set on outcome pitch
          const isOutcomePitch = i === lastPitchIdx && playEventType !== ''
          const eventType = isOutcomePitch ? playEventType : ''

          const pitch: AllPitch = { pX, pZ, pitchType, eventType }

          // Per-cell
          const col = getCol(pX)
          const row = getRow(pZ)
          if (row >= 0 && col >= 0) {
            const idx = row * 5 + col
            allPitchesByCell[idx].push(pitch)
          }

          // Per-pitch-type
          if (!pitchTypeMap.has(pitchType)) {
            pitchTypeMap.set(pitchType, [])
          }
          pitchTypeMap.get(pitchType)!.push(pitch)

          // Outcome pitches for totals
          if (isOutcomePitch) {
            allOutcomes.push({ pX, pZ, eventType: playEventType })
          }
        }

        // Spray chart: collect hit locations from the last event in the play
        if (HIT_EVENTS.has(playEventType)) {
          // Find the last event with hitData coordinates
          for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i]
            const coordX = ev.hitData?.coordinates?.coordX
            const coordY = ev.hitData?.coordinates?.coordY
            if (coordX != null && coordY != null) {
              sprayPoints.push({
                x: coordX,
                y: coordY,
                eventType: playEventType,
                pitchType: lastPitchType,
              })
              break
            }
          }
        }
      }
    }

    // Compute whiff_pct from game feeds
    const whiff_pct = swings > 0 ? Math.round((whiffs / swings) * 1000) / 10 : 0
    seasonStats = { ...seasonStats, whiff_pct }

    // 5. Build 5×5 zone grid (all pitches seen by batter)
    const zones = applyZonePct(buildZoneGrid(allPitchesByCell))

    // 6. Totals (outcome pitches only)
    const totRaw = computeStats(allOutcomes)
    const totals: ZoneTotals = {
      ...totRaw,
      avg: round3(totRaw.avg),
      slg: round3(totRaw.slg),
      obp: round3(totRaw.obp),
      ops: round3(totRaw.ops),
    }

    // 7. Per-pitch-type zone breakdown
    const pitchTypes: { code: string; name: string; count: number; zones: ZoneCell[][] }[] = []
    for (const [code, pitches] of pitchTypeMap.entries()) {
      if (pitches.length < 10) continue

      // Build per-cell buckets for this pitch type
      const ptByCell: AllPitch[][] = Array.from({ length: 25 }, () => [])
      for (const p of pitches) {
        const col = getCol(p.pX)
        const row = getRow(p.pZ)
        if (row >= 0 && col >= 0) {
          ptByCell[row * 5 + col].push(p)
        }
      }

      pitchTypes.push({
        code,
        name: PITCH_NAMES[code] ?? code,
        count: pitches.length,
        zones: applyZonePct(buildZoneGrid(ptByCell)),
      })
    }
    pitchTypes.sort((a, b) => b.count - a.count)

    return NextResponse.json({
      batterName,
      teamAbbr,
      season,
      seasonStats,
      zones,
      totals,
      pitchTypes,
      sprayPoints,
    })
  } catch (err) {
    console.error('[batter-season/zones]', err)
    return NextResponse.json({ error: 'Failed to load season data' }, { status: 500 })
  }
}
