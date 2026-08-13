import { NextRequest, NextResponse } from 'next/server'
import type { WarSeason } from '../../../lib/types'

export const dynamic = 'force-dynamic'

const BBREF = 'https://www.baseball-reference.com'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',   // force uncompressed so text() works reliably
}

// ── Name extraction ───────────────────────────────────────────────────────────
function extractPlayerName(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (!m) return 'Unknown'
  return m[1]
    .replace(/\s*Stats.*$/i, '')      // "Stats, Height, Weight…"
    .replace(/\s*Statistics.*$/i, '') // older pages
    .replace(/\s*\|.*$/i, '')         // "| Baseball-Reference.com"
    .replace(/\s*-\s*Baseball.*$/i, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim()
}

// ── Comment-aware HTML flattener ──────────────────────────────────────────────
// BBREF hides advanced tables inside <!-- --> comments as an anti-scraping
// measure. This exposes them so we can search by id= regardless of location.
function uncomment(html: string): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    const s = html.indexOf('<!--', i)
    if (s === -1) { out += html.slice(i); break }
    out += html.slice(i, s)           // text before comment → keep
    const e = html.indexOf('-->', s + 4)
    if (e === -1) { out += html.slice(s + 4); break }
    out += html.slice(s + 4, e)       // comment body → expose (strip <!-- -->)
    i = e + 3
  }
  return out
}

// ── Table extractor with nesting depth counter ────────────────────────────────
// The naive indexOf('</table>') grabs the FIRST closing tag, which can be a
// nested inner table's close. Count open/close tags to find the real end.
function extractTable(flat: string, tableId: string): string | null {
  const start = flat.indexOf(`id="${tableId}"`)
  if (start === -1) return null

  const tableOpen = flat.lastIndexOf('<table', start)
  if (tableOpen === -1) return null

  let depth = 0
  let i = tableOpen
  while (i < flat.length) {
    const nextOpen  = flat.indexOf('<table', i)
    const nextClose = flat.indexOf('</table>', i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 6
    } else {
      depth--
      const end = nextClose + 8
      if (depth === 0) return flat.slice(tableOpen, end)
      i = end
    }
  }
  return null
}

// ── Per-row stat extractor ────────────────────────────────────────────────────
// Handles both `data-stat="WAR"` and `data-stat="war"` (BBREF varies).
function getStat(row: string, ...names: string[]): string {
  for (const name of names) {
    for (const attr of [`data-stat="${name}"`, `data-stat="${name.toLowerCase()}"`, `data-stat="${name.toUpperCase()}"`]) {
      const idx = row.indexOf(attr)
      if (idx === -1) continue
      const cellOpen  = row.lastIndexOf('<t', idx)
      if (cellOpen === -1) continue
      const cellClose = row.indexOf('</t', cellOpen)
      const cell = cellClose === -1 ? row.slice(cellOpen) : row.slice(cellOpen, cellClose)
      const text = cell.replace(/<[^>]*>/g, '').trim()
      if (text) return text
    }
  }
  return ''
}

// ── Table → WarSeason[] ───────────────────────────────────────────────────────
function parseWarTable(tableHtml: string): WarSeason[] {
  const seasons: WarSeason[] = []
  const seen = new Set<string>()

  for (const chunk of tableHtml.split(/<tr\b/)) {
    const yearStr = getStat(chunk, 'year_ID')
    const year    = parseInt(yearStr, 10)
    if (!year || year < 1871 || year > 2030) continue

    const team = getStat(chunk, 'team_ID')
    // Skip multi-team aggregate rows (2TM, 3TM, TOT)
    if (!team || /^\d+T[A-Z]$/.test(team) || team === 'TOT') continue

    const warStr = getStat(chunk, 'WAR', 'war')
    const war    = parseFloat(warStr)
    if (isNaN(war)) continue

    const key = `${year}:${team}`
    if (seen.has(key)) continue
    seen.add(key)

    const offRaw = parseFloat(getStat(chunk, 'oWAR', 'off_war'))
    const defRaw = parseFloat(getStat(chunk, 'dWAR', 'def_war'))
    const g   = parseInt(getStat(chunk, 'G'), 10)
    const pa  = parseInt(getStat(chunk, 'PA'), 10)
    const ip  = parseFloat(getStat(chunk, 'IP'))

    seasons.push({
      year, team,
      g:       isNaN(g)   ? undefined : g,
      pa:      isNaN(pa)  ? null : pa,
      ip:      isNaN(ip)  ? undefined : ip,
      war,
      off_war: isNaN(offRaw) ? null : offRaw,
      def_war: isNaN(defRaw) ? null : defRaw,
    })
  }

  return seasons.sort((a, b) => a.year - b.year)
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.trim()
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }

  // 1. Search BBREF (follows redirects; single-match searches redirect to player page)
  let playerHtml: string
  let resolvedName = name

  try {
    const searchUrl = `${BBREF}/search/search.fcgi?search=${encodeURIComponent(name)}&pid=&type=b`
    const searchRes = await fetch(searchUrl, {
      headers: HEADERS,
      redirect: 'follow',
      next: { revalidate: 86400 * 30 },
    })
    if (!searchRes.ok) {
      return NextResponse.json({ error: `Baseball Reference returned ${searchRes.status}` }, { status: 502 })
    }

    if (searchRes.url.includes('/players/')) {
      playerHtml = await searchRes.text()
      resolvedName = extractPlayerName(playerHtml)
    } else {
      const searchHtml = await searchRes.text()
      const linkMatch  = searchHtml.match(/href="(\/players\/[a-z]\/[a-zA-Z0-9]+\.shtml)"/)
      if (!linkMatch) {
        return NextResponse.json({ error: `No player found matching "${name}" — check the spelling` }, { status: 404 })
      }
      const playerRes = await fetch(`${BBREF}${linkMatch[1]}`, {
        headers: HEADERS,
        next: { revalidate: 86400 * 30 },
      })
      if (!playerRes.ok) {
        return NextResponse.json({ error: `Could not load player page (${playerRes.status})` }, { status: 502 })
      }
      playerHtml = await playerRes.text()
      resolvedName = extractPlayerName(playerHtml)
    }
  } catch (err) {
    return NextResponse.json({ error: `Network error: ${String(err)}` }, { status: 502 })
  }

  // 2. Flatten HTML (expose any comment-hidden tables)
  const flat = uncomment(playerHtml)

  // 3. Try tables in order of preference
  const tableIds = ['batting_value', 'pitching_value', 'batting_standard', 'pitching_standard']
  let seasons: WarSeason[] = []

  for (const id of tableIds) {
    const tableHtml = extractTable(flat, id)
    if (!tableHtml) continue
    const parsed = parseWarTable(tableHtml)
    if (parsed.length > 0) { seasons = parsed; break }
  }

  if (seasons.length === 0) {
    return NextResponse.json(
      { error: `Found "${resolvedName}" but could not parse career WAR data — BBREF may have changed their page format` },
      { status: 422 }
    )
  }

  return NextResponse.json({ name: resolvedName, career: seasons })
}
