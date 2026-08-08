'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ZoneCell {
  row: number; col: number; pa: number; ab: number; h: number; tb: number; bb: number
  avg: number | null; slg: number | null; obp: number | null; ops: number | null
  total_pitches: number; zone_pct: number | null; avg_rv: number | null
}

interface PitchTypeEntry { code: string; name: string; count: number; zones: ZoneCell[][] }

interface SeasonStats {
  avg: number; obp: number; slg: number; ops: number
  k_pct: number; bb_pct: number; whiff_pct: number
  rv_per_100: number; rv_per_100_pct: number
  hr: number; rbi: number; sb: number; hits: number; ab: number; pa: number
}

interface SprayPoint { x: number; y: number; eventType: string; pitchType: string }

interface BatterZoneData {
  batterName: string; teamAbbr: string; season: number
  seasonStats: SeasonStats
  zones: ZoneCell[][]; totals: { pa: number; ab: number; h: number; tb: number; bb: number; avg: number | null; slg: number | null; obp: number | null; ops: number | null }
  pitchTypes: PitchTypeEntry[]; sprayPoints: SprayPoint[]
}

interface CareerSeason {
  year: string; level: string; team: string; teamAbbr: string
  g: number | null; ab: number | null; h: number | null
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
  hr: number | null; rbi: number | null; bb: number | null; k: number | null; sb: number | null
  war: number | null
}

interface WarEntry { name: string; team: string; war: number; player_type: string; career: unknown[] }

type StatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'zone_pct' | 'avg_rv'

// ── Color helpers ──────────────────────────────────────────────────────────────

const TEAL = '#3C999E'; const PINK = '#9B405A'; const EMPTY_CELL = '#374151'
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}
function interpolateColor(t: number) {
  const [tr, tg, tb] = hexToRgb(TEAL); const [pr, pg, pb] = hexToRgb(PINK)
  return rgbToHex(lerp(tr, pr, t), lerp(tg, pg, t), lerp(tb, pb, t))
}
function buildColorMap(cells: ZoneCell[], key: StatKey) {
  const values: { row: number; col: number; val: number }[] = []
  for (const cell of cells) {
    const val = (cell as unknown as Record<string, number | null>)[key]
    if (val !== null && val !== undefined) values.push({ row: cell.row, col: cell.col, val })
  }
  if (!values.length) return new Map<string, string>()
  const nums = values.map(v => v.val); const min = Math.min(...nums); const max = Math.max(...nums); const range = max - min
  const invertScale = key !== 'zone_pct'
  const map = new Map<string, string>()
  for (const { row, col, val } of values) {
    let t = range > 0 ? (val - min) / range : 0.5
    if (invertScale) t = 1 - t
    map.set(`${row}-${col}`, interpolateColor(t))
  }
  return map
}
function formatZoneStat(val: number | null, key: StatKey) {
  if (val === null) return '-'
  if (key === 'zone_pct') return `${Math.round(val * 100)}%`
  if (key === 'avg_rv') return (val >= 0 ? '+' : '') + val.toFixed(2)
  if (key === 'avg' || key === 'obp' || key === 'slg') return val.toFixed(3).replace(/^0/, '')
  return val.toFixed(3)
}
function computeWeightedMean(zones: ZoneCell[][], key: StatKey) {
  if (key === 'zone_pct') return null
  let sumVal = 0, sumPa = 0
  for (const row of zones) for (const cell of row) {
    const val = (cell as unknown as Record<string, number | null>)[key]
    if (val !== null && val !== undefined && cell.pa > 0) { sumVal += (val as number) * cell.pa; sumPa += cell.pa }
  }
  return sumPa > 0 ? sumVal / sumPa : null
}

// ── Canvas export helpers ──────────────────────────────────────────────────────

const ESPN_ABBR_EXPORT: Record<string, string> = {
  AZ: 'ari', ARI: 'ari', WSH: 'wsh', CWS: 'cws',
  TB: 'tb', TBR: 'tb', KC: 'kc', KCR: 'kc',
  SD: 'sd', SDP: 'sd', SF: 'sf', SFG: 'sf',
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src
  })
}

function canvasRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

async function exportBatterZoneImage(opts: {
  batterId: string; batterName: string; teamAbbr: string
  activeStat: StatKey; selectedPitchType: string; pitchTypes: PitchTypeEntry[]
  activeZones: ZoneCell[][]; colorMap: Map<string, string>; overall: number | null
}) {
  const { batterId, batterName, teamAbbr, activeStat, selectedPitchType, pitchTypes, activeZones, colorMap, overall } = opts

  const SCALE = 2; const W = 360; const PAD = 16
  const IMG_SIZE = 48; const HEADER_H = 72; const BADGE_H = 32
  const GW = CELL_W * 5; const GH = CELL_H * 5
  const H = PAD + HEADER_H + BADGE_H + GH + 56 + PAD

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE; canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!; ctx.scale(SCALE, SCALE)

  ctx.fillStyle = '#0D1117'; ctx.fillRect(0, 0, W, H)

  const slug = ESPN_ABBR_EXPORT[teamAbbr] ?? teamAbbr.toLowerCase()
  const [headshotImg, logoImg, siteLogoImg] = await Promise.all([
    loadImg(`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${batterId}/headshot/67/current`),
    loadImg(`https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`),
    loadImg('/logo.png'),
  ])

  // ── Header ──
  const hY = PAD + (HEADER_H - IMG_SIZE) / 2

  // Headshot — object-fit:cover (aspect ratio preserved)
  if (headshotImg) {
    const ar = headshotImg.naturalWidth / headshotImg.naturalHeight
    let dw, dh, dx, dy
    if (ar >= 1) { dh = IMG_SIZE; dw = IMG_SIZE * ar; dx = PAD - (dw - IMG_SIZE) / 2; dy = hY }
    else          { dw = IMG_SIZE; dh = IMG_SIZE / ar; dx = PAD; dy = hY - (dh - IMG_SIZE) / 2 }
    ctx.save(); ctx.beginPath()
    ctx.arc(PAD + IMG_SIZE / 2, hY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2); ctx.clip()
    ctx.drawImage(headshotImg, dx, dy, dw, dh); ctx.restore()
  } else {
    ctx.fillStyle = '#3D405B'; ctx.beginPath()
    ctx.arc(PAD + IMG_SIZE / 2, hY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2); ctx.fill()
  }

  // Team logo
  const lx = W - PAD - IMG_SIZE
  if (logoImg) {
    ctx.drawImage(logoImg, lx, hY, IMG_SIZE, IMG_SIZE)
  } else {
    ctx.fillStyle = '#374151'; canvasRoundRect(ctx, lx, hY, IMG_SIZE, IMG_SIZE, 6); ctx.fill()
    ctx.fillStyle = '#9CA3AF'; ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(teamAbbr, lx + IMG_SIZE / 2, hY + IMG_SIZE / 2)
  }

  // Name + position
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(batterName, W / 2, PAD + HEADER_H / 2 - 9)
  ctx.fillStyle = '#9CA3AF'; ctx.font = '11px sans-serif'
  ctx.fillText(`${teamAbbr} · Batter`, W / 2, PAD + HEADER_H / 2 + 11)

  // ── Badges ──
  const badgeY = PAD + HEADER_H + 6
  const pitchLabel = selectedPitchType === 'ALL' ? 'All Pitches' : (pitchTypes.find(p => p.code === selectedPitchType)?.name ?? selectedPitchType)
  const statLabel = STAT_TABS.find(s => s.key === activeStat)?.label ?? activeStat

  let bx = PAD
  for (const label of [pitchLabel, statLabel]) {
    ctx.font = 'bold 8px sans-serif'
    const tw = ctx.measureText(label).width
    const bw = tw + 12; const bh = 18
    ctx.fillStyle = '#3D405B'; canvasRoundRect(ctx, bx, badgeY, bw, bh, 3); ctx.fill()
    ctx.fillStyle = '#E6EDF3'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(label, bx + 6, badgeY + 5)
    bx += bw + 5
  }
  ctx.fillStyle = '#9CA3AF'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  ctx.fillText('Last 40 games', W - PAD, badgeY + 9)

  // ── Zone Grid ──
  const gridTop = PAD + HEADER_H + BADGE_H + 4
  const gridLeft = (W - GW) / 2

  for (const rowCells of activeZones) {
    for (const cell of rowCells) {
      const color = colorMap.get(`${cell.row}-${cell.col}`) ?? EMPTY_CELL
      const cx = gridLeft + cell.col * CELL_W; const cy = gridTop + cell.row * CELL_H
      ctx.fillStyle = color; canvasRoundRect(ctx, cx + 1, cy + 1, CELL_W - 2, CELL_H - 2, 2); ctx.fill()
      const statVal = (cell as unknown as Record<string, number | null>)[activeStat] as number | null
      if (statVal !== null) {
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 9px monospace'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(formatZoneStat(statVal, activeStat), cx + CELL_W / 2, cy + CELL_H / 2)
      }
    }
  }
  ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 1.5
  ctx.strokeRect(gridLeft + SZ_X, gridTop + SZ_Y, SZ_W, SZ_H)

  // ── View avg + Legend ──
  const afterGrid = gridTop + GH + 8
  if (overall !== null) {
    ctx.fillStyle = '#9CA3AF'; ctx.font = '9px sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText('View avg: ', gridLeft, afterGrid)
    const lw = ctx.measureText('View avg: ').width
    ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 9px monospace'
    ctx.fillText(formatZoneStat(overall, activeStat), gridLeft + lw, afterGrid)
  }

  const legendY = afterGrid + 16
  const legendItems = [
    { color: TEAL, label: activeStat === 'zone_pct' ? 'Less often thrown' : activeStat === 'avg_rv' ? 'More run value' : 'Better (higher)' },
    { color: PINK, label: activeStat === 'zone_pct' ? 'More often thrown' : activeStat === 'avg_rv' ? 'Less run value' : 'Worse (lower)' },
    { color: EMPTY_CELL, label: 'No data' },
  ]
  let llx = gridLeft
  for (const { color, label } of legendItems) {
    ctx.fillStyle = color; canvasRoundRect(ctx, llx, legendY, 10, 10, 2); ctx.fill()
    ctx.fillStyle = '#9CA3AF'; ctx.font = '8px sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(label, llx + 13, legendY + 1)
    llx += 13 + ctx.measureText(label).width + 10
  }

  // Footer
  const LOGO_H = 16
  const LOGO_W = Math.round(LOGO_H * 989 / 623)
  ctx.fillStyle = '#4B5563'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText("Catcher's view · inner box = strike zone", PAD, legendY + 16)
  const wY = legendY + 14
  if (siteLogoImg) {
    ctx.drawImage(siteLogoImg, W - PAD - LOGO_W, wY, LOGO_W, LOGO_H)
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText('samalytics', W - PAD - LOGO_W - 4, wY + LOGO_H / 2)
  } else {
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'
    ctx.fillText('samalytics', W - PAD, legendY + 16)
  }

  canvas.toBlob(async blob => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `${batterName.replace(/\s+/g, '_')}_zone.png`; a.click()
      URL.revokeObjectURL(url)
    }
  }, 'image/png')
}

// ── Zone Grid ──────────────────────────────────────────────────────────────────

const CELL_W = 44; const CELL_H = 38
const GRID_W = CELL_W * 5; const GRID_H = CELL_H * 5
const SZ_X = CELL_W; const SZ_Y = CELL_H; const SZ_W = CELL_W * 3; const SZ_H = CELL_H * 3

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'avg', label: 'AVG' }, { key: 'obp', label: 'OBP' }, { key: 'slg', label: 'SLG' },
  { key: 'ops', label: 'OPS' }, { key: 'zone_pct', label: 'Zone%' }, { key: 'avg_rv', label: 'Avg RV' },
]

function ZoneGrid({ zones, pitchTypes, selectedPitchType, activeStat }: {
  zones: ZoneCell[][]; pitchTypes: PitchTypeEntry[]; selectedPitchType: string; activeStat: StatKey
}) {
  const activeZones = selectedPitchType === 'ALL' ? zones : (pitchTypes.find(pt => pt.code === selectedPitchType)?.zones ?? zones)
  const flatCells = activeZones.flat()
  const colorMap = buildColorMap(flatCells, activeStat)
  const overall = computeWeightedMean(activeZones, activeStat)
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null)

  return (
    <div className="relative">
      <svg width={GRID_W} height={GRID_H} viewBox={`0 0 ${GRID_W} ${GRID_H}`} style={{ display: 'block' }}>
        {activeZones.map((rowCells, row) => rowCells.map((cell, col) => {
          const key = `${row}-${col}`
          const color = colorMap.get(key) ?? EMPTY_CELL
          const statVal = (cell as unknown as Record<string, number | null>)[activeStat] as number | null
          const x = col * CELL_W; const y = row * CELL_H
          const isHovered = hovered?.row === row && hovered?.col === col
          return (
            <g key={key} onMouseEnter={() => setHovered({ row, col })} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default' }}>
              <rect x={x+1} y={y+1} width={CELL_W-2} height={CELL_H-2} rx={2} fill={color} stroke={isHovered ? '#94A3B8' : 'transparent'} strokeWidth={1} />
              <text x={x+CELL_W/2} y={y+CELL_H/2-(cell.pa>0&&isHovered?5:0)} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill={statVal!==null?'#fff':'#6B7280'} fontFamily="monospace" fontWeight={statVal!==null?'700':'400'}>
                {formatZoneStat(statVal, activeStat)}
              </text>
              {isHovered && cell.pa > 0 && (
                <text x={x+CELL_W/2} y={y+CELL_H/2+7} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="rgba(255,255,255,0.6)" fontFamily="sans-serif">PA:{cell.pa}</text>
              )}
            </g>
          )
        }))}
        <rect x={SZ_X} y={SZ_Y} width={SZ_W} height={SZ_H} fill="none" stroke="#94A3B8" strokeWidth={1.5} />
      </svg>
      <div className="flex items-center gap-3 mt-2 text-[9px] text-538-muted">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: TEAL }} /><span>{activeStat==='zone_pct'?'Less often thrown':activeStat==='avg_rv'?'More run value':'Better (higher)'}</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PINK }} /><span>{activeStat==='zone_pct'?'More often thrown':activeStat==='avg_rv'?'Less run value':'Worse (lower)'}</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: EMPTY_CELL }} /><span>No data</span></div>
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

const EVENT_COLORS: Record<string, string> = { single: '#3B82F6', double: '#10B981', triple: '#F59E0B', home_run: '#EF4444' }
const EVENT_LABELS: Record<string, string> = { single: '1B', double: '2B', triple: '3B', home_run: 'HR' }

function SprayChart({ sprayPoints, selectedPitchType }: { sprayPoints: SprayPoint[]; selectedPitchType: string }) {
  const filteredPoints = selectedPitchType === 'ALL' ? sprayPoints : sprayPoints.filter(p => p.pitchType === selectedPitchType)
  const SCALE = 1.2; const toSvgX = (x: number) => x * SCALE; const toSvgY = (y: number) => y * SCALE
  const homePlateX = 125 * SCALE; const homePlateY = 204 * SCALE
  const lineLen = 420
  const lfX = homePlateX - lineLen * Math.cos(Math.PI/4); const lfY = homePlateY - lineLen * Math.sin(Math.PI/4)
  const rfX = homePlateX + lineLen * Math.cos(Math.PI/4); const rfY = homePlateY - lineLen * Math.sin(Math.PI/4)
  const arcR = 200
  const arcStartX = homePlateX - arcR * Math.cos(Math.PI/4); const arcStartY = homePlateY - arcR * Math.sin(Math.PI/4)
  const arcEndX   = homePlateX + arcR * Math.cos(Math.PI/4); const arcEndY   = homePlateY - arcR * Math.sin(Math.PI/4)

  return (
    <div className="flex flex-col gap-2">
      <svg width={300} height={300} viewBox="0 0 300 300" style={{ display: 'block', backgroundColor: '#1F2937', borderRadius: '8px' }}>
        <defs><clipPath id="fair-territory"><polygon points="150,245 0,95 0,0 300,0 300,95" /></clipPath></defs>
        <circle cx={homePlateX} cy={homePlateY-70} r={42} fill="none" stroke="#374151" strokeWidth={0.5} opacity={0.5} />
        <line x1={homePlateX} y1={homePlateY} x2={lfX} y2={lfY} stroke="#4B5563" strokeWidth={1} />
        <line x1={homePlateX} y1={homePlateY} x2={rfX} y2={rfY} stroke="#4B5563" strokeWidth={1} />
        <path d={`M ${arcStartX} ${arcStartY} A ${arcR} ${arcR} 0 0 0 ${arcEndX} ${arcEndY}`} fill="none" stroke="#4B5563" strokeWidth={1} />
        <circle cx={homePlateX} cy={homePlateY} r={3} fill="#6B7280" opacity={0.7} />
        <g clipPath="url(#fair-territory)">
          {filteredPoints.map((pt, i) => (
            <circle key={i} cx={toSvgX(pt.x)} cy={toSvgY(pt.y)} r={4} fill={EVENT_COLORS[pt.eventType] ?? '#6B7280'} opacity={0.75} />
          ))}
        </g>
      </svg>
      <div className="flex items-center gap-3 flex-wrap text-[9px] text-538-muted">
        {Object.entries(EVENT_LABELS).map(([evt, label]) => (
          <div key={evt} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: EVENT_COLORS[evt] }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="text-[8px] text-538-muted">{filteredPoints.length} batted ball{filteredPoints.length!==1?'s':''}</p>
    </div>
  )
}

// ── Stat Box ───────────────────────────────────────────────────────────────────

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center bg-538-border/20 rounded-lg px-3 py-2 shrink-0 min-w-[56px]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">{label}</span>
      <span className="text-xl font-black text-538-text tabular-nums leading-tight">{value}</span>
      {sub && <span className="text-[9px] text-538-muted mt-0.5 tabular-nums">{sub}</span>}
    </div>
  )
}

// ── Career Table ───────────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, string> = {
  MLB: 'bg-538-orange/20 text-538-orange border-538-orange/30',
  AAA: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  AA:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'A+':'bg-violet-500/20 text-violet-400 border-violet-500/30',
  A:   'bg-orange-500/20 text-orange-400 border-orange-500/30',
}
function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${LEVEL_STYLE[level] ?? 'bg-gray-500/20 text-538-muted border-gray-500/30'}`}>
      {level}
    </span>
  )
}

function BatterCareerTable({ seasons, currentYear }: { seasons: CareerSeason[]; currentYear: string }) {
  const fmt3 = (v: number | null) => v == null ? '—' : v.toFixed(3).replace(/^0/, '')
  return (
    <div className="overflow-x-auto rounded-xl border border-538-border">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="border-b border-538-border text-[10px] uppercase tracking-widest text-538-muted bg-538-card">
            <th className="px-3 py-2 text-left font-bold sticky left-0 bg-538-card z-10">Year</th>
            <th className="px-3 py-2 text-left font-bold">Lvl</th>
            <th className="px-3 py-2 text-left font-bold">Team</th>
            <th className="px-3 py-2 text-right font-bold">G</th>
            <th className="px-3 py-2 text-right font-bold">AB</th>
            <th className="px-3 py-2 text-right font-bold">H</th>
            <th className="px-3 py-2 text-right font-bold">HR</th>
            <th className="px-3 py-2 text-right font-bold">RBI</th>
            <th className="px-3 py-2 text-right font-bold">BB</th>
            <th className="px-3 py-2 text-right font-bold">K</th>
            <th className="px-3 py-2 text-right font-bold">AVG</th>
            <th className="px-3 py-2 text-right font-bold">OBP</th>
            <th className="px-3 py-2 text-right font-bold">SLG</th>
            <th className="px-3 py-2 text-right font-bold">OPS</th>
            <th className="px-3 py-2 text-right font-bold">WAR</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s, i) => {
            const isCurrent = s.year === currentYear
            const warColor = s.war == null ? '' : s.war >= 4 ? 'text-emerald-400' : s.war >= 2 ? 'text-blue-400' : s.war >= 0 ? 'text-538-text' : 'text-red-400'
            return (
              <tr key={`${s.year}-${s.team}`} className={`border-b border-538-border/50 hover:bg-538-bg/50 transition-colors ${i % 2 === 0 ? '' : 'bg-538-bg/30'}`}>
                <td className={`px-3 py-2 text-left sticky left-0 bg-538-card z-10 font-${isCurrent ? 'bold' : 'normal'} ${isCurrent ? 'text-538-orange' : 'text-538-text'}`}>{s.year}</td>
                <td className="px-3 py-2"><LevelBadge level={s.level} /></td>
                <td className="px-3 py-2 text-left text-538-muted whitespace-nowrap">
                  {s.teamAbbr ? <Link href={`/teams/${s.teamAbbr}`} className="hover:text-538-text transition-colors">{s.teamAbbr}</Link> : s.team || '—'}
                </td>
                <td className="px-3 py-2 text-right text-538-text">{s.g ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.ab ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.h ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.hr ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.rbi ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.bb ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.k ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{fmt3(s.avg)}</td>
                <td className="px-3 py-2 text-right text-538-text">{fmt3(s.obp)}</td>
                <td className="px-3 py-2 text-right text-538-text">{fmt3(s.slg)}</td>
                <td className="px-3 py-2 text-right font-semibold text-538-text">{fmt3(s.ops)}</td>
                <td className={`px-3 py-2 text-right font-bold ${warColor}`}>
                  {s.war == null ? '—' : (s.war >= 0 ? '+' : '') + s.war.toFixed(1)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Page skeleton ──────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-pulse">
      <div className="h-4 w-24 bg-538-border/30 rounded" />
      <div className="h-8 w-64 bg-538-border/30 rounded" />
      <div className="flex gap-2">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-14 w-14 bg-538-border/30 rounded-lg" />)}</div>
      <div className="h-40 bg-538-border/30 rounded-xl" />
      <div className="flex gap-6"><div className="h-52 w-52 bg-538-border/30 rounded" /><div className="h-52 w-52 bg-538-border/30 rounded" /></div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BatterPage({ params }: { params: { id: string } }) {
  const batterId = params.id
  const [data, setData] = useState<BatterZoneData | null>(null)
  const [warData, setWarData] = useState<WarEntry | null>(null)
  const [careerSeasons, setCareerSeasons] = useState<CareerSeason[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeStat, setActiveStat] = useState<StatKey>('avg')
  const [selectedPitchType, setSelectedPitchType] = useState<string>('ALL')
  const [copying, setCopying] = useState(false)

  const currentSeason = new Date().getFullYear()

  useEffect(() => {
    setLoading(true); setError('')
    Promise.all([
      fetch(`/api/batter-season/zones?batterId=${batterId}&season=${currentSeason}`).then(r => { if (!r.ok) throw new Error('Failed to load batter data'); return r.json() as Promise<BatterZoneData> }),
      fetch(`/api/player-war-history?playerId=${batterId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/prospect-career?playerId=${batterId}&group=hitting`).then(r => r.ok ? r.json() : []).catch(() => []),
    ])
      .then(([zoneData, warEntries, career]) => {
        setData(zoneData)
        if (Array.isArray(warEntries)) {
          const batterEntry = warEntries.find((e: WarEntry) => e.player_type === 'batter') ?? warEntries[0]
          setWarData(batterEntry ?? null)
        }
        if (Array.isArray(career)) setCareerSeasons(career as CareerSeason[])
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [batterId, currentSeason])

  if (loading) return <PageSkeleton />
  if (error) return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Link href="/players" className="text-xs text-538-muted hover:text-538-text transition-colors mb-4 inline-block">← Back to Batters</Link>
      <p className="text-sm text-538-muted">{error}</p>
    </div>
  )
  if (!data) return null

  const { batterName, teamAbbr, season, seasonStats, zones, pitchTypes, sprayPoints } = data
  const { rv_per_100, rv_per_100_pct } = seasonStats
  const fmt3 = (v: number) => v.toFixed(3).replace(/^0/, '')
  const fmtPct = (v: number) => `${v.toFixed(1)}%`
  const currentWar = warData?.war

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Back */}
      <Link href="/players" className="text-xs text-538-muted hover:text-538-text transition-colors inline-flex items-center gap-1">← Back to Batters</Link>

      {/* Name + team */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-538-text">{batterName}</h1>
        {teamAbbr && <span className="text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#3D405B' }}>{teamAbbr}</span>}
        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#3D405B' }}>{season} Season</span>
      </div>

      {/* Career stats table */}
      {careerSeasons.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-2">Career Stats</div>
          <BatterCareerTable seasons={careerSeasons} currentYear={String(currentSeason)} />
        </div>
      )}

      {/* Season stat bar — horizontal scroll on mobile */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-2">
          {season} Season · Last 40 games
        </div>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-2 flex-nowrap pb-1">
            <StatBox label="AVG"    value={fmt3(seasonStats.avg)} />
            <StatBox label="OBP"    value={fmt3(seasonStats.obp)} />
            <StatBox label="SLG"    value={fmt3(seasonStats.slg)} />
            <StatBox label="OPS"    value={fmt3(seasonStats.ops)} />
            <StatBox label="K%"     value={fmtPct(seasonStats.k_pct)} />
            <StatBox label="BB%"    value={fmtPct(seasonStats.bb_pct)} />
            <StatBox label="Whiff%" value={fmtPct(seasonStats.whiff_pct)} />
            <StatBox label="RV/100" value={(rv_per_100 >= 0 ? '+' : '') + rv_per_100.toFixed(1)} sub={`${rv_per_100_pct}th pct`} />
            <StatBox label="HR"     value={String(seasonStats.hr)} />
            <StatBox label="RBI"    value={String(seasonStats.rbi)} />
            <StatBox label="SB"     value={String(seasonStats.sb)} />
            {currentWar != null && <StatBox label="WAR" value={(currentWar >= 0 ? '+' : '') + currentWar.toFixed(1)} sub="bWAR" />}
          </div>
        </div>
      </div>

      {/* Controls: stat tabs + pitch type toggles */}
      <div className="bg-surface border border-538-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Zone Stat</span>
          <div className="flex gap-1 flex-wrap">
            {STAT_TABS.map(({ key, label }) => (
              <button key={key} onClick={() => setActiveStat(key)}
                className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors"
                style={activeStat===key ? { backgroundColor: '#3D405B', color: '#fff' } : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }}>
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              setCopying(true)
              const activeZones = selectedPitchType === 'ALL' ? zones : (pitchTypes.find(pt => pt.code === selectedPitchType)?.zones ?? zones)
              const colorMap = buildColorMap(activeZones.flat(), activeStat)
              const overall = computeWeightedMean(activeZones, activeStat)
              await exportBatterZoneImage({ batterId, batterName, teamAbbr, activeStat, selectedPitchType, pitchTypes, activeZones, colorMap, overall })
              setCopying(false)
              setTimeout(() => setCopying(false), 1500)
            }}
            disabled={copying}
            className="ml-auto text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded border transition-colors"
            style={copying ? { color: '#4ADE80', borderColor: '#4ADE80' } : { color: '#9CA3AF', borderColor: '#374151' }}
          >
            {copying ? '✓ Copied' : '⎘ Copy Image'}
          </button>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted mr-1">Pitch</span>
          <button onClick={() => setSelectedPitchType('ALL')}
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors whitespace-nowrap"
            style={selectedPitchType==='ALL' ? { backgroundColor: '#3D405B', color: '#fff' } : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }}>
            All
          </button>
          {pitchTypes.map(pt => (
            <button key={pt.code} onClick={() => setSelectedPitchType(pt.code)}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors whitespace-nowrap"
              style={selectedPitchType===pt.code ? { backgroundColor: '#3D405B', color: '#fff' } : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }}>
              {pt.name} <span className="opacity-60">({pt.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Zone grid + spray chart */}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        <div className="bg-surface border border-538-border rounded-xl p-4">
          <div className="flex items-baseline gap-2 mb-3"><span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Zone Breakdown</span><span className="text-[9px] text-538-muted">· Last 40 games</span></div>
          <ZoneGrid zones={zones} pitchTypes={pitchTypes} selectedPitchType={selectedPitchType} activeStat={activeStat} />
        </div>
        <div className="bg-surface border border-538-border rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-3">Spray Chart</div>
          {sprayPoints.length === 0 ? <p className="text-xs text-538-muted">No batted ball data available.</p> : <SprayChart sprayPoints={sprayPoints} selectedPitchType={selectedPitchType} />}
        </div>
      </div>

      {/* Season totals */}
      <div className="bg-surface border border-538-border rounded-xl p-4">
        <div className="flex items-baseline gap-2 mb-2"><span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Totals</span><span className="text-[9px] text-538-muted">· Last 40 games</span></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-538-muted">
          <span>PA <span className="font-semibold text-538-text">{data.totals.pa}</span></span>
          <span>AB <span className="font-semibold text-538-text">{data.totals.ab}</span></span>
          <span>H  <span className="font-semibold text-538-text">{data.totals.h}</span></span>
          <span>BB <span className="font-semibold text-538-text">{data.totals.bb}</span></span>
          {data.totals.avg !== null && <span>AVG <span className="font-semibold text-538-text">{data.totals.avg.toFixed(3).replace(/^0/, '')}</span></span>}
          {data.totals.obp !== null && <span>OBP <span className="font-semibold text-538-text">{data.totals.obp.toFixed(3).replace(/^0/, '')}</span></span>}
          {data.totals.slg !== null && <span>SLG <span className="font-semibold text-538-text">{data.totals.slg.toFixed(3).replace(/^0/, '')}</span></span>}
          {data.totals.ops !== null && <span>OPS <span className="font-semibold text-538-text">{data.totals.ops.toFixed(3)}</span></span>}
        </div>
        <p className="text-[9px] text-538-muted max-w-[400px] leading-relaxed mt-2">Based on last 40 games played. Shows batting outcomes on the final pitch of each plate appearance.</p>
      </div>
    </div>
  )
}
