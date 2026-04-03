export interface TeamColor {
  primary: string
  secondary: string
}

export const TEAM_COLORS: Record<string, TeamColor> = {
  // AL East
  BAL: { primary: '#DF4601', secondary: '#000000' },
  BOS: { primary: '#BD3039', secondary: '#0C2340' },
  NYY: { primary: '#003087', secondary: '#C4CED4' },
  TB:  { primary: '#092C5C', secondary: '#8FBCE6' },
  TOR: { primary: '#134A8E', secondary: '#E8291C' },
  // AL Central
  CWS: { primary: '#27251F', secondary: '#C4CED4' },
  CLE: { primary: '#00385D', secondary: '#E31937' },
  DET: { primary: '#0C2340', secondary: '#FA4616' },
  KC:  { primary: '#004687', secondary: '#C09A5B' },
  MIN: { primary: '#002B5C', secondary: '#D31145' },
  // AL West
  HOU: { primary: '#002D62', secondary: '#EB6E1F' },
  LAA: { primary: '#BA0021', secondary: '#003263' },
  OAK: { primary: '#003831', secondary: '#EFB21E' },
  ATH: { primary: '#003831', secondary: '#EFB21E' },
  SEA: { primary: '#0C2C56', secondary: '#005C5C' },
  TEX: { primary: '#003278', secondary: '#C0111F' },
  // NL East
  ATL: { primary: '#CE1141', secondary: '#13274F' },
  MIA: { primary: '#00A3E0', secondary: '#EF3340' },
  NYM: { primary: '#002D72', secondary: '#FF5910' },
  PHI: { primary: '#E81828', secondary: '#002D72' },
  WSH: { primary: '#AB0003', secondary: '#14225A' },
  // NL Central
  CHC: { primary: '#0E3386', secondary: '#CC3433' },
  CIN: { primary: '#C6011F', secondary: '#000000' },
  MIL: { primary: '#12284B', secondary: '#FFC52F' },
  PIT: { primary: '#27251F', secondary: '#FDB827' },
  STL: { primary: '#C41E3A', secondary: '#0C2340' },
  // NL West
  ARI: { primary: '#A71930', secondary: '#E3D4AD' },
  AZ:  { primary: '#A71930', secondary: '#E3D4AD' },
  COL: { primary: '#333366', secondary: '#C4CED4' },
  LAD: { primary: '#005A9C', secondary: '#EF3E42' },
  SD:  { primary: '#2F241D', secondary: '#FFC425' },
  SF:  { primary: '#FD5A1E', secondary: '#27251F' },
}

export const DIVISION_COLORS: Record<string, string> = {
  'AL East':    '#1A6BAD',
  'AL Central': '#2B8A57',
  'AL West':    '#B54E2A',
  'NL East':    '#7B3BB5',
  'NL Central': '#B58C2A',
  'NL West':    '#2A9B8A',
}

export const DIVISION_ORDER = [
  'AL East', 'AL Central', 'AL West',
  'NL East', 'NL Central', 'NL West',
]

// MLB Stats API returns full names; normalize to short form for lookups
const DIVISION_NAME_MAP: Record<string, string> = {
  'American League East':    'AL East',
  'American League Central': 'AL Central',
  'American League West':    'AL West',
  'National League East':    'NL East',
  'National League Central': 'NL Central',
  'National League West':    'NL West',
}

export function normalizeDivision(name: string): string {
  return DIVISION_NAME_MAP[name] ?? name
}

export function teamColor(abbr: string): string {
  return TEAM_COLORS[abbr]?.primary ?? '#888888'
}

export function divisionColor(division: string): string {
  return DIVISION_COLORS[normalizeDivision(division)] ?? '#888888'
}

// MLB Stats API team IDs for logo URLs
const TEAM_IDS: Record<string, number> = {
  ARI: 109, AZ: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112,
  CWS: 145, CIN: 113, CLE: 114, COL: 115, DET: 116, HOU: 117,
  KC: 118, LAA: 108, LAD: 119, MIA: 146, MIL: 158, MIN: 142,
  NYM: 121, NYY: 147, OAK: 133, ATH: 133, PHI: 143, PIT: 134, SD: 135,
  SF: 137, SEA: 136, STL: 138, TB: 139, TEX: 140, TOR: 141,
  WSH: 120,
}

export function teamLogoUrl(abbr: string): string {
  const id = TEAM_IDS[abbr]
  if (!id) return ''
  return `https://www.mlbstatic.com/team-logos/${id}.svg`
}
