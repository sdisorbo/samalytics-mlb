'use client'

import { useState, useEffect } from 'react'

const BLUE = '#1467EB'
const MLB_API = 'https://statsapi.mlb.com/api/v1'

// ── Linear weights (runs above average per event, batter perspective) ─────────
const LINEAR_WEIGHTS: Record<string, number> = {
  home_run: 1.380,
  triple: 1.052,
  double: 0.764,
  single: 0.455,
  walk: 0.317,
  intent_walk: 0.317,
  hit_by_pitch: 0.373,
  strikeout: -0.274,
  strikeout_double_play: -0.274,
  field_out: -0.267,
  force_out: -0.267,
  grounded_into_double_play: -0.534,
  double_play: -0.534,
  triple_play: -0.801,
  fielders_choice: -0.267,
  fielders_choice_out: -0.267,
  field_error: 0.100,
  sac_bunt: -0.267,
  sac_fly: 0.050,
  sac_fly_double_play: -0.267,
  catcher_interf: 0.317,
}

const DEFAULT_OUT_RV = -0.267
const BATTER_REPL_PER_PA = -0.020   // replacement batter is 0.02 runs/PA below avg
const PITCHER_REPL_PER_BF = -0.020  // replacement pitcher allows 0.02 runs/PA above avg

// ── Types ─────────────────────────────────────────────────────────────────────

type Outcome = 'HR' | '3B' | '2B' | '1B' | 'BB' | 'K' | 'OUT' | 'E' | 'SF' | 'DP'

interface GameEvent {
  id: number
  outcome: Outcome
  description: string
  inning: number
  isTop: boolean
  sprayAngle: number
  rv: number   // from batter's perspective
}

interface BatterData {
  batterId: number
  name: string
  isAway: boolean
  events: GameEvent[]
  totalRv: number
  rar: number
}

interface PitcherData {
  pitcherId: number
  name: string
  isAway: boolean   // true = pitcher pitches for away team (bottom innings)
  events: GameEvent[]
  totalRv: number   // from pitcher's perspective (positive = good)
  rar: number
  bf: number
  k: number
  bb: number
  hr: number
}

export interface GameBreakdownProps {
  gamePk: number
  awayTeamName: string
  homeTeamName: string
  awayTeamAbbr: string
  homeTeamAbbr: string
  awayScore: number | null
  homeScore: number | null
  gameStatus: string
  onClose: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function eventTypeToOutcome(eventType: string): Outcome {
  if (eventType === 'home_run') return 'HR'
  if (eventType === 'triple') return '3B'
  if (eventType === 'double') return '2B'
  if (eventType === 'single') return '1B'
  if (['walk', 'intent_walk', 'hit_by_pitch', 'catcher_interf'].includes(eventType)) return 'BB'
  if (['strikeout', 'strikeout_double_play'].includes(eventType)) return 'K'
  if (eventType === 'field_error') return 'E'
  if (['sac_fly', 'sac_fly_double_play'].includes(eventType)) return 'SF'
  if (['grounded_into_double_play', 'double_play', 'triple_play'].includes(eventType)) return 'DP'
  return 'OUT'
}

function coordsToSpray(coordX: number, coordY: number): number {
  const dx = coordX - 125.42
  const dy = 204.5 - coordY
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 0
  return Math.max(-45, Math.min(45, Math.atan2(dx, dy) * (180 / Math.PI)))
}

const LOC_SPRAY: Record<string, number> = {
  '1': 0, '2': 0, '3': 30, '4': 15, '5': -30,
  '6': -15, '7': -38, '8': 0, '9': 38,
}

// ── Fetch & parse ─────────────────────────────────────────────────────────────

interface ParsedGame {
  batters: BatterData[]
  pitchers: PitcherData[]
}

async function fetchGameData(gamePk: number): Promise<ParsedGame> {
  const res = await fetch(`${MLB_API}/game/${gamePk}/playByPlay`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()

  const batterMap = new Map<number, BatterData>()
  const pitcherMap = new Map<number, PitcherData>()
  let idx = 0

  for (const play of data.allPlays ?? []) {
    if (play.result?.type !== 'atBat' || !play.about?.isComplete) continue

    const batterId: number = play.matchup?.batter?.id
    const batterName: string = play.matchup?.batter?.fullName ?? 'Unknown'
    const pitcherId: number = play.matchup?.pitcher?.id
    const pitcherName: string = play.matchup?.pitcher?.fullName ?? 'Unknown'
    const isTop: boolean = play.about?.isTopInning ?? true
    const inning: number = play.about?.inning ?? 1
    const eventType: string = (play.result?.eventType ?? '').toLowerCase()
    const description: string = play.result?.description ?? play.result?.event ?? eventType

    const rv = LINEAR_WEIGHTS[eventType] ?? DEFAULT_OUT_RV
    const outcome = eventTypeToOutcome(eventType)

    // Spray angle from StatCast coordinates or position code
    let sprayAngle = 0
    for (const ev of play.playEvents ?? []) {
      if (ev.hitData) {
        const { coordX, coordY } = ev.hitData.coordinates ?? {}
        if (coordX != null && coordY != null) {
          sprayAngle = coordsToSpray(coordX, coordY)
        } else if (ev.hitData.location) {
          sprayAngle = LOC_SPRAY[String(ev.hitData.location)] ?? 0
        }
        break
      }
    }

    const event: GameEvent = { id: idx++, outcome, description, inning, isTop, sprayAngle, rv }

    // Batter record
    if (!batterMap.has(batterId)) {
      batterMap.set(batterId, {
        batterId, name: batterName,
        isAway: isTop,
        events: [], totalRv: 0, rar: 0,
      })
    }
    const batter = batterMap.get(batterId)!
    batter.events.push(event)
    batter.totalRv += rv

    // Pitcher record — pitcher perspective: rv is flipped
    // Away pitcher (isAway=true) pitches in the BOTTOM inning (!isTop)
    if (!pitcherMap.has(pitcherId)) {
      pitcherMap.set(pitcherId, {
        pitcherId, name: pitcherName,
        isAway: !isTop,   // bottom = away pitcher; top = home pitcher
        events: [], totalRv: 0, rar: 0, bf: 0, k: 0, bb: 0, hr: 0,
      })
    }
    const pitcher = pitcherMap.get(pitcherId)!
    pitcher.events.push(event)
    pitcher.totalRv += -rv   // pitcher perspective: K is good (+0.274), HR is bad (-1.380)
    pitcher.bf++
    if (outcome === 'K') pitcher.k++
    if (outcome === 'BB') pitcher.bb++
    if (outcome === 'HR') pitcher.hr++
  }

  // Finalize RAR
  for (const b of batterMap.values()) {
    b.rar = b.totalRv - b.events.length * BATTER_REPL_PER_PA
  }
  for (const p of pitcherMap.values()) {
    // pitcher_rar = pitcher_rv - bf * pitcher_replacement  (replacement allows more, so baseline < 0)
    p.rar = p.totalRv - p.bf * PITCHER_REPL_PER_BF
  }

  return {
    batters: Array.from(batterMap.values()),
    pitchers: Array.from(pitcherMap.values()),
  }
}

// ── Baseball field SVG ────────────────────────────────────────────────────────

const OUTCOME_DIST: Record<Outcome, number> = {
  HR: 235, '3B': 192, '2B': 160, '1B': 115,
  BB: 0, K: 0, OUT: 88, E: 100, SF: 155, DP: 70,
}

function hitEndpoint(spray: number, dist: number): [number, number] {
  const rad = (spray * Math.PI) / 180
  return [200 + dist * Math.sin(rad), 350 - dist * Math.cos(rad)]
}

function BaseballField({ events, name, animKey, perspective }: {
  events: GameEvent[]
  name: string
  animKey: number
  perspective: 'batter' | 'pitcher'
}) {
  const hitEvents = events.filter(e => OUTCOME_DIST[e.outcome] > 0)
  const plateEvents = events.filter(e => OUTCOME_DIST[e.outcome] === 0)

  return (
    <div className="flex flex-col items-center">
      <div className="text-xs font-bold mb-1 truncate w-full text-center" style={{ color: BLUE }}>
        {name}
      </div>
      <svg viewBox="0 0 400 385" style={{ width: '100%', maxWidth: 300, display: 'block' }}>
        <path d="M 28 102 Q 200 8 372 102" fill="none" stroke={BLUE} strokeWidth="1.5" opacity="0.4" />
        <line x1="200" y1="350" x2="28" y2="102" stroke={BLUE} strokeWidth="1.2" opacity="0.4" />
        <line x1="200" y1="350" x2="372" y2="102" stroke={BLUE} strokeWidth="1.2" opacity="0.4" />
        <polygon points="200,350 295,255 200,160 105,255"
          fill="none" stroke={BLUE} strokeWidth="1.5" opacity="0.8" />
        <circle cx="200" cy="232" r="7" fill="none" stroke={BLUE} strokeWidth="1" opacity="0.45" />
        {[{ cx: 295, cy: 255 }, { cx: 200, cy: 160 }, { cx: 105, cy: 255 }].map(({ cx, cy }, i) => (
          <rect key={i} x={cx - 4} y={cy - 4} width="8" height="8" fill={BLUE} opacity="0.3" rx="1" />
        ))}
        <polygon points="200,353 206,358 204,365 196,365 194,358" fill={BLUE} opacity="0.45" />

        {hitEvents.map((e, i) => {
          const [tx, ty] = hitEndpoint(e.sprayAngle, OUTCOME_DIST[e.outcome])
          // For pitcher perspective, good = pitcher prevented runs (positive rv for pitcher = -rv for batter)
          const displayRv = perspective === 'pitcher' ? -e.rv : e.rv
          const isPos = displayRv >= 0
          const color = e.outcome === 'HR'
            ? (perspective === 'pitcher' ? '#ef4444' : BLUE)
            : isPos ? '#3b82f6' : '#ef4444'
          const pathLen = Math.hypot(tx - 200, ty - 350)
          const delay = i * 0.18
          return (
            <g key={`${animKey}-${e.id}`}>
              <path d={`M 200 350 L ${tx.toFixed(1)} ${ty.toFixed(1)}`}
                fill="none" stroke={color}
                strokeWidth={e.outcome === 'HR' ? 2 : 1.5} strokeLinecap="round"
                style={{
                  strokeDasharray: pathLen, strokeDashoffset: pathLen,
                  animation: `gbDraw 0.45s ease ${delay}s forwards`,
                }} />
              <circle cx={tx} cy={ty} r={e.outcome === 'HR' ? 4 : 3} fill={color}
                style={{ opacity: 0, animation: `gbFade 0.15s ease ${delay + 0.42}s forwards` }} />
              <text
                x={tx + (tx > 205 ? 7 : tx < 195 ? -7 : 0)}
                y={ty + (ty < 200 ? -5 : 12)}
                fontSize="9" fontWeight="bold" fill={color}
                textAnchor={tx > 205 ? 'start' : tx < 195 ? 'end' : 'middle'}
                style={{ opacity: 0, animation: `gbFade 0.2s ease ${delay + 0.42}s forwards` }}
              >
                {isPos ? '+' : ''}{displayRv.toFixed(2)}
              </text>
            </g>
          )
        })}

        {plateEvents.map((e, i) => {
          const displayRv = perspective === 'pitcher' ? -e.rv : e.rv
          const isPos = displayRv >= 0
          return (
            <text key={`${animKey}-plate-${e.id}`}
              x={200 + (i - (plateEvents.length - 1) / 2) * 16}
              y={382} fontSize="10" fontWeight="bold" textAnchor="middle"
              fill={isPos ? BLUE : '#ef4444'}
              style={{ opacity: 0, animation: `gbFade 0.2s ease ${hitEvents.length * 0.18 + 0.1}s forwards` }}
            >
              {e.outcome}
            </text>
          )
        })}
      </svg>
      <style>{`
        @keyframes gbDraw { to { stroke-dashoffset: 0; } }
        @keyframes gbFade { to { opacity: 1; } }
      `}</style>
    </div>
  )
}

// ── Shared row component ──────────────────────────────────────────────────────

const CHIP_COLOR: Record<Outcome, string> = {
  HR: BLUE, '3B': '#7c3aed', '2B': '#2563eb', '1B': '#0ea5e9',
  BB: '#16a34a', K: '#ef4444', OUT: '#64748b', E: '#f59e0b', SF: '#0284c7', DP: '#dc2626',
}

function PlayerRow({ name, rar, events, maxAbsRar, isSelected, perspective, onSelect }: {
  name: string
  rar: number
  events: GameEvent[]
  maxAbsRar: number
  isSelected: boolean
  perspective: 'batter' | 'pitcher'
  onSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const barPct = maxAbsRar > 0 ? (Math.abs(rar) / maxAbsRar) * 100 : 0
  const isPos = rar >= 0

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
        style={{ backgroundColor: isSelected ? `${BLUE}14` : undefined }}
        onClick={onSelect}
      >
        <div className="w-28 text-xs font-semibold text-538-text truncate">{name}</div>
        <div className="flex-1 h-3 flex items-center">
          <div className="h-1.5 rounded-full" style={{
            width: `${barPct}%`, backgroundColor: isPos ? BLUE : '#ef4444', opacity: 0.75,
          }} />
        </div>
        <div className="text-xs font-mono font-bold w-14 text-right"
          style={{ color: isPos ? BLUE : '#ef4444' }}>
          {isPos ? '+' : ''}{rar.toFixed(2)}
        </div>
        <button className="text-538-muted hover:text-538-text text-xs w-4 flex-shrink-0"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}>
          {expanded ? '▲' : '▼'}
        </button>
      </div>
      {expanded && (
        <div className="mx-3 mb-1 text-2xs" style={{ borderLeft: `2px solid ${BLUE}35` }}>
          {events.map(ev => {
            const displayRv = perspective === 'pitcher' ? -ev.rv : ev.rv
            return (
              <div key={ev.id} className="flex items-center gap-2 px-3 py-1 border-b border-538-border last:border-0">
                <span className="font-bold font-mono rounded px-1 leading-4 flex-shrink-0 text-white"
                  style={{ fontSize: '9px', backgroundColor: CHIP_COLOR[ev.outcome] ?? '#64748b' }}>
                  {ev.outcome}
                </span>
                <span className="text-538-muted flex-1 truncate">
                  Inn. {ev.inning} — {ev.description}
                </span>
                <span className="font-mono font-bold flex-shrink-0"
                  style={{ color: displayRv >= 0 ? BLUE : '#ef4444' }}>
                  {displayRv >= 0 ? '+' : ''}{displayRv.toFixed(2)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Pitcher summary stats strip ───────────────────────────────────────────────

function PitcherStats({ pitcher }: { pitcher: PitcherData }) {
  const stats = [
    { label: 'BF', value: pitcher.bf },
    { label: 'K', value: pitcher.k },
    { label: 'BB', value: pitcher.bb },
    { label: 'HR', value: pitcher.hr },
  ]
  return (
    <div className="flex gap-3 px-3 pb-1">
      {stats.map(s => (
        <span key={s.label} className="text-2xs text-538-muted">
          {s.label} <span className="font-semibold text-538-text">{s.value}</span>
        </span>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type TabId = 'away' | 'home' | 'pitching'

export default function GameBreakdown({
  gamePk,
  awayTeamName,
  homeTeamName,
  awayTeamAbbr,
  homeTeamAbbr,
  awayScore,
  homeScore,
  gameStatus,
  onClose,
}: GameBreakdownProps) {
  const [tab, setTab] = useState<TabId>('away')
  const [pitchSide, setPitchSide] = useState<'away' | 'home'>('away')
  const [gameData, setGameData] = useState<ParsedGame | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [fieldKey, setFieldKey] = useState(0)

  const isPreview = gameStatus === 'Preview'

  useEffect(() => {
    if (isPreview) { setLoading(false); return }
    setLoading(true); setError(null)
    fetchGameData(gamePk)
      .then(d => { setGameData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [gamePk, isPreview])

  // Reset selection on tab change
  useEffect(() => { setSelectedId(null) }, [tab, pitchSide])

  const isLive = gameStatus === 'Live'
  const isFinal = gameStatus === 'Final'

  // Determine current list and perspective
  const battersAway = (gameData?.batters ?? []).filter(b => b.isAway).sort((a, b) => b.rar - a.rar)
  const battersHome = (gameData?.batters ?? []).filter(b => !b.isAway).sort((a, b) => b.rar - a.rar)
  const pitchersAway = (gameData?.pitchers ?? []).filter(p => p.isAway).sort((a, b) => b.rar - a.rar)
  const pitchersHome = (gameData?.pitchers ?? []).filter(p => !p.isAway).sort((a, b) => b.rar - a.rar)

  const isBatting = tab !== 'pitching'
  const currentBatters = tab === 'away' ? battersAway : battersHome
  const currentPitchers = pitchSide === 'away' ? pitchersAway : pitchersHome
  const currentList = isBatting ? currentBatters : currentPitchers
  const perspective: 'batter' | 'pitcher' = isBatting ? 'batter' : 'pitcher'

  const maxAbsRar = Math.max(...currentList.map(p => Math.abs(p.rar)), 0.01)

  // Find selected entry for field panel
  const selectedBatter = isBatting
    ? currentBatters.find(b => b.batterId === selectedId) ?? null
    : null
  const selectedPitcher = !isBatting
    ? currentPitchers.find(p => p.pitcherId === selectedId) ?? null
    : null
  const selectedEvents = selectedBatter?.events ?? selectedPitcher?.events ?? null
  const selectedName = selectedBatter?.name ?? selectedPitcher?.name ?? null

  function handleSelect(id: number) {
    if (selectedId === id) { setSelectedId(null); return }
    setSelectedId(id)
    setFieldKey(k => k + 1)
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: 'away', label: `${awayTeamAbbr} Bat` },
    { id: 'home', label: `${homeTeamAbbr} Bat` },
    { id: 'pitching', label: 'Pitching' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface border border-538-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-7xl flex flex-col overflow-hidden"
        style={{ maxHeight: '95dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-538-border flex-shrink-0">
          {/* Drag handle — mobile only */}
          <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 bg-538-border rounded-full sm:hidden" />
          <div className="pt-1 sm:pt-0">
            <div className="font-bold text-538-text text-sm">
              {awayTeamName} <span className="font-normal text-538-muted">@</span> {homeTeamName}
            </div>
            <div className="text-2xs mt-0.5">
              {(isLive || isFinal) && awayScore !== null ? (
                <span style={{ color: isLive ? '#16a34a' : '#888' }}>
                  {isFinal ? 'FINAL' : '● LIVE'}: {awayScore} – {homeScore}
                  <span className="text-538-muted ml-2 hidden sm:inline">· Run values via linear weights</span>
                </span>
              ) : (
                <span className="text-538-muted">Game not yet started</span>
              )}
            </div>
          </div>
          <button onClick={onClose}
            className="text-538-muted hover:text-538-text text-base leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-538-bg flex-shrink-0">
            ✕
          </button>
        </div>

        {isPreview ? (
          <div className="flex-1 flex items-center justify-center text-center text-538-muted text-sm p-8">
            Game hasn't started yet. Check back once the game is Live or Final.
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center text-538-muted text-sm py-16">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 rounded-full animate-spin"
                style={{ borderColor: `${BLUE} transparent` }} />
              Loading play-by-play…
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <div className="text-sm text-red-500 mb-2">Could not load game data</div>
              <div className="text-2xs text-538-muted">{error}</div>
            </div>
          </div>
        ) : (
          // On mobile: single column, field below list when selected
          // On desktop (sm+): side-by-side
          <div className="flex flex-col sm:flex-row flex-1 overflow-hidden min-h-0">
            {/* Player list */}
            <div className="flex flex-col sm:flex-1 overflow-hidden sm:border-r border-538-border min-w-0">
              {/* Main tabs */}
              <div className="flex border-b border-538-border flex-shrink-0">
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors"
                    style={{
                      color: tab === t.id ? BLUE : undefined,
                      borderBottom: tab === t.id ? `2px solid ${BLUE}` : '2px solid transparent',
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Pitching sub-tabs */}
              {tab === 'pitching' && (
                <div className="flex border-b border-538-border bg-538-bg flex-shrink-0">
                  {(['away', 'home'] as const).map(s => (
                    <button key={s} onClick={() => setPitchSide(s)}
                      className="flex-1 py-1.5 text-2xs font-semibold uppercase tracking-wider transition-colors"
                      style={{ color: pitchSide === s ? BLUE : '#999' }}>
                      {s === 'away' ? awayTeamAbbr : homeTeamAbbr}
                    </button>
                  ))}
                </div>
              )}

              {/* Column headers */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-538-border bg-538-bg flex-shrink-0">
                <div className="w-28 text-2xs font-bold uppercase tracking-widest text-538-muted">
                  {isBatting ? 'Batter' : 'Pitcher'}
                </div>
                <div className="flex-1 text-2xs font-bold uppercase tracking-widest text-538-muted">
                  Run Value
                </div>
                <div className="w-14 text-right text-2xs font-bold uppercase tracking-widest text-538-muted">
                  RAR
                </div>
                <div className="w-4" />
              </div>

              {/* Rows — scrollable */}
              <div className="overflow-y-auto" style={{ maxHeight: selectedEvents ? '45dvh' : undefined, flex: selectedEvents ? 'none' : '1' }}>
                {currentList.length === 0 ? (
                  <div className="text-center text-538-muted text-xs py-8">
                    {isLive ? 'Waiting for data…' : 'No data found.'}
                  </div>
                ) : isBatting ? (
                  <>
                    {currentBatters.map(b => (
                      <PlayerRow
                        key={b.batterId}
                        name={b.name} rar={b.rar} events={b.events}
                        maxAbsRar={maxAbsRar} isSelected={selectedId === b.batterId}
                        perspective="batter"
                        onSelect={() => handleSelect(b.batterId)}
                      />
                    ))}
                  </>
                ) : (
                  <>
                    {currentPitchers.map(p => (
                      <div key={p.pitcherId}>
                        <PlayerRow
                          name={p.name} rar={p.rar} events={p.events}
                          maxAbsRar={maxAbsRar} isSelected={selectedId === p.pitcherId}
                          perspective="pitcher"
                          onSelect={() => handleSelect(p.pitcherId)}
                        />
                        <PitcherStats pitcher={p} />
                      </div>
                    ))}
                  </>
                )}
                <div className="px-3 py-2 text-2xs text-538-muted border-t border-538-border">
                  {isBatting
                    ? 'Batter RAR = Σ linear weights − replacement baseline · ▼ for events'
                    : 'Pitcher RAR = runs prevented vs replacement · ▼ for batters faced'}
                </div>
              </div>

              {/* Mobile field — inline below list when player selected */}
              {selectedEvents && selectedName && (
                <div className="sm:hidden border-t border-538-border overflow-y-auto flex-1 flex items-center justify-center py-2">
                  <BaseballField
                    events={selectedEvents}
                    name={selectedName}
                    animKey={fieldKey}
                    perspective={perspective}
                  />
                </div>
              )}
            </div>

            {/* Desktop field panel — right side, always visible */}
            <div className="hidden sm:flex w-96 flex-shrink-0 flex-col items-center justify-center p-4 overflow-hidden">
              {selectedEvents && selectedName ? (
                <BaseballField
                  events={selectedEvents}
                  name={selectedName}
                  animKey={fieldKey}
                  perspective={perspective}
                />
              ) : (
                <div className="flex flex-col items-center text-center text-538-muted text-xs gap-3 opacity-35">
                  <svg viewBox="0 0 80 76" style={{ width: 64, height: 60 }}>
                    <polygon points="40,68 58,50 40,32 22,50" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M 8 20 Q 40 4 72 20" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="40" y1="68" x2="8" y2="20" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="40" y1="68" x2="72" y2="20" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <span>Select a player<br/>to view field</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
