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

const SWING_CODES = new Set(['S','W','T','F','X','D','E','L','M','O','Q','R'])
const WHIFF_CODES = new Set(['S','W','M','Q'])
const BATTED_EVENTS = new Set([
  'single','double','triple','home_run',
  'field_out','force_out','fielders_choice','fielders_choice_out',
  'grounded_into_double_play','double_play','triple_play','field_error',
  'sac_fly','sac_bunt','sac_fly_double_play',
])
const EXCLUDE_AB = new Set(['walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','catcher_interf'])
const RV_MAP: Record<string, number> = {
  walk: 0.33, intent_walk: 0.33, hit_by_pitch: 0.34,
  single: 0.47, double: 0.77, triple: 1.07, home_run: 1.40,
  strikeout: -0.30, strikeout_double_play: -0.57,
  grounded_into_double_play: -0.54, double_play: -0.54,
}

function rv(evt: string) { return RV_MAP[evt] ?? -0.27 }
function hits(evt: string) { return ['single','double','triple','home_run'].includes(evt) ? 1 : 0 }
function tb(evt: string) { return ({ single:1, double:2, triple:3, home_run:4 } as Record<string,number>)[evt] ?? 0 }
function isWalk(evt: string) { return evt==='walk' || evt==='intent_walk' || evt==='hit_by_pitch' }

interface Bucket {
  count: number; swings: number; whiffs: number; contact: number; hardContact: number
  rv_sum: number; pa: number; h: number; bb: number; ab: number; tb: number
}
// byPT[pitchType][pitcherHand]['balls-strikes'] = Bucket
type ByPT = Record<string, Record<string, Record<string, Bucket>>>

function add(
  map: ByPT, pt: string, hand: string, ck: string,
  sw: boolean, wh: boolean, co: boolean, hc: boolean,
  outcome: boolean, rvv: number, h: number, bb: number, ab: number, tbv: number
) {
  ;(map[pt] ??= {})
  ;(map[pt][hand] ??= {})
  ;(map[pt][hand][ck] ??= { count:0, swings:0, whiffs:0, contact:0, hardContact:0, rv_sum:0, pa:0, h:0, bb:0, ab:0, tb:0 })
  const b = map[pt][hand][ck]
  b.count++
  if (sw) b.swings++
  if (wh) b.whiffs++
  if (co) b.contact++
  if (hc) b.hardContact++
  if (outcome) { b.pa++; b.rv_sum += rvv; b.h += h; b.bb += bb; b.ab += ab; b.tb += tbv }
}

export async function GET(req: NextRequest) {
  const batterId = req.nextUrl.searchParams.get('batterId')
  const season   = req.nextUrl.searchParams.get('season') ?? String(new Date().getFullYear())
  if (!batterId) return NextResponse.json({ error: 'Missing batterId' }, { status: 400 })

  const logRes = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=1`,
    { next: { revalidate: 3600 } }
  )
  if (!logRes.ok) return NextResponse.json({ byPT: {}, pitchTypes: [] })

  const logData = await logRes.json()
  const splits  = (logData.stats?.[0]?.splits ?? []) as Array<{ game?: { gamePk?: number } }>
  const allPks  = splits.map(s => s.game?.gamePk).filter((pk): pk is number => !!pk)
  const gamePks = allPks.slice(-40)
  if (!gamePks.length) return NextResponse.json({ byPT: {}, pitchTypes: [] })

  const byPT: ByPT = {}
  const totals: Record<string, number> = {}

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
        if (Number((matchup?.batter as Record<string, unknown>)?.id) !== Number(batterId)) continue

        const pitchHand  = ((matchup?.pitchHand as Record<string, string>)?.code) ?? 'R'
        const resultEvt  = ((play.result as Record<string, unknown>)?.eventType as string) ?? ''
        const events     = (play.playEvents as Record<string, unknown>[]) ?? []

        let lastPitchIdx = -1
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].isPitch) { lastPitchIdx = i; break }
        }

        const isAb  = resultEvt && !EXCLUDE_AB.has(resultEvt)
        const hval  = hits(resultEvt)
        const tbval = tb(resultEvt)
        const bbval = isWalk(resultEvt) ? 1 : 0
        const abval = isAb ? 1 : 0
        const rvval = rv(resultEvt)

        // Track pre-pitch count: ev.count is the count AFTER the pitch result,
        // so the count for pitch i is the count from the previous pitch's ev.count.
        let preBalls = 0, preStrikes = 0

        for (let i = 0; i < events.length; i++) {
          const ev = events[i]
          if (!ev.isPitch) continue

          // Snapshot pre-pitch count before updating
          const ck = `${preBalls}-${preStrikes}`

          // Update for next pitch
          const cnt = ev.count as { balls?: number; strikes?: number } | undefined
          preBalls   = cnt?.balls   ?? preBalls
          preStrikes = cnt?.strikes ?? preStrikes

          const details = ev.details as Record<string, unknown> | undefined
          const pt      = ((details?.type as Record<string, string>)?.code) ?? ''
          if (!pt || pt === 'PO' || pt === 'IN' || pt === 'AB') continue

          const code    = (details?.code as string) ?? ''
          const isSwing = SWING_CODES.has(code)
          const isWhiff = isSwing && WHIFF_CODES.has(code)
          const isCont  = isSwing && !isWhiff

          let isHard = false
          const isOutcome = i === lastPitchIdx && !!resultEvt
          if (isOutcome && BATTED_EVENTS.has(resultEvt)) {
            const hit  = ev.hitData as Record<string, unknown> | undefined
            const spd  = hit?.launchSpeed as number | undefined
            const hard = hit?.hardness as string | undefined
            isHard = spd != null ? spd >= 95 : hard === 'Hard'
          }

          add(byPT, pt, pitchHand, ck, isSwing, isWhiff, isCont, isHard,
            isOutcome, isOutcome ? rvval : 0,
            isOutcome ? hval : 0, isOutcome ? bbval : 0,
            isOutcome ? abval : 0, isOutcome ? tbval : 0)
          totals[pt] = (totals[pt] ?? 0) + 1
        }
      }
    } catch { /* skip game */ }
  }))

  const pitchTypes = Object.entries(totals)
    .filter(([, c]) => c >= 10)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type, name: PITCH_NAMES[type] ?? type,
      color: PITCH_COLORS[type] ?? '#78909C', count,
    }))

  return NextResponse.json({ byPT, pitchTypes })
}
