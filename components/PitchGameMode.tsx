'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { PitcherArsenal, PitchArsenal } from '../lib/types'
import type { SelectedPitch } from './PitchVisualizer'
import type { BallUpdateCb } from './PitchAnimation3D'
import DailyLeaderboard from './DailyLeaderboard'
import {
  computeSlashLine,
  isCleanName,
  useDailyLeaderboard,
  MIN_AB,
} from '../lib/dailyLeaderboard'

const PitchAnimation3D = dynamic(() => import('./PitchAnimation3D'), { ssr: false })

// ── Colors ────────────────────────────────────────────────────────────────────
const PITCH_COLORS: Record<string, string> = {
  FF: '#C62828', SI: '#E64A19', FC: '#F57C00',
  SL: '#1565C0', ST: '#6A1B9A', SV: '#7B1FA2',
  CU: '#283593', KC: '#37474F',
  CH: '#2E7D32', FS: '#00695C',
  KN: '#546E7A', EP: '#78909C',
}
const pitchColor = (pt: string) => PITCH_COLORS[pt] ?? '#888'

// ── Strike zone (inches from plate center) ───────────────────────────────────
const ZONE_X_HALF = 8.5     // plate width / 2
const ZONE_BOT = 18         // ~knees
const ZONE_TOP = 42         // ~letters

// ── Helpers ──────────────────────────────────────────────────────────────────
function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function randNorm(mean: number, sd: number) {
  // Box-Muller
  const u = 1 - Math.random()
  const v = 1 - Math.random()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function inferHand(arsenal: PitchArsenal[]): 'R' | 'L' {
  for (const p of arsenal) {
    if (['FF', 'SI', 'CH'].includes(p.pitch_type) && p.break_x !== null) {
      return p.break_x >= 0 ? 'R' : 'L'
    }
  }
  return 'R'
}

// Pick a pitch from arsenal weighted by usage_pct.
function pickArsenalPitch(arsenal: PitchArsenal[]): PitchArsenal | null {
  const eligible = arsenal.filter((p) => (p.usage_pct ?? 0) > 0)
  if (eligible.length === 0) return null
  const totalWeight = eligible.reduce((s, p) => s + (p.usage_pct ?? 0), 0)
  let r = Math.random() * totalWeight
  for (const p of eligible) {
    r -= p.usage_pct ?? 0
    if (r <= 0) return p
  }
  return eligible[eligible.length - 1]
}

// Location distribution driven by the pitcher's real zone_pct (derived from
// BB/9). A control artist hits the zone ~54 % of the time; a wild pitcher
// only ~36 %. Within each zone/ball split the shape of where the pitch lands
// stays the same — it's only the overall in/out ratio that changes.
function generateLocation(
  zonePct = 0.48, // fallback = league-average control
): { x: number; y: number; inZone: boolean; wild: boolean } {
  if (Math.random() < zonePct) {
    // ── In zone ──────────────────────────────────────────────────────────────
    if (Math.random() < 0.25) {
      // Heart of the plate (~25 % of in-zone pitches)
      return { x: rand(-4, 4), y: rand(24, 36), inZone: true, wild: false }
    }
    // Edge of zone (~75 % of in-zone pitches) — pick one of four borders
    const edge = Math.floor(Math.random() * 4) // 0=top 1=bot 2=glove 3=arm
    let x: number, y: number
    if (edge === 0) {
      x = rand(-ZONE_X_HALF, ZONE_X_HALF); y = rand(ZONE_TOP - 4, ZONE_TOP)
    } else if (edge === 1) {
      x = rand(-ZONE_X_HALF, ZONE_X_HALF); y = rand(ZONE_BOT, ZONE_BOT + 4)
    } else if (edge === 2) {
      x = rand(-ZONE_X_HALF, -ZONE_X_HALF + 3); y = rand(ZONE_BOT, ZONE_TOP)
    } else {
      x = rand(ZONE_X_HALF - 3, ZONE_X_HALF); y = rand(ZONE_BOT, ZONE_TOP)
    }
    return { x, y, inZone: true, wild: false }
  }

  // ── Out of zone ───────────────────────────────────────────────────────────
  const r = Math.random()
  if (r < 0.72) {
    // Chase: just off the corner — the most common ball location
    const side = Math.floor(Math.random() * 4)
    let x: number, y: number
    if (side === 0) {
      x = rand(-ZONE_X_HALF - 5, ZONE_X_HALF + 5); y = rand(ZONE_TOP, ZONE_TOP + 5)
    } else if (side === 1) {
      x = rand(-ZONE_X_HALF - 5, ZONE_X_HALF + 5); y = rand(ZONE_BOT - 5, ZONE_BOT)
    } else if (side === 2) {
      x = rand(-ZONE_X_HALF - 5, -ZONE_X_HALF); y = rand(ZONE_BOT, ZONE_TOP)
    } else {
      x = rand(ZONE_X_HALF, ZONE_X_HALF + 5); y = rand(ZONE_BOT, ZONE_TOP)
    }
    return { x, y, inZone: false, wild: false }
  }
  if (r < 0.95) {
    // Way off — clearly a ball
    return { x: rand(-18, 18), y: rand(10, 50), inZone: false, wild: false }
  }
  // Wild pitch
  return { x: rand(-22, 22), y: rand(0, 56), inZone: false, wild: true }
}

function isInZone(loc: { x: number; y: number }): boolean {
  return (
    loc.x >= -ZONE_X_HALF &&
    loc.x <= ZONE_X_HALF &&
    loc.y >= ZONE_BOT &&
    loc.y <= ZONE_TOP
  )
}

// ── Contact model ────────────────────────────────────────────────────────────
type ContactQuality = 'miss' | 'weak' | 'fair' | 'solid' | 'perfect'

function classifyContact(distPx: number, sweetPx: number, weakPx: number): ContactQuality {
  if (distPx > weakPx) return 'miss'
  if (distPx > sweetPx * 1.8) return 'weak'
  if (distPx > sweetPx) return 'fair'
  if (distPx > sweetPx * 0.4) return 'solid'
  return 'perfect'
}

function contactRating(distPx: number, sweetPx: number, weakPx: number): number {
  // 0..1, 1 = perfect, 0 = miss
  if (distPx >= weakPx) return 0
  return clamp(1 - distPx / weakPx, 0, 1)
}

// 0..1 contact rating → letter grade (A+ down to F).
function gradeFromRating(r: number): { letter: string; color: string } {
  if (r >= 0.92) return { letter: 'A+', color: '#1F8C3A' }
  if (r >= 0.80) return { letter: 'A',  color: '#2E7D32' }
  if (r >= 0.70) return { letter: 'B',  color: '#558B6E' }
  if (r >= 0.55) return { letter: 'C',  color: '#F57C00' }
  if (r >= 0.35) return { letter: 'D',  color: '#E64A19' }
  return { letter: 'F', color: '#C62828' }
}

type InPlayOutcome = 'HR' | '3B' | '2B' | '1B' | 'OUT' | 'FOUL'

// ── Statcast outcome model ────────────────────────────────────────────────────
//
// Two-factor model built from the full per-degree LA table and per-mph EV
// table provided by Baseball Savant.
//
// LA BINS (5° wide, sorted descending so first-match wins in find()).
// Values are absolute P(outcome) at league-average EV (~87 mph), aggregated
// by averaging the per-degree rows from the Statcast LA table.
// P(out) = 1 − (p1B + p2B + p3B + pHR).
const LA_BINS: { min: number; p1B: number; p2B: number; p3B: number; pHR: number }[] = [
  // ── Popup / near-vertical ────────────────────────────────────────────────
  { min:  65, p1B: 0.001, p2B: 0.001, p3B: 0.000, pHR: 0.000 }, // popup, ~0% hit
  { min:  60, p1B: 0.004, p2B: 0.006, p3B: 0.000, pHR: 0.000 }, // ~1%
  { min:  55, p1B: 0.008, p2B: 0.014, p3B: 0.000, pHR: 0.000 }, // ~2%
  { min:  50, p1B: 0.020, p2B: 0.015, p3B: 0.000, pHR: 0.000 }, // ~3.5%
  // ── High fly balls ───────────────────────────────────────────────────────
  { min:  45, p1B: 0.031, p2B: 0.011, p3B: 0.001, pHR: 0.004 }, // ~4.7%
  { min:  40, p1B: 0.038, p2B: 0.013, p3B: 0.001, pHR: 0.021 }, // ~7.3%
  // ── Deep fly / HR zone ───────────────────────────────────────────────────
  { min:  35, p1B: 0.049, p2B: 0.017, p3B: 0.003, pHR: 0.092 }, // ~16%
  { min:  30, p1B: 0.066, p2B: 0.033, p3B: 0.007, pHR: 0.193 }, // ~30%
  // ── Barrel / power zone ──────────────────────────────────────────────────
  { min:  25, p1B: 0.091, p2B: 0.092, p3B: 0.014, pHR: 0.235 }, // ~43%  peak HR
  { min:  20, p1B: 0.172, p2B: 0.190, p3B: 0.015, pHR: 0.127 }, // ~50%  lots of 2B
  // ── Line drive zone ──────────────────────────────────────────────────────
  { min:  15, p1B: 0.377, p2B: 0.214, p3B: 0.012, pHR: 0.014 }, // ~62%
  { min:  10, p1B: 0.613, p2B: 0.148, p3B: 0.010, pHR: 0.000 }, // ~77%  peak AVG
  { min:   5, p1B: 0.480, p2B: 0.071, p3B: 0.003, pHR: 0.000 }, // ~55%
  // ── Flat / ground-ball zone ──────────────────────────────────────────────
  { min:   0, p1B: 0.365, p2B: 0.044, p3B: 0.002, pHR: 0.001 }, // ~41%
  { min:  -5, p1B: 0.262, p2B: 0.024, p3B: 0.000, pHR: 0.000 }, // ~29%
  { min: -10, p1B: 0.196, p2B: 0.014, p3B: 0.001, pHR: 0.001 }, // ~21%
  { min: -15, p1B: 0.126, p2B: 0.010, p3B: 0.001, pHR: 0.000 }, // ~14%
  { min: -20, p1B: 0.100, p2B: 0.006, p3B: 0.002, pHR: 0.000 }, // ~11%
  { min: -25, p1B: 0.061, p2B: 0.008, p3B: 0.000, pHR: 0.000 }, // ~7%
  { min: -30, p1B: 0.052, p2B: 0.004, p3B: 0.002, pHR: 0.000 }, // ~6%
  // ── Extreme downswing (chopper) — high-bounce, hard to field ─────────────
  { min: -90, p1B: 0.090, p2B: 0.003, p3B: 0.001, pHR: 0.000 }, // ~9%
]

// EV multiplier: scales P(hit) up or down relative to the ~87 mph baseline
// baked into the LA table. Derived from the Statcast per-mph EV table, but
// dampened (~60%) to correct for the LA/EV correlation in raw MLB data —
// in real at-bats, hard-hit balls also tend to have better launch angles,
// inflating the raw EV effect. In our model EV and LA are independent, so
// applying the raw effect would overstate it.
function evHitMult(ev: number): number {
  if (ev >= 110) return 1.65
  if (ev >= 105) return 1.45
  if (ev >= 100) return 1.25
  if (ev >=  95) return 1.12
  if (ev >=  90) return 1.04
  if (ev >=  85) return 1.00 // baseline
  if (ev >=  80) return 0.93
  if (ev >=  75) return 0.84
  if (ev >=  70) return 0.74
  if (ev >=  65) return 0.63
  if (ev >=  60) return 0.52
  return 0.40
}

function statcastOutcome(ev: number, la: number): InPlayOutcome {
  // Find the matching LA bin (sorted descending, first match wins)
  const row = LA_BINS.find(b => la >= b.min) ?? LA_BINS[LA_BINS.length - 1]

  const pHitBase = row.p1B + row.p2B + row.p3B + row.pHR
  if (pHitBase <= 0) return 'OUT'

  // Scale overall P(hit) by EV factor; preserve hit-type ratios from LA
  const pHit  = Math.min(0.98, pHitBase * evHitMult(ev))
  const scale = pHit / pHitBase

  const p1B  = row.p1B * scale
  const p2B  = row.p2B * scale
  const p3B  = row.p3B * scale
  const pHR  = row.pHR * scale
  const pOut = 1 - pHit

  const r = Math.random()
  if (r < pOut)              return 'OUT'
  if (r < pOut + p1B)        return '1B'
  if (r < pOut + p1B + p2B)  return '2B'
  if (r < pOut + p1B + p2B + p3B) return '3B'
  return 'HR'
}

interface ContactResult {
  quality: ContactQuality
  rating: number      // 0..1
  ev: number          // mph
  la: number          // degrees
  distFt: number      // approx flight distance
  outcome: InPlayOutcome
  description: string
}

function resolveContact(distPx: number, sweetPx: number, weakPx: number): ContactResult {
  const quality = classifyContact(distPx, sweetPx, weakPx)
  const rating = contactRating(distPx, sweetPx, weakPx)

  // EV + LA bands by quality
  let ev: number, la: number
  switch (quality) {
    case 'perfect':
      ev = randNorm(106, 4)
      la = randNorm(26, 5)
      break
    case 'solid':
      ev = randNorm(98, 5)
      la = randNorm(18, 8)
      break
    case 'fair':
      ev = randNorm(85, 7)
      la = randNorm(12, 18)
      break
    case 'weak':
      ev = randNorm(70, 8)
      // weak contact is either popup (high LA) or squibber (low/neg LA)
      la = Math.random() < 0.5 ? randNorm(55, 10) : randNorm(-5, 8)
      break
    default:
      ev = 0
      la = 0
  }
  ev = clamp(ev, 0, 120)
  la = clamp(la, -30, 80)

  // Distance estimate (rough): EV * 4.5 * sin(2·LA) — peaks at 45° LA
  const laRad = (la * Math.PI) / 180
  const distFt = clamp((ev * ev * Math.sin(2 * laRad)) / 25, 0, 480)

  // Outcome from Statcast EV × LA probability table (2024 MLB data).
  const outcome: InPlayOutcome = quality === 'miss' ? 'OUT' : statcastOutcome(ev, la)

  // Human-readable description based on outcome + contact shape.
  let description: string
  switch (outcome) {
    case 'HR':  description = 'Home run!'; break
    case '3B':  description = 'Triple!'; break
    case '2B':  description = 'Double'; break
    case '1B':
      if (la < -5)           description = 'Ground ball single'
      else if (la < 10)      description = 'Line drive single'
      else if (quality === 'weak') description = 'Bloop single'
      else                   description = 'Single'
      break
    default: // OUT
      if (la < -10)          description = 'Ground ball'
      else if (la > 50)      description = 'Pop up'
      else if (ev >= 95)     description = 'Hard out'
      else                   description = 'Flyout'
  }

  return { quality, rating, ev, la, distFt, outcome, description }
}

// ── Stats ────────────────────────────────────────────────────────────────────
interface GameStats {
  pa: number
  ab: number
  h: number
  k: number
  bb: number
  h1: number
  h2: number
  h3: number
  hr: number
}
const EMPTY_STATS: GameStats = { pa: 0, ab: 0, h: 0, k: 0, bb: 0, h1: 0, h2: 0, h3: 0, hr: 0 }

function fmtAvg(num: number, den: number): string {
  if (den === 0) return '.000'
  const v = num / den
  return v.toFixed(3).replace(/^0/, '')
}

function statsLine(s: GameStats) {
  const obpDen = s.pa
  const obpNum = s.h + s.bb
  const tb = s.h1 + 2 * s.h2 + 3 * s.h3 + 4 * s.hr
  const obp = obpDen === 0 ? 0 : obpNum / obpDen
  const slg = s.ab === 0 ? 0 : tb / s.ab
  return {
    avg: fmtAvg(s.h, s.ab),
    obp: fmtAvg(obpNum, obpDen),
    slg: fmtAvg(tb, s.ab),
    ops: (obp + slg).toFixed(3).replace(/^0/, ''),
  }
}

// ── State machine ────────────────────────────────────────────────────────────
type GamePhase =
  | 'setup'
  | 'between_pitches'
  | 'preparing'       // 1-second pause after Throw button before pitch fires
  | 'pitch_in_flight'
  | 'pitch_resolved'  // outcome shown, wait for explicit Next Pitch
  // ab_summary phase removed — every outcome (incl. AB end) shows in pitch_resolved.

interface CurrentPitch {
  pitch: SelectedPitch
  target: { x: number; y: number }
}

interface PitchResult {
  kind: 'ball' | 'called_strike' | 'swinging_strike' | 'foul' | 'in_play'
  contact?: ContactResult
  pitch: CurrentPitch
}

// ── Main component ───────────────────────────────────────────────────────────
interface Props {
  initialPitcher: PitcherArsenal | null
  arsenal: PitcherArsenal[]
  onExit: () => void
}

export default function PitchGameMode({ initialPitcher, arsenal, onExit }: Props) {
  // Setup state
  const [hand, setHand] = useState<'R' | 'L'>('R')
  const [randomPitcher, setRandomPitcher] = useState(false)
  const [pitcher, setPitcher] = useState<PitcherArsenal | null>(initialPitcher)
  const [phase, setPhase] = useState<GamePhase>('setup')

  // Live game state
  const [balls, setBalls] = useState(0)
  const [strikes, setStrikes] = useState(0)
  const [current, setCurrent] = useState<CurrentPitch | null>(null)
  const [lastResult, setLastResult] = useState<PitchResult | null>(null)
  const [animKey, setAnimKey] = useState(0)
  const [stats, setStats] = useState<GameStats>(EMPTY_STATS)
  const [freeze, setFreeze] = useState(false)
  // Countdown shown during the pre-pitch hold.
  const [countdown, setCountdown] = useState<number>(0)
  // Brief feedback flash for a swing-and-miss while the ball is still flying.
  const [missFlash, setMissFlash] = useState(false)
  // Pending swinging-strike result (set when user misses; resolved when ball lands).
  const pendingMissRef = useRef<boolean>(false)
  // Late-swing buffer: after the ball lands, hold for ~700ms before resolving
  // so that late clicks register (as swinging strikes). True contact must
  // happen during the actual flight — once the ball has crossed the plate,
  // a click is always a miss.
  const bufferTimerRef = useRef<number | null>(null)
  const ballLandedRef = useRef<boolean>(false)
  // Post-contact launch parameters — when set, the animation plays the ball
  // flying out into the field along this trajectory.
  const [contactLaunch, setContactLaunch] = useState<{
    ev: number
    la: number
    sprayAngle: number
  } | null>(null)
  // Stash of the full pending pitch result (with contact). Set whenever
  // contact is made; resolved when the launch animation finishes.
  const pendingFinalRef = useRef<PitchResult | null>(null)
  // True once the scene has reported entering its post_contact phase. The
  // scene fires a 'post_contact' event before the launch animation runs, and
  // a 'frozen' event when it ends. We only resolve the in-play result on the
  // 'frozen' that follows 'post_contact' — never on the earlier fly→frozen
  // that can sneak through while React is committing setContactLaunch.
  const postContactSeenRef = useRef<boolean>(false)

  // Refs for swing detection
  const ballPosRef = useRef<{ screenX: number; screenY: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  // Live mouse position over the canvas — used to draw the bat silhouette.
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)

  // Daily leaderboard hook + exit/submit modal state.
  const { data: leaderboardData, recordPlay, submitEntry } = useDailyLeaderboard()
  const [showExitModal, setShowExitModal] = useState(false)

  // Camera angle toggle — 'batter' = side-on eye-POV (default),
  // 'center' = straight-on centred view, slightly zoomed.
  const [camView, setCamView] = useState<'batter' | 'center'>('batter')

  // Build a SelectedPitch (with hand) from an arsenal entry.
  const buildSelectedPitch = useCallback(
    (a: PitcherArsenal, p: PitchArsenal): SelectedPitch => ({
      pitcher_name: a.name,
      team: a.team,
      pitch_type: p.pitch_type,
      pitch_name: p.pitch_name,
      usage_pct: p.usage_pct ?? 0,
      whiff_pct: p.whiff_pct,
      xwoba_against: p.xwoba_against,
      woba_against: p.woba_against,
      run_value_per_100: p.run_value_per_100,
      avg_speed: p.avg_speed,
      break_x: p.break_x,
      break_z: p.break_z,
      pitcher_hand: inferHand(a.pitches),
      release_pos_x: p.release_pos_x,
      release_pos_y: p.release_pos_y,
      release_pos_z: p.release_pos_z,
      release_extension: p.release_extension,
      release_spin_rate: p.release_spin_rate,
      spin_axis: p.spin_axis,
      effective_speed: p.effective_speed,
      vx0: p.vx0,
      vy0: p.vy0,
      vz0: p.vz0,
      ax: p.ax,
      ay: p.ay,
      az: p.az,
      arm_angle: p.arm_angle,
    }),
    [],
  )

  // Roll a fresh pitch with arsenal-weighted type + edge-biased location.
  const rollNextPitch = useCallback((): CurrentPitch | null => {
    const activePitcher =
      randomPitcher ? arsenal[Math.floor(Math.random() * arsenal.length)] : pitcher
    if (!activePitcher) return null
    const ap = pickArsenalPitch(activePitcher.pitches)
    if (!ap) return null
    const loc = generateLocation(activePitcher.zone_pct)
    return {
      pitch: buildSelectedPitch(activePitcher, ap),
      target: { x: loc.x, y: loc.y },
    }
  }, [randomPitcher, pitcher, arsenal, buildSelectedPitch])

  // ── Flow handlers ─────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    if (!pitcher && !randomPitcher) return
    setStats(EMPTY_STATS)
    setBalls(0)
    setStrikes(0)
    setCurrent(null)
    setLastResult(null)
    setPhase('between_pitches')
    recordPlay()
  }, [pitcher, randomPitcher, recordPlay])

  // Trigger a new pitch. preFlyDelay = 4 s: first 3 s show the 3-2-1
  // countdown, last 1 s the disc winds up so the batter can time the pitch.
  const PREP_SECONDS = 4
  const COUNTDOWN_SECONDS = 3 // how long the digit countdown lasts
  const queueNextPitch = useCallback(() => {
    const p = rollNextPitch()
    if (!p) return
    setCurrent(p)
    setLastResult(null)
    setFreeze(false)
    pendingMissRef.current = false
    setMissFlash(false)
    setContactLaunch(null)
    pendingFinalRef.current = null
    postContactSeenRef.current = false
    ballLandedRef.current = false
    if (bufferTimerRef.current) {
      window.clearTimeout(bufferTimerRef.current)
      bufferTimerRef.current = null
    }
    setCountdown(COUNTDOWN_SECONDS)
    setPhase('preparing')
    setAnimKey((k) => k + 1)
  }, [rollNextPitch])

  // Tick the countdown while in preparing phase. Counts down 3 → 2 → 1
  // over COUNTDOWN_SECONDS; after that, countdown reads 0 (wind-up frame).
  useEffect(() => {
    if (phase !== 'preparing') return
    const start = Date.now()
    setCountdown(COUNTDOWN_SECONDS)
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - start) / 1000
      if (elapsed >= COUNTDOWN_SECONDS) {
        setCountdown(0)
        window.clearInterval(id)
      } else {
        setCountdown(Math.ceil(COUNTDOWN_SECONDS - elapsed))
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [phase])

  const finishPitch = useCallback(
    (result: PitchResult) => {
      setLastResult(result)
      setFreeze(true)
      // Update count.
      let newBalls = balls
      let newStrikes = strikes
      if (result.kind === 'ball') newBalls += 1
      else if (result.kind === 'called_strike' || result.kind === 'swinging_strike') newStrikes += 1
      else if (result.kind === 'foul' && strikes < 2) newStrikes += 1
      setBalls(newBalls)
      setStrikes(newStrikes)

      // Detect AB ending events and update season stats inline.
      const isInPlayHitOrOut =
        result.kind === 'in_play' && result.contact && result.contact.outcome !== 'FOUL'
      const struckOut = newStrikes >= 3
      const walked = newBalls >= 4
      if (isInPlayHitOrOut || struckOut || walked) {
        setStats((s) => {
          const next: GameStats = { ...s, pa: s.pa + 1 }
          if (struckOut) {
            next.ab = s.ab + 1
            next.k = s.k + 1
          } else if (walked) {
            next.bb = s.bb + 1
          } else if (result.contact) {
            next.ab = s.ab + 1
            switch (result.contact.outcome) {
              case 'HR':  next.hr += 1; next.h += 1; break
              case '3B':  next.h3 += 1; next.h += 1; break
              case '2B':  next.h2 += 1; next.h += 1; break
              case '1B':  next.h1 += 1; next.h += 1; break
            }
          }
          return next
        })
      }

      // Single result-overlay phase for every outcome; advance() handles
      // resetting the count when an AB has ended.
      setPhase('pitch_resolved')
    },
    [balls, strikes],
  )

  // Called on canvas click during pitch_in_flight = SWING.
  //
  // Miss policy: ball continues to the plate (don't freeze). We mark the
  // pitch as a pending swinging strike via pendingMissRef and resolve it
  // when the animation reaches 'frozen'. A brief "Swing & miss!" flash
  // gives feedback during flight.
  const handleSwing = useCallback(
    (clickX: number, clickY: number) => {
      if (phase !== 'pitch_in_flight' || !current) return
      if (pendingMissRef.current) return // already swung this pitch
      // If the ball has already crossed the plate, any click is a late swing
      // and is always treated as a swinging strike — no contact possible.
      if (ballLandedRef.current) {
        pendingMissRef.current = true
        setMissFlash(true)
        window.setTimeout(() => setMissFlash(false), 500)
        return
      }
      const ball = ballPosRef.current
      if (!ball) return
      // Hit windows — slightly tightened from the previous round.
      const cw = canvasRef.current?.clientWidth ?? 800
      const sweetPx = cw * 0.06  // 6% of canvas width = solid contact
      const weakPx = cw * 0.15   // 15% = weak contact halo
      const dx = clickX - ball.screenX
      const dy = clickY - ball.screenY
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > weakPx) {
        // Miss — keep the ball flying. Result lands when animation completes.
        pendingMissRef.current = true
        setMissFlash(true)
        window.setTimeout(() => setMissFlash(false), 500)
        return
      }
      // Cancel any pending late-swing-buffer timer; we just resolved.
      if (bufferTimerRef.current) {
        window.clearTimeout(bufferTimerRef.current)
        bufferTimerRef.current = null
      }
      const contact = resolveContact(dist, sweetPx, weakPx)
      if (contact.quality === 'weak' && Math.random() < 0.3) {
        contact.outcome = 'FOUL'
        contact.description = 'Foul ball'
      }
      const pullSign = hand === 'R' ? 1 : -1
      const sprayAngle = pullSign * randNorm(15, 18)
      // For ALL contact (hit, out, foul) we run the launch animation and
      // defer the result until it finishes. Fouls get a shorter, weaker
      // trajectory (mostly backward), but they still get visible flight.
      const kind: PitchResult['kind'] = contact.outcome === 'FOUL' ? 'foul' : 'in_play'
      pendingFinalRef.current = { kind, pitch: current, contact }
      // Fouls fly mostly straight back/up at moderate EV — clamp the LA up.
      const isFoul = contact.outcome === 'FOUL'
      setContactLaunch({
        ev: isFoul ? Math.min(contact.ev, 75) : contact.ev,
        la: isFoul ? clamp(contact.la + 35, 40, 75) : contact.la,
        // Fouls go to the opposite side at random; non-foul biased to pull.
        sprayAngle: isFoul ? -pullSign * randNorm(40, 25) : sprayAngle,
      })
    },
    [phase, current, hand],
  )

  // Animation phase callback:
  //  - 'fly'    = the get-ready hold is over; ball is now in flight. Flip
  //               our game phase so canvas clicks register as swings.
  //  - 'frozen' = ball reached the plate. If we already had a pending
  //               swinging-strike, finalize that; otherwise this is a
  //               called strike or ball.
  const handlePhaseChange = useCallback(
    (p: 'rotate' | 'wait' | 'fly' | 'post_contact' | 'frozen') => {
      if (p === 'fly' && phase === 'preparing') {
        setPhase('pitch_in_flight')
      }
      if (p === 'post_contact') {
        postContactSeenRef.current = true
        return
      }
      if (p !== 'frozen') return
      if (phase !== 'pitch_in_flight' || !current) return

      // Case A: contact was made.
      if (pendingFinalRef.current) {
        // If the post_contact animation hasn't started yet (we're seeing the
        // earlier fly→frozen that fired before React committed contactLaunch),
        // wait — beginPostContact will fire and we'll get another 'frozen'.
        if (!postContactSeenRef.current) return
        // Otherwise the launch animation just finished — resolve now.
        const result = pendingFinalRef.current
        pendingFinalRef.current = null
        finishPitch(result)
        return
      }

      // Case B: the ball reached the plate without a swing. Mark it landed
      // so further clicks register as swinging strikes (never contact), then
      // open a 700ms late-swing buffer.
      ballLandedRef.current = true
      if (bufferTimerRef.current) window.clearTimeout(bufferTimerRef.current)
      bufferTimerRef.current = window.setTimeout(() => {
        bufferTimerRef.current = null
        if (pendingFinalRef.current) return // a late hit landed during buffer
        if (pendingMissRef.current) {
          finishPitch({ kind: 'swinging_strike', pitch: current })
        } else {
          const calledStrike = isInZone(current.target)
          finishPitch({
            kind: calledStrike ? 'called_strike' : 'ball',
            pitch: current,
          })
        }
      }, 700)
    },
    [phase, current, finishPitch],
  )

  // Advance handler — fired by Throw / Next-pitch / Next-AB BUTTONS only
  // (not by stray canvas clicks).
  const advance = useCallback(() => {
    if (phase !== 'between_pitches' && phase !== 'pitch_resolved') return
    // If the previous pitch ended the AB, reset the count display now.
    if (lastResult) {
      const endedAB =
        balls >= 4 ||
        strikes >= 3 ||
        (lastResult.kind === 'in_play' && lastResult.contact?.outcome !== 'FOUL')
      if (endedAB) {
        setBalls(0)
        setStrikes(0)
      }
    }
    queueNextPitch()
  }, [phase, lastResult, balls, strikes, queueNextPitch])

  // SPACE = advance, ONLY when not in flight. Never auto-swings.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      if (phase === 'between_pitches' || phase === 'pitch_resolved') {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, advance])

  // Click on canvas: SWING ONLY, and only during the in-flight phase.
  // Clicks at any other moment do nothing — advance must come from a button.
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (phase !== 'pitch_in_flight') return
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      handleSwing(x, y)
    },
    [phase, handleSwing],
  )

  // Ball position broadcast — store screen coords in ref for click handling.
  const onBallUpdate: BallUpdateCb = useCallback((info) => {
    ballPosRef.current = { screenX: info.screenX, screenY: info.screenY }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="border border-538-border rounded bg-surface p-6 space-y-4 max-w-xl mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-538-text">Game Mode</h2>
          <button
            onClick={onExit}
            className="px-3 py-1.5 text-xs font-semibold rounded border border-538-border text-538-muted hover:text-538-text"
          >
            ✕ Exit
          </button>
        </div>
        <HowToPlay />

        <div>
          <div className="text-[11px] uppercase tracking-wider text-538-muted mb-1">Batter handedness</div>
          <div className="flex gap-2">
            {(['R', 'L'] as const).map((h) => (
              <button
                key={h}
                onClick={() => setHand(h)}
                className={
                  'flex-1 px-3 py-2 text-sm font-bold rounded border-2 transition-colors ' +
                  (hand === h ? 'bg-538-orange text-white border-538-orange' : 'border-538-border text-538-muted hover:text-538-text')
                }
              >
                {h === 'R' ? 'Right-handed (RHB)' : 'Left-handed (LHB)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-538-muted mb-1">Pitcher</div>
          <label className="flex items-center gap-2 text-sm text-538-text">
            <input
              type="checkbox"
              checked={randomPitcher}
              onChange={(e) => setRandomPitcher(e.target.checked)}
            />
            Random pitcher each AB
          </label>
          {!randomPitcher && (
            <div className="mt-1 text-xs text-538-muted space-y-0.5">
              {pitcher ? (
                <>
                  <div>
                    Facing: <span className="font-bold text-538-text">{pitcher.name}</span> ({pitcher.team})
                  </div>
                  {pitcher.zone_pct != null && (
                    <div className="flex items-center gap-1.5">
                      <span>Control:</span>
                      <ZonePctBar zonePct={pitcher.zone_pct} />
                      <span className="tabular-nums text-538-text font-semibold">
                        {Math.round(pitcher.zone_pct * 100)}% in zone
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>No pitcher selected — pick one from the sidebar before starting, or enable random mode.</>
              )}
            </div>
          )}
        </div>

        <button
          onClick={startGame}
          disabled={!pitcher && !randomPitcher}
          className="w-full px-4 py-2 text-sm font-bold rounded bg-538-orange text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ▶ Start Game
        </button>
      </div>
    )
  }

  const stat = statsLine(stats)
  const tb = stats.h1 + 2 * stats.h2 + 3 * stats.h3 + 4 * stats.hr

  return (
    <div className="space-y-2">
      {/* Top mini banner — kept compact since the side panel duplicates the
          full stat line for visibility while the player focuses on the scene. */}
      <div className="border border-538-border rounded bg-surface px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-[10px] uppercase tracking-wider text-538-orange font-bold">Game Mode</span>
        {current && (
          <span className="text-538-muted">
            Pitcher: <span className="font-bold text-538-text">{current.pitch.pitcher_name}</span> ({current.pitch.team})
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Camera angle toggle */}
          <div className="flex rounded border border-538-border overflow-hidden text-[10px] font-semibold">
            <button
              onClick={() => setCamView('batter')}
              className={
                'px-2 py-1 transition-colors ' +
                (camView === 'batter'
                  ? 'bg-538-orange text-white'
                  : 'text-538-muted hover:text-538-text')
              }
              title="Batter's eye view"
            >
              👤 Batter
            </button>
            <button
              onClick={() => setCamView('center')}
              className={
                'px-2 py-1 border-l border-538-border transition-colors ' +
                (camView === 'center'
                  ? 'bg-538-orange text-white'
                  : 'text-538-muted hover:text-538-text')
              }
              title="Straight-on centre view"
            >
              🎥 Center
            </button>
          </div>
          <button
            onClick={() => setShowExitModal(true)}
            className="px-2 py-1 text-[11px] font-semibold rounded border border-538-border text-538-muted hover:text-538-text"
          >
            ✕ Exit / Submit to Leaderboard
          </button>
        </div>
      </div>

      {showExitModal && (
        <ExitLeaderboardModal
          stats={stats}
          pitcherLabel={randomPitcher ? 'Random' : pitcher?.name ?? 'Unknown'}
          onClose={onExit}
          onCancel={() => setShowExitModal(false)}
          submitEntry={submitEntry}
        />
      )}

      {/* Main layout: 3D scene on the left, sticky stats panel on the right. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-2 items-start">
        <div
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={(e) => {
            const rect = canvasRef.current?.getBoundingClientRect()
            if (!rect) return
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
          }}
          onMouseLeave={() => setMousePos(null)}
          className="border border-538-border rounded bg-surface overflow-hidden cursor-crosshair select-none relative"
        >
          <div className="aspect-[4/3] relative bg-black">
            {current && (
              <PitchAnimation3D
                key={animKey}
                pitch={current.pitch}
                target={current.target}
                angle={
                  camView === 'center'
                    ? hand === 'R' ? 'centerGameR' : 'centerGameL'
                    : hand === 'R' ? 'batterR' : 'batterL'
                }
                gameMode
                skipRotation
                preFlyDelay={PREP_SECONDS}
                freeze={freeze}
                contactLaunch={contactLaunch}
                onPhaseChange={handlePhaseChange}
                onBallUpdate={onBallUpdate}
              />
            )}

            {/* Phase-specific overlays */}
            {phase === 'between_pitches' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/30">
                <button
                  onClick={advance}
                  className="pointer-events-auto px-5 py-2 text-sm font-bold rounded bg-538-orange text-white hover:opacity-90"
                >
                  ▶ Throw Pitch {current ? '' : '(first)'}
                </button>
              </div>
            )}
            {phase === 'preparing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {countdown > 0 ? (
                  <>
                    <div
                      className="text-8xl font-black tabular-nums leading-none"
                      style={{ color: '#FFFFFF', textShadow: '0 4px 14px rgba(0,0,0,0.7)' }}
                    >
                      {countdown}
                    </div>
                    <div className="mt-2 text-[11px] uppercase tracking-wider text-white/80">
                      Get ready…
                    </div>
                  </>
                ) : (
                  <div
                    className="text-5xl font-black tracking-tight"
                    style={{ color: '#FFD27F', textShadow: '0 4px 14px rgba(0,0,0,0.7)' }}
                  >
                    Throw!
                  </div>
                )}
              </div>
            )}
            {/* Bat silhouette follows the cursor — barrel at cursor position.
                Shown during prep + flight so the player can pre-aim. */}
            {mousePos && (phase === 'preparing' || phase === 'pitch_in_flight' || phase === 'between_pitches') && (
              <BatSilhouette x={mousePos.x} y={mousePos.y} hand={hand} />
            )}
            {phase === 'pitch_in_flight' && (
              <>
                <div className="absolute top-3 left-3 px-2 py-1 text-[10px] uppercase tracking-wider rounded bg-surface/80 text-538-muted pointer-events-none">
                  Click the ball to swing
                </div>
                {missFlash && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-5xl font-black tracking-tight" style={{ color: '#C62828', textShadow: '0 3px 10px rgba(0,0,0,0.6)' }}>
                      Swing & miss!
                    </div>
                  </div>
                )}
              </>
            )}
            {phase === 'pitch_resolved' && lastResult && (
              <PitchResultOverlay
                result={lastResult}
                balls={balls}
                strikes={strikes}
                onNext={advance}
              />
            )}
          </div>
        </div>

        {/* Stats sidebar — sticky on desktop so it stays visible regardless
            of scroll position while the player focuses on the scene. */}
        <aside className="border border-538-border rounded bg-surface p-3 lg:sticky lg:top-4 space-y-3">
          {/* Count */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-538-muted mb-1.5">Count</div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-538-muted w-12">Balls</span>
                <CountDots count={3} active={balls} color="#558B6E" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-538-muted w-12">Strikes</span>
                <CountDots count={2} active={strikes} color="#C62828" />
              </div>
            </div>
          </div>

          {/* Slash line */}
          <div className="border-t border-538-border pt-2.5">
            <div className="text-[10px] uppercase tracking-wider text-538-muted mb-1.5">Slash Line</div>
            <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
              <SidebarStat label="AVG" value={stat.avg} />
              <SidebarStat label="OBP" value={stat.obp} />
              <SidebarStat label="SLG" value={stat.slg} />
              <SidebarStat label="OPS" value={stat.ops as string} />
            </div>
          </div>

          {/* Counts */}
          <div className="border-t border-538-border pt-2.5">
            <div className="text-[10px] uppercase tracking-wider text-538-muted mb-1.5">Game Totals</div>
            <div className="grid grid-cols-2 gap-y-1 text-[11px]">
              <SidebarKV label="PA" value={stats.pa} />
              <SidebarKV label="AB" value={stats.ab} />
              <SidebarKV label="H" value={stats.h} />
              <SidebarKV label="K" value={stats.k} />
              <SidebarKV label="BB" value={stats.bb} />
              <SidebarKV label="HR" value={stats.hr} />
              <SidebarKV label="2B" value={stats.h2} />
              <SidebarKV label="3B" value={stats.h3} />
              <SidebarKV label="1B" value={stats.h1} />
              <SidebarKV label="TB" value={tb} />
            </div>
          </div>

          {/* Daily leaderboard — always visible in game mode so the player
              can see who they're chasing in real time. */}
          <div className="border-t border-538-border pt-2.5">
            <DailyLeaderboard data={leaderboardData} compact />
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── How-to-Play accordion (shown on setup screen) ────────────────────────────
function HowToPlay() {
  const [open, setOpen] = useState(true)
  const [physicsOpen, setPhysicsOpen] = useState(false)
  const [scoringOpen, setScoringOpen] = useState(false)

  return (
    <div className="border border-538-border rounded text-xs overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface hover:bg-538-border/20 text-538-text font-semibold"
      >
        <span>How to Play</span>
        <span className="text-538-muted">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-538-muted leading-relaxed">
          <p>
            Stand in against a real MLB pitcher. Each pitch comes from their actual arsenal,
            weighted by real usage rates, with edge-biased locations that mirror how pitchers
            attack hitters. You have to <strong className="text-538-text">time AND aim</strong> —
            click the ball while it's in flight to swing. Early or late clicks count as misses.
          </p>

          <ul className="list-disc list-inside space-y-0.5 text-[11px]">
            <li>Balls and strikes accumulate normally — 3 strikes = K, 4 balls = BB.</li>
            <li>Click the ball as it approaches the plate to make contact.</li>
            <li>Your cursor shows a bat silhouette — aim your barrel at the ball.</li>
            <li>After 5+ ABs you can submit your slash line to the daily leaderboard.</li>
          </ul>

          {/* Physics sub-section */}
          <div className="border border-538-border rounded overflow-hidden mt-1">
            <button
              onClick={() => setPhysicsOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-1.5 bg-surface hover:bg-538-border/20 text-538-text font-semibold text-[11px]"
            >
              <span>⚙ Game Physics</span>
              <span className="text-538-muted">{physicsOpen ? '▴' : '▾'}</span>
            </button>
            {physicsOpen && (
              <div className="px-3 py-2 space-y-1.5 text-[11px] leading-relaxed">
                <p>
                  <strong className="text-538-text">Contact quality</strong> is determined by how
                  close you click to the ball's center. A perfect click (barrel on ball) produces
                  elite exit velocity; a glancing blow gives weak contact.
                </p>
                <p>
                  <strong className="text-538-text">Exit Velocity (EV)</strong> ranges from ≈70 mph
                  on weak contact up to ≈115 mph on a perfect hit. Higher EV = more distance.
                </p>
                <p>
                  <strong className="text-538-text">Launch Angle (LA)</strong> is randomized within
                  a band for each contact tier. Solid contact tends toward 18–28°, weak contact
                  toward popups (55°+) or grounders (negative).
                </p>
                <p>
                  <strong className="text-538-text">Distance</strong> is estimated as
                  EV² × sin(2 × LA) / 25. Outcomes are distance-first:
                </p>
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  <li>&gt; 380 ft at 18–45°  → <span className="font-bold text-538-text">Home Run</span></li>
                  <li>310–380 ft at 10–45° → <span className="text-538-text">Double / Triple</span></li>
                  <li>200–310 ft at 5–40°  → <span className="text-538-text">Single / Double / Out</span></li>
                  <li>&lt; 200 ft           → <span className="text-538-text">Grounder / Lineout / Bloop</span></li>
                  <li>LA &lt; −5°          → <span className="text-538-text">Ground ball</span></li>
                  <li>LA &gt; 55°          → <span className="text-538-text">Pop up</span></li>
                </ul>
                <p className="text-[10px] opacity-70">
                  Contact grade (A+ → F) reflects how precisely you timed and aimed the swing.
                </p>
              </div>
            )}
          </div>

          {/* Scoring sub-section */}
          <div className="border border-538-border rounded overflow-hidden">
            <button
              onClick={() => setScoringOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-1.5 bg-surface hover:bg-538-border/20 text-538-text font-semibold text-[11px]"
            >
              <span>🏆 Leaderboard Scoring</span>
              <span className="text-538-muted">{scoringOpen ? '▴' : '▾'}</span>
            </button>
            {scoringOpen && (
              <div className="px-3 py-2 space-y-1.5 text-[11px] leading-relaxed">
                <p>
                  The daily leaderboard ranks the top 10 sessions by{' '}
                  <strong className="text-538-text">SLG (Slugging %)</strong>. The more extra-base
                  hits you rack up, the higher you climb.
                </p>
                <p>
                  <strong className="text-538-text">Tiebreaker:</strong> if two players' SLGs are
                  within 20% of each other, the one with <em>more ABs</em> ranks higher — reward
                  for persistence. Earliest submission breaks any remaining ties.
                </p>
                <p>
                  Minimum <strong className="text-538-text">5 ABs</strong> required to qualify.
                  Leaderboard resets daily at midnight UTC.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] text-538-muted uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold text-538-text tabular-nums">{value}</div>
    </div>
  )
}

// Small horizontal bar showing zone% relative to the 36–58 % range.
function ZonePctBar({ zonePct }: { zonePct: number }) {
  const MIN = 0.36, MAX = 0.58
  const pct = Math.min(1, Math.max(0, (zonePct - MIN) / (MAX - MIN)))
  // Color: green = great control, orange = average, red = wild
  const color = pct >= 0.6 ? '#2E7D32' : pct >= 0.35 ? '#F57C00' : '#C62828'
  return (
    <div className="flex-1 max-w-[60px] h-1.5 rounded-full bg-538-border overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct * 100}%`, backgroundColor: color }}
      />
    </div>
  )
}

function SidebarKV({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between pr-2">
      <span className="text-538-muted">{label}</span>
      <span className="font-bold text-538-text tabular-nums">{value}</span>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────
function CountDots({ count, active, color }: { count: number; active: number; color: string }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="w-3 h-3 rounded-full border-2 transition-colors"
          style={{ borderColor: color, backgroundColor: i < active ? color : 'transparent' }}
        />
      ))}
    </div>
  )
}

// Single unified overlay for every pitch outcome. Shows:
//   - Big AB-ending label when the pitch ended the AB (Strikeout / Walk /
//     Home run / Single / Double / Triple / Pop out / Lineout / etc.)
//   - Otherwise the pitch-level result (Ball / Strike looking / Foul / etc.)
//   - Pitch type + speed
//   - Contact stats (grade, EV, distance) for ANY contact
//   - Button label: "Next AB →" if AB ended, else "Next pitch →"
function PitchResultOverlay({
  result,
  balls,
  strikes,
  onNext,
}: {
  result: PitchResult
  balls: number
  strikes: number
  onNext: () => void
}) {
  const sp = result.pitch.pitch
  const dotColor = pitchColor(sp.pitch_type)
  const speed = sp.avg_speed ?? sp.effective_speed

  const isInPlayHitOrOut =
    result.kind === 'in_play' && result.contact && result.contact.outcome !== 'FOUL'
  const struckOut = strikes >= 3
  const walked = balls >= 4
  const abEnded = isInPlayHitOrOut || struckOut || walked

  // Big label + tone
  let bigLabel = ''
  let tone: 'good' | 'bad' | 'neutral' = 'neutral'
  if (struckOut) { bigLabel = 'Strikeout'; tone = 'bad' }
  else if (walked) { bigLabel = 'Walk'; tone = 'good' }
  else if (isInPlayHitOrOut && result.contact) {
    switch (result.contact.outcome) {
      case 'HR': bigLabel = 'Home run!'; tone = 'good'; break
      case '3B': bigLabel = 'Triple!'; tone = 'good'; break
      case '2B': bigLabel = 'Double'; tone = 'good'; break
      case '1B': bigLabel = 'Single'; tone = 'good'; break
      default: bigLabel = result.contact.description || 'Out'; tone = 'bad'
    }
  } else {
    // Pitch-level (no AB end)
    if (result.kind === 'called_strike') { bigLabel = 'Strike'; tone = 'bad' }
    else if (result.kind === 'swinging_strike') { bigLabel = 'Strike — swinging'; tone = 'bad' }
    else if (result.kind === 'ball') { bigLabel = 'Ball'; tone = 'good' }
    else if (result.kind === 'foul') { bigLabel = 'Foul ball'; tone = 'neutral' }
    else { bigLabel = 'In play'; tone = 'neutral' }
  }
  const toneColor = tone === 'good' ? '#2E7D32' : tone === 'bad' ? '#C62828' : '#F57C00'

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
    >
      <div className="text-center pointer-events-auto">
        <div
          className="text-4xl font-black tracking-tight"
          style={{ color: toneColor, textShadow: '0 3px 10px rgba(0,0,0,0.55)' }}
        >
          {bigLabel}
        </div>

        {/* Pitch type + speed */}
        <div className="mt-2 flex items-center justify-center gap-2 text-sm text-white">
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: dotColor }}
          >
            {sp.pitch_type}
          </span>
          <span className="font-semibold">{sp.pitch_name}</span>
          {speed != null && (
            <span className="text-white/80">
              · <span className="font-bold tabular-nums text-white">{speed.toFixed(1)}</span> mph
            </span>
          )}
        </div>

        {/* Contact stats — shown for ANY contact (hit, out, OR foul). */}
        {result.contact && (
          <div className="mt-3 space-y-1.5 text-sm">
            {(() => {
              const grade = gradeFromRating(result.contact.rating)
              return (
                <div className="flex items-center justify-center gap-3 text-white">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-white/80">Contact Grade</span>
                    <span
                      className="text-2xl font-black tabular-nums"
                      style={{ color: grade.color, textShadow: '0 2px 6px rgba(0,0,0,0.5)' }}
                    >
                      {grade.letter}
                    </span>
                  </div>
                  <span className="text-white/50">|</span>
                  <span>
                    <span className="font-bold tabular-nums">{result.contact.ev.toFixed(0)}</span>
                    <span className="text-white/80 ml-1 text-xs">mph EV</span>
                  </span>
                  <span className="text-white/50">|</span>
                  <span>
                    <span className="font-bold tabular-nums">{result.contact.distFt.toFixed(0)}</span>
                    <span className="text-white/80 ml-1 text-xs">ft</span>
                  </span>
                </div>
              )
            })()}
            <ContactMeter rating={result.contact.rating} />
            <div className="text-[11px] text-white/85">
              LA {result.contact.la.toFixed(0)}° · {result.contact.quality} contact
            </div>
          </div>
        )}

        <button
          onClick={onNext}
          className="mt-3 px-4 py-1.5 text-xs font-bold rounded bg-538-orange text-white hover:opacity-90"
        >
          {abEnded ? 'Next AB →' : 'Next pitch →'}
        </button>
      </div>
    </div>
  )
}

// Exit-time leaderboard submission modal. Shows the player's outing stats,
// validates the entered name, attempts a top-10 submission, then reveals
// the rank if achieved.
function ExitLeaderboardModal({
  stats,
  pitcherLabel,
  onClose,
  onCancel,
  submitEntry,
}: {
  stats: GameStats
  /** Display string for the pitcher faced — single pitcher's name, or "Random". */
  pitcherLabel: string
  onClose: () => void
  onCancel: () => void
  submitEntry: (entry: {
    name: string
    pitcher: string
    pa: number
    ab: number
    h: number
    k: number
    bb: number
    hr: number
    h1: number
    h2: number
    h3: number
    avg: number
    obp: number
    slg: number
    ops: number
  }) => Promise<{ admitted: boolean; rank: number | null; error?: string }>
}) {
  const slash = computeSlashLine(stats)
  const eligible = stats.ab >= MIN_AB
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ admitted: boolean; rank: number | null } | null>(null)

  async function handleSubmit() {
    setError(null)
    const check = isCleanName(name)
    if (!check.ok) {
      setError(check.reason || 'Invalid name.')
      return
    }
    setSubmitting(true)
    const r = await submitEntry({
      name: name.trim(),
      pitcher: pitcherLabel,
      pa: stats.pa,
      ab: stats.ab,
      h: stats.h,
      k: stats.k,
      bb: stats.bb,
      hr: stats.hr,
      h1: stats.h1,
      h2: stats.h2,
      h3: stats.h3,
      avg: slash.avg,
      obp: slash.obp,
      slg: slash.slg,
      ops: slash.ops,
    })
    setSubmitting(false)
    if (r.error && !r.admitted) {
      setError(r.error)
      return
    }
    setResult({ admitted: r.admitted, rank: r.rank })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
    >
      <div className="bg-surface border border-538-border rounded p-5 max-w-md w-full space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-538-text">Outing Complete</h2>
          <button
            onClick={onCancel}
            className="text-538-muted hover:text-538-text text-sm"
          >
            ← Back
          </button>
        </div>

        {/* Pitcher faced */}
        <div className="text-xs flex items-center gap-2 text-538-muted">
          <span className="text-[10px] uppercase tracking-wider">Faced</span>
          <span className="font-bold text-538-text">{pitcherLabel}</span>
          {pitcherLabel === 'Random' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-538-orange/20 text-538-orange font-bold uppercase tracking-wide">
              Random mode
            </span>
          )}
        </div>

        {/* Stats summary */}
        <div className="text-xs space-y-1">
          <div className="grid grid-cols-4 gap-1 text-center">
            <div>
              <div className="text-[9px] uppercase text-538-muted">PA</div>
              <div className="font-bold tabular-nums">{stats.pa}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-538-muted">AB</div>
              <div className="font-bold tabular-nums">{stats.ab}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-538-muted">H</div>
              <div className="font-bold tabular-nums">{stats.h}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-538-muted">HR</div>
              <div className="font-bold tabular-nums">{stats.hr}</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1 text-center pt-1 border-t border-538-border/40">
            <div>
              <div className="text-[9px] uppercase text-538-muted">AVG</div>
              <div className="font-bold tabular-nums">{slash.avg.toFixed(3).replace(/^0/, '')}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-538-muted">OBP</div>
              <div className="font-bold tabular-nums">{slash.obp.toFixed(3).replace(/^0/, '')}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-538-muted">SLG</div>
              <div className="font-bold tabular-nums text-538-orange">{slash.slg.toFixed(3).replace(/^0/, '')}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-538-muted">OPS</div>
              <div className="font-bold tabular-nums">{slash.ops.toFixed(3).replace(/^0/, '')}</div>
            </div>
          </div>
        </div>

        {result ? (
          // ── Post-submit result ──
          <div className="border-t border-538-border pt-3 text-center space-y-2">
            {result.admitted && result.rank !== null ? (
              <>
                <div className="text-3xl font-black" style={{ color: '#2E7D32' }}>
                  #{result.rank}
                </div>
                <div className="text-xs text-538-text">
                  You made today's leaderboard!
                </div>
              </>
            ) : (
              <div className="text-sm text-538-text">
                Nice outing — didn't make the top {10} today.
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full px-3 py-1.5 text-xs font-bold rounded bg-538-orange text-white hover:opacity-90"
            >
              Close
            </button>
          </div>
        ) : !eligible ? (
          // ── Not enough ABs ──
          <div className="border-t border-538-border pt-3 space-y-2">
            <p className="text-xs text-538-muted text-center">
              Need at least <span className="font-bold text-538-text">{MIN_AB} ABs</span> to qualify for the leaderboard.
              You had {stats.ab}.
            </p>
            <button
              onClick={onClose}
              className="w-full px-3 py-1.5 text-xs font-bold rounded bg-538-orange text-white hover:opacity-90"
            >
              Exit
            </button>
          </div>
        ) : (
          // ── Name input ──
          <div className="border-t border-538-border pt-3 space-y-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-538-muted block mb-1">
                Name for leaderboard
              </label>
              <input
                type="text"
                maxLength={24}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
                placeholder="Anonymous"
                autoFocus
                className="w-full px-2 py-1.5 text-sm bg-538-bg border border-538-border rounded text-538-text outline-none focus:border-538-orange"
              />
              {error && <div className="text-[11px] text-red-500 mt-1">{error}</div>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-1.5 text-xs font-semibold rounded border border-538-border text-538-muted hover:text-538-text"
              >
                Skip
              </button>
              <button
                onClick={handleSubmit}
                disabled={name.trim().length === 0 || submitting}
                className="flex-1 px-3 py-1.5 text-xs font-bold rounded bg-538-orange text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Translucent baseball bat silhouette that follows the cursor. Barrel sits at
// the cursor; the handle extends in from the batter's body side of the
// screen at ~60° from horizontal — entering frame from the lower-left for
// RHB, lower-right for LHB.
function BatSilhouette({ x, y, hand }: { x: number; y: number; hand: 'R' | 'L' }) {
  // SVG rotation is clockwise in +y-down coords. Bat is defined in local
  // space with barrel at origin and handle extending toward +y (down).
  // rotate(+60) for RHB → handle lower-RIGHT; rotate(-60) for LHB → lower-LEFT.
  const rotation = hand === 'R' ? 60 : -60
  return (
    <svg
      className="absolute pointer-events-none"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        width: 280,
        height: 280,
      }}
      viewBox="-100 -100 200 200"
    >
      <g transform={`rotate(${rotation})`}>
        {/* Single-path bat: cap → barrel → taper → handle → knob.
            Wood-tan fill, dark outline for definition over any background. */}
        <path
          d="
            M -6 -34
            C -6 -40 6 -40 6 -34
            L 6 12
            C 6 24 3 38 2.2 56
            L 2.2 80
            C 2.2 86 3.4 90 3.6 92
            A 3.8 3.8 0 0 1 -3.6 92
            C -3.4 90 -2.2 86 -2.2 80
            L -2.2 56
            C -3 38 -6 24 -6 12
            Z
          "
          fill="#C49A6B"
          fillOpacity={0.5}
          stroke="#1A0F08"
          strokeOpacity={0.75}
          strokeWidth={1.0}
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

function ContactMeter({ rating }: { rating: number }) {
  // 0 = miss, 1 = perfect
  const pct = clamp(rating * 100, 0, 100)
  return (
    <div className="w-48 mx-auto">
      <div className="h-2 rounded overflow-hidden bg-538-border/30">
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(to right, #C62828, #F57C00, #2E7D32)',
          }}
        />
      </div>
      <div className="text-[10px] text-538-muted mt-0.5 tabular-nums">{pct.toFixed(0)} / 100</div>
    </div>
  )
}
