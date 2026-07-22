'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import type {
  Pitcher,
  PitcherArsenal,
  PitchArsenal,
  RankedPitch,
} from '../lib/types'
import { LogicBreakdown, Code } from './LogicBreakdown'
import DailyLeaderboard from './DailyLeaderboard'
import { useDailyLeaderboard } from '../lib/dailyLeaderboard'

// Lazy-load the 3D scene so three.js doesn't ship on other routes.
const PitchAnimation3D = dynamic(() => import('./PitchAnimation3D'), { ssr: false })
const PitchTestMode = dynamic(() => import('./PitchTestMode'), { ssr: false })
const PitchGameMode = dynamic(() => import('./PitchGameMode'), { ssr: false })

type ViewAngle = 'center' | 'right' | 'left'

// ── Pitch colors ──────────────────────────────────────────────────────────────
const PITCH_COLORS: Record<string, string> = {
  FF: '#C62828', SI: '#E64A19', FC: '#F57C00',
  SL: '#1565C0', ST: '#6A1B9A', SV: '#7B1FA2',
  CU: '#283593', KC: '#37474F',
  CH: '#2E7D32', FS: '#00695C',
  KN: '#546E7A', EP: '#78909C',
}
const pitchColor = (pt: string) => PITCH_COLORS[pt] ?? '#888'

function fmtWoba(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return v.toFixed(3).replace(/^0/, '')
}
function fmtPct(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return `${v.toFixed(dec)}%`
}
function fmtRv(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

// ── View angle toggle (Left / Center / Right) ────────────────────────────────
function AngleToggle({
  angle,
  onChange,
}: {
  angle: ViewAngle
  onChange: (a: ViewAngle) => void
}) {
  const options: { value: ViewAngle; label: string }[] = [
    { value: 'left', label: 'L' },
    { value: 'center', label: 'C' },
    { value: 'right', label: 'R' },
  ]
  return (
    <div className="inline-flex rounded border border-538-border overflow-hidden bg-surface/90">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={
            'px-2 py-1 text-xs font-bold transition-colors ' +
            (angle === opt.value
              ? 'bg-538-orange text-white'
              : 'text-538-muted hover:text-538-text')
          }
          title={`${opt.value === 'left' ? 'LHB' : opt.value === 'right' ? 'RHB' : 'Center'} view`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Searchable pitcher dropdown ───────────────────────────────────────────────
function SearchDropdown({
  items,
  selected,
  onSelect,
  placeholder,
}: {
  items: PitcherArsenal[]
  selected: PitcherArsenal | null
  onSelect: (p: PitcherArsenal | null) => void
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return items
      .filter((it) => it.name.toLowerCase().includes(q) || it.team.toLowerCase().includes(q))
      .slice(0, 25)
  }, [items, query])

  return (
    <div ref={ref} className="relative w-full">
      <div className="flex items-center border border-538-border rounded-sm bg-surface">
        {selected && !open ? (
          <div className="flex items-center flex-1 px-3 py-2 gap-2">
            <span className="font-semibold text-538-text text-sm">{selected.name}</span>
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ color: '#fff', backgroundColor: '#3D405B' }}
            >
              {selected.team}
            </span>
            <button
              onClick={() => {
                onSelect(null)
                setQuery('')
              }}
              className="ml-auto text-538-muted hover:text-538-text text-sm leading-none"
            >
              ✕
            </button>
          </div>
        ) : (
          <input
            className="flex-1 px-3 py-2 text-sm outline-none bg-transparent text-538-text placeholder:text-538-muted"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
          />
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-538-border rounded-sm shadow-xl max-h-64 overflow-y-auto">
          {filtered.map((item) => (
            <button
              key={item.player_id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-538-bg flex items-center gap-2 border-b border-538-border last:border-0"
              onClick={() => {
                onSelect(item)
                setQuery('')
                setOpen(false)
              }}
            >
              <span className="font-medium text-538-text">{item.name}</span>
              <span className="text-xs text-538-muted">{item.team}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Strike zone click target ──────────────────────────────────────────────────
// Coordinates are in inches relative to plate center: x ∈ [-25, 25], y ∈ [0, 60]
// (y is height above ground). Strike zone roughly 17" wide centered at x=0,
// from ~18" (knees) to ~42" (letters) high.
const ZONE_LEFT = -8.5
const ZONE_RIGHT = 8.5
const ZONE_BOTTOM = 18
const ZONE_TOP = 42
const VIEW_LEFT = -22
const VIEW_RIGHT = 22
const VIEW_BOTTOM = 8
const VIEW_TOP = 52
const VIEW_W = VIEW_RIGHT - VIEW_LEFT
const VIEW_H = VIEW_TOP - VIEW_BOTTOM

interface PitchLocation {
  x: number // inches from plate center, +x = catcher's right (1B side)
  y: number // inches above ground
}

function ZoneTarget({
  location,
  onClick,
  pitchTypeColor,
}: {
  location: PitchLocation | null
  onClick: (loc: PitchLocation) => void
  pitchTypeColor: string
}) {
  function handle(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // Convert pixel to inches in our viewbox coords.
    const x = VIEW_LEFT + (px / rect.width) * VIEW_W
    const yPixFromTop = py / rect.height
    const y = VIEW_TOP - yPixFromTop * VIEW_H
    onClick({ x, y })
  }

  // Inner 3×3 grid lines (heart vs shadow)
  const dx = (ZONE_RIGHT - ZONE_LEFT) / 3
  const dy = (ZONE_TOP - ZONE_BOTTOM) / 3

  return (
    <svg
      viewBox={`${VIEW_LEFT} ${-VIEW_TOP} ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full cursor-crosshair select-none"
      preserveAspectRatio="xMidYMid meet"
      onClick={handle}
      style={{ background: 'var(--color-surface)' }}
    >
      {/* y is inverted in SVG — we flip by negating y in path coords below */}
      {/* Outer zone */}
      <rect
        x={ZONE_LEFT}
        y={-ZONE_TOP}
        width={ZONE_RIGHT - ZONE_LEFT}
        height={ZONE_TOP - ZONE_BOTTOM}
        fill="rgba(120,120,120,0.08)"
        stroke="#C8B89E"
        strokeWidth={0.4}
      />
      {/* Inner grid lines (3x3) */}
      {[1, 2].map((i) => (
        <line
          key={`v${i}`}
          x1={ZONE_LEFT + i * dx}
          x2={ZONE_LEFT + i * dx}
          y1={-ZONE_TOP}
          y2={-ZONE_BOTTOM}
          stroke="#C8B89E"
          strokeWidth={0.2}
          strokeDasharray="0.6 0.6"
        />
      ))}
      {[1, 2].map((i) => (
        <line
          key={`h${i}`}
          x1={ZONE_LEFT}
          x2={ZONE_RIGHT}
          y1={-(ZONE_BOTTOM + i * dy)}
          y2={-(ZONE_BOTTOM + i * dy)}
          stroke="#C8B89E"
          strokeWidth={0.2}
          strokeDasharray="0.6 0.6"
        />
      ))}
      {/* Plate outline at the bottom — pentagon shape */}
      <polygon
        points={`-8.5,${-3} 8.5,${-3} 8.5,${-1.5} 0,${0} -8.5,${-1.5}`}
        fill="rgba(255,255,255,0.6)"
        stroke="#8A6248"
        strokeWidth={0.3}
      />
      {/* Click dot */}
      {location && (
        <g>
          <circle cx={location.x} cy={-location.y} r={1.4} fill={pitchTypeColor} fillOpacity={0.85} stroke="#fff" strokeWidth={0.4} />
          <circle cx={location.x} cy={-location.y} r={0.4} fill="#fff" />
        </g>
      )}
      {/* Catcher POV label */}
      <text x={VIEW_LEFT + 1} y={-VIEW_TOP + 2.5} fontSize="2" fill="#8A6248" opacity="0.6">
        catcher view — click where the pitch crosses
      </text>
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  ranked: RankedPitch[]
  arsenal: PitcherArsenal[]
  pitchers: Pitcher[]
}

export interface SelectedPitch {
  pitcher_name: string
  team: string
  pitch_type: string
  pitch_name: string
  usage_pct: number
  whiff_pct: number | null
  xwoba_against: number | null
  woba_against: number | null
  run_value_per_100: number | null
  avg_speed: number | null
  break_x: number | null
  break_z: number | null
  pitcher_hand: 'R' | 'L' // approximated from break direction
  // Kinematic averages — when present, the animation uses these instead of
  // hardcoded release point + heuristic break.
  release_pos_x?: number | null
  release_pos_y?: number | null
  release_pos_z?: number | null
  release_extension?: number | null
  release_spin_rate?: number | null
  spin_axis?: number | null
  effective_speed?: number | null
  vx0?: number | null
  vy0?: number | null
  vz0?: number | null
  ax?: number | null
  ay?: number | null
  az?: number | null
  arm_angle?: number | null
}

// Infer pitcher hand from break_x sign for arm-side pitches in the arsenal.
function inferHand(arsenal: PitchArsenal[]): 'R' | 'L' {
  // FF/SI/CH typically arm-side: positive break_x in pitcher's perspective for RHP, negative for LHP.
  for (const p of arsenal) {
    if (['FF', 'SI', 'CH'].includes(p.pitch_type) && p.break_x !== null) {
      return p.break_x >= 0 ? 'R' : 'L'
    }
  }
  return 'R'
}

export default function PitchVisualizer({ ranked, arsenal, pitchers: _pitchers }: Props) {
  const [selectedPitcher, setSelectedPitcher] = useState<PitcherArsenal | null>(null)
  const [selectedPitch, setSelectedPitch] = useState<SelectedPitch | null>(null)
  const [location, setLocation] = useState<PitchLocation | null>(null)
  const [animationKey, setAnimationKey] = useState(0)
  const [animating, setAnimating] = useState(false)
  const [angle, setAngle] = useState<ViewAngle>('center')
  const [testMode, setTestMode] = useState(false)
  const [gameMode, setGameMode] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const { data: leaderboardData } = useDailyLeaderboard()

  // Build a SelectedPitch from a sidebar leaderboard row.
  function pickFromRanked(r: RankedPitch) {
    const hisArsenal = arsenal.find((a) => a.player_id === r.pitcher_id)
    const hand = hisArsenal ? inferHand(hisArsenal.pitches) : 'R'
    if (hisArsenal) setSelectedPitcher(hisArsenal)
    setSelectedPitch({
      pitcher_name: r.pitcher_name,
      team: r.team,
      pitch_type: r.pitch_type,
      pitch_name: r.pitch_name,
      usage_pct: r.usage_pct,
      whiff_pct: r.whiff_pct,
      xwoba_against: r.xwoba_against,
      woba_against: r.woba_against,
      run_value_per_100: r.run_value_per_100,
      avg_speed: r.avg_speed,
      break_x: r.break_x,
      break_z: r.break_z,
      pitcher_hand: hand,
      release_pos_x: r.release_pos_x,
      release_pos_y: r.release_pos_y,
      release_pos_z: r.release_pos_z,
      release_extension: r.release_extension,
      release_spin_rate: r.release_spin_rate,
      spin_axis: r.spin_axis,
      effective_speed: r.effective_speed,
      vx0: r.vx0,
      vy0: r.vy0,
      vz0: r.vz0,
      ax: r.ax,
      ay: r.ay,
      az: r.az,
      arm_angle: r.arm_angle,
    })
    setLocation(null)
    setAnimating(false)
  }

  // Build a SelectedPitch from clicking an arsenal chip.
  function pickFromArsenal(p: PitchArsenal) {
    if (!selectedPitcher) return
    const hand = inferHand(selectedPitcher.pitches)
    setSelectedPitch({
      pitcher_name: selectedPitcher.name,
      team: selectedPitcher.team,
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
      pitcher_hand: hand,
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
    })
    setLocation(null)
    setAnimating(false)
  }

  function throwPitch() {
    if (!selectedPitch || !location) return
    setAnimationKey((k) => k + 1)
    setAnimating(true)
  }

  function closeAnimation() {
    setAnimating(false)
  }

  const canThrow = !!selectedPitch && !!location

  if (testMode) {
    return <PitchTestMode arsenal={arsenal} onExit={() => setTestMode(false)} />
  }
  if (gameMode) {
    return (
      <PitchGameMode
        initialPitcher={selectedPitcher}
        arsenal={arsenal}
        onExit={() => setGameMode(false)}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Top bar: Test Mode + Game Mode + collapsible Daily Leaderboard */}
      <div className="flex justify-end gap-2 flex-wrap">
        <button
          onClick={() => setLeaderboardOpen((v) => !v)}
          className="px-3 py-1.5 text-xs font-bold rounded border-2 border-538-orange text-538-orange hover:bg-538-orange hover:text-white transition-colors"
        >
          🏆 Daily Leaderboard {leaderboardOpen ? '▴' : '▾'}
        </button>
        <button
          onClick={() => setGameMode(true)}
          className="px-3 py-1.5 text-xs font-bold rounded border-2 border-538-orange text-538-orange hover:bg-538-orange hover:text-white transition-colors"
        >
          🎮 Game Mode · Try to Hit
        </button>
        <button
          onClick={() => setTestMode(true)}
          className="px-3 py-1.5 text-xs font-bold rounded border-2 border-538-orange text-538-orange hover:bg-538-orange hover:text-white transition-colors"
        >
          ▶ Test Mode · Guess 10 Pitches
        </button>
      </div>

      {leaderboardOpen && (
        <DailyLeaderboard data={leaderboardData} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="border border-538-border rounded bg-surface overflow-hidden h-fit">
        <div className="px-3 py-2 border-b border-538-border">
          <h2 className="text-sm font-bold text-538-text">League&apos;s Best Pitches</h2>
          <p className="text-[10px] text-538-muted">By run value / 100 · min 20 IP, 5% usage</p>
        </div>
        <ul className="max-h-[600px] overflow-y-auto divide-y divide-538-border">
          {ranked.map((r, i) => {
            const isActive =
              selectedPitch?.pitcher_name === r.pitcher_name &&
              selectedPitch?.pitch_type === r.pitch_type
            return (
              <li key={`${r.pitcher_id}-${r.pitch_type}`}>
                <button
                  onClick={() => pickFromRanked(r)}
                  className={
                    'w-full text-left px-3 py-2 text-xs hover:bg-538-bg transition-colors' +
                    (isActive ? ' bg-538-bg' : '')
                  }
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] text-538-muted tabular-nums w-5">{i + 1}</span>
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: pitchColor(r.pitch_type) }}
                    />
                    <span className="font-semibold text-538-text">{r.pitch_name}</span>
                  </div>
                  <div className="ml-7 mt-0.5 flex items-center gap-1.5 text-[10px] text-538-muted">
                    <span className="font-medium text-538-text">{r.pitcher_name}</span>
                    <span>{r.team}</span>
                  </div>
                  <div className="ml-7 mt-1 grid grid-cols-4 gap-1 text-[10px] tabular-nums">
                    <div>
                      <div className="text-538-muted">RV/100</div>
                      <div className="font-bold" style={{ color: pitchColor(r.pitch_type) }}>
                        {fmtRv(r.run_value_per_100)}
                      </div>
                    </div>
                    <div>
                      <div className="text-538-muted">xwOBA</div>
                      <div className="font-medium">{fmtWoba(r.xwoba_against)}</div>
                    </div>
                    <div>
                      <div className="text-538-muted">Whiff</div>
                      <div className="font-medium">{fmtPct(r.whiff_pct)}</div>
                    </div>
                    <div>
                      <div className="text-538-muted">Use</div>
                      <div className="font-medium">{fmtPct(r.usage_pct)}</div>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* ── Main panel ───────────────────────────────────────────────────── */}
      <section className="space-y-4 min-w-0">
        {/* Search + arsenal chips */}
        <div className="border border-538-border rounded bg-surface p-3">
          <label className="text-xs font-semibold text-538-muted uppercase tracking-wider mb-1 block">
            Pitcher
          </label>
          <SearchDropdown
            items={arsenal}
            selected={selectedPitcher}
            onSelect={(p) => {
              setSelectedPitcher(p)
              setSelectedPitch(null)
              setLocation(null)
              setAnimating(false)
            }}
            placeholder="Search any pitcher…"
          />
          {selectedPitcher && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-538-muted mr-1">Arsenal</span>
              {selectedPitcher.pitches.map((p) => {
                const isActive = selectedPitch?.pitch_type === p.pitch_type
                return (
                  <button
                    key={p.pitch_type}
                    onClick={() => pickFromArsenal(p)}
                    className="px-2 py-1 text-xs font-bold rounded border-2 transition-colors"
                    style={{
                      color: isActive ? '#fff' : pitchColor(p.pitch_type),
                      backgroundColor: isActive ? pitchColor(p.pitch_type) : 'transparent',
                      borderColor: pitchColor(p.pitch_type),
                    }}
                    title={`${p.pitch_name} — ${(p.usage_pct ?? 0).toFixed(0)}% usage`}
                  >
                    {p.pitch_type}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Selected pitch summary */}
        {selectedPitch && (
          <div className="border border-538-border rounded bg-surface px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: pitchColor(selectedPitch.pitch_type) }}
              />
              <span className="font-bold text-538-text">{selectedPitch.pitch_name}</span>
              <span className="text-538-muted">— {selectedPitch.pitcher_name}</span>
            </div>
            <div className="text-538-muted">
              Velo <span className="font-bold text-538-text tabular-nums">
                {selectedPitch.avg_speed?.toFixed(1) ?? '—'}
              </span> mph
            </div>
            <div className="text-538-muted">
              H-Break <span className="font-bold text-538-text tabular-nums">
                {selectedPitch.break_x?.toFixed(1) ?? '—'}
              </span>″
            </div>
            <div className="text-538-muted">
              V-Break <span className="font-bold text-538-text tabular-nums">
                {selectedPitch.break_z?.toFixed(1) ?? '—'}
              </span>″
            </div>
            <div className="text-538-muted">
              xwOBA <span className="font-bold text-538-text tabular-nums">
                {fmtWoba(selectedPitch.xwoba_against)}
              </span>
            </div>
            <div className="text-538-muted">
              Whiff <span className="font-bold text-538-text tabular-nums">
                {fmtPct(selectedPitch.whiff_pct)}
              </span>
            </div>
          </div>
        )}

        {/* Zone target OR 3D scene */}
        <div className="border border-538-border rounded bg-surface overflow-hidden">
          {animating && selectedPitch && location ? (
            <div className="aspect-[4/3] relative bg-black">
              <PitchAnimation3D
                key={animationKey}
                pitch={selectedPitch}
                target={location}
                angle={angle}
              />
              <div className="absolute top-3 right-3 flex gap-2 items-center">
                <AngleToggle
                  angle={angle}
                  onChange={(a) => {
                    setAngle(a)
                    setAnimationKey((k) => k + 1)
                  }}
                />
                <button
                  onClick={() => setAnimationKey((k) => k + 1)}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-white/30 bg-black/40 text-white hover:bg-black/60"
                >
                  ↺ Replay
                </button>
                <button
                  onClick={closeAnimation}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-white/30 bg-black/40 text-white hover:bg-black/60"
                >
                  ✕ Close
                </button>
              </div>
            </div>
          ) : (
            <div className="aspect-[4/3] flex flex-col">
              <div className="flex-1 min-h-0">
                {selectedPitch ? (
                  <ZoneTarget
                    location={location}
                    onClick={setLocation}
                    pitchTypeColor={pitchColor(selectedPitch.pitch_type)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-538-muted text-sm">
                    Pick a pitch from the sidebar or search a pitcher to begin.
                  </div>
                )}
              </div>
              {selectedPitch && (
                <div className="border-t border-538-border px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-538-muted">
                    {location
                      ? `Pitch will land at (${location.x.toFixed(1)}″, ${location.y.toFixed(1)}″)`
                      : 'Click the zone to set where the pitch crosses the plate.'}
                  </div>
                  <div className="flex items-center gap-2">
                    <AngleToggle angle={angle} onChange={setAngle} />
                    <button
                      onClick={throwPitch}
                      disabled={!canThrow}
                      className="px-4 py-1.5 text-xs font-bold rounded text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: pitchColor(selectedPitch.pitch_type) }}
                    >
                      ▶ Throw Pitch
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      </div>

      <LogicBreakdown sections={PITCH_VIS_SECTIONS} />
    </div>
  )
}

const PITCH_VIS_SECTIONS = [
  {
    title: 'Data sources',
    body: (
      <>
        <p>
          Three Baseball Savant endpoints are joined per (pitcher_id × pitch_type) into
          one row per pitch type in <code>pitcher_arsenal.json</code>.
        </p>
        <Code>{`/leaderboard/pitch-arsenal-stats
  → usage_pct, whiff_pct, woba/xwoba_against,
    hard_hit_pct, run_value_per_100

/leaderboard/pitch-movement
  → avg_speed, break_x, break_z (induced vertical break),
    pitch_hand

/statcast_search/csv  (per-pitch, aggregated locally by month)
  → release_pos_x/y/z, release_extension, release_spin_rate,
    spin_axis, effective_speed, arm_angle,
    vx0/vy0/vz0, ax/ay/az          ← used for the 3D trajectory`}</Code>
        <p>
          The Statcast Search pull is the expensive one (~200K pitches/season). It runs
          in monthly chunks and averages per pitch-type. Only the per-pitch-type aggregates
          are persisted, not the individual pitches.
        </p>
      </>
    ),
  },
  {
    title: 'Leaderboard ranking (best pitches)',
    body: (
      <>
        <p>
          The sidebar ranks pitches by <strong>run value per 100 thrown</strong>. RV/100
          is computed by Savant: each pitch state-change (e.g. 1-1 → 1-2 via called
          strike) has a known impact on run expectancy. Sum across every throw, divide
          by total throws, multiply by 100. Lower is better for the pitcher.
        </p>
        <Code>{`ranked = arsenal
  .flatMap(p => p.pitches.map(pitch => ({ ...pitch, pitcher: p })))
  .filter(r => r.pitcher.innings_pitched >= 20
            && r.usage_pct >= 5
            && r.run_value_per_100 !== null)
  .sort((a, b) => a.run_value_per_100 - b.run_value_per_100)
  .slice(0, 30)`}</Code>
        <p>
          Min 20 IP filters out fringe pitchers; min 5% usage filters out fluke pitch
          types (e.g. a pitcher who threw 3 sliders all season).
        </p>
      </>
    ),
  },
  {
    title: 'Trajectory: real kinematics (when available)',
    body: (
      <>
        <p>
          When per-pitch-type Statcast kinematics are loaded, the animation skips
          heuristics and integrates the actual physical motion of the average pitch.
        </p>
        <p>
          <strong>Inputs from Statcast</strong> (per pitch type, season averages):
        </p>
        <ul className="list-disc pl-5 space-y-0.5 my-1">
          <li><code>release_pos_x, y, z</code> — actual 3D release point in feet</li>
          <li><code>ax, ay, az</code> — acceleration vector that already combines gravity AND the Magnus force of the pitch&apos;s spin</li>
          <li><code>effective_speed</code> — perceived velocity at the plate (uses extension)</li>
        </ul>
        <p>
          The acceleration is the key — Statcast doesn&apos;t need us to separately model
          spin direction or Magnus force, because the radar-measured <code>a</code> vector
          encodes both gravity and the spin-induced lift/drift in one number per axis.
          A 4-seam fastball has <code>az ≈ −18</code> (gravity offset by backspin lift); a
          curveball has <code>az ≈ −45</code> (gravity enhanced by topspin push).
        </p>
        <Code>{`// Statcast (catcher-view) → our scene frame:
//   scene.x = −statcast.x   (flip to put 3B-side = +x)
//   scene.y =  statcast.z   (height, +up)
//   scene.z =  statcast.y   (depth toward mound, +z)

T = distance(release, target) / (effective_speed × 1.467)

// Solve initial velocity to land at user's clicked target:
v = (target − release − ½·a·T²) / T

// Replay the real physical trajectory:
pos(t) = release + v·t + ½·a·t²`}</Code>
        <p>
          The user still controls the endpoint (where the ball crosses the plate); the
          model just figures out the initial velocity that, given the real Magnus
          acceleration, lands there. The trajectory shape (late break, ride, sweep) emerges
          from the real <code>a</code>, not from an amplified curve.
        </p>
      </>
    ),
  },
  {
    title: 'Trajectory: fallback when kinematics missing',
    body: (
      <>
        <p>
          For pitch types without Statcast kinematic data (very rare types, sparse pitchers,
          older seasons), we fall back to the older model: explicit gravity plus a cubic
          late-loaded spin drift derived from <code>break_x</code> and <code>break_z</code>.
        </p>
        <Code>{`pos(t) = release
       + v · t
       + ½ · (0, −g, 0) · t²
       + breakScene · (t/T)³

breakScene.x = break_x  / 12 × 2.2          // horizontal amplification
breakScene.y = break_z  / 12 × (break_z < 0 ? 2.5 : 1.0)
//             ↑ negative IVB (curveballs) amplified;
//               positive IVB (fastballs) untouched

v = (target − release − ½·(0,−g,0)·T² − breakScene) / T`}</Code>
        <p>
          The cubic <code>(t/T)³</code> drift concentrates 75% of the break in the last
          third of flight — the &quot;snap&quot;. Amplification is needed because real IVB
          values are only ~10 inches against ~3 ft of gravity drop; without it everything
          looks straight at the camera distances we use.
        </p>
        <p className="text-538-orange">
          Kinematic path is preferred whenever available — the heuristic fallback is here
          only for completeness.
        </p>
      </>
    ),
  },
  {
    title: 'Coordinate frames',
    body: (
      <>
        <p>
          three.js&apos;s default camera looks down its local −z axis. When we point the
          camera at a +z target (the mound), the camera&apos;s right-vector ends up in
          world −x. We pick world +x = 3B side specifically so that the on-screen mapping
          comes out correct:
        </p>
        <Code>{`world +x = 3B side  → renders on SCREEN LEFT
world −x = 1B side  → renders on SCREEN RIGHT
world +y = up       → SCREEN UP
world +z = toward mound

// SVG zone click uses broadcast convention (+svg_x = catcher's
// right = 1B side), so we negate to map into scene coords:
target.scene.x = −svg.x / 12
target.scene.y =  svg.y / 12`}</Code>
        <p>
          Pitcher release sides follow the same convention: RHP at <code>+x</code> (3B),
          LHP at <code>−x</code> (1B). When kinematics are loaded this is no longer
          inferred — it&apos;s read directly from <code>release_pos_x</code>.
        </p>
      </>
    ),
  },
  {
    title: 'Camera, lighting, timing',
    body: (
      <>
        <p>
          Camera does a 1.5-second cubic-eased pan from a catcher-style starting position
          to the chosen end view (Left / Center / Right batter angle). Then the ball
          flies in real time — distance / speed at MLB scale.
        </p>
        <Code>{`startPos: (0, 4.8, −9)         // behind plate, slight elevation
endPos:
  center: (0,    5.6, −10)
  right:  (+3.5, 5.8, −8)     // RHB box (3B side = world +x)
  left:   (−3.5, 5.8, −8)     // LHB box (1B side)

camera rotation duration  = 1.5 s, easeInOutCubic
ball flight time          = distance / (effective_speed × 1.467)
trail                     = polyline updated each frame, persists at freeze`}</Code>
        <p>
          A 95-mph pitch covers the ~55 ft from release to plate in ~0.4 s; an 80-mph
          curveball takes ~0.5 s. That speed delta is the deceptive part of the matchup
          and we preserve it as real-time difference.
        </p>
      </>
    ),
  },
  {
    title: "What's assumed vs. measured",
    body: (
      <>
        <p>
          Honesty check on what comes from data and what is stylized:
        </p>
        <Code>{`MEASURED FROM DATA  (Statcast averages, per pitcher × pitch_type):
  ✓ release point (x, y, z)
  ✓ acceleration vector (gravity + Magnus combined)
  ✓ effective speed
  ✓ flight time (derived from release distance + speed)
  ✓ spin rate, spin axis (collected but not currently rendered)
  ✓ arm angle (collected but not currently rendered)

ASSUMED / STYLIZED:
  • Target endpoint = user's click (not the pitcher's actual avg location)
  • Initial velocity = solved to hit user's target with real a
  • Camera positions and FOV are chosen for readability, not realism
  • Ball size is real (~1.45" radius); spin rotation not modeled
  • Pitcher silhouette is replaced with a colored release sphere`}</Code>
        <p>
          So the on-screen <em>shape</em> of every pitch (the curve, the ride, the late
          drop) is physically accurate to the average Skenes splitter / Cole slider /
          whoever&apos;s pitch you picked. The <em>landing spot</em> is your call.
        </p>
      </>
    ),
  },
]
