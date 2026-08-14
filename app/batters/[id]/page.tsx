'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useMemo } from 'react'
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

interface WarEntry { name: string; team: string; war: number; player_type: string; career: WarSeason[] }
interface WarSeason { year: number; war: number; off_war: number | null; def_war: number | null }
interface GameRarEntry { date: string; gamePk: number; opp: string; pa: number; rv: number; cumRv: number }

type StatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'zone_pct' | 'avg_rv'
type AbSeqMetric = 'swing' | 'hardcontact'

interface BatterSeqBucket { count: number; swings: number; contact: number; hardContact: number }
interface BatterAbSeqData {
  byAbPitch: Record<string, Record<string, BatterSeqBucket>>
  pitchTypes: Array<{ type: string; name: string; color: string; count: number }>
}

interface ScenarioBucket {
  count: number; swings: number; whiffs: number; contact: number; hardContact: number
  rv_sum: number; pa: number; h: number; bb: number; ab: number; tb: number
}
interface BatterScenarioData {
  byPT: Record<string, Record<string, Record<string, ScenarioBucket>>>
  pitchTypes: Array<{ type: string; name: string; color: string; count: number }>
}

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

// ── RAR Chart + canvas export ──────────────────────────────────────────────────

async function exportRarImage(opts: {
  batterId: string; batterName: string; teamAbbr: string
  games: GameRarEntry[]; war: number | null | undefined
}) {
  const { batterId, batterName, teamAbbr, games, war } = opts
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
    loadImg(`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${batterId}/headshot/67/current`),
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
  ctx.fillText(batterName, W / 2, PAD + HEADER_H / 2 - 14)
  ctx.fillStyle = '#9CA3AF'; ctx.font = '10px sans-serif'
  ctx.fillText('Season Run Value · Cumulative', W / 2, PAD + HEADER_H / 2 + 5)
  const rarStr = `RAR: ${lastRarVal >= 0 ? '+' : ''}${lastRarVal.toFixed(1)} (Runs Above Expected)${war != null ? `  ·  WAR: ${war >= 0 ? '+' : ''}${war.toFixed(1)}` : ''}`
  ctx.font = 'bold 10px monospace'
  ctx.fillStyle = lastRarVal >= 0 ? '#34D399' : '#F87171'
  ctx.fillText(rarStr, W / 2, PAD + HEADER_H / 2 + 22)

  // Chart area
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
    ctx.beginPath()
    ctx.moveTo(tX(0), blY)
    for (const [px, py] of polyPts) ctx.lineTo(px, py)
    ctx.lineTo(tX(games.length - 1), blY)
    ctx.closePath()
  }
  function drawLine() {
    ctx.beginPath()
    polyPts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
  }

  // Green area above zero
  ctx.save(); ctx.beginPath(); ctx.rect(cX, cY, cW, blY - cY); ctx.clip()
  ctx.fillStyle = '#34D399'; ctx.globalAlpha = 0.15; drawPoly(); ctx.fill(); ctx.restore()
  // Red area below zero
  ctx.save(); ctx.beginPath(); ctx.rect(cX, blY, cW, cY + cH - blY); ctx.clip()
  ctx.fillStyle = '#F87171'; ctx.globalAlpha = 0.15; drawPoly(); ctx.fill(); ctx.restore()
  // Green line above zero
  ctx.save(); ctx.beginPath(); ctx.rect(cX, cY, cW, blY - cY); ctx.clip()
  ctx.strokeStyle = '#34D399'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  drawLine(); ctx.stroke(); ctx.restore()
  // Red line below zero
  ctx.save(); ctx.beginPath(); ctx.rect(cX, blY, cW, cY + cH - blY); ctx.clip()
  ctx.strokeStyle = '#F87171'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  drawLine(); ctx.stroke(); ctx.restore()

  const lastVal = allVals[allVals.length - 1]
  const lastX = tX(games.length - 1), lastY = tY(lastVal)
  const dotColor = lastVal >= 0 ? '#34D399' : '#F87171'
  ctx.fillStyle = dotColor; ctx.beginPath(); ctx.arc(lastX, lastY, 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = dotColor; ctx.font = 'bold 9px monospace'
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
  ctx.fillText(`${lastVal >= 0 ? '+' : ''}${lastVal.toFixed(1)}`, lastX, lastY - 4)

  ctx.fillStyle = '#6B7280'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText('Game 1', cX, cY + cH + 4)
  ctx.textAlign = 'right'
  ctx.fillText(`Game ${games.length}`, cX + cW, cY + cH + 4)

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
      a.download = `${batterName.replace(/\s+/g, '_')}_rar.png`; a.click()
      URL.revokeObjectURL(url)
    }
  }, 'image/png')
}

async function exportSprayImage(opts: {
  batterId: string; batterName: string; teamAbbr: string
  filteredPoints: SprayPoint[]; mode: SprayMode
  heatCells: Map<string, { count: number; val: number }> | null
  maxCount: number; maxVal: number
}) {
  const { batterId, batterName, teamAbbr, filteredPoints, mode, heatCells, maxCount, maxVal } = opts
  const SCALE = 2
  const FIELD_X = 20, FIELD_W_C = 300, FIELD_H_C = 265
  const PAD = 14, IMG_SIZE = 48, HEADER_H = 72, FOOTER_H = 22
  const W = FIELD_X + FIELD_W_C + FIELD_X
  const FIELD_Y_OFF = PAD + HEADER_H + 4
  const H = FIELD_Y_OFF + FIELD_H_C + FOOTER_H + PAD

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
  const lx = W - PAD - IMG_SIZE
  if (logoImg) { ctx.drawImage(logoImg, lx, hY, IMG_SIZE, IMG_SIZE) }
  else {
    ctx.fillStyle = '#374151'; canvasRoundRect(ctx, lx, hY, IMG_SIZE, IMG_SIZE, 6); ctx.fill()
    ctx.fillStyle = '#9CA3AF'; ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(teamAbbr, lx + IMG_SIZE / 2, hY + IMG_SIZE / 2)
  }
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(batterName, W / 2, PAD + HEADER_H / 2 - 9)
  ctx.fillStyle = '#9CA3AF'; ctx.font = '11px sans-serif'
  const modeLabel = mode === 'scatter' ? 'Scatter' : mode === 'density' ? 'Density' : 'Hit Value'
  ctx.fillText(`${teamAbbr} · Spray Chart · ${modeLabel}`, W / 2, PAD + HEADER_H / 2 + 11)

  // ── Field ──
  const fx = (x: number) => x + FIELD_X
  const fy = (y: number) => y + FIELD_Y_OFF

  ctx.fillStyle = '#1F2937'
  ctx.fillRect(fx(0), fy(0), FIELD_W_C, FIELD_H_C)

  // Outfield grass
  ctx.fillStyle = '#1a3a1a'; ctx.beginPath()
  ctx.moveTo(fx(HPX), fy(HPY)); ctx.lineTo(fx(LF[0]), fy(LF[1]))
  ctx.quadraticCurveTo(fx(WALL_CTX), fy(WALL_CTY), fx(RF[0]), fy(RF[1])); ctx.closePath(); ctx.fill()

  // Warning track
  ctx.fillStyle = '#2a5a2a'; ctx.beginPath()
  ctx.moveTo(fx(HPX), fy(HPY)); ctx.lineTo(fx(WT_LF[0]), fy(WT_LF[1]))
  ctx.quadraticCurveTo(fx(WT_CTX), fy(WT_CTY), fx(WT_RF[0]), fy(WT_RF[1])); ctx.closePath(); ctx.fill()

  // Infield dirt
  ctx.fillStyle = '#5a3a22'; ctx.beginPath()
  ctx.arc(fx(HPX), fy(HPY - 36), 62, 0, Math.PI * 2); ctx.fill()

  // Diamond grass
  ctx.fillStyle = '#2d5c2d'; ctx.beginPath()
  ctx.moveTo(fx(HPX), fy(HPY)); ctx.lineTo(fx(B1[0]), fy(B1[1]))
  ctx.lineTo(fx(B2[0]), fy(B2[1])); ctx.lineTo(fx(B3[0]), fy(B3[1])); ctx.closePath(); ctx.fill()

  // Foul lines
  ctx.strokeStyle = '#5a7a5a'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(fx(HPX), fy(HPY)); ctx.lineTo(fx(LF[0]), fy(LF[1])); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(fx(HPX), fy(HPY)); ctx.lineTo(fx(RF[0]), fy(RF[1])); ctx.stroke()

  // Outfield wall
  ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1.5; ctx.beginPath()
  ctx.moveTo(fx(LF[0]), fy(LF[1]))
  ctx.quadraticCurveTo(fx(WALL_CTX), fy(WALL_CTY), fx(RF[0]), fy(RF[1])); ctx.stroke()

  // Base paths
  ctx.strokeStyle = '#8b6a44'; ctx.lineWidth = 3; ctx.setLineDash([])
  const bPos: [number, number][] = [[HPX, HPY], [B1[0], B1[1]], [B2[0], B2[1]], [B3[0], B3[1]]]
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = bPos[i], [bx2, by2] = bPos[(i + 1) % 4]
    ctx.beginPath(); ctx.moveTo(fx(ax), fy(ay)); ctx.lineTo(fx(bx2), fy(by2)); ctx.stroke()
  }

  // Pitcher mound
  ctx.fillStyle = '#6b4a2a'; ctx.beginPath()
  ctx.arc(fx(HPX), fy(MOUND_Y), 7, 0, Math.PI * 2); ctx.fill()

  // Bases (rotated squares)
  for (const [bx2, by2] of [B1, B2, B3]) {
    ctx.save(); ctx.translate(fx(bx2), fy(by2)); ctx.rotate(Math.PI / 4)
    ctx.fillStyle = '#E5E7EB'; ctx.fillRect(-4, -4, 8, 8); ctx.restore()
  }

  // Home plate
  ctx.fillStyle = '#D1D5DB'; ctx.beginPath()
  ctx.moveTo(fx(HPX - 5), fy(HPY - 3)); ctx.lineTo(fx(HPX + 5), fy(HPY - 3))
  ctx.lineTo(fx(HPX + 5), fy(HPY + 2)); ctx.lineTo(fx(HPX), fy(HPY + 6))
  ctx.lineTo(fx(HPX - 5), fy(HPY + 2)); ctx.closePath(); ctx.fill()

  // Heat sectors (density / value modes)
  if (mode !== 'scatter' && heatCells) {
    for (let aBin = 0; aBin < A_BINS; aBin++) {
      for (let dBin = 0; dBin < 3; dBin++) {
        const cell = heatCells.get(`${aBin}-${dBin}`)
        if (!cell) continue
        const a1 = A_START + aBin * A_STEP, a2 = a1 + A_STEP
        const r1 = D_BREAKS[dBin], r2 = D_BREAKS[dBin + 1]
        const t = mode === 'density' ? cell.count / maxCount : (cell.val / Math.max(cell.count, 1)) / maxVal
        const fill = heatColor(t, 0.65)
        if (fill === 'transparent') continue
        const N = 12
        ctx.beginPath()
        ctx.moveTo(fx(spX(r1, a1)), fy(spY(r1, a1)))
        ctx.lineTo(fx(spX(r2, a1)), fy(spY(r2, a1)))
        for (let k = 1; k <= N; k++) { const a = a1 + (a2 - a1) * k / N; ctx.lineTo(fx(spX(r2, a)), fy(spY(r2, a))) }
        ctx.lineTo(fx(spX(r1, a2)), fy(spY(r1, a2)))
        for (let k = N - 1; k >= 0; k--) { const a = a1 + (a2 - a1) * k / N; ctx.lineTo(fx(spX(r1, a)), fy(spY(r1, a))) }
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
      }
    }
  }

  // Scatter dots (clipped to fair territory)
  ctx.save(); ctx.beginPath()
  ctx.moveTo(fx(HPX), fy(HPY)); ctx.lineTo(fx(LF[0]), fy(LF[1]))
  ctx.quadraticCurveTo(fx(WALL_CTX), fy(WALL_CTY), fx(RF[0]), fy(RF[1])); ctx.closePath(); ctx.clip()
  for (const pt of filteredPoints) {
    ctx.fillStyle = EVENT_COLORS[pt.eventType] ?? '#6B7280'
    ctx.globalAlpha = mode === 'scatter' ? 0.8 : 0.45
    ctx.beginPath(); ctx.arc(fx(pt.x * SPRAY_SCALE), fy(pt.y * SPRAY_SCALE), mode === 'scatter' ? 4 : 2.5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1; ctx.restore()

  // ── Footer ──
  const footerY = H - FOOTER_H + 4
  const LOGO_H = 16, LOGO_W = Math.round(LOGO_H * 989 / 623)
  ctx.fillStyle = '#4B5563'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(`${filteredPoints.length} hit${filteredPoints.length !== 1 ? 's' : ''}`, FIELD_X, footerY + LOGO_H / 2)
  if (siteLogoImg) {
    ctx.drawImage(siteLogoImg, W - PAD - LOGO_W, footerY, LOGO_W, LOGO_H)
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText('samalytics', W - PAD - LOGO_W - 4, footerY + LOGO_H / 2)
  } else {
    ctx.textAlign = 'right'; ctx.fillText('samalytics', W - PAD, footerY + LOGO_H / 2)
  }

  canvas.toBlob(async blob => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `${batterName.replace(/\s+/g, '_')}_spray.png`; a.click()
      URL.revokeObjectURL(url)
    }
  }, 'image/png')
}

function SeasonRvChart({ games, war, batterId, batterName, teamAbbr }: {
  games: GameRarEntry[]
  war?: number | null
  batterId?: string
  batterName?: string
  teamAbbr?: string
}) {
  const [copying, setCopying] = useState(false)
  if (!games.length) return null

  const W = 460, H = 155
  const PAD_TOP = 24, PAD_BOT = 18, PAD_X = 6

  const allVals = games.map(g => g.cumRv)
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

  const lastVal = allVals[allVals.length - 1]
  const lastX = toX(games.length - 1), lastY = toY(lastVal)
  const lastColor = lastVal >= 0 ? '#34D399' : '#F87171'

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Season Run Value</span>
          <span className="text-[9px] text-538-muted">
            RAR: <span style={{ color: lastVal >= 0 ? '#34D399' : '#F87171', fontWeight: 700 }}>{lastVal >= 0 ? '+' : ''}{lastVal.toFixed(1)}</span>
            {war != null && <> {' · '} WAR: <span style={{ color: war >= 0 ? '#34D399' : '#F87171', fontWeight: 700 }}>{war >= 0 ? '+' : ''}{war.toFixed(1)}</span></>}
          </span>
        </div>
        {batterId && batterName && teamAbbr && (
          <button
            onClick={async () => {
              setCopying(true)
              await exportRarImage({ batterId, batterName, teamAbbr, games, war })
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

      <div style={{ maxWidth: W }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <defs>
          <clipPath id="rar-above-zero">
            <rect x={0} y={0} width={W} height={baselineY} />
          </clipPath>
          <clipPath id="rar-below-zero">
            <rect x={0} y={baselineY} width={W} height={H - baselineY} />
          </clipPath>
        </defs>

        {/* Zero baseline */}
        <line x1={PAD_X} y1={baselineY} x2={W - PAD_X} y2={baselineY}
          stroke="#374151" strokeWidth={0.75} strokeDasharray="3,3" />

        {/* Green fill above zero */}
        <polygon points={polyPts} clipPath="url(#rar-above-zero)" fill="#34D399" opacity={0.13} />
        {/* Red fill below zero */}
        <polygon points={polyPts} clipPath="url(#rar-below-zero)" fill="#F87171" opacity={0.13} />

        {/* Green line above zero */}
        <polyline points={pts} clipPath="url(#rar-above-zero)"
          fill="none" stroke="#34D399" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* Red line below zero */}
        <polyline points={pts} clipPath="url(#rar-below-zero)"
          fill="none" stroke="#F87171" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* Last point dot */}
        <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={3.5} fill={lastColor} />

        {/* Value label — anchored to end, never clips */}
        <text x={lastX} y={lastY - 7} textAnchor="end" fontSize={8.5}
          fill={lastColor} fontFamily="monospace" fontWeight={700}>
          {lastVal >= 0 ? '+' : ''}{lastVal.toFixed(1)}
        </text>

        {/* Axis labels */}
        <text x={PAD_X} y={H - 2} fontSize={7} fill="#6B7280" fontFamily="sans-serif">Game 1</text>
        <text x={W - PAD_X} y={H - 2} textAnchor="end" fontSize={7} fill="#6B7280" fontFamily="sans-serif">
          Game {games.length}
        </text>
      </svg>
      </div>

      <p className="text-[8px] text-538-muted mt-1">
        Cumulative RAR (Runs Above Expected) · {games.length} games
      </p>
    </div>
  )
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
const HIT_VAL: Record<string, number> = { single: 1, double: 2, triple: 3, home_run: 4 }

type SprayMode = 'scatter' | 'density' | 'value'
const SPRAY_MODES: { key: SprayMode; label: string }[] = [
  { key: 'scatter', label: 'Scatter' },
  { key: 'density', label: 'Density' },
  { key: 'value',   label: 'Hit Value' },
]

// Field coordinate constants (raw StatCast coordX/Y, scaled by SPRAY_SCALE to SVG)
const SPRAY_SCALE = 1.2
const HPX = 125 * SPRAY_SCALE  // home plate SVG x = 150
const HPY = 204 * SPRAY_SCALE  // home plate SVG y = 244.8

// Convert polar (distance from HP in SVG units, spray angle in degrees, 0=CF +RF -LF) → SVG point
const spX = (r: number, deg: number) => HPX + r * Math.sin(deg * Math.PI / 180)
const spY = (r: number, deg: number) => HPY - r * Math.cos(deg * Math.PI / 180)

// Build SVG path for a sector arc (annular sector from r1..r2, angle a1..a2 degrees)
function sectorPath(r1: number, r2: number, a1: number, a2: number): string {
  const la = (a2 - a1) >= 180 ? 1 : 0
  return [
    `M ${spX(r1,a1).toFixed(1)} ${spY(r1,a1).toFixed(1)}`,
    `L ${spX(r2,a1).toFixed(1)} ${spY(r2,a1).toFixed(1)}`,
    `A ${r2} ${r2} 0 ${la} 1 ${spX(r2,a2).toFixed(1)} ${spY(r2,a2).toFixed(1)}`,
    `L ${spX(r1,a2).toFixed(1)} ${spY(r1,a2).toFixed(1)}`,
    `A ${r1} ${r1} 0 ${la} 0 ${spX(r1,a1).toFixed(1)} ${spY(r1,a1).toFixed(1)}`,
    'Z',
  ].join(' ')
}

// Wall arc path (quadratic bezier through LF, CF, RF)
// LF pole: r=198, -45° | CF: r=240, 0° | RF: r=198, +45°
const LF = [spX(198, -45), spY(198, -45)] as const
const RF = [spX(198,  45), spY(198,  45)] as const
const CF = [spX(240,   0), spY(240,   0)] as const
// Bezier control point so curve passes through CF at t=0.5:
// At t=0.5 for quadratic: (P0 + 2*P1 + P2)/4 = mid → P1 = 2*mid - (P0+P2)/2
const WALL_CTX = 2 * CF[0] - (LF[0] + RF[0]) / 2
const WALL_CTY = 2 * CF[1] - (LF[1] + RF[1]) / 2
// Warning track (8 SVG units inside wall)
const WT_LF = [spX(190, -45), spY(190, -45)] as const
const WT_RF = [spX(190,  45), spY(190,  45)] as const
const WT_CF = [spX(232,   0), spY(232,   0)] as const
const WT_CTX = 2 * WT_CF[0] - (WT_LF[0] + WT_RF[0]) / 2
const WT_CTY = 2 * WT_CF[1] - (WT_LF[1] + WT_RF[1]) / 2

// Base positions in SVG space (90ft base paths; 1 SVG ≈ 1.67ft)
const BASE_PX = 54  // 90ft in SVG units
const B2 = [HPX,            HPY - BASE_PX * Math.SQRT2] as const  // 2B (straight toward CF)
const B1 = [HPX + BASE_PX * Math.SQRT2 / 2, HPY - BASE_PX * Math.SQRT2 / 2] as const  // 1B
const B3 = [HPX - BASE_PX * Math.SQRT2 / 2, HPY - BASE_PX * Math.SQRT2 / 2] as const  // 3B

// Pitching mound (60.5ft from HP)
const MOUND_Y = HPY - 60.5 / 90 * BASE_PX * Math.SQRT2

// Sector grid: 9 angle bins (-45 to +45, 10° each), 3 distance bins
const A_BINS = 9; const A_STEP = 10; const A_START = -45
const D_BREAKS = [40, 110, 165, 205] as const  // SVG unit boundaries

function computeHeatCells(points: SprayPoint[]): Map<string, { count: number; val: number }> {
  const cells = new Map<string, { count: number; val: number }>()
  for (const pt of points) {
    const sx = pt.x * SPRAY_SCALE; const sy = pt.y * SPRAY_SCALE
    const dx = sx - HPX; const dy = HPY - sy  // positive dy = toward CF
    const dist = Math.sqrt(dx * dx + dy * dy)
    const angleDeg = Math.atan2(dx, dy) * 180 / Math.PI
    if (Math.abs(angleDeg) > 50 || dist < D_BREAKS[0]) continue
    const aBin = Math.max(0, Math.min(A_BINS - 1, Math.floor((angleDeg - A_START) / A_STEP)))
    const dBin = dist < D_BREAKS[1] ? 0 : dist < D_BREAKS[2] ? 1 : dist < D_BREAKS[3] ? 2 : -1
    if (dBin < 0) continue
    const key = `${aBin}-${dBin}`
    const cur = cells.get(key) ?? { count: 0, val: 0 }
    cur.count++; cur.val += HIT_VAL[pt.eventType] ?? 1
    cells.set(key, cur)
  }
  return cells
}

function heatColor(t: number, alpha = 0.65): string {
  if (t < 0.001) return 'transparent'
  // cool (teal) → warm (orange/red)
  const r = Math.round(lerp(56, 239, t))
  const g = Math.round(lerp(189, 88, t))
  const b = Math.round(lerp(158, 36, t))
  return `rgba(${r},${g},${b},${alpha * Math.max(0.25, t)})`
}

function SprayChart({
  sprayPoints, selectedPitchType,
  batterId, batterName, teamAbbr,
}: {
  sprayPoints: SprayPoint[]; selectedPitchType: string
  batterId?: string; batterName?: string; teamAbbr?: string
}) {
  const [mode, setMode] = useState<SprayMode>('scatter')
  const [copyingSpray, setCopyingSpray] = useState(false)
  const filteredPoints = selectedPitchType === 'ALL' ? sprayPoints : sprayPoints.filter(p => p.pitchType === selectedPitchType)

  const heatCells = mode !== 'scatter' ? computeHeatCells(filteredPoints) : null
  const maxCount = heatCells ? Math.max(1, ...Array.from(heatCells.values()).map(c => c.count)) : 1
  const maxVal   = heatCells ? Math.max(1, ...Array.from(heatCells.values()).map(c => c.val / Math.max(c.count, 1))) : 4

  // Fair territory clip polygon: home plate → LF pole → wall arc → RF pole → home plate
  const fairClip = `${HPX},${HPY} ${LF[0].toFixed(1)},${LF[1].toFixed(1)} ${RF[0].toFixed(1)},${RF[1].toFixed(1)}`

  return (
    <div className="flex flex-col gap-2">
      {/* Mode toggle + copy */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex gap-1">
          {SPRAY_MODES.map(({ key, label }) => (
            <button key={key} onClick={() => setMode(key)}
              className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors"
              style={mode === key ? { backgroundColor: '#3D405B', color: '#fff' } : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }}>
              {label}
            </button>
          ))}
        </div>
        {batterId && batterName && teamAbbr && (
          <button
            onClick={async () => {
              setCopyingSpray(true)
              await exportSprayImage({ batterId, batterName, teamAbbr, filteredPoints, mode, heatCells, maxCount, maxVal })
              setCopyingSpray(false)
            }}
            disabled={copyingSpray}
            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border transition-colors"
            style={copyingSpray ? { color: '#4ADE80', borderColor: '#4ADE80' } : { color: '#9CA3AF', borderColor: '#374151' }}>
            {copyingSpray ? '✓ Copied' : '⎘ Copy'}
          </button>
        )}
      </div>

      <svg width={300} height={265} viewBox="0 0 300 265" style={{ display: 'block', borderRadius: '8px', overflow: 'hidden' }}>
        <defs>
          {/* Fair territory: home → LF arc → RF, clipped by straight lines */}
          <clipPath id="spray-fair">
            <path d={`M ${HPX} ${HPY} L ${LF[0].toFixed(1)} ${LF[1].toFixed(1)} Q ${WALL_CTX.toFixed(1)} ${WALL_CTY.toFixed(1)} ${RF[0].toFixed(1)} ${RF[1].toFixed(1)} Z`} />
          </clipPath>
        </defs>

        {/* Background */}
        <rect width={300} height={265} fill="#1F2937" />

        {/* Outfield grass */}
        <path
          d={`M ${HPX} ${HPY} L ${LF[0].toFixed(1)} ${LF[1].toFixed(1)} Q ${WALL_CTX.toFixed(1)} ${WALL_CTY.toFixed(1)} ${RF[0].toFixed(1)} ${RF[1].toFixed(1)} Z`}
          fill="#1a3a1a"
        />

        {/* Warning track */}
        <path
          d={`M ${HPX} ${HPY} L ${WT_LF[0].toFixed(1)} ${WT_LF[1].toFixed(1)} Q ${WT_CTX.toFixed(1)} ${WT_CTY.toFixed(1)} ${WT_RF[0].toFixed(1)} ${WT_RF[1].toFixed(1)} Z`}
          fill="#2a5a2a"
        />

        {/* Infield dirt circle */}
        <circle cx={HPX.toFixed(1)} cy={(HPY - 36).toFixed(1)} r={62} fill="#5a3a22" />

        {/* Diamond grass */}
        <polygon points={`${HPX},${HPY} ${B1[0].toFixed(1)},${B1[1].toFixed(1)} ${B2[0].toFixed(1)},${B2[1].toFixed(1)} ${B3[0].toFixed(1)},${B3[1].toFixed(1)}`} fill="#2d5c2d" />

        {/* Foul lines */}
        <line x1={HPX} y1={HPY} x2={LF[0].toFixed(1)} y2={LF[1].toFixed(1)} stroke="#5a7a5a" strokeWidth={1} />
        <line x1={HPX} y1={HPY} x2={RF[0].toFixed(1)} y2={RF[1].toFixed(1)} stroke="#5a7a5a" strokeWidth={1} />

        {/* Outfield wall */}
        <path d={`M ${LF[0].toFixed(1)} ${LF[1].toFixed(1)} Q ${WALL_CTX.toFixed(1)} ${WALL_CTY.toFixed(1)} ${RF[0].toFixed(1)} ${RF[1].toFixed(1)}`} fill="none" stroke="#6b7280" strokeWidth={1.5} />

        {/* Base paths */}
        <line x1={HPX} y1={HPY} x2={B1[0].toFixed(1)} y2={B1[1].toFixed(1)} stroke="#8b6a44" strokeWidth={3} />
        <line x1={B1[0].toFixed(1)} y1={B1[1].toFixed(1)} x2={B2[0].toFixed(1)} y2={B2[1].toFixed(1)} stroke="#8b6a44" strokeWidth={3} />
        <line x1={B2[0].toFixed(1)} y1={B2[1].toFixed(1)} x2={B3[0].toFixed(1)} y2={B3[1].toFixed(1)} stroke="#8b6a44" strokeWidth={3} />
        <line x1={B3[0].toFixed(1)} y1={B3[1].toFixed(1)} x2={HPX} y2={HPY} stroke="#8b6a44" strokeWidth={3} />

        {/* Pitcher mound */}
        <circle cx={HPX.toFixed(1)} cy={MOUND_Y.toFixed(1)} r={7} fill="#6b4a2a" />

        {/* Bases */}
        {[B1, B2, B3].map(([bx, by], i) => (
          <rect key={i} x={bx - 4} y={by - 4} width={8} height={8} transform={`rotate(45 ${bx} ${by})`} fill="#E5E7EB" rx={0.5} />
        ))}

        {/* Home plate pentagon */}
        <polygon points={`${HPX - 5},${HPY - 3} ${HPX + 5},${HPY - 3} ${HPX + 5},${HPY + 2} ${HPX},${HPY + 6} ${HPX - 5},${HPY + 2}`} fill="#D1D5DB" />

        {/* Heat map sectors */}
        {mode !== 'scatter' && heatCells && Array.from({ length: A_BINS }, (_, aBin) =>
          [0, 1, 2].map(dBin => {
            const key = `${aBin}-${dBin}`
            const cell = heatCells.get(key)
            if (!cell) return null
            const a1 = A_START + aBin * A_STEP
            const a2 = a1 + A_STEP
            const r1 = D_BREAKS[dBin]; const r2 = D_BREAKS[dBin + 1]
            const t = mode === 'density'
              ? cell.count / maxCount
              : (cell.val / cell.count) / maxVal
            const fill = heatColor(t)
            return <path key={key} d={sectorPath(r1, r2, a1, a2)} fill={fill} />
          })
        )}

        {/* Scatter dots (always shown in scatter mode, faint overlay in heat modes) */}
        <g clipPath="url(#spray-fair)">
          {filteredPoints.map((pt, i) => (
            <circle
              key={i}
              cx={(pt.x * SPRAY_SCALE).toFixed(1)}
              cy={(pt.y * SPRAY_SCALE).toFixed(1)}
              r={mode === 'scatter' ? 4 : 2.5}
              fill={EVENT_COLORS[pt.eventType] ?? '#6B7280'}
              opacity={mode === 'scatter' ? 0.80 : 0.45}
            />
          ))}
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
      {mode !== 'scatter' && (
        <div className="flex items-center gap-1.5 text-[9px] text-538-muted">
          <span>Low</span>
          <div className="flex gap-px">
            {[0.1, 0.3, 0.5, 0.7, 0.9].map(t => (
              <div key={t} className="w-5 h-2.5 rounded-sm" style={{ backgroundColor: heatColor(t, 0.65) }} />
            ))}
          </div>
          <span>High</span>
          <span className="ml-1">({mode === 'density' ? '# hits' : 'bases/hit'})</span>
        </div>
      )}
      <p className="text-[8px] text-538-muted">{filteredPoints.length} hit{filteredPoints.length !== 1 ? 's' : ''}</p>
    </div>
  )
}

// ── Batter AB Sequence Chart ──────────────────────────────────────────────────

const BATTER_AB_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8+']

async function exportBatterSeqImage(opts: {
  batterId: string; batterName: string; teamAbbr: string
  metric: AbSeqMetric; chartTitle: string
  xKeys: string[]
  series: Array<{ type: string; name: string; color: string; vals: (number | null)[] }>
  yMax: number
}) {
  const { batterId, batterName, teamAbbr, metric, chartTitle, xKeys, series, yMax } = opts
  const SCALE = 2, W = 560, PAD = 16
  const IMG_SIZE = 48, HEADER_H = 72
  const CW = W - 2 * PAD, PL = 36, PR = 80, PT = 12, PB = 24
  const CHART_H = 160, LEGEND_H = 20, FOOTER_H = 22
  const H = PAD + HEADER_H + CHART_H + LEGEND_H + FOOTER_H + PAD

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
    ctx.fillStyle = '#374151'; canvasRoundRect(ctx, lx, hY, IMG_SIZE, IMG_SIZE, 6); ctx.fill()
    ctx.fillStyle = '#9CA3AF'; ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(teamAbbr, lx + IMG_SIZE / 2, hY + IMG_SIZE / 2)
  }
  const metricLabel = metric === 'swing' ? 'Swing %' : 'Hard Contact %'
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(batterName, W / 2, PAD + HEADER_H / 2 - 9)
  ctx.fillStyle = '#9CA3AF'; ctx.font = '11px sans-serif'
  ctx.fillText(`${chartTitle} · ${metricLabel}`, W / 2, PAD + HEADER_H / 2 + 11)

  const chartTop = PAD + HEADER_H
  const pw = CW - PL - PR, ph = CHART_H - PT - PB
  const xs = (i: number) => PAD + PL + (i / Math.max(xKeys.length - 1, 1)) * pw
  const ys = (v: number) => chartTop + PT + ph - (v / yMax) * ph

  const grids = Array.from({ length: Math.floor(yMax / 5) }, (_, i) => (i + 1) * 5).filter(v => v < yMax)
  ctx.setLineDash([3, 4])
  grids.forEach(v => {
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(PAD + PL, ys(v)); ctx.lineTo(PAD + PL + pw, ys(v)); ctx.stroke()
    ctx.fillStyle = '#6B7280'; ctx.font = '8px monospace'
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(`${v}%`, PAD + PL - 3, ys(v))
  })
  ctx.setLineDash([])
  ctx.strokeStyle = '#374151'; ctx.lineWidth = 0.5
  ctx.beginPath(); ctx.moveTo(PAD + PL, chartTop + PT + ph); ctx.lineTo(PAD + PL + pw, chartTop + PT + ph); ctx.stroke()

  series.forEach(s => {
    const segs: [number, number][][] = []
    let cur: [number, number][] = []
    s.vals.forEach((v, i) => {
      if (v === null) { if (cur.length) { segs.push(cur); cur = [] } }
      else cur.push([xs(i), ys(v)])
    })
    if (cur.length) segs.push(cur)
    segs.forEach(seg => {
      ctx.beginPath(); ctx.moveTo(seg[0][0], seg[0][1])
      seg.slice(1).forEach(([px, py]) => ctx.lineTo(px, py))
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()
    })
    s.vals.forEach((v, i) => {
      if (v === null) return
      ctx.beginPath(); ctx.arc(xs(i), ys(v), 2.5, 0, Math.PI * 2)
      ctx.fillStyle = s.color; ctx.fill()
    })
    let lastIdx = -1
    s.vals.forEach((v, i) => { if (v !== null) lastIdx = i })
    if (lastIdx >= 0 && s.vals[lastIdx] !== null) {
      const v = s.vals[lastIdx]!
      ctx.fillStyle = s.color; ctx.font = 'bold 8px monospace'
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
      ctx.fillText(s.type, xs(lastIdx) + 5, ys(v))
      ctx.font = '7px monospace'; ctx.textBaseline = 'top'
      ctx.fillText(`${v.toFixed(0)}%`, xs(lastIdx) + 5, ys(v))
    }
  })

  xKeys.forEach((k, i) => {
    ctx.fillStyle = '#6B7280'; ctx.font = '8px monospace'
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText(k, xs(i), chartTop + PT + ph + 4)
  })

  const legendTop = chartTop + CHART_H + 4
  let llx = PAD + PL
  series.forEach(s => {
    ctx.fillStyle = s.color
    ctx.beginPath(); ctx.arc(llx + 4, legendTop + 5, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#9CA3AF'; ctx.font = '8px sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    const label = s.name || s.type
    ctx.fillText(label, llx + 12, legendTop + 5)
    llx += 12 + ctx.measureText(label).width + 10
  })

  const footerY = legendTop + LEGEND_H + 2
  ctx.fillStyle = '#4B5563'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText('Pitch number in at-bat · Last 40 games', PAD, footerY)
  const LOGO_H = 16, LOGO_W = Math.round(LOGO_H * 989 / 623)
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
      a.download = `${batterName.replace(/\s+/g, '_')}_ab_sequence.png`; a.click()
      URL.revokeObjectURL(url)
    }
  }, 'image/png')
}

function BatterAbSequenceChart({
  seqData, batterId, batterName, teamAbbr,
}: {
  seqData: BatterAbSeqData
  batterId: string; batterName: string; teamAbbr: string
}) {
  const [metric, setMetric] = useState<AbSeqMetric>('swing')
  const [hiddenPitches, setHiddenPitches] = useState(new Set<string>())
  const [copying, setCopying] = useState(false)

  const togglePitch = (type: string) => setHiddenPitches(prev => {
    const next = new Set(prev)
    next.has(type) ? next.delete(type) : next.add(type)
    return next
  })

  const { byAbPitch, pitchTypes } = seqData

  const allSeries = pitchTypes.map(pt => {
    const vals: (number | null)[] = BATTER_AB_KEYS.map(k => {
      const bucket = byAbPitch[k]?.[pt.type]
      if (!bucket || bucket.count < 5) return null
      if (metric === 'swing') return (bucket.swings / bucket.count) * 100
      // Hard contact: % of balls in play that were hard
      if (bucket.contact < 3) return null
      return (bucket.hardContact / bucket.contact) * 100
    })
    return { ...pt, vals }
  }).filter(s => s.vals.some(v => v !== null))

  if (allSeries.length === 0) return <p className="text-[10px] text-538-muted py-4 text-center">No pitch sequence data</p>

  const series = allSeries.filter(s => !hiddenPitches.has(s.type))

  const allVals = series.flatMap(s => s.vals).filter((v): v is number => v !== null)
  const dataMax = allVals.length ? Math.max(...allVals) : 10
  const yMax = Math.ceil((dataMax * 1.2 + 2) / 5) * 5
  const grids = Array.from({ length: Math.floor(yMax / 5) }, (_, i) => (i + 1) * 5).filter(v => v < yMax)

  const W = 560, H = 170, PL = 36, PR = 80, PT = 16, PB = 24
  const pw = W - PL - PR, ph = H - PT - PB
  const xs = (i: number) => PL + (i / Math.max(BATTER_AB_KEYS.length - 1, 1)) * pw
  const ys = (v: number) => PT + ph - (v / yMax) * ph

  const metricLabel = metric === 'swing' ? 'Swing % by pitch type' : 'Hard Contact % (EV ≥ 95) by pitch type'

  return (
    <div>
      {/* Metric toggle + pitch toggles + copy */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <div className="inline-flex rounded border border-538-border overflow-hidden text-[9px] mr-1">
          {([['swing', 'Swing %'], ['hardcontact', 'Hard Contact %']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setMetric(key)}
              className={`px-2 py-1 font-semibold transition-colors ${metric === key ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
              {label}
            </button>
          ))}
        </div>
        {allSeries.map(s => {
          const hidden = hiddenPitches.has(s.type)
          return (
            <button key={s.type} onClick={() => togglePitch(s.type)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold border transition-opacity"
              style={{ borderColor: s.color, color: hidden ? '#6B7280' : s.color, opacity: hidden ? 0.4 : 1, background: 'transparent' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: hidden ? '#6B7280' : s.color, display: 'inline-block' }} />
              {s.type}
            </button>
          )
        })}
        <button
          onClick={async () => {
            setCopying(true)
            await exportBatterSeqImage({ batterId, batterName, teamAbbr, metric, chartTitle: 'Pitch Mix · By Count in At-Bat', xKeys: BATTER_AB_KEYS, series, yMax })
            setTimeout(() => setCopying(false), 1500)
          }}
          disabled={copying}
          className="ml-auto text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded border transition-colors"
          style={copying ? { color: '#4ADE80', borderColor: '#4ADE80' } : { color: '#9CA3AF', borderColor: '#374151' }}
        >
          {copying ? '✓ Copied' : '⎘ Copy Image'}
        </button>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {grids.map(v => (
          <g key={v}>
            <line x1={PL} y1={ys(v).toFixed(1)} x2={W - PR} y2={ys(v).toFixed(1)} stroke="#374151" strokeWidth={0.5} strokeDasharray="2,3" />
            <text x={PL - 3} y={(ys(v) + 3).toFixed(1)} textAnchor="end" fontSize={6} fill="#6B7280" fontFamily="monospace">{v}%</text>
          </g>
        ))}
        <line x1={PL} y1={PT + ph} x2={W - PR} y2={PT + ph} stroke="#374151" strokeWidth={0.5} />

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

        {series.flatMap(s =>
          s.vals.flatMap((v, i) => v === null ? [] : [
            <circle key={`${s.type}-${i}`} cx={xs(i).toFixed(1)} cy={ys(v).toFixed(1)} r={2.5} fill={s.color} />
          ])
        )}

        {series.map(s => {
          let lastIdx = -1
          s.vals.forEach((v, i) => { if (v !== null) lastIdx = i })
          if (lastIdx < 0 || s.vals[lastIdx] === null) return null
          const v = s.vals[lastIdx]!
          return (
            <g key={`lbl-${s.type}`}>
              <text x={(xs(lastIdx) + 5).toFixed(1)} y={(ys(v) - 2).toFixed(1)} fontSize={6.5} fill={s.color} fontFamily="monospace" fontWeight={700}>{s.type}</text>
              <text x={(xs(lastIdx) + 5).toFixed(1)} y={(ys(v) + 6).toFixed(1)} fontSize={5.5} fill={s.color} fontFamily="monospace">{v.toFixed(0)}%</text>
            </g>
          )
        })}

        {BATTER_AB_KEYS.map((k, i) => (
          <text key={k} x={xs(i).toFixed(1)} y={H - 3} textAnchor="middle" fontSize={6.5} fill="#6B7280" fontFamily="monospace">{k}</text>
        ))}
      </svg>
      <p className="text-center text-[7px] text-538-muted mt-0.5">Pitch # in at-bat · {metricLabel}</p>
    </div>
  )
}

// ── Scenario Builder ───────────────────────────────────────────────────────────

const COUNT_GRID = [
  ['0-0', '0-1', '0-2'],
  ['1-0', '1-1', '1-2'],
  ['2-0', '2-1', '2-2'],
  ['3-0', '3-1', '3-2'],
]

interface BarItem { type: string; color: string; value: number | null; fmt: string }

function BarColumn({ title, items, isRv }: { title: string; items: BarItem[]; isRv?: boolean }) {
  const valid = items.filter(i => i.value !== null)
  if (!valid.length) return null
  const absMax = Math.max(...valid.map(i => Math.abs(i.value!)), 0.01)
  const sorted = [...valid].sort((a, b) => b.value! - a.value!)
  return (
    <div style={{ flex: '1 1 105px', minWidth: 105 }}>
      <div className="text-[8px] font-bold uppercase tracking-widest text-538-muted mb-1.5">{title}</div>
      {sorted.map(item => {
        const pct = Math.min(100, (Math.abs(item.value!) / absMax) * 100)
        const neg = (item.value ?? 0) < 0
        const barColor = isRv ? (neg ? '#F87171' : '#34D399') : item.color
        return (
          <div key={item.type} className="flex items-center gap-1 mb-1">
            <span className="text-[7px] font-bold font-mono w-5 text-right shrink-0" style={{ color: item.color }}>{item.type}</span>
            <div className="bg-538-border/20 rounded-sm overflow-hidden h-2.5" style={{ flex: 1 }}>
              <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: barColor }} />
            </div>
            <span className={`text-[7px] font-mono w-9 text-right shrink-0 ${isRv ? (neg ? 'text-red-400' : 'text-green-400') : 'text-538-muted'}`}>{item.fmt}</span>
          </div>
        )
      })}
    </div>
  )
}

function BatterScenarioCharts({ data }: { data: BatterScenarioData }) {
  const [hand, setHand] = useState<'all' | 'L' | 'R'>('all')
  const [count, setCount] = useState('all')

  const metrics = useMemo(() => {
    return data.pitchTypes.map(pt => {
      const handMap = data.byPT[pt.type]
      if (!handMap) return null
      const hands = hand === 'all' ? ['L', 'R'] : [hand]
      const agg = { count: 0, swings: 0, whiffs: 0, contact: 0, hardContact: 0, rv_sum: 0, pa: 0, h: 0, bb: 0, ab: 0, tb: 0 }
      for (const h of hands) {
        const countMap = handMap[h]
        if (!countMap) continue
        const buckets = count === 'all'
          ? Object.values(countMap)
          : [countMap[count]].filter((b): b is ScenarioBucket => !!b)
        for (const b of buckets) {
          agg.count += b.count; agg.swings += b.swings; agg.whiffs += b.whiffs
          agg.contact += b.contact; agg.hardContact += b.hardContact
          agg.rv_sum += b.rv_sum; agg.pa += b.pa
          agg.h += b.h; agg.bb += b.bb; agg.ab += b.ab; agg.tb += b.tb
        }
      }
      if (agg.count < 5) return null
      const obp = agg.pa >= 5 ? (agg.h + agg.bb) / agg.pa : null
      const slg = agg.ab >= 5 ? agg.tb / agg.ab : null
      return {
        type: pt.type, name: pt.name, color: pt.color,
        swing: (agg.swings / agg.count) * 100,
        whiff: agg.swings >= 3 ? (agg.whiffs / agg.swings) * 100 : null,
        hc:    agg.contact >= 3 ? (agg.hardContact / agg.contact) * 100 : null,
        ops:   obp !== null && slg !== null ? obp + slg : null,
        rv:    agg.pa >= 5 ? (agg.rv_sum / agg.pa) * 100 : null,
      }
    }).filter((m): m is NonNullable<typeof m> => !!m)
  }, [data, hand, count])

  const toFmt = (v: number | null, decimals: number, suffix = '') =>
    v !== null ? `${v.toFixed(decimals)}${suffix}` : ''
  const toRvFmt = (v: number | null) =>
    v !== null ? (v >= 0 ? '+' : '') + v.toFixed(1) : ''

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-5 items-start">
        <div>
          <div className="text-[8px] font-bold uppercase tracking-widest text-538-muted mb-1">vs Pitcher</div>
          <div className="inline-flex border border-538-border rounded overflow-hidden">
            {(['all', 'L', 'R'] as const).map(h => (
              <button key={h} onClick={() => setHand(h)}
                className={`px-2 py-0.5 text-[8px] font-bold transition-colors ${hand === h ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
                {h === 'all' ? 'Both' : h === 'L' ? 'LHP' : 'RHP'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[8px] font-bold uppercase tracking-widest text-538-muted mb-1">
            Count <span className="font-normal normal-case opacity-70">(balls-strikes)</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <button onClick={() => setCount('all')}
              className={`text-[7.5px] font-bold px-2 py-0.5 rounded transition-colors ${count === 'all' ? 'bg-538-orange text-white' : 'border border-538-border text-538-muted hover:text-538-text'}`}>
              All Counts
            </button>
            <div className="grid grid-cols-3 gap-0.5">
              {COUNT_GRID.flat().map(ck => (
                <button key={ck} onClick={() => setCount(ck)}
                  className={`text-[7.5px] font-bold font-mono py-0.5 rounded transition-colors ${count === ck ? 'bg-538-orange text-white' : 'border border-538-border text-538-muted hover:text-538-text'}`}>
                  {ck}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mini bar charts */}
      {metrics.length > 0 ? (
        <>
          <div className="flex gap-3 flex-wrap">
            <BarColumn title="Swing %" items={metrics.map(m => ({ type: m.type, color: m.color, value: m.swing, fmt: toFmt(m.swing, 0, '%') }))} />
            <BarColumn title="Whiff %" items={metrics.map(m => ({ type: m.type, color: m.color, value: m.whiff, fmt: toFmt(m.whiff, 0, '%') }))} />
            <BarColumn title="HC %" items={metrics.map(m => ({ type: m.type, color: m.color, value: m.hc, fmt: toFmt(m.hc, 0, '%') }))} />
            <BarColumn title="OPS" items={metrics.map(m => ({ type: m.type, color: m.color, value: m.ops, fmt: toFmt(m.ops, 3) }))} />
            <BarColumn title="RV/100 PA" items={metrics.map(m => ({ type: m.type, color: m.color, value: m.rv, fmt: toRvFmt(m.rv) }))} isRv />
          </div>
          <p className="text-[7.5px] text-538-muted leading-relaxed">
            HC% = hard contact (EV ≥ 95) as % of contact · Whiff% = whiffs per swing · RV/100 = run value on outcome pitches
          </p>
        </>
      ) : (
        <p className="text-[9px] text-538-muted py-2">No data for selected scenario (try a less specific filter)</p>
      )}
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
  const [gameRarData, setGameRarData] = useState<GameRarEntry[]>([])
  const [abSeqData, setAbSeqData] = useState<BatterAbSeqData | null>(null)
  const [abSeqLoading, setAbSeqLoading] = useState(false)
  const [scenarioData, setScenarioData] = useState<BatterScenarioData | null>(null)
  const [scenarioLoading, setScenarioLoading] = useState(false)

  const currentSeason = new Date().getFullYear()

  useEffect(() => {
    setLoading(true); setError(''); setGameRarData([])
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
        // Chain RAR fetch after zones so we have the canonical player name
        return fetch(`/api/player-game-rar?playerName=${encodeURIComponent(zoneData.batterName)}`)
          .then(r => r.ok ? r.json() : null).catch(() => null)
      })
      .then(rarData => { if (rarData?.games) setGameRarData(rarData.games as GameRarEntry[]) })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))

    // Lazy-load AB sequence + scenario data (separate endpoints, same game feed source)
    setAbSeqData(null); setAbSeqLoading(true)
    setScenarioData(null); setScenarioLoading(true)
    fetch(`/api/batter-ab-sequence?batterId=${batterId}&season=${currentSeason}`)
      .then(r => r.ok ? r.json() as Promise<BatterAbSeqData> : null)
      .then(d => { if (d) setAbSeqData(d) })
      .finally(() => setAbSeqLoading(false))
    fetch(`/api/batter-scenario?batterId=${batterId}&season=${currentSeason}`)
      .then(r => r.ok ? r.json() as Promise<BatterScenarioData> : null)
      .then(d => { if (d) setScenarioData(d) })
      .catch(() => null)
      .finally(() => setScenarioLoading(false))
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

      {/* Season RAR trendline */}
      {gameRarData.length > 0 && (
        <div className="bg-surface border border-538-border rounded-xl p-4">
          <SeasonRvChart
            games={gameRarData} war={currentWar}
            batterId={batterId} batterName={batterName} teamAbbr={teamAbbr}
          />
        </div>
      )}

      {/* AB Sequence charts */}
      <div className="bg-surface border border-538-border rounded-xl p-4">
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Pitch Sequencing · By Count in At-Bat</div>
          <div className="text-[9px] text-538-muted">· Last 40 games</div>
        </div>
        {abSeqData && abSeqData.pitchTypes.length > 0 ? (
          <BatterAbSequenceChart seqData={abSeqData} batterId={batterId} batterName={batterName} teamAbbr={teamAbbr} />
        ) : abSeqLoading ? (
          <p className="text-[9px] text-538-muted">Loading pitch sequence data…</p>
        ) : (
          <p className="text-[9px] text-538-muted">No pitch sequence data available.</p>
        )}
      </div>

      {/* Scenario builder */}
      <div className="bg-surface border border-538-border rounded-xl p-4">
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Pitch Breakdown · Scenario Builder</div>
          <div className="text-[9px] text-538-muted">· Last 40 games</div>
        </div>
        {scenarioData && scenarioData.pitchTypes.length > 0 ? (
          <BatterScenarioCharts data={scenarioData} />
        ) : scenarioLoading ? (
          <p className="text-[9px] text-538-muted">Loading scenario data…</p>
        ) : (
          <p className="text-[9px] text-538-muted">No scenario data available.</p>
        )}
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
          {sprayPoints.length === 0 ? <p className="text-xs text-538-muted">No batted ball data available.</p> : <SprayChart sprayPoints={sprayPoints} selectedPitchType={selectedPitchType} batterId={batterId} batterName={batterName} teamAbbr={teamAbbr} />}
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
