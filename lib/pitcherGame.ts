// Shared logic for pitcher game breakdown — used by both /api/yesterday-start and /api/pitcher-game

import { getPitchers } from './data'

const MLB_API = 'https://statsapi.mlb.com/api/v1'

export const PITCH_COLORS: Record<string, string> = {
  FF: '#EF4444', SI: '#F97316', FC: '#F59E0B', FT: '#FB923C',
  SL: '#3B82F6', ST: '#6366F1', SV: '#7C3AED', SW: '#A855F7',
  CU: '#1D4ED8', KC: '#1E3A8A',
  CH: '#10B981', FS: '#059669', FO: '#047857', SC: '#065F46',
  KN: '#64748B', EP: '#94A3B8',
}

export const PITCH_NAMES: Record<string, string> = {
  FF: '4-Seam Fastball', SI: 'Sinker', FC: 'Cutter', FT: '2-Seam',
  SL: 'Slider', ST: 'Sweeper', SV: 'Slurve', SW: 'Slow Curve',
  CU: 'Curveball', KC: 'Knuckle Curve',
  CH: 'Changeup', FS: 'Splitter', FO: 'Forkball', SC: 'Screwball',
  KN: 'Knuckleball', EP: 'Eephus',
}

export type PitchResult = 'ball' | 'called_strike' | 'swinging_strike' | 'foul' | 'out' | 'single' | 'double' | 'triple' | 'home_run'

export interface PitchPoint {
  x: number
  z: number
  type: string
  name: string
  color: string
  result: PitchResult
}

export interface PitchMixItem {
  type: string
  name: string
  count: number
  pct: number
  color: string
}

export interface GameBreakdown {
  pitcherName: string
  pitcherTeamAbbr: string
  playerId: number
  ip: number
  ipDisplay: string
  ks: number
  bbs: number
  hits: number
  er: number
  totalPitches: number
  ops: number
  gameScore: number
  percentile: number
  pitches: PitchPoint[]
  pitchMix: PitchMixItem[]
  seasonEra: number | null
  eraPercentile: number
  k9Percentile: number
  gameDate: string
  opponentAbbr: string
  gameResult: string
  blurb: string
}

export const CONTACT_CODES = new Set(['X', 'D', 'E'])
export const STRIKE_CODES   = new Set(['C', 'S', 'T', 'L', 'O', 'M', 'Q', 'R', 'U', 'W'])
export const BALL_CODES     = new Set(['B', 'I', 'P', 'V', 'Y', 'H'])

export function ipToDecimal(ipStr: string): number {
  const [full, thirds = '0'] = (ipStr ?? '0.0').split('.')
  return parseInt(full, 10) + parseInt(thirds, 10) / 3
}

export function computeGameScore(ip: number, ks: number, hits: number, walks: number, er: number, r: number): number {
  const outs    = Math.round(ip * 3)
  const innings = Math.floor(ip)
  return Math.round(50 + outs + Math.max(0, innings - 4) * 2 + ks - hits * 2 - walks - er * 4 - (r - er) * 2)
}

export function gameScoreToPercentile(gs: number): number {
  if (gs >= 90) return 99
  if (gs >= 83) return 97
  if (gs >= 77) return 94
  if (gs >= 72) return 90
  if (gs >= 67) return 85
  if (gs >= 62) return 78
  if (gs >= 57) return 70
  if (gs >= 52) return 62
  if (gs >= 47) return 53
  if (gs >= 42) return 43
  if (gs >= 37) return 34
  if (gs >= 32) return 25
  if (gs >= 27) return 17
  if (gs >= 22) return 10
  return 5
}

export function generateBlurb(
  name: string, percentile: number, ks: number, bbs: number, er: number,
  ipDisplay: string, opponentAbbr: string, gameResult: string, pitchCount: number,
): string {
  const quality =
    percentile >= 90 ? 'dominant' :
    percentile >= 75 ? 'impressive' :
    percentile >= 60 ? 'solid' :
    percentile >= 45 ? 'serviceable' : 'rough'
  const erStr = er === 0 ? 'no earned runs' : er === 1 ? '1 earned run' : `${er} earned runs`
  const ksStr = ks === 1 ? '1 strikeout' : `${ks} strikeouts`
  const bbNote = bbs > 3 ? ` with ${bbs} walks issued` : ''
  const resultNote = gameResult.startsWith('W') ? 'picking up the win' :
    gameResult.startsWith('L') ? 'taking the loss' : 'in a no-decision'
  return `${name} turned in a ${quality} ${percentile}th-percentile outing against ${opponentAbbr} — going ${ipDisplay} innings, striking out ${ksStr}${bbNote}, and allowing ${erStr} on ${pitchCount} pitches${bbNote ? '' : `, ${resultNote}`}.`
}

export async function fetchGameBreakdown(
  gamePk: number,
  pitcherId: number,
  pitcherName: string,
  teamAbbr: string,
  opponentAbbr: string,
  ipDisplay: string,
  ks: number,
  bbs: number,
  hits: number,
  er: number,
  r: number,
  pitchCount: number,
  homeRuns: number,
  battersFaced: number,
  gameResult: string,
  dateDisplay: string,
  revalidate: number,
): Promise<GameBreakdown> {
  const ip = ipToDecimal(ipDisplay)

  const feedRes = await fetch(
    `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
    { next: { revalidate } },
  )

  const pitchPoints: PitchPoint[] = []
  let singles = 0, doubles = 0, triples = 0, homers = homeRuns

  if (feedRes.ok) {
    const feed = await feedRes.json()
    const allPlays: unknown[] = feed.liveData?.plays?.allPlays ?? []

    for (const play of allPlays as Record<string, unknown>[]) {
      const matchup = play.matchup as Record<string, unknown> | undefined
      if ((matchup?.pitcher as Record<string, unknown>)?.id !== pitcherId) continue

      const playResult = play.result as Record<string, string> | undefined
      const et = playResult?.eventType ?? ''
      if (et === 'single') singles++
      else if (et === 'double') doubles++
      else if (et === 'triple') triples++
      else if (et === 'home_run') homers++

      for (const event of (play.playEvents as Record<string, unknown>[]) ?? []) {
        if (!event.isPitch) continue
        const pd = event.pitchData as Record<string, Record<string, number>> | undefined
        const pX = pd?.coordinates?.pX
        const pZ = pd?.coordinates?.pZ
        if (pX == null || pZ == null) continue

        const details    = event.details as Record<string, unknown> | undefined
        const typeObj    = details?.type as Record<string, string> | undefined
        const pitchType  = typeObj?.code ?? ''
        const resultCode = (details?.code as string) ?? ''

        let pitchResult: PitchResult = 'ball'
        if (resultCode === 'C') {
          pitchResult = 'called_strike'
        } else if (resultCode === 'S' || resultCode === 'W' || resultCode === 'T') {
          pitchResult = 'swinging_strike'
        } else if (resultCode === 'F' || resultCode === 'L' || resultCode === 'O' || resultCode === 'M') {
          pitchResult = 'foul'
        } else if (CONTACT_CODES.has(resultCode)) {
          if (et === 'single') pitchResult = 'single'
          else if (et === 'double') pitchResult = 'double'
          else if (et === 'triple') pitchResult = 'triple'
          else if (et === 'home_run') pitchResult = 'home_run'
          else pitchResult = 'out'
        } else if (STRIKE_CODES.has(resultCode)) {
          pitchResult = 'swinging_strike'
        }

        pitchPoints.push({
          x: pX, z: pZ,
          type: pitchType,
          name: PITCH_NAMES[pitchType] ?? pitchType,
          color: PITCH_COLORS[pitchType] ?? '#6B7280',
          result: pitchResult,
        })
      }
    }
  }

  // OPS against
  const tb  = singles + doubles * 2 + triples * 3 + homers * 4
  const ab  = Math.max(battersFaced - bbs - 1, 1)
  const obp = Math.min((hits + bbs) / Math.max(ab + bbs, 1), 1)
  const slg = Math.min(tb / ab, 4)
  const ops = parseFloat((obp + slg).toFixed(3))

  // Pitch mix
  const pitchCounts: Record<string, { count: number; name: string; color: string }> = {}
  for (const p of pitchPoints) {
    if (!p.type) continue
    pitchCounts[p.type] ??= { count: 0, name: p.name, color: p.color }
    pitchCounts[p.type].count++
  }
  const totalTracked = Object.values(pitchCounts).reduce((s, v) => s + v.count, 0)
  const pitchMix = Object.entries(pitchCounts)
    .map(([type, v]) => ({
      type, name: v.name, count: v.count, color: v.color,
      pct: totalTracked > 0 ? Math.round((v.count / totalTracked) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  // Season context
  let eraPercentile = 50, k9Percentile = 50, seasonEra: number | null = null
  try {
    const pitchers = getPitchers()
    const local    = pitchers.find(p => p.player_id === pitcherId)
    if (local) {
      eraPercentile = local.era_percentile
      k9Percentile  = local.k9_percentile
      seasonEra     = local.era
    }
  } catch { /* unavailable */ }

  const gameScore  = computeGameScore(ip, ks, hits, bbs, er, r)
  const percentile = gameScoreToPercentile(gameScore)
  const blurb      = generateBlurb(pitcherName, percentile, ks, bbs, er, ipDisplay, opponentAbbr, gameResult, pitchCount)

  return {
    pitcherName, pitcherTeamAbbr: teamAbbr, playerId: pitcherId,
    ip, ipDisplay, ks, bbs, hits, er,
    totalPitches: pitchCount,
    ops, gameScore, percentile,
    pitches: pitchPoints, pitchMix,
    seasonEra, eraPercentile, k9Percentile,
    gameDate: dateDisplay, opponentAbbr, gameResult, blurb,
  }
}

// Fetch boxscore and return all pitchers (SP + RP) for a game, optionally filtered by team.
export async function fetchGameStarters(gamePk: number, filterTeamAbbr?: string) {
  const bsRes = await fetch(`${MLB_API}/game/${gamePk}/boxscore`, { next: { revalidate: 3600 } })
  if (!bsRes.ok) return []
  const bs = await bsRes.json()

  const pitchers: {
    pitcherId: number
    pitcherName: string
    teamAbbr: string
    opponentAbbr: string
    side: 'away' | 'home'
    role: 'SP' | 'RP'
    ipDisplay: string
    ks: number
    bbs: number
    hits: number
    er: number
    r: number
    pitchCount: number
    homeRuns: number
    battersFaced: number
    gameResult: string
  }[] = []

  for (const side of ['away', 'home'] as const) {
    const team        = bs.teams[side]
    const pitcherIds: number[] = team.pitchers ?? []
    if (!pitcherIds.length) continue

    const teamAbbr = (team.team?.abbreviation ?? '').toUpperCase()
    if (filterTeamAbbr && teamAbbr !== filterTeamAbbr.toUpperCase()) continue

    const oppSide  = side === 'away' ? 'home' : 'away'
    const oppAbbr  = (bs.teams[oppSide]?.team?.abbreviation ?? '').toUpperCase()
    const myScore  = side === 'away' ? (bs.teams.away?.teamStats?.batting?.runs ?? 0) : (bs.teams.home?.teamStats?.batting?.runs ?? 0)
    const oppScore = side === 'away' ? (bs.teams.home?.teamStats?.batting?.runs ?? 0) : (bs.teams.away?.teamStats?.batting?.runs ?? 0)
    const gameResult = myScore > oppScore ? `W ${myScore}-${oppScore}` : myScore < oppScore ? `L ${myScore}-${oppScore}` : `T ${myScore}-${oppScore}`

    for (let idx = 0; idx < pitcherIds.length; idx++) {
      const pid  = pitcherIds[idx]
      const pData = team.players?.[`ID${pid}`]
      if (!pData) continue

      const stats = pData.stats?.pitching
      if (!stats) continue
      if ((stats.numberOfPitches ?? 0) === 0) continue  // skip guys who didn't throw

      pitchers.push({
        pitcherId:    pid,
        pitcherName:  pData.person?.fullName ?? 'Unknown',
        teamAbbr,
        opponentAbbr: oppAbbr,
        side,
        role:         idx === 0 ? 'SP' : 'RP',
        ipDisplay:    stats.inningsPitched ?? '0.0',
        ks:           stats.strikeOuts     ?? 0,
        bbs:          stats.baseOnBalls    ?? 0,
        hits:         stats.hits           ?? 0,
        er:           stats.earnedRuns     ?? 0,
        r:            stats.runs           ?? 0,
        pitchCount:   stats.numberOfPitches ?? 0,
        homeRuns:     stats.homeRuns        ?? 0,
        battersFaced: stats.battersFaced    ?? 0,
        gameResult,
      })
    }
  }

  return pitchers
}
