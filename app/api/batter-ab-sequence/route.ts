import { NextRequest, NextResponse } from 'next/server'
import { PITCH_COLORS } from '../../../lib/pitchColors'

export const dynamic = 'force-dynamic'

const PITCH_NAMES: Record<string, string> = {
  FF: '4-Seam FB', SI: 'Sinker', FC: 'Cutter', FT: '2-Seam FB',
  SL: 'Slider', ST: 'Sweeper', SV: 'Slurve', SW: 'Slow Curve',
  CU: 'Curveball', KC: 'Knuckle Curve',
  CH: 'Changeup', FS: 'Splitter', FO: 'Forkball', SC: 'Screwball',
  KN: 'Knuckleball', EP: 'Eephus',
}

// Swing = any pitch where the batter offered
const SWING_CODES = new Set(['S','W','T','F','X','D','E','L','M','O','Q','R'])
// Whiff = swing and miss (no contact)
const WHIFF_CODES = new Set(['S','W','M','Q'])
// Batted ball events = ball put in play (for hard contact denominator)
const BATTED_EVENTS = new Set([
  'single', 'double', 'triple', 'home_run',
  'field_out', 'force_out', 'fielders_choice', 'fielders_choice_out',
  'grounded_into_double_play', 'double_play', 'triple_play', 'field_error',
  'sac_fly', 'sac_bunt', 'sac_fly_double_play',
])

export type BatterSeqBucket = { count: number; swings: number; contact: number; hardContact: number }
type AggMap = Record<string, Record<string, BatterSeqBucket>>

function addPitch(map: AggMap, key: string, pt: string, isSwing: boolean, isContact: boolean, isHard: boolean) {
  map[key] ??= {}
  map[key][pt] ??= { count: 0, swings: 0, contact: 0, hardContact: 0 }
  map[key][pt].count++
  if (isSwing) map[key][pt].swings++
  if (isContact) map[key][pt].contact++
  if (isHard) map[key][pt].hardContact++
}

// GET /api/batter-ab-sequence?batterId=592450&season=2025
export async function GET(req: NextRequest) {
  const batterId = req.nextUrl.searchParams.get('batterId')
  const season = req.nextUrl.searchParams.get('season') ?? String(new Date().getFullYear())
  if (!batterId) return NextResponse.json({ error: 'Missing batterId' }, { status: 400 })

  const logRes = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=1`,
    { next: { revalidate: 3600 } }
  )
  if (!logRes.ok) return NextResponse.json({ byAbPitch: {}, pitchTypes: [] })

  const logData = await logRes.json()
  const splits = (logData.stats?.[0]?.splits ?? []) as Array<{ game?: { gamePk?: number } }>
  const allPks = splits.map(s => s.game?.gamePk).filter((pk): pk is number => !!pk)
  const gamePks = allPks.slice(-40) // last 40 games

  if (!gamePks.length) return NextResponse.json({ byAbPitch: {}, pitchTypes: [] })

  const byAbPitch: AggMap = {}
  const pitchTypeTotals: Record<string, number> = {}

  await Promise.all(gamePks.map(async gamePk => {
    try {
      const feedRes = await fetch(
        `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
        { next: { revalidate: 86400 * 30 } }
      )
      if (!feedRes.ok) return
      const feed = await feedRes.json()
      const allPlays = (feed.liveData?.plays?.allPlays ?? []) as Record<string, unknown>[]

      for (const play of allPlays) {
        const matchup = play.matchup as Record<string, unknown> | undefined
        const batterIdInPlay = (matchup?.batter as Record<string, unknown>)?.id
        if (Number(batterIdInPlay) !== Number(batterId)) continue

        const playEventType = ((play.result as Record<string, unknown>)?.eventType as string) ?? ''
        const events = (play.playEvents as Record<string, unknown>[]) ?? []

        // Find last pitch event (outcome pitch)
        let lastPitchIdx = -1
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].isPitch) { lastPitchIdx = i; break }
        }

        for (let i = 0; i < events.length; i++) {
          const ev = events[i]
          if (!ev.isPitch) continue

          const details = ev.details as Record<string, unknown> | undefined
          const pt = ((details?.type as Record<string, string>)?.code) ?? ''
          if (!pt || pt === 'PO' || pt === 'IN' || pt === 'AB') continue

          const pitchNum = (ev.pitchNumber as number) ?? 0
          const resultCode = (details?.code as string) ?? ''
          const isSwing = SWING_CODES.has(resultCode)
          const isContact = isSwing && !WHIFF_CODES.has(resultCode)

          // Hard contact: only on outcome pitch with a batted ball event
          let isHard = false
          if (i === lastPitchIdx && BATTED_EVENTS.has(playEventType)) {
            const hitData = ev.hitData as Record<string, unknown> | undefined
            const launchSpeed = hitData?.launchSpeed as number | undefined
            const hardness = hitData?.hardness as string | undefined
            if (launchSpeed != null) {
              isHard = launchSpeed >= 95
            } else if (hardness) {
              isHard = hardness === 'Hard'
            }
          }

          const abKey = pitchNum >= 8 ? '8+' : String(pitchNum)
          addPitch(byAbPitch, abKey, pt, isSwing, isContact, isHard)
          pitchTypeTotals[pt] = (pitchTypeTotals[pt] ?? 0) + 1
        }
      }
    } catch { /* skip game */ }
  }))

  const pitchTypes = Object.entries(pitchTypeTotals)
    .filter(([, count]) => count >= 10)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      name: PITCH_NAMES[type] ?? type,
      color: PITCH_COLORS[type] ?? '#78909C',
      count,
    }))

  return NextResponse.json({ byAbPitch, pitchTypes })
}
