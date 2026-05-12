// Live At-Bat model: blends per-pitcher arsenal and per-batter splits with
// league-wide count-conditioned tables. The count tables are MLB-wide multi-year
// averages (publicly known and very stable year-to-year), used as priors that
// nudge the pitcher's overall mix and effectiveness based on the current count.

import type { PitchArsenal, PitchVsStats } from './types'

export type Count = { balls: number; strikes: number }

export type PitchEvent =
  | 'ball'
  | 'called_strike'
  | 'swinging_strike'
  | 'foul'
  | 'in_play'
  | 'hbp'

// ── Pitch families ────────────────────────────────────────────────────────────
const FASTBALL = new Set(['FF', 'SI', 'FC', 'FT'])
const BREAKING = new Set(['SL', 'ST', 'SV', 'SW', 'CU', 'KC', 'CS'])
// everything else (CH, FS, FO, SC, KN, EP) treated as offspeed/other

type Family = 'FB' | 'BR' | 'OFF'
function pitchFamily(pt: string): Family {
  if (FASTBALL.has(pt)) return 'FB'
  if (BREAKING.has(pt)) return 'BR'
  return 'OFF'
}

// ── League count tables (MLB-wide multi-year averages) ───────────────────────
// Eventual PA outcome probability given the count was reached.
// Sources: aggregate of public MLB pitch-by-pitch data, FanGraphs/Tango count
// tables. These shift <1 pt year to year.
type Outcomes = { k: number; bb: number; hit: number; hbp: number; out: number }

const COUNT_OUTCOMES: Record<string, Outcomes> = {
  '0-0': { k: 0.226, bb: 0.082, hit: 0.247, hbp: 0.012, out: 0.433 },
  '1-0': { k: 0.175, bb: 0.128, hit: 0.266, hbp: 0.014, out: 0.417 },
  '2-0': { k: 0.122, bb: 0.238, hit: 0.290, hbp: 0.015, out: 0.335 },
  '3-0': { k: 0.065, bb: 0.490, hit: 0.300, hbp: 0.010, out: 0.135 },
  '0-1': { k: 0.290, bb: 0.057, hit: 0.218, hbp: 0.010, out: 0.425 },
  '1-1': { k: 0.248, bb: 0.088, hit: 0.235, hbp: 0.012, out: 0.417 },
  '2-1': { k: 0.190, bb: 0.155, hit: 0.255, hbp: 0.013, out: 0.387 },
  '3-1': { k: 0.105, bb: 0.352, hit: 0.270, hbp: 0.011, out: 0.262 },
  '0-2': { k: 0.460, bb: 0.025, hit: 0.155, hbp: 0.008, out: 0.352 },
  '1-2': { k: 0.415, bb: 0.044, hit: 0.179, hbp: 0.009, out: 0.353 },
  '2-2': { k: 0.355, bb: 0.084, hit: 0.198, hbp: 0.010, out: 0.353 },
  '3-2': { k: 0.270, bb: 0.220, hit: 0.215, hbp: 0.010, out: 0.285 },
}

// Pitch-family usage multipliers vs the pitcher's overall mix.
// 3-ball counts: more fastballs (must throw strikes). 2-strike counts:
// more breaking/offspeed (chase). 0-0 slight FB lean (get ahead).
const FAMILY_FACTOR: Record<string, Record<Family, number>> = {
  '0-0': { FB: 1.05, BR: 0.95, OFF: 0.95 },
  '1-0': { FB: 1.15, BR: 0.90, OFF: 0.90 },
  '2-0': { FB: 1.35, BR: 0.65, OFF: 0.60 },
  '3-0': { FB: 1.60, BR: 0.30, OFF: 0.35 },
  '0-1': { FB: 0.95, BR: 1.05, OFF: 1.05 },
  '1-1': { FB: 1.00, BR: 1.00, OFF: 1.00 },
  '2-1': { FB: 1.10, BR: 0.95, OFF: 0.90 },
  '3-1': { FB: 1.40, BR: 0.60, OFF: 0.60 },
  '0-2': { FB: 0.80, BR: 1.20, OFF: 1.15 },
  '1-2': { FB: 0.85, BR: 1.15, OFF: 1.10 },
  '2-2': { FB: 0.95, BR: 1.05, OFF: 1.05 },
  '3-2': { FB: 1.20, BR: 0.85, OFF: 0.90 },
}

// Whiff% multiplier vs the pitch's baseline whiff% in this count.
// 2-strike counts elevate (chase); 3-ball counts depress.
const WHIFF_MULT: Record<string, number> = {
  '0-0': 0.85, '1-0': 0.80, '2-0': 0.65, '3-0': 0.40,
  '0-1': 1.10, '1-1': 1.00, '2-1': 0.90, '3-1': 0.75,
  '0-2': 1.60, '1-2': 1.50, '2-2': 1.40, '3-2': 1.10,
}

// xwOBA delta vs the pitch's baseline xwOBA in this count.
// Hitter-favored counts add value; pitcher-favored counts subtract.
const XWOBA_DELTA: Record<string, number> = {
  '0-0': 0.00,  '1-0': 0.030, '2-0': 0.090, '3-0': 0.170,
  '0-1': -0.040, '1-1': -0.010, '2-1': 0.045, '3-1': 0.130,
  '0-2': -0.130, '1-2': -0.100, '2-2': -0.050, '3-2': 0.060,
}

// ── Count helpers ─────────────────────────────────────────────────────────────
export function countKey(c: Count): string {
  return `${c.balls}-${c.strikes}`
}

export function advanceCount(c: Count, ev: PitchEvent): Count {
  switch (ev) {
    case 'ball':
      return c.balls < 3 ? { balls: c.balls + 1, strikes: c.strikes } : c
    case 'called_strike':
    case 'swinging_strike':
      return c.strikes < 2 ? { balls: c.balls, strikes: c.strikes + 1 } : c
    case 'foul':
      return c.strikes < 2 ? { balls: c.balls, strikes: c.strikes + 1 } : c
    case 'in_play':
    case 'hbp':
      return c // at-bat ends; caller resets
  }
}

// PA terminates when ball would become 4th, strike would become 3rd, or in_play/hbp.
export function endsAtBat(c: Count, ev: PitchEvent): boolean {
  if (ev === 'in_play' || ev === 'hbp') return true
  if (ev === 'ball' && c.balls >= 3) return true
  if ((ev === 'called_strike' || ev === 'swinging_strike') && c.strikes >= 2) return true
  return false
}

// ── Main computation ──────────────────────────────────────────────────────────
export interface PitchPrediction {
  pitch_type: string
  pitch_name: string
  probability: number          // normalized P(this pitch | count, pitcher) in [0,1]
  base_usage_pct: number       // pitcher's overall usage (raw)
  whiff_pct: number | null     // count-adjusted whiff%, blended w/ batter if provided
  xwoba: number | null         // count-adjusted xwOBA against, blended w/ batter
  batter_xwoba: number | null  // batter's xwOBA vs this pitch type (raw), if available
  is_signature: boolean        // whether this is the pitcher's top weapon
}

export interface AtBatPrediction {
  pitches: PitchPrediction[]
  outcome: Outcomes            // adjusted for pitcher K%/BB% rates if provided
  baseOutcome: Outcomes        // raw league outcome for this count
}

interface PitcherRates {
  // Pitcher's season K% and BB% as decimals, used to nudge outcome probs.
  k_pct?: number | null
  bb_pct?: number | null
}

interface BatterRates {
  k_pct?: number | null
  bb_pct?: number | null
}

function blend(a: number | null, b: number | null, weightA = 0.5): number | null {
  if (a === null && b === null) return null
  if (a === null) return b
  if (b === null) return a
  return a * weightA + b * (1 - weightA)
}

// ── Sequence (in-AB) conditioning ────────────────────────────────────────────
// Tunneling/contrast effects from pitch sequencing. Values are heuristics
// grounded in published research on pitch tunneling (whiff% lifts of ~5-10%
// after a family switch, ~10-15% whiff drop on a repeated pitch). They scale
// the per-pitch whiff% and xwOBA in addition to the count adjustment.
interface SequenceAdjust {
  whiffMult: number   // multiplies count-adjusted whiff%
  xwobaDelta: number  // adds to count-adjusted xwOBA
}

function sequenceAdjustFor(
  pitchType: string,
  pitchesThrown: string[],
): SequenceAdjust {
  if (pitchesThrown.length === 0) return { whiffMult: 1, xwobaDelta: 0 }

  const fam = pitchFamily(pitchType)
  const prevTypes = pitchesThrown
  const lastFam = pitchFamily(prevTypes[prevTypes.length - 1])

  // Repetition: how many times this exact pitch has already been thrown
  const repeats = prevTypes.filter((t) => t === pitchType).length
  // Family streak: how many consecutive prior pitches share this pitch's family
  let streak = 0
  for (let i = prevTypes.length - 1; i >= 0; i--) {
    if (pitchFamily(prevTypes[i]) === fam) streak++
    else break
  }

  let whiffMult = 1
  let xwobaDelta = 0

  // Each prior occurrence of the same pitch type: -10% whiff, +0.025 xwOBA
  // Capped at 3 repeats so it doesn't blow up in long ABs.
  const repPenalty = Math.min(repeats, 3)
  whiffMult *= Math.pow(0.90, repPenalty)
  xwobaDelta += 0.025 * repPenalty

  // Family-switch bonus when the previous pitch was a different family:
  // breaking after fastball (or vice versa) creates timing disruption.
  if (lastFam !== fam) {
    whiffMult *= 1.08
    xwobaDelta -= 0.020
    // Extra bonus for big velocity contrast: FB ↔ OFF (offspeed) is the
    // canonical pairing (fastball / changeup tunnel).
    if ((lastFam === 'FB' && fam === 'OFF') || (lastFam === 'OFF' && fam === 'FB')) {
      whiffMult *= 1.04
      xwobaDelta -= 0.010
    }
  }

  // Same-family streak penalty: 3+ in a row of one family → batter is locked
  // on that look. Apply mild penalty to *next same-family pitch*.
  if (streak >= 3 && lastFam === fam) {
    whiffMult *= 0.92
    xwobaDelta += 0.020
  }

  return { whiffMult, xwobaDelta }
}

export function predict(
  arsenal: PitchArsenal[],
  count: Count,
  batterVsPitch: PitchVsStats[] | null,
  pitcherRates?: PitcherRates,
  batterRates?: BatterRates,
  pitchesThrown: string[] = [],  // ordered pitch_types thrown in this AB so far
): AtBatPrediction {
  const key = countKey(count)
  const familyFactor = FAMILY_FACTOR[key] ?? { FB: 1, BR: 1, OFF: 1 }
  const whiffMult = WHIFF_MULT[key] ?? 1
  const xwobaDelta = XWOBA_DELTA[key] ?? 0

  // 1) Compute count-adjusted usage weight per pitch.
  // Also down-weight pitches that have been thrown a lot in this AB —
  // pitchers vary their mix to stay unpredictable.
  const weights = arsenal.map((p) => {
    const fam = pitchFamily(p.pitch_type)
    const base = (p.usage_pct ?? 0) / 100
    const repeats = pitchesThrown.filter((t) => t === p.pitch_type).length
    const repShift = Math.pow(0.80, repeats) // each repeat drops usage 20%
    return Math.max(0, base * familyFactor[fam] * repShift)
  })
  const total = weights.reduce((s, w) => s + w, 0) || 1

  // 2) Build predictions, blending batter splits when present.
  const batterMap = new Map<string, PitchVsStats>()
  if (batterVsPitch) for (const v of batterVsPitch) batterMap.set(v.pitch_type, v)

  const topUsage = Math.max(...arsenal.map((p) => p.usage_pct ?? 0))

  const pitches: PitchPrediction[] = arsenal.map((p, i) => {
    const v = batterMap.get(p.pitch_type) ?? null
    const seqAdj = sequenceAdjustFor(p.pitch_type, pitchesThrown)
    // Whiff: count-adjust pitcher's base, blended w/ batter, then apply sequence multiplier.
    const pWhiff = p.whiff_pct !== null ? p.whiff_pct * whiffMult : null
    const whiffCount = v && v.whiff_pct !== null ? blend(pWhiff, v.whiff_pct * whiffMult, 0.6) : pWhiff
    const whiff = whiffCount !== null ? whiffCount * seqAdj.whiffMult : null
    // xwOBA: count delta + sequence delta on top of pitcher (blended w/ batter).
    const pXwoba = p.xwoba_against !== null ? p.xwoba_against + xwobaDelta : null
    const xwobaCount = v && v.xwoba !== null ? blend(pXwoba, v.xwoba + xwobaDelta, 0.6) : pXwoba
    const xwoba = xwobaCount !== null ? xwobaCount + seqAdj.xwobaDelta : null

    return {
      pitch_type: p.pitch_type,
      pitch_name: p.pitch_name,
      probability: weights[i] / total,
      base_usage_pct: p.usage_pct ?? 0,
      whiff_pct: whiff,
      xwoba,
      batter_xwoba: v?.xwoba ?? null,
      is_signature: (p.usage_pct ?? 0) === topUsage && topUsage > 0,
    }
  })

  pitches.sort((a, b) => b.probability - a.probability)

  // 3) Outcome probabilities from league count table, nudged by pitcher/batter K/BB rates.
  const base = COUNT_OUTCOMES[key]
  const leagueK = 0.226, leagueBB = 0.082
  const pK_ratio =
    ((pitcherRates?.k_pct ?? leagueK) / leagueK) *
    ((batterRates?.k_pct ?? leagueK) / leagueK)
  const pBB_ratio =
    ((pitcherRates?.bb_pct ?? leagueBB) / leagueBB) *
    ((batterRates?.bb_pct ?? leagueBB) / leagueBB)

  // Apply ratios (sqrt to dampen so we don't blow past 1.0), then renormalize.
  const k = base.k * Math.sqrt(pK_ratio)
  const bb = base.bb * Math.sqrt(pBB_ratio)
  const hit = base.hit
  const hbp = base.hbp
  const out = base.out
  const sum = k + bb + hit + hbp + out
  const outcome: Outcomes = {
    k: k / sum,
    bb: bb / sum,
    hit: hit / sum,
    hbp: hbp / sum,
    out: out / sum,
  }

  return { pitches, outcome, baseOutcome: base }
}
