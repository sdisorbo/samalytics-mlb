'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ZoneCell {
  row: number
  col: number
  pa: number
  ab: number
  h: number
  tb: number
  bb: number
  avg: number | null
  slg: number | null
  obp: number | null
  ops: number | null
  total_pitches: number
  zone_pct: number | null
  avg_rv: number | null
}

interface PitchTypeEntry {
  code: string
  name: string
  count: number
  zones: ZoneCell[][]
}

interface SeasonStats {
  avg: number
  obp: number
  slg: number
  ops: number
  k_pct: number
  bb_pct: number
  whiff_pct: number
  hr: number
  rbi: number
  sb: number
  hits: number
  ab: number
  pa: number
}

interface SprayPoint {
  x: number
  y: number
  eventType: string
  pitchType: string
}

interface BatterZoneData {
  batterName: string
  teamAbbr: string
  season: number
  seasonStats: SeasonStats
  zones: ZoneCell[][]
  totals: {
    pa: number
    ab: number
    h: number
    tb: number
    bb: number
    avg: number | null
    slg: number | null
    obp: number | null
    ops: number | null
  }
  pitchTypes: PitchTypeEntry[]
  sprayPoints: SprayPoint[]
}

type StatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'zone_pct' | 'avg_rv'

// ── Color helpers ──────────────────────────────────────────────────────────────

const TEAL = '#3C999E'
const PINK = '#9B405A'
const EMPTY_CELL = '#374151'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function interpolateColor(t: number): string {
  const [tr, tg, tb] = hexToRgb(TEAL)
  const [pr, pg, pb] = hexToRgb(PINK)
  return rgbToHex(lerp(tr, pr, t), lerp(tg, pg, t), lerp(tb, pb, t))
}

function buildColorMap(cells: ZoneCell[], key: StatKey): Map<string, string> {
  const values: { row: number; col: number; val: number }[] = []
  for (const cell of cells) {
    const val = (cell as unknown as Record<string, number | null>)[key]
    if (val !== null && val !== undefined) {
      values.push({ row: cell.row, col: cell.col, val })
    }
  }
  if (values.length === 0) return new Map()
  const nums = values.map(v => v.val)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min
  // For batting stats: higher = better = teal, so invert t
  const invertScale = key !== 'zone_pct'
  const map = new Map<string, string>()
  for (const { row, col, val } of values) {
    let t = range > 0 ? (val - min) / range : 0.5
    if (invertScale) t = 1 - t
    map.set(`${row}-${col}`, interpolateColor(t))
  }
  return map
}

function formatZoneStat(val: number | null, key: StatKey): string {
  if (val === null) return '-'
  if (key === 'zone_pct') return `${Math.round(val * 100)}%`
  if (key === 'avg_rv') return (val >= 0 ? '+' : '') + val.toFixed(2)
  if (key === 'avg' || key === 'obp' || key === 'slg') return val.toFixed(3).replace(/^0/, '')
  return val.toFixed(3)
}


function computeWeightedMean(zones: ZoneCell[][], key: StatKey): number | null {
  if (key === 'zone_pct') return null
  let sumVal = 0, sumPa = 0
  for (const row of zones) {
    for (const cell of row) {
      const val = (cell as unknown as Record<string, number | null>)[key]
      if (val !== null && val !== undefined && cell.pa > 0) {
        sumVal += (val as number) * cell.pa
        sumPa += cell.pa
      }
    }
  }
  return sumPa > 0 ? sumVal / sumPa : null
}

// ── Zone Grid (full-size) ──────────────────────────────────────────────────────

const CELL_W = 44
const CELL_H = 38
const GRID_W = CELL_W * 5
const GRID_H = CELL_H * 5

// Strike zone: inner 3×3 = rows 1–3, cols 1–3
const SZ_X = CELL_W
const SZ_Y = CELL_H
const SZ_W = CELL_W * 3
const SZ_H = CELL_H * 3

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'avg',      label: 'AVG'   },
  { key: 'obp',      label: 'OBP'   },
  { key: 'slg',      label: 'SLG'   },
  { key: 'ops',      label: 'OPS'   },
  { key: 'zone_pct', label: 'Zone%' },
  { key: 'avg_rv',   label: 'Avg RV' },
]

interface ZoneGridProps {
  zones: ZoneCell[][]
  pitchTypes: PitchTypeEntry[]
  selectedPitchType: string
  activeStat: StatKey
}

function ZoneGrid({ zones, pitchTypes, selectedPitchType, activeStat }: ZoneGridProps) {
  const activeZones =
    selectedPitchType === 'ALL'
      ? zones
      : (pitchTypes.find(pt => pt.code === selectedPitchType)?.zones ?? zones)

  const flatCells: ZoneCell[] = activeZones.flat()
  const colorMap = buildColorMap(flatCells, activeStat)
  const overall = computeWeightedMean(activeZones, activeStat)
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null)

  return (
    <div className="relative">
      <svg
        width={GRID_W}
        height={GRID_H}
        viewBox={`0 0 ${GRID_W} ${GRID_H}`}
        style={{ display: 'block' }}
      >
        {activeZones.map((rowCells, row) =>
          rowCells.map((cell, col) => {
            const key = `${row}-${col}`
            const color = colorMap.get(key) ?? EMPTY_CELL
            const statVal = (cell as unknown as Record<string, number | null>)[activeStat] as number | null
            const x = col * CELL_W
            const y = row * CELL_H
            const isHovered = hovered?.row === row && hovered?.col === col

            return (
              <g
                key={key}
                onMouseEnter={() => setHovered({ row, col })}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'default' }}
              >
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={CELL_W - 2}
                  height={CELL_H - 2}
                  rx={2}
                  fill={color}
                  stroke={isHovered ? '#94A3B8' : 'transparent'}
                  strokeWidth={1}
                />
                <text
                  x={x + CELL_W / 2}
                  y={y + CELL_H / 2 - (cell.pa > 0 && isHovered ? 5 : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill={statVal !== null ? '#fff' : '#6B7280'}
                  fontFamily="monospace"
                  fontWeight={statVal !== null ? '700' : '400'}
                >
                  {formatZoneStat(statVal, activeStat)}
                </text>
                {isHovered && cell.pa > 0 && (
                  <text
                    x={x + CELL_W / 2}
                    y={y + CELL_H / 2 + 7}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={7}
                    fill="rgba(255,255,255,0.6)"
                    fontFamily="sans-serif"
                  >
                    PA:{cell.pa}
                  </text>
                )}
              </g>
            )
          }),
        )}

        {/* Strike zone boundary */}
        <rect
          x={SZ_X}
          y={SZ_Y}
          width={SZ_W}
          height={SZ_H}
          fill="none"
          stroke="#94A3B8"
          strokeWidth={1.5}
        />
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-[9px] text-538-muted">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: TEAL }} />
          <span>{activeStat === 'zone_pct' ? 'Less often thrown' : activeStat === 'avg_rv' ? 'More run value' : 'Better (higher)'}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PINK }} />
          <span>{activeStat === 'zone_pct' ? 'More often thrown' : activeStat === 'avg_rv' ? 'Less run value' : 'Worse (lower)'}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: EMPTY_CELL }} />
          <span>No data</span>
        </div>
      </div>
      {overall !== null && (
        <div className="flex items-center gap-1 mt-1.5 text-[9px]">
          <span className="text-538-muted">View avg:</span>
          <span className="font-bold text-538-text tabular-nums">{formatZoneStat(overall, activeStat)}</span>
        </div>
      )}
      <span className="text-[8px] text-538-muted mt-1 block">Catcher&apos;s view · inner box = strike zone</span>
    </div>
  )
}

// ── Spray Chart ────────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  single:   '#3B82F6',
  double:   '#10B981',
  triple:   '#F59E0B',
  home_run: '#EF4444',
}

const EVENT_LABELS: Record<string, string> = {
  single:   '1B',
  double:   '2B',
  triple:   '3B',
  home_run: 'HR',
}

interface SprayChartProps {
  sprayPoints: SprayPoint[]
  selectedPitchType: string
}

function SprayChart({ sprayPoints, selectedPitchType }: SprayChartProps) {
  const filteredPoints = selectedPitchType === 'ALL'
    ? sprayPoints
    : sprayPoints.filter(p => p.pitchType === selectedPitchType)

  // MLB hitData.coordinates are image pixel coords (0–250 range).
  // Home plate ≈ (125, 204): small coordY = deep outfield (y increases toward plate).
  // Direct scale ×1.2 maps 250-unit space → 300px SVG.
  // Home plate in SVG ≈ (150, 245).
  // Foul lines at 45°: left line hits x=0 at y=95, right line hits x=300 at y=95.

  const SCALE = 1.2
  const toSvgX = (x: number) => x * SCALE
  const toSvgY = (y: number) => y * SCALE

  const homePlateX = 125 * SCALE   // 150
  const homePlateY = 204 * SCALE   // 244.8

  // Foul lines: from home plate, going upper-left / upper-right at 45° in SVG
  const lineLen = 420
  const lfX = homePlateX - lineLen * Math.cos(Math.PI / 4)
  const lfY = homePlateY - lineLen * Math.sin(Math.PI / 4)
  const rfX = homePlateX + lineLen * Math.cos(Math.PI / 4)
  const rfY = homePlateY - lineLen * Math.sin(Math.PI / 4)

  // Outfield arc endpoints on foul lines (radius ≈ 200px ≈ 310-ft wall)
  const arcR = 200
  const arcStartX = homePlateX - arcR * Math.cos(Math.PI / 4)
  const arcStartY = homePlateY - arcR * Math.sin(Math.PI / 4)
  const arcEndX   = homePlateX + arcR * Math.cos(Math.PI / 4)
  const arcEndY   = homePlateY - arcR * Math.sin(Math.PI / 4)

  return (
    <div className="flex flex-col gap-2">
      <svg
        width={300}
        height={300}
        viewBox="0 0 300 300"
        style={{ display: 'block', backgroundColor: '#1F2937', borderRadius: '8px' }}
      >
        <defs>
          <clipPath id="fair-territory">
            {/* Home plate at (150,245); foul lines at 45°; left hits x=0 at y=95, right hits x=300 at y=95 */}
            <polygon points="150,245 0,95 0,0 300,0 300,95" />
          </clipPath>
        </defs>

        {/* Infield dirt circle */}
        <circle
          cx={homePlateX}
          cy={homePlateY - 70}
          r={42}
          fill="none"
          stroke="#374151"
          strokeWidth={0.5}
          opacity={0.5}
        />

        {/* Foul lines */}
        <line
          x1={homePlateX} y1={homePlateY}
          x2={lfX} y2={lfY}
          stroke="#4B5563"
          strokeWidth={1}
        />
        <line
          x1={homePlateX} y1={homePlateY}
          x2={rfX} y2={rfY}
          stroke="#4B5563"
          strokeWidth={1}
        />

        {/* Outfield arc */}
        <path
          d={`M ${arcStartX} ${arcStartY} A ${arcR} ${arcR} 0 0 0 ${arcEndX} ${arcEndY}`}
          fill="none"
          stroke="#4B5563"
          strokeWidth={1}
        />

        {/* Home plate marker */}
        <circle
          cx={homePlateX}
          cy={homePlateY}
          r={3}
          fill="#6B7280"
          opacity={0.7}
        />

        {/* Spray dots */}
        <g clipPath="url(#fair-territory)">
          {filteredPoints.map((pt, i) => {
            const svgX = toSvgX(pt.x)
            const svgY = toSvgY(pt.y)
            const dotColor = EVENT_COLORS[pt.eventType] ?? '#6B7280'
            return (
              <circle
                key={i}
                cx={svgX}
                cy={svgY}
                r={4}
                fill={dotColor}
                opacity={0.75}
              />
            )
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap text-[9px] text-538-muted">
        {Object.entries(EVENT_LABELS).map(([evt, label]) => (
          <div key={evt} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: EVENT_COLORS[evt] }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <p className="text-[8px] text-538-muted">
        {filteredPoints.length} batted ball{filteredPoints.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

// ── Stat Box ───────────────────────────────────────────────────────────────────

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center bg-538-border/20 rounded-lg px-3 py-2 min-w-[52px]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">{label}</span>
      <span className="text-xl font-black text-538-text tabular-nums leading-tight">{value}</span>
      {sub && <span className="text-[9px] text-538-muted mt-0.5 tabular-nums">{sub}</span>}
    </div>
  )
}

// ── Page skeleton ──────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-pulse">
      <div className="h-4 w-24 bg-538-border/30 rounded" />
      <div className="h-8 w-64 bg-538-border/30 rounded" />
      <div className="flex gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="h-14 w-14 bg-538-border/30 rounded-lg" />
        ))}
      </div>
      <div className="flex gap-6">
        <div className="h-52 w-52 bg-538-border/30 rounded" />
        <div className="h-52 w-52 bg-538-border/30 rounded" />
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BatterPage({ params }: { params: { id: string } }) {
  const batterId = params.id

  const [data, setData] = useState<BatterZoneData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeStat, setActiveStat] = useState<StatKey>('avg')
  const [selectedPitchType, setSelectedPitchType] = useState<string>('ALL')

  const currentSeason = new Date().getFullYear()

  useEffect(() => {
    setLoading(true)
    setError('')

    fetch(`/api/batter-season/zones?batterId=${batterId}&season=${currentSeason}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load batter data')
        return r.json() as Promise<BatterZoneData>
      })
      .then(d => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [batterId, currentSeason])

  if (loading) return <PageSkeleton />

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Link
          href="/players"
          className="text-xs text-538-muted hover:text-538-text transition-colors mb-4 inline-block"
        >
          ← Back to Batters
        </Link>
        <p className="text-sm text-538-muted">{error}</p>
      </div>
    )
  }

  if (!data) return null

  const { batterName, teamAbbr, season, seasonStats, zones, pitchTypes, sprayPoints } = data
  const { rv_per_100, rv_per_100_pct } = seasonStats

  const fmt3 = (v: number) => v.toFixed(3).replace(/^0/, '')
  const fmtPct = (v: number) => `${v.toFixed(1)}%`

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Back button */}
      <Link
        href="/players"
        className="text-xs text-538-muted hover:text-538-text transition-colors inline-flex items-center gap-1"
      >
        ← Back to Batters
      </Link>

      {/* Name + team */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-538-text">{batterName}</h1>
        {teamAbbr && (
          <span
            className="text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: '#3D405B' }}
          >
            {teamAbbr}
          </span>
        )}
        <span
          className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
          style={{ backgroundColor: '#3D405B' }}
        >
          {season} Season
        </span>
      </div>

      {/* Season stat boxes */}
      <div className="flex flex-wrap gap-2">
        <StatBox label="AVG"  value={fmt3(seasonStats.avg)} />
        <StatBox label="OBP"  value={fmt3(seasonStats.obp)} />
        <StatBox label="SLG"  value={fmt3(seasonStats.slg)} />
        <StatBox label="OPS"  value={fmt3(seasonStats.ops)} />
        <StatBox label="K%"   value={fmtPct(seasonStats.k_pct)} />
        <StatBox label="BB%"  value={fmtPct(seasonStats.bb_pct)} />
        <StatBox label="Whiff%" value={fmtPct(seasonStats.whiff_pct)} />
        <StatBox
          label="RV/100"
          value={(rv_per_100 >= 0 ? '+' : '') + rv_per_100.toFixed(1)}
          sub={`${rv_per_100_pct}th pct`}
        />
        <StatBox label="HR"   value={String(seasonStats.hr)} />
        <StatBox label="RBI"  value={String(seasonStats.rbi)} />
        <StatBox label="SB"   value={String(seasonStats.sb)} />
      </div>

      {/* Shared controls: stat tabs + pitch type toggles */}
      <div className="bg-surface border border-538-border rounded-xl p-4 space-y-3">
        {/* Stat tabs */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Zone Stat</span>
          <div className="flex gap-1 flex-wrap">
            {STAT_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveStat(key)}
                className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors"
                style={
                  activeStat === key
                    ? { backgroundColor: '#3D405B', color: '#fff' }
                    : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Pitch type toggles */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted mr-1">Pitch</span>
          <button
            onClick={() => setSelectedPitchType('ALL')}
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors whitespace-nowrap"
            style={
              selectedPitchType === 'ALL'
                ? { backgroundColor: '#3D405B', color: '#fff' }
                : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }
            }
          >
            All
          </button>
          {pitchTypes.map(pt => (
            <button
              key={pt.code}
              onClick={() => setSelectedPitchType(pt.code)}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors whitespace-nowrap"
              style={
                selectedPitchType === pt.code
                  ? { backgroundColor: '#3D405B', color: '#fff' }
                  : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }
              }
            >
              {pt.name} <span className="opacity-60">({pt.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Zone grid + spray chart */}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {/* Zone grid */}
        <div className="bg-surface border border-538-border rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-3">Zone Breakdown</div>
          <ZoneGrid
            zones={zones}
            pitchTypes={pitchTypes}
            selectedPitchType={selectedPitchType}
            activeStat={activeStat}
          />
        </div>

        {/* Spray chart */}
        <div className="bg-surface border border-538-border rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-3">Spray Chart</div>
          {sprayPoints.length === 0 ? (
            <p className="text-xs text-538-muted">No batted ball data available.</p>
          ) : (
            <SprayChart
              sprayPoints={sprayPoints}
              selectedPitchType={selectedPitchType}
            />
          )}
        </div>
      </div>

      {/* Season totals */}
      <div className="bg-surface border border-538-border rounded-xl p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-2">Season Totals (from Game Feed)</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-538-muted">
          <span>PA <span className="font-semibold text-538-text">{data.totals.pa}</span></span>
          <span>AB <span className="font-semibold text-538-text">{data.totals.ab}</span></span>
          <span>H  <span className="font-semibold text-538-text">{data.totals.h}</span></span>
          <span>BB <span className="font-semibold text-538-text">{data.totals.bb}</span></span>
          {data.totals.avg !== null && (
            <span>AVG <span className="font-semibold text-538-text">{data.totals.avg.toFixed(3).replace(/^0/, '')}</span></span>
          )}
          {data.totals.obp !== null && (
            <span>OBP <span className="font-semibold text-538-text">{data.totals.obp.toFixed(3).replace(/^0/, '')}</span></span>
          )}
          {data.totals.slg !== null && (
            <span>SLG <span className="font-semibold text-538-text">{data.totals.slg.toFixed(3).replace(/^0/, '')}</span></span>
          )}
          {data.totals.ops !== null && (
            <span>OPS <span className="font-semibold text-538-text">{data.totals.ops.toFixed(3)}</span></span>
          )}
        </div>
        <p className="text-[9px] text-538-muted max-w-[400px] leading-relaxed mt-2">
          Zone data from up to 40 game feeds. Shows batting outcomes on the last pitch of each plate appearance. Values only shown with 5+ PA per zone.
        </p>
      </div>
    </div>
  )
}
