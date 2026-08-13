import { NextRequest, NextResponse } from 'next/server'
import type { WarSeason } from '../../../lib/types'

export const dynamic = 'force-dynamic'

const BBREF = 'https://www.baseball-reference.com'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

// Extract text content of a data-stat cell from a row's HTML
function getStat(rowHtml: string, stat: string): string {
  const idx = rowHtml.indexOf(`data-stat="${stat}"`)
  if (idx === -1) return ''
  // Find the opening <td or <th tag before this attribute
  const cellOpen = rowHtml.lastIndexOf('<t', idx)
  if (cellOpen === -1) return ''
  const cellClose = rowHtml.indexOf('</t', cellOpen)
  const cell = cellClose === -1 ? rowHtml.slice(cellOpen) : rowHtml.slice(cellOpen, cellClose)
  // Strip all HTML tags to get text content
  return cell.replace(/<[^>]*>/g, '').trim()
}

// Parse a BBREF batting_value or batting_standard table HTML into WarSeason[]
function parseWarTable(tableHtml: string): WarSeason[] {
  // Split into rows — only care about <tr> with data-stat content
  const rowChunks = tableHtml.split(/<tr\b/)
  const seasons: WarSeason[] = []

  for (const chunk of rowChunks) {
    const yearStr = getStat(chunk, 'year_ID')
    const year = parseInt(yearStr, 10)
    if (!year || year < 1871 || year > 2030) continue

    // Skip multi-team aggregate rows (TOT, 2TM, etc.)
    const team = getStat(chunk, 'team_ID')
    if (!team || /^\d?T[A-Z]$/.test(team) || team === 'TOT') continue

    const warRaw = getStat(chunk, 'WAR')
    const war = parseFloat(warRaw)
    if (isNaN(war)) continue

    const offRaw = getStat(chunk, 'oWAR')
    const defRaw = getStat(chunk, 'dWAR')

    const g   = parseInt(getStat(chunk, 'G'), 10)
    const pa  = parseInt(getStat(chunk, 'PA'), 10)
    const ip  = parseFloat(getStat(chunk, 'IP'))

    seasons.push({
      year,
      team,
      g:       isNaN(g)  ? undefined : g,
      pa:      isNaN(pa) ? null : pa,
      ip:      isNaN(ip) ? undefined : ip,
      war,
      off_war: isNaN(parseFloat(offRaw)) ? null : parseFloat(offRaw),
      def_war: isNaN(parseFloat(defRaw)) ? null : parseFloat(defRaw),
    })
  }

  // Deduplicate by year+team (keep first occurrence) and sort chronologically
  const seen = new Set<string>()
  return seasons
    .filter((s) => { const k = `${s.year}:${s.team}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.year - b.year)
}

// Extract a named table from HTML — also checks inside HTML comments (BBREF hides some tables there)
function extractTable(html: string, tableId: string): string | null {
  // Try regular HTML first
  let start = html.indexOf(`id="${tableId}"`)
  let source = html
  if (start === -1) {
    // Try inside HTML comments (BBREF anti-scraping measure for advanced tables)
    const stripped = html.replace(/<!--([\s\S]*?)-->/g, (_, inner) =>
      inner.includes(tableId) ? inner : ''
    )
    start = stripped.indexOf(`id="${tableId}"`)
    if (start === -1) return null
    source = stripped
  }
  const tableOpen = source.lastIndexOf('<table', start)
  if (tableOpen === -1) return null
  const tableClose = source.indexOf('</table>', tableOpen)
  return tableClose === -1 ? null : source.slice(tableOpen, tableClose + 8)
}

// Derive player name from the page's <title> element
function extractPlayerName(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (!m) return 'Unknown'
  return m[1].replace(/\s*Statistics.*$/i, '').replace(/\s*-\s*Baseball.*$/i, '').trim()
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.trim()
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }

  // 1. Hit BBREF search — follows redirects automatically
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

    const finalUrl = searchRes.url

    if (finalUrl.includes('/players/')) {
      // Single match — redirected straight to the player page
      playerHtml = await searchRes.text()
      resolvedName = extractPlayerName(playerHtml)
    } else {
      // Multiple matches — parse the search results page for the first player link
      const searchHtml = await searchRes.text()
      const linkMatch = searchHtml.match(/href="(\/players\/[a-z]\/[a-zA-Z0-9]+\.shtml)"/)
      if (!linkMatch) {
        return NextResponse.json({ error: `No player found matching "${name}"` }, { status: 404 })
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
    return NextResponse.json({ error: `Fetch failed: ${String(err)}` }, { status: 502 })
  }

  // 2. Try batting_value → pitching_value → batting_standard → pitching_standard
  const tableIds = ['batting_value', 'pitching_value', 'batting_standard', 'pitching_standard']
  let seasons: WarSeason[] = []

  for (const tableId of tableIds) {
    const tableHtml = extractTable(playerHtml, tableId)
    if (!tableHtml) continue
    const parsed = parseWarTable(tableHtml)
    if (parsed.length > 0) {
      seasons = parsed
      break
    }
  }

  if (seasons.length === 0) {
    return NextResponse.json({ error: `Found "${resolvedName}" but could not parse career WAR stats` }, { status: 422 })
  }

  return NextResponse.json({ name: resolvedName, career: seasons })
}
