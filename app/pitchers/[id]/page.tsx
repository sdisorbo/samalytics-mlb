'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SeasonStats { era: number; whip: number; k9: number; bb9: number; wins: number; losses: number; ip: string }

interface ZoneCell {
  row: number; col: number; pa: number; ab: number; h: number; tb: number; bb: number
  avg: number | null; slg: number | null; obp: number | null; ops: number | null
  total_pitches: number; zone_pct: number | null; avg_rv: number | null
}

interface ZoneTotals { pa: number; ab: number; h: number; tb: number; bb: number; avg: number | null; slg: number | null; obp: number | null; ops: number | null }
interface PitchTypeEntry { code: string; name: string; count: number; zones: ZoneCell[][] }

interface SeasonZoneData {
  pitcherName: string; teamAbbr: string; season: number
  seasonStats: SeasonStats; rv_per_100: number; rv_per_100_pct: number
  zones: ZoneCell[][]; totals: ZoneTotals; pitchTypes: PitchTypeEntry[]
}

interface CareerSeason {
  year: string; level: string; team: string; teamAbbr: string
  g: number | null; gs: number | null; ip: string | null
  era: number | null; whip: number | null; k9: number | null; bb9: number | null
  wins: number | null; losses: number | null; so: number | null
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
  const map = new Map<string, string>()
  for (const { row, col, val } of values) {
    const t = range > 0 ? (val - min) / range : 0.5
    map.set(`${row}-${col}`, interpolateColor(t))
  }
  return map
}

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'avg', label: 'AVG' }, { key: 'obp', label: 'OBP' }, { key: 'slg', label: 'SLG' },
  { key: 'ops', label: 'OPS' }, { key: 'zone_pct', label: 'Zone%' }, { key: 'avg_rv', label: 'Avg RV' },
]

function formatStat(val: number | null, key: StatKey) {
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

async function exportZoneImage(opts: {
  pitcherId: string; pitcherName: string; teamAbbr: string
  activeStat: StatKey; selectedPitchType: string; pitchTypes: PitchTypeEntry[]
  activeZones: ZoneCell[][]; colorMap: Map<string, string>; overall: number | null
}) {
  const { pitcherId, pitcherName, teamAbbr, activeStat, selectedPitchType, pitchTypes, activeZones, colorMap, overall } = opts

  const SCALE = 2; const W = 360; const PAD = 16
  const IMG_SIZE = 48; const HEADER_H = 72; const BADGE_H = 32
  const GW = CELL_W * 5; const GH = CELL_H * 5
  const H = PAD + HEADER_H + BADGE_H + GH + 56 + PAD

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE; canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!; ctx.scale(SCALE, SCALE)

  // Background
  ctx.fillStyle = '#0D1117'; ctx.fillRect(0, 0, W, H)

  // Load headshot + team logo
  const slug = ESPN_ABBR_EXPORT[teamAbbr] ?? teamAbbr.toLowerCase()
  const [headshotImg, logoImg] = await Promise.all([
    loadImg(`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${pitcherId}/headshot/67/current`),
    loadImg(`https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`),
  ])

  // ── Header ──
  const hY = PAD + (HEADER_H - IMG_SIZE) / 2
  // Headshot (clipped circle, aspect-ratio preserved — object-fit:cover)
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
    ctx.fillStyle = '#374151'
    canvasRoundRect(ctx, lx, hY, IMG_SIZE, IMG_SIZE, 6); ctx.fill()
    ctx.fillStyle = '#9CA3AF'; ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(teamAbbr, lx + IMG_SIZE / 2, hY + IMG_SIZE / 2)
  }
  // Name + team
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(pitcherName, W / 2, PAD + HEADER_H / 2 - 9)
  ctx.fillStyle = '#9CA3AF'; ctx.font = '11px sans-serif'
  ctx.fillText(`${teamAbbr} · Pitcher`, W / 2, PAD + HEADER_H / 2 + 11)

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
        ctx.fillText(formatStat(statVal, activeStat), cx + CELL_W / 2, cy + CELL_H / 2)
      }
    }
  }
  // Strike zone border
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
    ctx.fillText(formatStat(overall, activeStat), gridLeft + lw, afterGrid)
  }

  const legendY = afterGrid + 16
  const legendItems = [
    { color: TEAL, label: activeStat === 'zone_pct' ? 'Less often thrown' : activeStat === 'avg_rv' ? 'Less RV allowed' : 'Better (lower)' },
    { color: PINK, label: activeStat === 'zone_pct' ? 'More often thrown' : 'Worse (higher)' },
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
  ctx.fillStyle = '#4B5563'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  ctx.fillText("Catcher's view · inner box = strike zone · samalytics.com", W / 2, legendY + 16)

  // Copy or download
  canvas.toBlob(async blob => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `${pitcherName.replace(/\s+/g, '_')}_zone.png`; a.click()
      URL.revokeObjectURL(url)
    }
  }, 'image/png')
}

// ── Zone Grid ──────────────────────────────────────────────────────────────────

const CELL_W = 44; const CELL_H = 38
const GRID_W = CELL_W * 5; const GRID_H = CELL_H * 5
const SZ_X = CELL_W; const SZ_Y = CELL_H; const SZ_W = CELL_W * 3; const SZ_H = CELL_H * 3

function ZoneGrid({ zones, pitchTypes, pitcherId, pitcherName, teamAbbr }: {
  zones: ZoneCell[][]; pitchTypes: PitchTypeEntry[]
  pitcherId: string; pitcherName: string; teamAbbr: string
}) {
  const [activeStat, setActiveStat] = useState<StatKey>('avg')
  const [selectedPitchType, setSelectedPitchType] = useState<string>('ALL')
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null)
  const [copying, setCopying] = useState(false)

  const activeZones = selectedPitchType === 'ALL' ? zones : (pitchTypes.find(pt => pt.code === selectedPitchType)?.zones ?? zones)
  const flatCells = activeZones.flat()
  const colorMap = buildColorMap(flatCells, activeStat)
  const overall = computeWeightedMean(activeZones, activeStat)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {[{ code: 'ALL', name: 'All', count: 0 }, ...pitchTypes].map(pt => (
          <button key={pt.code} onClick={() => setSelectedPitchType(pt.code)}
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors whitespace-nowrap"
            style={selectedPitchType===pt.code ? { backgroundColor: '#3D405B', color: '#fff' } : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }}>
            {pt.name}{pt.code !== 'ALL' && <span className="opacity-60"> ({pt.count})</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Zone</span>
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
            await exportZoneImage({ pitcherId, pitcherName, teamAbbr, activeStat, selectedPitchType, pitchTypes, activeZones, colorMap, overall })
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

      <div className="relative">
        <svg width={GRID_W} height={GRID_H} viewBox={`0 0 ${GRID_W} ${GRID_H}`} style={{ display: 'block' }}>
          {activeZones.map((rowCells, row) => rowCells.map((cell, col) => {
            const k = `${row}-${col}`
            const color = colorMap.get(k) ?? EMPTY_CELL
            const statVal = (cell as unknown as Record<string, number | null>)[activeStat] as number | null
            const x = col * CELL_W; const y = row * CELL_H
            const isHovered = hovered?.row === row && hovered?.col === col
            return (
              <g key={k} onMouseEnter={() => setHovered({ row, col })} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default' }}>
                <rect x={x+1} y={y+1} width={CELL_W-2} height={CELL_H-2} rx={2} fill={color} stroke={isHovered?'#94A3B8':'transparent'} strokeWidth={1} />
                <text x={x+CELL_W/2} y={y+CELL_H/2-(cell.pa>0&&isHovered?5:0)} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill={statVal!==null?'#fff':'#6B7280'} fontFamily="monospace" fontWeight={statVal!==null?'700':'400'}>
                  {formatStat(statVal, activeStat)}
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
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: TEAL }} /><span>{activeStat==='zone_pct'?'Less often thrown':activeStat==='avg_rv'?'Less run value allowed':'Better (lower)'}</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PINK }} /><span>{activeStat==='zone_pct'?'More often thrown':'Worse (higher)'}</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: EMPTY_CELL }} /><span>No data</span></div>
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

function PitcherCareerTable({ seasons, currentYear }: { seasons: CareerSeason[]; currentYear: string }) {
  const fmtF2 = (v: number | null) => v == null ? '—' : v.toFixed(2)
  return (
    <div className="overflow-x-auto rounded-xl border border-538-border">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="border-b border-538-border text-[10px] uppercase tracking-widest text-538-muted bg-538-card">
            <th className="px-3 py-2 text-left font-bold sticky left-0 bg-538-card z-10">Year</th>
            <th className="px-3 py-2 text-left font-bold">Lvl</th>
            <th className="px-3 py-2 text-left font-bold">Team</th>
            <th className="px-3 py-2 text-right font-bold">G</th>
            <th className="px-3 py-2 text-right font-bold">GS</th>
            <th className="px-3 py-2 text-right font-bold">IP</th>
            <th className="px-3 py-2 text-right font-bold">W-L</th>
            <th className="px-3 py-2 text-right font-bold">ERA</th>
            <th className="px-3 py-2 text-right font-bold">WHIP</th>
            <th className="px-3 py-2 text-right font-bold">K/9</th>
            <th className="px-3 py-2 text-right font-bold">BB/9</th>
            <th className="px-3 py-2 text-right font-bold">SO</th>
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
                <td className="px-3 py-2 text-right text-538-text">{s.gs ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.ip ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.wins ?? '—'}–{s.losses ?? '—'}</td>
                <td className="px-3 py-2 text-right font-semibold text-538-text">{fmtF2(s.era)}</td>
                <td className="px-3 py-2 text-right text-538-text">{fmtF2(s.whip)}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.k9?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.bb9?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-2 text-right text-538-text">{s.so ?? '—'}</td>
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PitcherPage({ params }: { params: { id: string } }) {
  const pitcherId = params.id
  const currentSeason = new Date().getFullYear()
  const [season, setSeason] = useState(currentSeason)
  const [data, setData] = useState<SeasonZoneData | null>(null)
  const [warData, setWarData] = useState<WarEntry | null>(null)
  const [careerSeasons, setCareerSeasons] = useState<CareerSeason[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true); setError(''); setData(null)
    Promise.all([
      fetch(`/api/pitcher-season/zones?pitcherId=${pitcherId}&season=${season}`).then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch(`/api/player-war-history?playerId=${pitcherId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/prospect-career?playerId=${pitcherId}&group=pitching`).then(r => r.ok ? r.json() : []).catch(() => []),
    ])
      .then(([zoneData, warEntries, careerData]) => {
        setData(zoneData as SeasonZoneData)
        if (Array.isArray(warEntries)) {
          const pitcherEntry = warEntries.find((e: WarEntry) => e.player_type === 'pitcher') ?? warEntries[0]
          setWarData(pitcherEntry ?? null)
        }
        if (Array.isArray(careerData)) setCareerSeasons(careerData as CareerSeason[])
      })
      .catch(() => setError('Could not load pitcher data.'))
      .finally(() => setLoading(false))
  }, [pitcherId, season])

  const { seasonStats, rv_per_100, rv_per_100_pct } = data ?? {}

  return (
    <main className="max-w-screen-lg mx-auto px-4 py-8 space-y-6">
      {/* Back */}
      <Link href="/pitchers" className="text-xs text-538-muted hover:text-538-text transition-colors flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        All Pitchers
      </Link>

      {/* Header + season selector */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-538-text tracking-tight">
            {data?.pitcherName ?? (loading ? 'Loading…' : `Pitcher ${pitcherId}`)}
          </h1>
          {data?.teamAbbr && <p className="text-sm text-538-muted mt-1">{data.teamAbbr} · Pitcher</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-538-muted">Season</span>
          <div className="inline-flex rounded border border-538-border overflow-hidden">
            {[currentSeason, currentSeason-1, currentSeason-2].map(yr => (
              <button key={yr} onClick={() => setSeason(yr)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${season===yr ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
                {yr}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <p className="text-538-muted text-sm">Loading pitcher data…</p>}
      {error && <div className="py-8 text-sm text-red-500">{error}</div>}

      {/* Career stats table */}
      {careerSeasons.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-2">Career Stats</div>
          <PitcherCareerTable seasons={careerSeasons} currentYear={String(currentSeason)} />
        </div>
      )}

      {data && seasonStats && (
        <div className="space-y-6">
          {/* Season stat bar — horizontal scroll on mobile */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-2">{season} Season</div>
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex gap-2 flex-nowrap pb-1">
                <StatBox label="ERA"    value={seasonStats.era.toFixed(2)} />
                <StatBox label="W-L"    value={`${seasonStats.wins}-${seasonStats.losses}`} />
                <StatBox label="IP"     value={seasonStats.ip} />
                <StatBox label="K/9"    value={seasonStats.k9.toFixed(1)} />
                <StatBox label="BB/9"   value={seasonStats.bb9.toFixed(1)} />
                <StatBox label="WHIP"   value={seasonStats.whip.toFixed(2)} />
                <StatBox label="RV/100" value={(rv_per_100! >= 0 ? '+' : '') + rv_per_100!.toFixed(1)} sub={`${rv_per_100_pct}th pct`} />
                {warData?.war != null && <StatBox label="WAR" value={(warData.war >= 0 ? '+' : '') + warData.war.toFixed(1)} sub="bWAR" />}
              </div>
            </div>
          </div>

          {/* Zone grid + totals */}
          <div className="bg-surface border border-538-border rounded-xl p-5">
            <div className="flex flex-col sm:flex-row gap-8">
              <ZoneGrid zones={data.zones} pitchTypes={data.pitchTypes} pitcherId={pitcherId} pitcherName={data.pitcherName} teamAbbr={data.teamAbbr ?? ''} />
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
                <p className="text-[9px] text-538-muted max-w-[240px] leading-relaxed mt-2">Based on last 40 games pitched. Batting outcomes on the final pitch of each plate appearance.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
