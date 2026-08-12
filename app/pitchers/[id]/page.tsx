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
interface GameRarEntry { date: string; gamePk: number; opp: string; ip: string; er: number; k: number; rv: number; cumRv: number }

interface ArsenalPitch {
  pitch_type: string; pitch_name: string
  usage_pct: number | null; whiff_pct: number | null
  woba_against: number | null; xwoba_against: number | null
  hard_hit_pct: number | null; run_value_per_100: number | null
  avg_speed: number | null
}
interface ArsenalData { pitches: ArsenalPitch[] }

type MixMetric = 'usage' | 'whiff' | 'strike' | 'era'
interface PitchBucket { count: number; whiffs: number; strikes: number }
interface PitchMixData {
  byAbPitch: Record<string, Record<string, PitchBucket>>
  byInning: Record<string, Record<string, PitchBucket>>
  byGamePitch: Record<string, Record<string, PitchBucket>>
  pitchTypes: Array<{ type: string; name: string; color: string; count: number }>
  eraByInning: Record<string, { runs: number; appearances: number }>
}

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
  const [headshotImg, logoImg, siteLogoImg] = await Promise.all([
    loadImg(`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${pitcherId}/headshot/67/current`),
    loadImg(`https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`),
    loadImg('/logo.png'),
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

// ── Pitcher Season RV Chart ────────────────────────────────────────────────────

async function exportPitcherRarImage(opts: {
  pitcherId: string; pitcherName: string; teamAbbr: string
  games: GameRarEntry[]; war: number | null | undefined
}) {
  const { pitcherId, pitcherName, teamAbbr, games, war } = opts
  const SCALE = 2, W = 520, PAD = 16
  const IMG_SIZE = 48, HEADER_H = 72
  const CHART_H = 150, FOOTER_H = 24
  const H = PAD + HEADER_H + CHART_H + FOOTER_H + PAD

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE; canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!; ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#0D1117'; ctx.fillRect(0, 0, W, H)

  const slug = ESPN_ABBR_EXPORT[teamAbbr] ?? teamAbbr.toLowerCase()
  const [headshotImg, logoImg, siteLogoImg] = await Promise.all([
    loadImg(`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${pitcherId}/headshot/67/current`),
    loadImg(`https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`),
    loadImg('/logo.png'),
  ])

  const hY = PAD + (HEADER_H - IMG_SIZE) / 2
  if (headshotImg) {
    const ar = headshotImg.naturalWidth / headshotImg.naturalHeight
    let dw, dh, dx, dy
    if (ar >= 1) { dh = IMG_SIZE; dw = IMG_SIZE * ar; dx = PAD - (dw - IMG_SIZE) / 2; dy = hY }
    else { dw = IMG_SIZE; dh = IMG_SIZE / ar; dx = PAD; dy = hY - (dh - IMG_SIZE) / 2 }
    ctx.save(); ctx.beginPath()
    ctx.arc(PAD + IMG_SIZE / 2, hY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2); ctx.clip()
    ctx.drawImage(headshotImg, dx, dy, dw, dh); ctx.restore()
  } else {
    ctx.fillStyle = '#3D405B'; ctx.beginPath()
    ctx.arc(PAD + IMG_SIZE / 2, hY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2); ctx.fill()
  }
  const lx = W - PAD - IMG_SIZE
  if (logoImg) { ctx.drawImage(logoImg, lx, hY, IMG_SIZE, IMG_SIZE) }
  else {
    ctx.fillStyle = '#374151'; ctx.fillRect(lx, hY, IMG_SIZE, IMG_SIZE)
    ctx.fillStyle = '#9CA3AF'; ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(teamAbbr, lx + IMG_SIZE / 2, hY + IMG_SIZE / 2)
  }

  const lastRarVal = games[games.length - 1]?.cumRv ?? 0
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(pitcherName, W / 2, PAD + HEADER_H / 2 - 14)
  ctx.fillStyle = '#9CA3AF'; ctx.font = '10px sans-serif'
  ctx.fillText('Season Run Value · Cumulative', W / 2, PAD + HEADER_H / 2 + 5)
  const rpaaStr = `RPAA: ${lastRarVal >= 0 ? '+' : ''}${lastRarVal.toFixed(1)} (Runs Prevented Above Average)${war != null ? `  ·  WAR: ${war >= 0 ? '+' : ''}${war.toFixed(1)}` : ''}`
  ctx.font = 'bold 10px monospace'
  ctx.fillStyle = lastRarVal >= 0 ? '#34D399' : '#F87171'
  ctx.fillText(rpaaStr, W / 2, PAD + HEADER_H / 2 + 22)

  const cX = PAD + 4, cY = PAD + HEADER_H + 14
  const cW = W - 2 * PAD - 8, cH = CHART_H - 20
  const allVals = games.map(g => g.cumRv)
  const minV = Math.min(0, ...allVals), maxV = Math.max(0, ...allVals)
  const range = maxV - minV || 1
  const paddedMin = minV - range * 0.12, paddedMax = maxV + range * 0.12
  const paddedRange = paddedMax - paddedMin
  const tX = (i: number) => cX + (i / Math.max(games.length - 1, 1)) * cW
  const tY = (v: number) => cY + cH * (1 - (v - paddedMin) / paddedRange)
  const blY = tY(0)

  ctx.strokeStyle = '#374151'; ctx.lineWidth = 0.75; ctx.setLineDash([3, 3])
  ctx.beginPath(); ctx.moveTo(cX, blY); ctx.lineTo(cX + cW, blY); ctx.stroke()
  ctx.setLineDash([])

  const polyPts: [number, number][] = games.map((g, i) => [tX(i), tY(g.cumRv)])
  function drawPoly() {
    ctx.beginPath(); ctx.moveTo(tX(0), blY)
    for (const [px, py] of polyPts) ctx.lineTo(px, py)
    ctx.lineTo(tX(games.length - 1), blY); ctx.closePath()
  }
  function drawLine() {
    ctx.beginPath(); polyPts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
  }

  ctx.save(); ctx.beginPath(); ctx.rect(cX, cY, cW, blY - cY); ctx.clip()
  ctx.fillStyle = '#34D399'; ctx.globalAlpha = 0.15; drawPoly(); ctx.fill(); ctx.restore()
  ctx.save(); ctx.beginPath(); ctx.rect(cX, blY, cW, cY + cH - blY); ctx.clip()
  ctx.fillStyle = '#F87171'; ctx.globalAlpha = 0.15; drawPoly(); ctx.fill(); ctx.restore()
  ctx.save(); ctx.beginPath(); ctx.rect(cX, cY, cW, blY - cY); ctx.clip()
  ctx.strokeStyle = '#34D399'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  drawLine(); ctx.stroke(); ctx.restore()
  ctx.save(); ctx.beginPath(); ctx.rect(cX, blY, cW, cY + cH - blY); ctx.clip()
  ctx.strokeStyle = '#F87171'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  drawLine(); ctx.stroke(); ctx.restore()

  const lastX = tX(games.length - 1), lastY = tY(lastRarVal)
  const dotColor = lastRarVal >= 0 ? '#34D399' : '#F87171'
  ctx.fillStyle = dotColor; ctx.beginPath(); ctx.arc(lastX, lastY, 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = dotColor; ctx.font = 'bold 9px monospace'
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
  ctx.fillText(`${lastRarVal >= 0 ? '+' : ''}${lastRarVal.toFixed(1)}`, lastX, lastY - 4)

  ctx.fillStyle = '#6B7280'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText('App. 1', cX, cY + cH + 4)
  ctx.textAlign = 'right'
  ctx.fillText(`App. ${games.length}`, cX + cW, cY + cH + 4)

  const LOGO_H = 16, LOGO_W = Math.round(LOGO_H * 989 / 623)
  const footerY = H - FOOTER_H + 4
  ctx.fillStyle = '#4B5563'; ctx.font = '8px sans-serif'
  if (siteLogoImg) {
    ctx.drawImage(siteLogoImg, W - PAD - LOGO_W, footerY, LOGO_W, LOGO_H)
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText('samalytics', W - PAD - LOGO_W - 4, footerY + LOGO_H / 2)
  } else {
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'
    ctx.fillText('samalytics', W - PAD, footerY)
  }

  canvas.toBlob(async blob => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `${pitcherName.replace(/\s+/g, '_')}_rar.png`; a.click()
      URL.revokeObjectURL(url)
    }
  }, 'image/png')
}

function PitcherSeasonRvChart({ games, war, pitcherId, pitcherName, teamAbbr }: {
  games: GameRarEntry[]
  war?: number | null
  pitcherId?: string
  pitcherName?: string
  teamAbbr?: string
}) {
  const [copying, setCopying] = useState(false)
  if (!games.length) return null

  const W = 460, H = 155
  const PAD_TOP = 24, PAD_BOT = 18, PAD_X = 6
  const allVals = games.map(g => g.cumRv)
  const lastVal = allVals[allVals.length - 1]
  const minV = Math.min(0, ...allVals), maxV = Math.max(0, ...allVals)
  const range = maxV - minV || 1
  const paddedMin = minV - range * 0.13, paddedMax = maxV + range * 0.13
  const paddedRange = paddedMax - paddedMin
  const chartH = H - PAD_TOP - PAD_BOT
  const toX = (i: number) => PAD_X + (i / Math.max(games.length - 1, 1)) * (W - 2 * PAD_X)
  const toY = (v: number) => PAD_TOP + chartH * (1 - (v - paddedMin) / paddedRange)
  const baselineY = toY(0)
  const pts = games.map((g, i) => `${toX(i).toFixed(1)},${toY(g.cumRv).toFixed(1)}`).join(' ')
  const polyPts = `${toX(0).toFixed(1)},${baselineY.toFixed(1)} ${pts} ${toX(games.length - 1).toFixed(1)},${baselineY.toFixed(1)}`
  const lastX = toX(games.length - 1), lastY = toY(lastVal)
  const lastColor = lastVal >= 0 ? '#34D399' : '#F87171'

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Season Run Value</span>
          <span className="text-[9px] text-538-muted">
            RPAA: <span style={{ color: lastVal >= 0 ? '#34D399' : '#F87171', fontWeight: 700 }}>{lastVal >= 0 ? '+' : ''}{lastVal.toFixed(1)}</span>
            {war != null && <> {' · '} WAR: <span style={{ color: war >= 0 ? '#34D399' : '#F87171', fontWeight: 700 }}>{war >= 0 ? '+' : ''}{war.toFixed(1)}</span></>}
          </span>
        </div>
        {pitcherId && pitcherName && teamAbbr && (
          <button
            onClick={async () => {
              setCopying(true)
              await exportPitcherRarImage({ pitcherId, pitcherName, teamAbbr, games, war })
              setCopying(false)
            }}
            disabled={copying}
            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border transition-colors"
            style={copying ? { color: '#4ADE80', borderColor: '#4ADE80' } : { color: '#9CA3AF', borderColor: '#374151' }}
          >
            {copying ? '✓ Copied' : '⎘ Copy'}
          </button>
        )}
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <defs>
          <clipPath id="rpaa-above-zero"><rect x={0} y={0} width={W} height={baselineY} /></clipPath>
          <clipPath id="rpaa-below-zero"><rect x={0} y={baselineY} width={W} height={H - baselineY} /></clipPath>
        </defs>
        <line x1={PAD_X} y1={baselineY} x2={W - PAD_X} y2={baselineY}
          stroke="#374151" strokeWidth={0.75} strokeDasharray="3,3" />
        <polygon points={polyPts} clipPath="url(#rpaa-above-zero)" fill="#34D399" opacity={0.13} />
        <polygon points={polyPts} clipPath="url(#rpaa-below-zero)" fill="#F87171" opacity={0.13} />
        <polyline points={pts} clipPath="url(#rpaa-above-zero)" fill="none" stroke="#34D399" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={pts} clipPath="url(#rpaa-below-zero)" fill="none" stroke="#F87171" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={3.5} fill={lastColor} />
        <text x={lastX} y={lastY - 7} textAnchor="end" fontSize={8.5} fill={lastColor} fontFamily="monospace" fontWeight={700}>
          {lastVal >= 0 ? '+' : ''}{lastVal.toFixed(1)}
        </text>
        <text x={PAD_X} y={H - 2} fontSize={7} fill="#6B7280" fontFamily="sans-serif">App. 1</text>
        <text x={W - PAD_X} y={H - 2} textAnchor="end" fontSize={7} fill="#6B7280" fontFamily="sans-serif">App. {games.length}</text>
      </svg>

      <p className="text-[8px] text-538-muted mt-1">
        Cumulative RPAA (Runs Prevented Above Average) · {games.length} appearances
      </p>
    </div>
  )
}

// ── Pitch colors (client-side, mirrors lib/pitcherGame) ───────────────────────

const PITCH_COLOR_MAP: Record<string, string> = {
  FF: '#C62828', SI: '#E64A19', FC: '#F57C00', FT: '#D84315',
  SL: '#1565C0', ST: '#6A1B9A', SV: '#7B1FA2', SW: '#4527A0',
  CU: '#283593', KC: '#37474F',
  CH: '#2E7D32', FS: '#00695C', FO: '#00796B', SC: '#0277BD',
  KN: '#546E7A', EP: '#78909C',
}

// ── Arsenal table ──────────────────────────────────────────────────────────────

function PitchArsenalTable({ pitches }: { pitches: ArsenalPitch[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[9px] uppercase tracking-widest text-538-muted border-b border-538-border">
            <th className="pb-1.5 text-left font-bold pr-4">Pitch</th>
            <th className="pb-1.5 text-right font-bold px-2">Usage</th>
            <th className="pb-1.5 text-right font-bold px-2">Velo</th>
            <th className="pb-1.5 text-right font-bold px-2">Whiff%</th>
            <th className="pb-1.5 text-right font-bold px-2">HH%</th>
            <th className="pb-1.5 text-right font-bold px-2">wOBA</th>
            <th className="pb-1.5 text-right font-bold px-2">xwOBA</th>
            <th className="pb-1.5 text-right font-bold px-2">RV/100</th>
          </tr>
        </thead>
        <tbody>
          {pitches.map(p => {
            const color = PITCH_COLOR_MAP[p.pitch_type] ?? '#6B7280'
            const rv = p.run_value_per_100
            const rvColor = rv == null ? 'text-538-muted' : rv <= -1.5 ? 'text-emerald-400' : rv <= 0 ? 'text-blue-400' : rv <= 1 ? 'text-orange-400' : 'text-red-400'
            return (
              <tr key={p.pitch_type} className="border-b border-538-border/30 hover:bg-538-bg/40 transition-colors">
                <td className="py-1.5 pr-4">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-538-text font-medium">{p.pitch_name}</span>
                    <span className="text-[9px] text-538-muted font-mono">{p.pitch_type}</span>
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums px-2 font-semibold text-538-text">{p.usage_pct?.toFixed(1) ?? '—'}%</td>
                <td className="py-1.5 text-right tabular-nums px-2 text-538-muted">{p.avg_speed?.toFixed(1) ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums px-2 text-538-text">{p.whiff_pct?.toFixed(1) ?? '—'}%</td>
                <td className="py-1.5 text-right tabular-nums px-2 text-538-text">{p.hard_hit_pct?.toFixed(1) ?? '—'}%</td>
                <td className="py-1.5 text-right tabular-nums px-2 text-538-text">{p.woba_against?.toFixed(3) ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums px-2 text-538-text">{p.xwoba_against?.toFixed(3) ?? '—'}</td>
                <td className={`py-1.5 text-right tabular-nums px-2 font-bold ${rvColor}`}>
                  {rv == null ? '—' : (rv >= 0 ? '+' : '') + rv.toFixed(1)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Pitch Mix Charts ───────────────────────────────────────────────────────────

const AB_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8+']
const INNING_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const GAME_KEYS = ['1-15', '16-30', '31-45', '46-60', '61-75', '76-90', '91+']

function PitchMixLineChart({
  data, xKeys, pitchTypes, metric, xAxisLabel, eraByInning,
}: {
  data: Record<string, Record<string, PitchBucket>>
  xKeys: string[]
  pitchTypes: Array<{ type: string; name: string; color: string }>
  metric: MixMetric
  xAxisLabel: string
  eraByInning?: Record<string, { runs: number; appearances: number }>
}) {
  const W = 560, H = 170, PL = 36, PR = 80, PT = 16, PB = 24
  const pw = W - PL - PR, ph = H - PT - PB

  // ERA mode — single line, no per-pitch breakdown
  if (metric === 'era') {
    if (!eraByInning) return <p className="text-[10px] text-538-muted py-4 text-center">ERA available in Inning view only</p>
    const eraVals: (number | null)[] = xKeys.map(k => {
      const d = eraByInning[k]
      if (!d || d.appearances < 3) return null
      return (d.runs / d.appearances) * 9
    })
    const nonNull = eraVals.filter((v): v is number => v !== null)
    if (!nonNull.length) return <p className="text-[10px] text-538-muted py-4 text-center">Not enough ERA data</p>
    const yMax = Math.max(6, ...nonNull) * 1.15
    const xs = (i: number) => PL + (i / Math.max(xKeys.length - 1, 1)) * pw
    const ys = (v: number) => PT + ph - (v / yMax) * ph
    const pts = xKeys.map((k, i) => eraVals[i] !== null ? `${xs(i).toFixed(1)},${ys(eraVals[i]!).toFixed(1)}` : null)
    let lastIdx = -1
    eraVals.forEach((v, i) => { if (v !== null) lastIdx = i })
    return (
      <div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
          {[1, 3, 5].filter(v => v <= yMax).map(v => (
            <g key={v}>
              <line x1={PL} y1={ys(v).toFixed(1)} x2={W - PR} y2={ys(v).toFixed(1)} stroke="#374151" strokeWidth={0.5} strokeDasharray="2,3" />
              <text x={PL - 3} y={(ys(v) + 3).toFixed(1)} textAnchor="end" fontSize={6} fill="#6B7280" fontFamily="monospace">{v}</text>
            </g>
          ))}
          <line x1={PL} y1={PT + ph} x2={W - PR} y2={PT + ph} stroke="#374151" strokeWidth={0.5} />
          <polyline
            points={pts.filter(Boolean).join(' ')}
            fill="none" stroke="#94A3B8" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
          />
          {xKeys.map((k, i) => eraVals[i] !== null && (
            <circle key={k} cx={xs(i).toFixed(1)} cy={ys(eraVals[i]!).toFixed(1)} r={2.5} fill="#94A3B8" />
          ))}
          {lastIdx >= 0 && eraVals[lastIdx] !== null && (
            <text x={(xs(lastIdx) + 5).toFixed(1)} y={(ys(eraVals[lastIdx]!) + 3).toFixed(1)}
              fontSize={7} fill="#94A3B8" fontFamily="monospace" fontWeight={700}>
              {eraVals[lastIdx]!.toFixed(2)}
            </text>
          )}
          {xKeys.map((k, i) => (
            <text key={k} x={xs(i).toFixed(1)} y={H - 3} textAnchor="middle" fontSize={6.5} fill="#6B7280" fontFamily="monospace">{k}</text>
          ))}
        </svg>
        <p className="text-center text-[7px] text-538-muted mt-0.5">{xAxisLabel} · R/9 per inning pitched (min 3 starts)</p>
      </div>
    )
  }

  const series = pitchTypes.map(pt => {
    const vals: (number | null)[] = xKeys.map(xk => {
      const bkt = data[xk]
      if (!bkt?.[pt.type]) return null
      const { count, whiffs, strikes } = bkt[pt.type]
      const total = Object.values(bkt).reduce((s, b) => s + b.count, 0)
      if (metric === 'usage') return total > 0 ? (count / total) * 100 : null
      if (metric === 'whiff') return count >= 5 ? (whiffs / count) * 100 : null
      return count >= 5 ? (strikes / count) * 100 : null
    })
    return { ...pt, vals }
  }).filter(s => s.vals.some(v => v !== null))

  if (series.length === 0) return <p className="text-[10px] text-538-muted py-4 text-center">No data</p>

  const allVals = series.flatMap(s => s.vals).filter((v): v is number => v !== null)
  const yMax = metric === 'usage' ? 100 : Math.max(60, ...allVals) + 5
  const grids = metric === 'usage' ? [25, 50, 75] : [20, 40, 60]

  const xs = (i: number) => PL + (i / Math.max(xKeys.length - 1, 1)) * pw
  const ys = (v: number) => PT + ph - (v / yMax) * ph

  // Overall average line (weighted by pitch count) for whiff/strike
  const avgVals: (number | null)[] = metric === 'usage' ? [] : xKeys.map(xk => {
    const bkt = data[xk]
    if (!bkt) return null
    const totCount = Object.values(bkt).reduce((s, b) => s + b.count, 0)
    if (totCount < 5) return null
    if (metric === 'whiff') return Object.values(bkt).reduce((s, b) => s + b.whiffs, 0) / totCount * 100
    return Object.values(bkt).reduce((s, b) => s + b.strikes, 0) / totCount * 100
  })

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {grids.map(v => (
          <g key={v}>
            <line x1={PL} y1={ys(v).toFixed(1)} x2={W - PR} y2={ys(v).toFixed(1)} stroke="#374151" strokeWidth={0.5} strokeDasharray="2,3" />
            <text x={PL - 3} y={(ys(v) + 3).toFixed(1)} textAnchor="end" fontSize={6} fill="#6B7280" fontFamily="monospace">{v}%</text>
          </g>
        ))}
        <line x1={PL} y1={PT + ph} x2={W - PR} y2={PT + ph} stroke="#374151" strokeWidth={0.5} />

        {/* Average trend line */}
        {avgVals.length > 0 && (() => {
          const avgPts = avgVals.map((v, i) => v !== null ? `${xs(i).toFixed(1)},${ys(v).toFixed(1)}` : null).filter(Boolean)
          const lastAvgIdx = avgVals.reduce((acc, v, i) => v !== null ? i : acc, -1)
          return (
            <>
              <polyline points={avgPts.join(' ')} fill="none" stroke="#6B7280" strokeWidth={1} strokeDasharray="4,2" strokeLinecap="round" />
              {lastAvgIdx >= 0 && avgVals[lastAvgIdx] !== null && (
                <text x={(xs(lastAvgIdx) + 5).toFixed(1)} y={(ys(avgVals[lastAvgIdx]!) + 3).toFixed(1)}
                  fontSize={6.5} fill="#6B7280" fontFamily="monospace">Avg</text>
              )}
            </>
          )
        })()}

        {/* Per-pitch lines */}
        {series.flatMap(s => {
          const segs: string[][] = []
          let cur: string[] = []
          s.vals.forEach((v, i) => {
            if (v === null) { if (cur.length) { segs.push(cur); cur = [] } }
            else cur.push(`${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)
          })
          if (cur.length) segs.push(cur)
          return segs.map((seg, si) => (
            <polyline key={`${s.type}-${si}`} points={seg.join(' ')} fill="none"
              stroke={s.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          ))
        })}

        {/* Dots */}
        {series.flatMap(s =>
          s.vals.flatMap((v, i) => v === null ? [] : [
            <circle key={`${s.type}-${i}`} cx={xs(i).toFixed(1)} cy={ys(v).toFixed(1)} r={2.5} fill={s.color} />
          ])
        )}

        {/* End-of-line labels: pitch code + value */}
        {series.map(s => {
          const lastIdx = s.vals.reduce((acc, v, i) => v !== null ? i : acc, -1)
          if (lastIdx < 0 || s.vals[lastIdx] === null) return null
          const v = s.vals[lastIdx]!
          const lx = xs(lastIdx) + 5
          const ly = ys(v)
          return (
            <g key={`lbl-${s.type}`}>
              <text x={lx.toFixed(1)} y={(ly - 2).toFixed(1)} fontSize={6.5} fill={s.color} fontFamily="monospace" fontWeight={700}>{s.type}</text>
              <text x={lx.toFixed(1)} y={(ly + 6).toFixed(1)} fontSize={5.5} fill={s.color} fontFamily="monospace">{v.toFixed(0)}%</text>
            </g>
          )
        })}

        {xKeys.map((k, i) => (
          <text key={k} x={xs(i).toFixed(1)} y={H - 3} textAnchor="middle" fontSize={6.5} fill="#6B7280" fontFamily="monospace">{k}</text>
        ))}
      </svg>
      <p className="text-center text-[7px] text-538-muted mt-0.5">{xAxisLabel}</p>
    </div>
  )
}

function PitchContactProfile({
  pitchTypes, byPitchType,
}: {
  pitchTypes: Array<{ type: string; name: string; color: string; count: number }>
  byPitchType: Record<string, { count: number; gb: number; fb: number; ld: number; popup: number; whiffs: number; rvSum: number }>
}) {
  const total = pitchTypes.reduce((s, p) => s + p.count, 0)
  const shown = pitchTypes.filter(pt => (byPitchType[pt.type]?.count ?? 0) >= 10)
  if (shown.length === 0) return <p className="text-[10px] text-538-muted py-4 text-center">No contact data</p>

  return (
    <div className="space-y-3">
      {shown.map(pt => {
        const d = byPitchType[pt.type]
        const contact = d.gb + d.fb + d.ld + d.popup
        const usagePct = total > 0 ? (d.count / total * 100) : 0
        const whiffPct = d.count > 0 ? (d.whiffs / d.count * 100) : 0
        const avgRv = d.count > 0 ? d.rvSum / d.count : 0
        const gbPct = contact > 0 ? d.gb / contact * 100 : 0
        const fbPct = contact > 0 ? d.fb / contact * 100 : 0
        const ldPct = contact > 0 ? d.ld / contact * 100 : 0
        const puPct = contact > 0 ? d.popup / contact * 100 : 0
        return (
          <div key={pt.type} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 justify-between flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pt.color }} />
                <span className="text-[10px] font-semibold text-538-text">{pt.name}</span>
              </div>
              <div className="flex gap-3 text-[9px] text-538-muted font-mono">
                <span>Usage&nbsp;<span className="text-538-text font-bold">{usagePct.toFixed(0)}%</span></span>
                <span>Whiff&nbsp;<span className="text-538-text font-bold">{whiffPct.toFixed(0)}%</span></span>
                <span>Avg RV&nbsp;<span style={{ color: avgRv >= 0 ? '#34D399' : '#F87171' }} className="font-bold">{avgRv >= 0 ? '+' : ''}{avgRv.toFixed(3)}</span></span>
              </div>
            </div>
            {contact > 0 ? (
              <div className="flex rounded overflow-hidden h-4 w-full text-[8px]">
                {gbPct > 0 && <div title={`GB ${gbPct.toFixed(0)}%`} style={{ width: gbPct + '%', backgroundColor: '#34D399' }} className="flex items-center justify-center text-black font-bold overflow-hidden">{gbPct >= 12 ? `${gbPct.toFixed(0)}%` : ''}</div>}
                {ldPct > 0 && <div title={`LD ${ldPct.toFixed(0)}%`} style={{ width: ldPct + '%', backgroundColor: '#F59E0B' }} className="flex items-center justify-center text-black font-bold overflow-hidden">{ldPct >= 12 ? `${ldPct.toFixed(0)}%` : ''}</div>}
                {fbPct > 0 && <div title={`FB ${fbPct.toFixed(0)}%`} style={{ width: fbPct + '%', backgroundColor: '#3B82F6' }} className="flex items-center justify-center text-white font-bold overflow-hidden">{fbPct >= 12 ? `${fbPct.toFixed(0)}%` : ''}</div>}
                {puPct > 0 && <div title={`PU ${puPct.toFixed(0)}%`} style={{ width: puPct + '%', backgroundColor: '#6B7280' }} className="flex items-center justify-center text-white font-bold overflow-hidden">{puPct >= 12 ? `${puPct.toFixed(0)}%` : ''}</div>}
              </div>
            ) : (
              <div className="h-4 rounded bg-538-border/30 flex items-center px-2">
                <span className="text-[8px] text-538-muted">No batted ball data</span>
              </div>
            )}
          </div>
        )
      })}
      <div className="flex gap-4 text-[8px] text-538-muted mt-1 flex-wrap">
        {([['#34D399','GB — Ground Ball'],['#F59E0B','LD — Line Drive'],['#3B82F6','FB — Fly Ball'],['#6B7280','PU — Popup']] as [string,string][]).map(([c,l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: c }} />{l}
          </span>
        ))}
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
  const [gameRarData, setGameRarData] = useState<GameRarEntry[]>([])
  const [arsenalData, setArsenalData] = useState<ArsenalData | null>(null)
  const [pitchMixData, setPitchMixData] = useState<PitchMixData | null>(null)
  const [pitchMixLoading, setPitchMixLoading] = useState(false)
  const [abMetric, setAbMetric] = useState<MixMetric>('usage')
  const [gameView, setGameView] = useState<'game' | 'inning'>('game')
  const [gameMetric, setGameMetric] = useState<MixMetric>('usage')

  useEffect(() => {
    setPitchMixData(null)
    setPitchMixLoading(true)
    const doFetch = async () => {
      try {
        const r = await fetch(`/api/pitcher-pitch-mix?pitcherId=${pitcherId}&season=${season}`)
        if (!r.ok) return
        const d = await r.json() as PitchMixData
        if (d?.pitchTypes?.length) setPitchMixData(d)
      } catch { /* ignore */ } finally { setPitchMixLoading(false) }
    }
    doFetch()
  }, [pitcherId, season])

  useEffect(() => {
    setLoading(true); setError(''); setData(null); setGameRarData([]); setArsenalData(null)
    Promise.all([
      fetch(`/api/pitcher-season/zones?pitcherId=${pitcherId}&season=${season}`).then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch(`/api/player-war-history?playerId=${pitcherId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/prospect-career?playerId=${pitcherId}&group=pitching`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/pitcher-game-rar?pitcherId=${pitcherId}&season=${season}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/pitcher-arsenal?pitcherId=${pitcherId}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([zoneData, warEntries, careerData, rarData, arsenalResult]) => {
        setData(zoneData as SeasonZoneData)
        if (Array.isArray(warEntries)) {
          const pitcherEntry = warEntries.find((e: WarEntry) => e.player_type === 'pitcher') ?? warEntries[0]
          setWarData(pitcherEntry ?? null)
        }
        if (Array.isArray(careerData)) setCareerSeasons(careerData as CareerSeason[])
        if (rarData?.games) setGameRarData(rarData.games as GameRarEntry[])
        if ((arsenalResult as ArsenalData | null)?.pitches?.length) setArsenalData(arsenalResult as ArsenalData)
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

          {/* Season RAR trendline */}
          {gameRarData.length > 0 && (
            <div className="bg-surface border border-538-border rounded-xl p-4">
              <PitcherSeasonRvChart
                games={gameRarData} war={warData?.war}
                pitcherId={pitcherId} pitcherName={data.pitcherName} teamAbbr={data.teamAbbr ?? ''}
              />
            </div>
          )}

          {/* Pitch Arsenal — always shown when arsenal data loads (local, fast) */}
          {arsenalData && arsenalData.pitches.length > 0 && (
            <div className="bg-surface border border-538-border rounded-xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted mb-3">Pitch Arsenal · {season}</div>
              <PitchArsenalTable pitches={arsenalData.pitches} />
            </div>
          )}

          {/* Pitch Sequencing — loads from Statcast (may take a moment) */}
          {pitchMixData ? (
            <div className="space-y-4">
              {/* Chart 1: By AB pitch count */}
              <div className="bg-surface border border-538-border rounded-xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Pitch Mix · By Count in At-Bat</div>
                    <div className="text-[9px] text-538-muted mt-0.5">Avg pitch selection at each point in the AB · season</div>
                  </div>
                  <div className="inline-flex rounded border border-538-border overflow-hidden text-[9px]">
                    {(['usage','whiff','strike'] as MixMetric[]).map(m => (
                      <button key={m} onClick={() => setAbMetric(m)}
                        className={`px-2 py-1 font-semibold transition-colors ${abMetric === m ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
                        {m === 'usage' ? 'Usage %' : m === 'whiff' ? 'Whiff %' : 'Strike %'}
                      </button>
                    ))}
                  </div>
                </div>
                <PitchMixLineChart
                  data={pitchMixData.byAbPitch} xKeys={AB_KEYS}
                  pitchTypes={pitchMixData.pitchTypes} metric={abMetric}
                  xAxisLabel="Pitch number in at-bat"
                />
              </div>

              {/* Chart 2: By game pitch count / inning */}
              <div className="bg-surface border border-538-border rounded-xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">
                      Pitch Mix · By {gameView === 'game' ? 'Game Pitch Count' : 'Inning'}
                    </div>
                    <div className="text-[9px] text-538-muted mt-0.5">
                      How pitch selection evolves {gameView === 'game' ? 'through the game' : 'inning by inning'} · season avg
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <div className="inline-flex rounded border border-538-border overflow-hidden text-[9px]">
                      {(['game','inning'] as const).map(v => (
                        <button key={v} onClick={() => setGameView(v)}
                          className={`px-2 py-1 font-semibold transition-colors ${gameView === v ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
                          {v === 'game' ? 'By Pitch #' : 'By Inning'}
                        </button>
                      ))}
                    </div>
                    <div className="inline-flex rounded border border-538-border overflow-hidden text-[9px]">
                      {(['usage','whiff','strike','era'] as MixMetric[]).map(m => (
                        <button key={m} onClick={() => setGameMetric(m)}
                          className={`px-2 py-1 font-semibold transition-colors ${gameMetric === m ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
                          {m === 'usage' ? 'Usage %' : m === 'whiff' ? 'Whiff %' : m === 'strike' ? 'Strike %' : 'ERA'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <PitchMixLineChart
                  data={gameView === 'game' ? pitchMixData.byGamePitch : pitchMixData.byInning}
                  xKeys={gameView === 'game' ? GAME_KEYS : INNING_KEYS}
                  pitchTypes={pitchMixData.pitchTypes} metric={gameMetric}
                  xAxisLabel={gameView === 'game' ? 'Pitch number in game' : 'Inning'}
                  eraByInning={gameView === 'inning' ? pitchMixData.eraByInning : undefined}
                />
              </div>

            </div>
          ) : pitchMixLoading ? (
            <p className="text-[9px] text-538-muted">Loading pitch sequencing data…</p>
          ) : null}

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
