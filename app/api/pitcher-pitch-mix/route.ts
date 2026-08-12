import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const NEEDED_COLS = ['pitch_type', 'pitch_number', 'at_bat_number', 'game_pk', 'inning', 'bb_type', 'description', 'events', 'delta_run_exp']

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  const indices: Record<string, number> = {}
  for (const col of NEEDED_COLS) {
    const idx = headers.indexOf(col)
    if (idx >= 0) indices[col] = idx
  }
  const result: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const vals = line.split(',')
    const row: Record<string, string> = {}
    for (const [col, idx] of Object.entries(indices)) {
      row[col] = (vals[idx] ?? '').trim().replace(/^"|"$/g, '')
    }
    if (row.pitch_type && row.pitch_type !== 'PO' && row.pitch_type !== 'IN') result.push(row)
  }
  return result
}

const PITCH_NAMES: Record<string, string> = {
  FF: '4-Seam Fastball', SI: 'Sinker', FC: 'Cutter', FT: '2-Seam',
  SL: 'Slider', ST: 'Sweeper', SV: 'Slurve', SW: 'Slow Curve',
  CU: 'Curveball', KC: 'Knuckle Curve',
  CH: 'Changeup', FS: 'Splitter', FO: 'Forkball', SC: 'Screwball',
  KN: 'Knuckleball', EP: 'Eephus',
}
const PITCH_COLORS: Record<string, string> = {
  FF: '#EF4444', SI: '#F97316', FC: '#F59E0B', FT: '#FB923C',
  SL: '#3B82F6', ST: '#6366F1', SV: '#7C3AED', SW: '#A855F7',
  CU: '#1D4ED8', KC: '#1E3A8A',
  CH: '#10B981', FS: '#059669', FO: '#047857', SC: '#065F46',
  KN: '#64748B', EP: '#94A3B8',
}

type BucketMap = Record<string, { count: number; whiffs: number; rvSum: number }>
type AggMap = Record<string, BucketMap>

function bucket(map: AggMap, key: string, pt: string, isWhiff: boolean, rv: number) {
  map[key] ??= {}
  map[key][pt] ??= { count: 0, whiffs: 0, rvSum: 0 }
  map[key][pt].count++
  if (isWhiff) map[key][pt].whiffs++
  map[key][pt].rvSum += rv
}

function gamePitchBucket(n: number): string {
  if (n <= 15) return '1-15'
  if (n <= 30) return '16-30'
  if (n <= 45) return '31-45'
  if (n <= 60) return '46-60'
  if (n <= 75) return '61-75'
  if (n <= 90) return '76-90'
  return '91+'
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const pitcherId = url.searchParams.get('pitcherId')
  const season = url.searchParams.get('season') ?? new Date().getFullYear()
  if (!pitcherId) return NextResponse.json({ error: 'Missing pitcherId' }, { status: 400 })

  const savantUrl = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfSea=${season}%7C&player_type=pitcher&pitchers_lookup%5B%5D=${pitcherId}&type=details&min_pitches=0&min_results=0&min_pas=0`
  let rows: Record<string, string>[] = []
  try {
    const res = await fetch(savantUrl, {
      next: { revalidate: 86400 },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; samalytics/1.0)', Accept: 'text/csv,*/*' },
    })
    if (res.ok) {
      const text = await res.text()
      rows = parseCSV(text)
    }
  } catch {
    // fall through — return empty
  }

  if (rows.length === 0) return NextResponse.json({ byAbPitch: {}, byInning: {}, byGamePitch: {}, byPitchType: {}, pitchTypes: [] })

  const byAbPitch: AggMap = {}
  const byInning: AggMap = {}
  const byPitchType: Record<string, { count: number; gb: number; fb: number; ld: number; popup: number; whiffs: number; rvSum: number }> = {}
  const pitchTypeTotals: Record<string, number> = {}

  // For game-pitch ordering: group by game_pk
  const byGame: Record<string, Array<{ pt: string; abNum: number; pitchNum: number; isWhiff: boolean; rv: number }>> = {}

  for (const row of rows) {
    const pt = row.pitch_type
    const pitchNum = parseInt(row.pitch_number) || 0
    const abNum = parseInt(row.at_bat_number) || 0
    const inning = parseInt(row.inning) || 0
    const gamePk = row.game_pk
    const bb = row.bb_type
    const desc = row.description ?? ''
    const isWhiff = desc.includes('swinging_strike') || desc === 'missed_bunt'
    const rv = parseFloat(row.delta_run_exp) || 0

    if (!pt || pitchNum < 1) continue

    // By AB pitch count (cap at 8+)
    const abKey = pitchNum >= 8 ? '8+' : String(pitchNum)
    bucket(byAbPitch, abKey, pt, isWhiff, rv)

    // By inning
    if (inning >= 1 && inning <= 15) {
      bucket(byInning, String(inning), pt, isWhiff, rv)
    }

    // Per pitch type contact
    byPitchType[pt] ??= { count: 0, gb: 0, fb: 0, ld: 0, popup: 0, whiffs: 0, rvSum: 0 }
    byPitchType[pt].count++
    if (isWhiff) byPitchType[pt].whiffs++
    byPitchType[pt].rvSum += rv
    if (bb === 'ground_ball') byPitchType[pt].gb++
    else if (bb === 'fly_ball') byPitchType[pt].fb++
    else if (bb === 'line_drive') byPitchType[pt].ld++
    else if (bb === 'popup') byPitchType[pt].popup++

    pitchTypeTotals[pt] = (pitchTypeTotals[pt] ?? 0) + 1

    // For game pitch ordering
    if (gamePk) {
      byGame[gamePk] ??= []
      byGame[gamePk].push({ pt, abNum, pitchNum, isWhiff, rv })
    }
  }

  // Build game-pitch buckets
  const byGamePitch: AggMap = {}
  for (const pitches of Object.values(byGame)) {
    pitches.sort((a, b) => a.abNum - b.abNum || a.pitchNum - b.pitchNum)
    pitches.forEach((p, idx) => {
      const bkt = gamePitchBucket(idx + 1)
      bucket(byGamePitch, bkt, p.pt, p.isWhiff, p.rv)
    })
  }

  // Build pitch type list ordered by usage
  const pitchTypes = Object.entries(pitchTypeTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, name: PITCH_NAMES[type] ?? type, color: PITCH_COLORS[type] ?? '#6B7280', count }))

  return NextResponse.json({ byAbPitch, byInning, byGamePitch, byPitchType, pitchTypes })
}
