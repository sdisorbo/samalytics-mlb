'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { PitcherArsenal, BatterVsPitch, PitchArsenal, PitchVsStats } from '../lib/types'

// ── Pitch type colors ─────────────────────────────────────────────────────────
const PITCH_COLORS: Record<string, string> = {
  FF: '#C62828', // 4-Seam Fastball
  SI: '#E64A19', // Sinker
  FC: '#F57C00', // Cutter
  SL: '#1565C0', // Slider
  ST: '#6A1B9A', // Sweeper
  SV: '#7B1FA2', // Slurve
  CU: '#283593', // Curveball
  KC: '#37474F', // Knuckle Curve
  CH: '#2E7D32', // Changeup
  FS: '#00695C', // Splitter
  KN: '#546E7A', // Knuckleball
  EP: '#78909C', // Eephus
}

function pitchColor(pt: string): string {
  return PITCH_COLORS[pt] ?? '#888888'
}

function fmt(val: number | null | undefined, dec = 1, suffix = ''): string {
  if (val === null || val === undefined) return '—'
  return `${val.toFixed(dec)}${suffix}`
}

function fmtWoba(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  return val.toFixed(3).replace(/^0/, '')
}

function fmtRv(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  const sign = val > 0 ? '+' : ''
  return `${sign}${val.toFixed(1)}`
}

// ── Searchable Dropdown ───────────────────────────────────────────────────────
function SearchDropdown<T extends { player_id: number; name: string; team: string }>({
  items,
  selected,
  onSelect,
  placeholder,
}: {
  items: T[]
  selected: T | null
  onSelect: (item: T | null) => void
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return items
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) || item.team.toLowerCase().includes(q)
      )
      .slice(0, 25)
  }, [items, query])

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center border border-538-border rounded-sm bg-white">
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
        <div className="absolute z-50 w-full mt-1 bg-white border border-538-border rounded-sm shadow-xl max-h-64 overflow-y-auto">
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

// ── Movement Plot ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MovementDot = (props: any) => {
  const { cx, cy, payload } = props
  if (!cx || !cy) return null
  const color = pitchColor(payload.pitch_type)
  const r = Math.max(8, Math.min(16, ((payload.usage_pct ?? 10) / 50) * 16 + 4))
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.85} stroke="#fff" strokeWidth={1.5} />
      <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize={9} fill={color} fontWeight="700">
        {payload.pitch_type}
      </text>
    </g>
  )
}

function MovementPlot({ pitches }: { pitches: PitchArsenal[] }) {
  const withMovement = pitches.filter((p) => p.break_x !== null && p.break_z !== null)
  if (withMovement.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-538-muted text-sm">
        Movement data not available
      </div>
    )
  }

  const data = withMovement.map((p) => ({
    x: p.break_x!,
    y: p.break_z!,
    pitch_type: p.pitch_type,
    pitch_name: p.pitch_name,
    usage_pct: p.usage_pct,
    avg_speed: p.avg_speed,
  }))

  return (
    <div>
      <div className="text-xs text-538-muted mb-1 text-center">
        Pitch Movement — pitcher&apos;s perspective (inches). Dot size = usage%.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
          <XAxis
            type="number"
            dataKey="x"
            domain={[-24, 24]}
            tickCount={5}
            tick={{ fontSize: 10, fill: '#8A6248' }}
            label={{ value: 'Horizontal Break', position: 'insideBottom', offset: -8, fontSize: 10, fill: '#8A6248' }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[-24, 24]}
            tickCount={5}
            tick={{ fontSize: 10, fill: '#8A6248' }}
            label={{ value: 'Vert. Break', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#8A6248' }}
          />
          <ReferenceLine x={0} stroke="#DDD0C0" strokeDasharray="3 3" />
          <ReferenceLine y={0} stroke="#DDD0C0" strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="bg-white border border-538-border rounded px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold" style={{ color: pitchColor(d.pitch_type) }}>
                    {d.pitch_name}
                  </div>
                  <div className="text-538-muted mt-1">
                    Velo: {fmt(d.avg_speed, 1, ' mph')}
                  </div>
                  <div className="text-538-muted">
                    H-Break: {fmt(d.x, 1, '"')} | V-Break: {fmt(d.y, 1, '"')}
                  </div>
                  <div className="text-538-muted">Usage: {fmt(d.usage_pct, 1, '%')}</div>
                </div>
              )
            }}
          />
          <Scatter data={data} shape={<MovementDot />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Arsenal Table ─────────────────────────────────────────────────────────────
function ArsenalTable({ pitches }: { pitches: PitchArsenal[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-538-border text-538-muted uppercase tracking-wider">
            <th className="text-left py-2 pr-3 font-semibold">Pitch</th>
            <th className="text-right py-2 px-2 font-semibold">Use%</th>
            <th className="text-right py-2 px-2 font-semibold">Velo</th>
            <th className="text-right py-2 px-2 font-semibold">Whiff%</th>
            <th className="text-right py-2 px-2 font-semibold">wOBA</th>
            <th className="text-right py-2 pl-2 font-semibold">RV/100</th>
          </tr>
        </thead>
        <tbody>
          {pitches.map((p) => {
            const rv = p.run_value_per_100
            const rvColor =
              rv === null ? '#8A6248' : rv < -1 ? '#1a7a3a' : rv > 1 ? '#b52222' : '#8A6248'
            return (
              <tr key={p.pitch_type} className="border-b border-538-border last:border-0">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: pitchColor(p.pitch_type) }}
                    />
                    <span className="font-semibold text-538-text">{p.pitch_type}</span>
                    <span className="text-538-muted hidden sm:inline">{p.pitch_name}</span>
                  </div>
                </td>
                <td className="text-right py-2 px-2 text-538-text font-medium">
                  {fmt(p.usage_pct, 1, '%')}
                </td>
                <td className="text-right py-2 px-2 text-538-text">
                  {fmt(p.avg_speed, 1)}
                </td>
                <td className="text-right py-2 px-2 text-538-text">
                  {fmt(p.whiff_pct, 1, '%')}
                </td>
                <td className="text-right py-2 px-2 text-538-text">
                  {fmtWoba(p.woba_against)}
                </td>
                <td className="text-right py-2 pl-2 font-semibold" style={{ color: rvColor }}>
                  {fmtRv(rv)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Batter vs Pitch Table ─────────────────────────────────────────────────────
function BatterVsPitchTable({ pitches }: { pitches: PitchVsStats[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-538-border text-538-muted uppercase tracking-wider">
            <th className="text-left py-2 pr-3 font-semibold">Pitch</th>
            <th className="text-right py-2 px-2 font-semibold">PA</th>
            <th className="text-right py-2 px-2 font-semibold">wOBA</th>
            <th className="text-right py-2 px-2 font-semibold">xwOBA</th>
            <th className="text-right py-2 px-2 font-semibold">Whiff%</th>
            <th className="text-right py-2 pl-2 font-semibold">HH%</th>
          </tr>
        </thead>
        <tbody>
          {pitches.map((p) => {
            const woba = p.woba
            const wobaColor =
              woba === null ? '#8A6248' : woba >= 0.37 ? '#1a7a3a' : woba <= 0.27 ? '#b52222' : '#8A6248'
            return (
              <tr key={p.pitch_type} className="border-b border-538-border last:border-0">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: pitchColor(p.pitch_type) }}
                    />
                    <span className="font-semibold text-538-text">{p.pitch_type}</span>
                    <span className="text-538-muted hidden sm:inline">{p.pitch_name}</span>
                  </div>
                </td>
                <td className="text-right py-2 px-2 text-538-muted">{p.pa}</td>
                <td className="text-right py-2 px-2 font-semibold" style={{ color: wobaColor }}>
                  {fmtWoba(woba)}
                </td>
                <td className="text-right py-2 px-2 text-538-text">{fmtWoba(p.xwoba)}</td>
                <td className="text-right py-2 px-2 text-538-text">
                  {fmt(p.whiff_pct, 1, '%')}
                </td>
                <td className="text-right py-2 pl-2 text-538-text">
                  {fmt(p.hard_hit_pct, 1, '%')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Matchup Edge ──────────────────────────────────────────────────────────────
function MatchupEdge({
  pitcher,
  batter,
}: {
  pitcher: PitcherArsenal
  batter: BatterVsPitch
}) {
  const pitcherMap = new Map(pitcher.pitches.map((p) => [p.pitch_type, p]))
  const batterMap = new Map(batter.vs_pitches.map((p) => [p.pitch_type, p]))
  const shared = [...pitcherMap.keys()].filter((pt) => batterMap.has(pt))

  if (shared.length === 0) {
    return (
      <div className="text-center text-538-muted text-sm py-8">
        No shared pitch types with enough data.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-538-border text-538-muted uppercase tracking-wider">
            <th className="text-left py-2 pr-3 font-semibold w-24">Pitch</th>
            <th className="text-right py-2 px-2 font-semibold text-538-orange">P Whiff%</th>
            <th className="text-right py-2 px-2 font-semibold text-538-orange">P wOBA</th>
            <th className="text-right py-2 px-2 font-semibold text-538-orange">P RV/100</th>
            <th className="w-8" />
            <th className="text-right py-2 px-2 font-semibold text-[#1565C0]">B xwOBA</th>
            <th className="text-right py-2 px-2 font-semibold text-[#1565C0]">B Whiff%</th>
            <th className="text-right py-2 pl-2 font-semibold text-[#1565C0]">B HH%</th>
            <th className="text-right py-2 pl-4 font-semibold">Edge</th>
          </tr>
        </thead>
        <tbody>
          {shared.map((pt) => {
            const pp = pitcherMap.get(pt)!
            const bp = batterMap.get(pt)!

            // Edge: negative pitcher rv/100 = pitcher dominates; high batter xwOBA = batter wins
            // Combine: batter xwOBA vs .320 avg and pitcher whiff vs 23% avg
            const wobaEdge = ((bp.xwoba ?? 0.32) - 0.32) * 5   // positive = batter
            const whiffEdge = ((pp.whiff_pct ?? 23) - 23) / 23  // positive = pitcher
            const edgeScore = wobaEdge - whiffEdge               // positive = batter, negative = pitcher

            const pctWidth = Math.min(Math.abs(edgeScore) * 40, 100)
            const batterWins = edgeScore > 0.05
            const pitcherWins = edgeScore < -0.05

            return (
              <tr key={pt} className="border-b border-538-border last:border-0">
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: pitchColor(pt) }}
                    />
                    <span className="font-semibold text-538-text">{pt}</span>
                  </div>
                </td>
                {/* Pitcher stats */}
                <td className="text-right py-2.5 px-2 text-538-text">
                  {fmt(pp.whiff_pct, 1, '%')}
                </td>
                <td className="text-right py-2.5 px-2 text-538-text">
                  {fmtWoba(pp.woba_against)}
                </td>
                <td className="text-right py-2.5 px-2 font-medium text-538-text">
                  {fmtRv(pp.run_value_per_100)}
                </td>
                <td className="px-1 text-538-border text-center">|</td>
                {/* Batter stats */}
                <td className="text-right py-2.5 px-2 text-538-text">
                  {fmtWoba(bp.xwoba)}
                </td>
                <td className="text-right py-2.5 px-2 text-538-text">
                  {fmt(bp.whiff_pct, 1, '%')}
                </td>
                <td className="text-right py-2.5 pl-2 text-538-text">
                  {fmt(bp.hard_hit_pct, 1, '%')}
                </td>
                {/* Edge bar */}
                <td className="py-2.5 pl-4 min-w-[120px]">
                  <div className="flex items-center gap-1">
                    {pitcherWins ? (
                      <>
                        <span className="text-[10px] font-bold text-538-orange w-12 text-right">
                          Pitcher
                        </span>
                        <div className="flex-1 h-3 rounded overflow-hidden bg-538-border/30">
                          <div
                            className="h-full rounded"
                            style={{ width: `${pctWidth}%`, background: '#7C2B1A' }}
                          />
                        </div>
                      </>
                    ) : batterWins ? (
                      <>
                        <div className="flex-1 h-3 rounded overflow-hidden bg-538-border/30">
                          <div
                            className="h-full rounded ml-auto"
                            style={{ width: `${pctWidth}%`, background: '#1565C0' }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-[#1565C0] w-12 text-left">
                          Batter
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-538-muted w-full text-center">Even</span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function MatchupTool({
  pitchers,
  batters,
}: {
  pitchers: PitcherArsenal[]
  batters: BatterVsPitch[]
}) {
  const [selectedPitcher, setSelectedPitcher] = useState<PitcherArsenal | null>(null)
  const [selectedBatter, setSelectedBatter] = useState<BatterVsPitch | null>(null)

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-538-muted mb-1.5">
            Select Pitcher
          </label>
          <SearchDropdown
            items={pitchers}
            selected={selectedPitcher}
            onSelect={setSelectedPitcher}
            placeholder="Search pitcher name or team..."
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-538-muted mb-1.5">
            Select Batter
          </label>
          <SearchDropdown
            items={batters}
            selected={selectedBatter}
            onSelect={setSelectedBatter}
            placeholder="Search batter name or team..."
          />
        </div>
      </div>

      {/* Empty state */}
      {!selectedPitcher && !selectedBatter && (
        <div className="text-center py-16 text-538-muted text-sm border border-538-border rounded-sm bg-538-bg">
          Select a pitcher and/or batter to begin the matchup analysis.
        </div>
      )}

      {/* Two-panel layout */}
      {(selectedPitcher || selectedBatter) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pitcher Panel */}
          <div className="border border-538-border rounded-sm bg-white">
            {selectedPitcher ? (
              <>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-538-border bg-538-bg">
                  <span className="font-bold text-538-text">{selectedPitcher.name}</span>
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded text-white"
                    style={{ background: '#7C2B1A' }}
                  >
                    {selectedPitcher.team}
                  </span>
                  <span className="text-xs text-538-muted ml-auto">
                    {selectedPitcher.pitches.length} pitch types
                  </span>
                </div>
                <div className="p-4 space-y-5">
                  <MovementPlot pitches={selectedPitcher.pitches} />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-538-muted mb-2">
                      Arsenal
                    </div>
                    <ArsenalTable pitches={selectedPitcher.pitches} />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-64 text-538-muted text-sm">
                No pitcher selected
              </div>
            )}
          </div>

          {/* Batter Panel */}
          <div className="border border-538-border rounded-sm bg-white">
            {selectedBatter ? (
              <>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-538-border bg-538-bg">
                  <span className="font-bold text-538-text">{selectedBatter.name}</span>
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded text-white"
                    style={{ background: '#1565C0' }}
                  >
                    {selectedBatter.team}
                  </span>
                  <span className="text-xs text-538-muted ml-auto">
                    {selectedBatter.vs_pitches.length} pitch types faced
                  </span>
                </div>
                <div className="p-4">
                  <div className="text-xs font-semibold uppercase tracking-widest text-538-muted mb-2">
                    Performance vs Pitch Type
                  </div>
                  <BatterVsPitchTable pitches={selectedBatter.vs_pitches} />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-64 text-538-muted text-sm">
                No batter selected
              </div>
            )}
          </div>
        </div>
      )}

      {/* Matchup Edge */}
      {selectedPitcher && selectedBatter && (
        <div className="border border-538-border rounded-sm bg-white">
          <div className="px-4 py-3 border-b border-538-border bg-538-bg flex items-center gap-2">
            <span className="font-bold text-538-text">Matchup Edge</span>
            <span className="text-xs text-538-muted">
              {selectedPitcher.name}{' '}
              <span className="text-538-border">vs</span>{' '}
              {selectedBatter.name}
            </span>
          </div>
          <div className="p-4">
            <MatchupEdge pitcher={selectedPitcher} batter={selectedBatter} />
          </div>
          <div className="px-4 py-2 border-t border-538-border bg-538-bg text-[10px] text-538-muted leading-relaxed">
            <span className="font-semibold">Stat glossary — </span>
            <span><b>Use%</b>: share of pitches thrown of this type. </span>
            <span><b>Velo</b>: avg release speed (mph). </span>
            <span><b>Whiff%</b>: swings that miss. </span>
            <span><b>wOBA</b>: weighted on-base average allowed — measures the quality of contact a pitcher gives up per pitch of this type. Lower is better for a pitcher (lg avg ~.320); a .250 means the pitch is dominant, a .380+ means batters are teeing off on it. </span>
            <span><b>xwOBA</b>: expected wOBA based on exit velocity &amp; launch angle — strips out luck (bloop singles, etc.) to show true quality of contact allowed. </span>
            <span><b>RV/100</b>: run value per 100 pitches — negative favors pitcher, positive favors batter. </span>
            <span><b>HH%</b>: hard-hit rate (exit velo ≥ 95 mph). </span>
            <span><b>PA</b>: plate appearances faced on this pitch type. </span>
            Edge bar: pitcher whiff% vs lg avg (23%) and batter xwOBA vs lg avg (.320). Data: Baseball Savant 2025.
          </div>
        </div>
      )}
    </div>
  )
}
