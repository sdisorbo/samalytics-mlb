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

// Lazy-load the 3D scene so three.js doesn't ship on other routes.
const PitchAnimation3D = dynamic(() => import('./PitchAnimation3D'), { ssr: false })
const PitchTestMode = dynamic(() => import('./PitchTestMode'), { ssr: false })

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
              style={{ color: '#fff', backgroundColor: '#7C2B1A' }}
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
  x: number // inches from plate center, +x = catcher's right (3B side)
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

  return (
    <div className="space-y-3">
      {/* Top bar: Test Mode entry */}
      <div className="flex justify-end">
        <button
          onClick={() => setTestMode(true)}
          className="px-3 py-1.5 text-xs font-bold rounded border-2 border-538-orange text-538-orange hover:bg-538-orange hover:text-white transition-colors"
        >
          ▶ Test Mode · Guess 10 Pitches
        </button>
      </div>

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
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-538-border bg-surface/90 text-538-text hover:bg-538-bg"
                >
                  ↺ Replay
                </button>
                <button
                  onClick={closeAnimation}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-538-border bg-surface/90 text-538-text hover:bg-538-bg"
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
    title: 'Leaderboard ranking',
    body: (
      <>
        <p>
          Source: <code>data/output/pitcher_arsenal.json</code> (Baseball Savant&apos;s
          pitch-arsenal &amp; pitch-movement leaderboards joined on pitcher_id × pitch_type).
        </p>
        <p>
          Run value per 100 (<code>RV/100</code>) is the per-pitch expected runs prevented
          relative to league average. Lower is better for the pitcher, so we sort ascending.
        </p>
        <Code>{`ranked.sort((a, b) => a.run_value_per_100 - b.run_value_per_100)
  .filter(p => pitcher.innings_pitched >= 20
            && p.usage_pct >= 5
            && p.run_value_per_100 !== null)
  .slice(0, 30)`}</Code>
      </>
    ),
  },
  {
    title: 'Trajectory physics',
    body: (
      <>
        <p>
          The ball follows projectile motion under gravity (g = 32.2 ft/s²) plus a spin
          drift that accumulates over flight. Release point is ~5 ft in front of the rubber
          (z = 55) at 6 ft height; the user&apos;s clicked target is the endpoint.
        </p>
        <p>
          Initial velocity is solved so that gravity + drift land the ball exactly at the
          target — effectively the pitcher &quot;aims&quot; to compensate for both forces.
        </p>
        <Code>{`pos(t) = release
       + v · t
       − ½ · g · t² · ŷ          // gravity
       + breakScene · (t/T)³     // late-loaded spin drift

v = (target − release + ½·g·T²·ŷ − breakScene) / T`}</Code>
        <p>
          Cubic drift <code>(t/T)³</code> means most of the deviation happens in the last
          third of flight — that&apos;s the &quot;snap&quot; of a curveball or sweeper.
        </p>
      </>
    ),
  },
  {
    title: 'Visual amplification',
    body: (
      <>
        <p>
          Statcast&apos;s induced vertical break is measured in inches. On a ~3-ft gravity
          drop at typical camera distances, raw values read as a near-straight line. We
          amplify the lateral break and downward IVB so the eye can read them — positive
          IVB (fastball ride) stays at 1× so 4-seamers still look realistic.
        </p>
        <Code>{`const X_AMP = 2.2           // all horizontal break
const Z_AMP_DOWN = 2.5      // applied only when IVB < 0

breakScene.x = -break_x / 12 * X_AMP
breakScene.y = break_z / 12 * (break_z < 0 ? Z_AMP_DOWN : 1)`}</Code>
        <p>
          The amplified break feeds both <code>v</code> and the drift, so the ball still
          lands exactly at the clicked spot — just with a more dramatic path getting there.
        </p>
      </>
    ),
  },
  {
    title: 'Camera + flight time',
    body: (
      <>
        <p>
          Camera rotates over <code>1.5 s</code> from a catcher-style position to the
          chosen view (Left / Center / Right batter angle), eased with cubic in-out. Ball
          flight is real-time: a 95 mph pitch covers the scene in ~0.4 s.
        </p>
        <Code>{`flightTime = distance(release, target) / (mph × 1.467)
// 1.467 = ft/s per mph`}</Code>
      </>
    ),
  },
]
