import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const PITCH_NAMES: Record<string, string> = {
  FF: '4-Seam Fastball', SI: 'Sinker', FC: 'Cutter', FT: '2-Seam',
  SL: 'Slider', ST: 'Sweeper', SV: 'Slurve', SW: 'Slow Curve',
  CU: 'Curveball', KC: 'Knuckle Curve',
  CH: 'Changeup', FS: 'Splitter', FO: 'Forkball', SC: 'Screwball',
  KN: 'Knuckleball', EP: 'Eephus',
}
const PITCH_COLORS: Record<string, string> = {
  FF: '#EF4444', SI: '#F97316', FC: '#F59E0B', FT: '#FB923C',
  SL: '#3B82F6', ST: '#6366F1', SV: '#7C3AED', SW: '#A855F7',
  CU: '#1D4ED8', KC: '#1E3A8A',
  CH: '#10B981', FS: '#059669', FO: '#047857', SC: '#065F46',
  KN: '#64748B', EP: '#94A3B8',
}

// MLB result codes → outcome category
const WHIFF_CODES  = new Set(['S', 'W', 'T', 'M', 'O', 'Q', 'R'])
const STRIKE_CODES = new Set(['S', 'W', 'T', 'C', 'F', 'L', 'M', 'O', 'Q', 'R', 'U'])

type PitchBucket = { count: number; whiffs: number; strikes: number }
type AggMap = Record<string, Record<string, PitchBucket>>

function add(map: AggMap, key: string, pt: string, isWhiff: boolean, isStrike: boolean) {
  map[key] ??= {}
  map[key][pt] ??= { count: 0, whiffs: 0, strikes: 0 }
  map[key][pt].count++
  if (isWhiff) map[key][pt].whiffs++
  if (isStrike) map[key][pt].strikes++
}

function gamePitchBucket(n: number): string {
  if (n <= 15) return '1-15'
  if (n <= 30) return '16-30'
  if (n <= 45) return '31-45'
  if (n <= 60) return '46-60'
  if (n <= 75) return '61-75'
  if (n <= 90) return '76-90'
  return '91+'
}

type RawPitch = { pt: string; abNum: number; pitchNum: number; isWhiff: boolean; isStrike: boolean; inning: number }

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const pitcherId = url.searchParams.get('pitcherId')
  const season = url.searchParams.get('season') ?? new Date().getFullYear()
  if (!pitcherId) return NextResponse.json({ error: 'Missing pitcherId' }, { status: 400 })

  // Step 1: get list of gamePks from season game log
  const logRes = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=1`,
    { next: { revalidate: 3600 } }
  )
  if (!logRes.ok) return NextResponse.json({ byAbPitch: {}, byInning: {}, byGamePitch: {}, pitchTypes: [] })

  const logData = await logRes.json()
  const splits = (logData.stats?.[0]?.splits ?? []) as Array<{ game?: { gamePk?: number } }>
  const gamePks = splits.map(s => s.game?.gamePk).filter((pk): pk is number => !!pk)

  if (gamePks.length === 0) return NextResponse.json({ byAbPitch: {}, byInning: {}, byGamePitch: {}, pitchTypes: [] })

  const byAbPitch: AggMap = {}
  const byInning: AggMap = {}
  const byGamePitch: AggMap = {}
  const pitchTypeTotals: Record<string, number> = {}

  // Step 2: fetch each game's live feed in parallel (past games cached 30 days)
  const recentCutoff = Date.now() - 7 * 86400 * 1000
  await Promise.all(gamePks.map(async gamePk => {
    try {
      // Determine revalidate based on whether game is recent
      const revalidate = recentCutoff > 0 ? 86400 * 30 : 3600
      const feedRes = await fetch(
        `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
        { next: { revalidate } }
      )
      if (!feedRes.ok) return

      const feed = await feedRes.json()
      const allPlays = (feed.liveData?.plays?.allPlays ?? []) as Record<string, unknown>[]

      const gamePitches: RawPitch[] = []

      for (const play of allPlays) {
        const matchup = play.matchup as Record<string, unknown> | undefined
        const pitcherIdInPlay = (matchup?.pitcher as Record<string, unknown>)?.id
        if (Number(pitcherIdInPlay) !== Number(pitcherId)) continue

        const about = play.about as Record<string, unknown> | undefined
        const inning = (about?.inning as number) ?? 0
        const abNum = (about?.atBatIndex as number) ?? 0

        for (const event of (play.playEvents as Record<string, unknown>[]) ?? []) {
          if (!event.isPitch) continue
          const details = event.details as Record<string, unknown> | undefined
          const typeObj = details?.type as Record<string, string> | undefined
          const pt = typeObj?.code ?? ''
          if (!pt || pt === 'PO' || pt === 'IN' || pt === 'AB') continue

          const pitchNum = (event.pitchNumber as number) ?? 0
          const resultCode = (details?.code as string) ?? ''
          const isWhiff = WHIFF_CODES.has(resultCode)
          const isStrike = STRIKE_CODES.has(resultCode)

          gamePitches.push({ pt, abNum, pitchNum, isWhiff, isStrike, inning })
          pitchTypeTotals[pt] = (pitchTypeTotals[pt] ?? 0) + 1

          const abKey = pitchNum >= 8 ? '8+' : String(pitchNum)
          add(byAbPitch, abKey, pt, isWhiff, isStrike)

          if (inning >= 1 && inning <= 15) add(byInning, String(inning), pt, isWhiff, isStrike)
        }
      }

      // Sort by (atBatIndex, pitchNumber) → sequential game pitch number
      gamePitches.sort((a, b) => a.abNum - b.abNum || a.pitchNum - b.pitchNum)
      gamePitches.forEach((p, idx) => {
        add(byGamePitch, gamePitchBucket(idx + 1), p.pt, p.isWhiff, p.isStrike)
      })
    } catch { /* skip failed game */ }
  }))

  const pitchTypes = Object.entries(pitchTypeTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, name: PITCH_NAMES[type] ?? type, color: PITCH_COLORS[type] ?? '#6B7280', count }))

  return NextResponse.json({ byAbPitch, byInning, byGamePitch, pitchTypes })
}
