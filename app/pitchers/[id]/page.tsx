'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SeasonStats {
  era: number
  whip: number
  k9: number
  bb9: number
  wins: number
  losses: number
  ip: string
}

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

interface ZoneTotals {
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

interface PitchTypeEntry {
  code: string
  name: string
  count: number
  zones: ZoneCell[][]
}

interface SeasonZoneData {
  pitcherName: string
  teamAbbr: string
  season: number
  seasonStats: SeasonStats
  rv_per_100: number
  rv_per_100_pct: number
  zones: ZoneCell[][]
  totals: ZoneTotals
  pitchTypes: PitchTypeEntry[]
}

type StatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'zone_pct' | 'avg_rv'

// ── Color helpers ──────────────────────────────────────────────────────────────

const TEAL = '#3C999E'
const PINK = '#9B405A'
const EMPTY_CELL = '#374151'

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
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
  const map = new Map<string, string>()
  for (const { row, col, val } of values) {
    const t = range > 0 ? (val - min) / range : 0.5
    map.set(`${row}-${col}`, interpolateColor(t))
  }
  return map
}

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'avg',      label: 'AVG'    },
  { key: 'obp',      label: 'OBP'    },
  { key: 'slg',      label: 'SLG'    },
  { key: 'ops',      label: 'OPS'    },
  { key: 'zone_pct', label: 'Zone%'  },
  { key: 'avg_rv',   label: 'Avg RV' },
]

function formatStat(val: number | null, key: StatKey): string {
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

// ── Zone Grid ──────────────────────────────────────────────────────────────────

const CELL_W = 44
const CELL_H = 38
const GRID_W = CELL_W * 5
const GRID_H = CELL_H * 5
const SZ_X = CELL_W, SZ_Y = CELL_H, SZ_W = CELL_W * 3, SZ_H = CELL_H * 3

function ZoneGrid({ zones, pitchTypes }: { zones: ZoneCell[][]; pitchTypes: PitchTypeEntry[] }) {
  const [activeStat, setActiveStat]           = useState<StatKey>('avg')
  const [selectedPitchType, setSelectedPitchType] = useState<string>('ALL')
  const [hovered, setHovered]                 = useState<{ row: number; col: number } | null>(null)

  const activeZones =
    selectedPitchType === 'ALL'
      ? zones
      : (pitchTypes.find(pt => pt.code === selectedPitchType)?.zones ?? zones)

  const flatCells  = activeZones.flat()
  const colorMap   = buildColorMap(flatCells, activeStat)
  const overall    = computeWeightedMean(activeZones, activeStat)

  return (
    <div className="flex flex-col gap-3">
      {/* Pitch type toggles */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {[{ code: 'ALL', name: 'All', count: 0 }, ...pitchTypes].map(pt => (
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
            {pt.name}{pt.code !== 'ALL' && <span className="opacity-60"> ({pt.count})</span>}
          </button>
        ))}
      </div>

      {/* Stat tabs */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Zone</span>
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

      <div className="relative">
        <svg width={GRID_W} height={GRID_H} viewBox={`0 0 ${GRID_W} ${GRID_H}`} style={{ display: 'block' }}>
          {activeZones.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const k      = `${row}-${col}`
              const color  = colorMap.get(k) ?? EMPTY_CELL
              const statVal = (cell as unknown as Record<string, number | null>)[activeStat] as number | null
              const x = col * CELL_W, y = row * CELL_H
              const isHovered = hovered?.row === row && hovered?.col === col
              return (
                <g key={k} onMouseEnter={() => setHovered({ row, col })} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default' }}>
                  <rect x={x + 1} y={y + 1} width={CELL_W - 2} height={CELL_H - 2} rx={2}
                    fill={color} stroke={isHovered ? '#94A3B8' : 'transparent'} strokeWidth={1} />
                  <text x={x + CELL_W / 2} y={y + CELL_H / 2 - (cell.pa > 0 && isHovered ? 5 : 0)}
                    textAnchor="middle" dominantBaseline="middle" fontSize={9}
                    fill={statVal !== null ? '#fff' : '#6B7280'} fontFamily="monospace" fontWeight={statVal !== null ? '700' : '400'}>
                    {formatStat(statVal, activeStat)}
                  </text>
                  {isHovered && cell.pa > 0 && (
                    <text x={x + CELL_W / 2} y={y + CELL_H / 2 + 7} textAnchor="middle" dominantBaseline="middle"
                      fontSize={7} fill="rgba(255,255,255,0.6)" fontFamily="sans-serif">
                      PA:{cell.pa}
                    </text>
                  )}
                </g>
              )
            }),
          )}
          <rect x={SZ_X} y={SZ_Y} width={SZ_W} height={SZ_H} fill="none" stroke="#94A3B8" strokeWidth={1.5} />
        </svg>

        <div className="flex items-center gap-3 mt-2 text-[9px] text-538-muted">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: TEAL }} />
            <span>{activeStat === 'zone_pct' ? 'Less often thrown' : activeStat === 'avg_rv' ? 'Less run value allowed' : 'Better (lower)'}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PINK }} />
            <span>{activeStat === 'zone_pct' ? 'More often thrown' : 'Worse (higher)'}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: EMPTY_CELL }} />
            <span>No data</span>
          </div>
        </div>
        {overall !== null && (
          <div className="flex items-center gap-1 mt-1.5 text-[9px]">
            <span className="text-538-muted">View avg:</span>
            <span className="font-bold text-538-text tabular-nums">{formatStat(overall, activeStat)}</span>
          </div>
        )}
        <span className="text-[8px] text-538-muted mt-1 block">Catcher&apos;s view · inner box = strike zone</span>
      </div>
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PitcherPage({ params }: { params: { id: string } }) {
  const pitcherId = params.id
  const currentSeason = new Date().getFullYear()
  const [season, setSeason]   = useState(currentSeason)
  const [data, setData]       = useState<SeasonZoneData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    setData(null)
    fetch(`/api/pitcher-season/zones?pitcherId=${pitcherId}&season=${season}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: SeasonZoneData) => setData(d))
      .catch(() => setError('Could not load pitcher data.'))
      .finally(() => setLoading(false))
  }, [pitcherId, season])

  const { seasonStats, rv_per_100, rv_per_100_pct } = data ?? {}

  return (
    <main className="max-w-screen-lg mx-auto px-4 py-8">
      {/* Back link */}
      <div className="mb-6">
        <Link href="/pitchers" className="text-xs text-538-muted hover:text-538-text transition-colors flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All Pitchers
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-538-text tracking-tight">
            {data?.pitcherName ?? (loading ? 'Loading…' : `Pitcher ${pitcherId}`)}
          </h1>
          {data?.teamAbbr && (
            <p className="text-sm text-538-muted mt-1">{data.teamAbbr} · Pitcher</p>
          )}
        </div>
        {/* Season selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-538-muted">Season</span>
          <div className="inline-flex rounded border border-538-border overflow-hidden">
            {[currentSeason, currentSeason - 1, currentSeason - 2].map(yr => (
              <button
                key={yr}
                onClick={() => setSeason(yr)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  season === yr ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'
                }`}
              >
                {yr}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <p className="text-538-muted text-sm">Loading pitcher data…</p>
      )}

      {error && (
        <div className="py-8 text-sm text-red-500">{error}</div>
      )}

      {data && seasonStats && (
        <div className="space-y-6">
          {/* Season stats */}
          <div className="flex flex-wrap gap-2">
            <StatBox label="ERA"    value={seasonStats.era.toFixed(2)} />
            <StatBox label="W-L"    value={`${seasonStats.wins}-${seasonStats.losses}`} />
            <StatBox label="IP"     value={seasonStats.ip} />
            <StatBox label="K/9"    value={seasonStats.k9.toFixed(1)} />
            <StatBox label="BB/9"   value={seasonStats.bb9.toFixed(1)} />
            <StatBox label="WHIP"   value={seasonStats.whip.toFixed(2)} />
            <StatBox
              label="RV/100"
              value={(rv_per_100! >= 0 ? '+' : '') + rv_per_100!.toFixed(1)}
              sub={`${rv_per_100_pct}th pct`}
            />
          </div>

          {/* Zone grid + totals */}
          <div className="bg-surface border border-538-border rounded-xl p-5">
            <div className="flex flex-col sm:flex-row gap-8">
              <ZoneGrid zones={data.zones} pitchTypes={data.pitchTypes} />

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Totals vs Pitcher</span>
                  <span className="text-[9px] text-538-muted">· Last 40 games</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-538-muted">
                  <span>PA <span className="font-semibold text-538-text">{data.totals.pa}</span></span>
                  <span>AB <span className="font-semibold text-538-text">{data.totals.ab}</span></span>
                  <span>H  <span className="font-semibold text-538-text">{data.totals.h}</span></span>
                  <span>BB <span className="font-semibold text-538-text">{data.totals.bb}</span></span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-538-muted">
                  {data.totals.avg !== null && <span>AVG <span className="font-semibold text-538-text">{data.totals.avg.toFixed(3).replace(/^0/, '')}</span></span>}
                  {data.totals.obp !== null && <span>OBP <span className="font-semibold text-538-text">{data.totals.obp.toFixed(3).replace(/^0/, '')}</span></span>}
                  {data.totals.slg !== null && <span>SLG <span className="font-semibold text-538-text">{data.totals.slg.toFixed(3).replace(/^0/, '')}</span></span>}
                  {data.totals.ops !== null && <span>OPS <span className="font-semibold text-538-text">{data.totals.ops.toFixed(3)}</span></span>}
                </div>
                <p className="text-[9px] text-538-muted max-w-[240px] leading-relaxed mt-2">
                  Based on last 40 games pitched. Batting outcomes on the final pitch of each plate appearance.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
