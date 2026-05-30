import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface MLBPersonResult {
  id: number
  fullName: string
  primaryPosition?: {
    type?: string
    abbreviation?: string
  }
  currentTeam?: {
    abbreviation?: string
  }
}

interface MLBSearchResponse {
  people?: MLBPersonResult[]
}

// GET /api/pitcher-season/search?q=gerrit+cole
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

    const pitchers = people
      .filter(p =>
        p.primaryPosition?.type === 'Pitcher' ||
        p.primaryPosition?.abbreviation === 'P',
      )
      .map(p => ({
        id: p.id,
        name: p.fullName,
        teamAbbr: (p.currentTeam?.abbreviation ?? '???').toUpperCase(),
      }))

    return NextResponse.json(pitchers)
  } catch {
    return NextResponse.json([])
  }
}
