import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// MLB team IDs → abbreviations (the people search API omits abbreviation from currentTeam)
const TEAM_ID_TO_ABBR: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
}

interface MLBPersonResult {
  id: number
  fullName: string
  primaryPosition?: {
    type?: string
    abbreviation?: string
  }
  currentTeam?: {
    id?: number
    abbreviation?: string
  }
}

interface MLBSearchResponse {
  people?: MLBPersonResult[]
}

// GET /api/batter-season/search?q=mike+trout
export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (q.length < 2) return NextResponse.json([])

  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(q)}&sportId=1&active=true`,
      { cache: 'no-store' },
    )
    if (!res.ok) return NextResponse.json([])

    const data: MLBSearchResponse = await res.json()
    const people = data.people ?? []

    const batters = people
      .filter(p =>
        p.primaryPosition?.type !== 'Pitcher' &&
        p.primaryPosition?.abbreviation !== 'P',
      )
      .map(p => ({
        id: p.id,
        name: p.fullName,
        teamAbbr: (p.currentTeam?.abbreviation ?? (p.currentTeam?.id ? TEAM_ID_TO_ABBR[p.currentTeam.id] : '') ?? ''),
      }))

    return NextResponse.json(batters)
  } catch {
    return NextResponse.json([])
  }
}
