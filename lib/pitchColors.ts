// Pitch colors — palette anchored to #e63946/#ec9a9a/#a8dadc/#457b9d/#1d3557
// Fastballs: red family · Breaking balls: blue/navy · Offspeed: teal · Specialty: muted
export const PITCH_COLORS: Record<string, string> = {
  FF: '#e63946',   // 4-Seam Fastball  — anchor red
  SI: '#c1121f',   // Sinker           — deep red
  FC: '#f4a0a9',   // Cutter           — soft pink-red
  FT: '#ec9a9a',   // 2-Seam           — anchor salmon
  SL: '#457b9d',   // Slider           — anchor blue
  ST: '#6096ba',   // Sweeper          — lighter blue
  SV: '#2b4d6f',   // Slurve           — deep navy-blue
  SW: '#264653',   // Slow Curve       — dark teal-navy
  CU: '#1d3557',   // Curveball        — anchor dark navy
  KC: '#2a6f97',   // Knuckle Curve    — mid blue
  CH: '#a8dadc',   // Changeup         — anchor light teal
  FS: '#74c0c3',   // Splitter         — medium teal
  FO: '#5aacb0',   // Forkball         — teal
  SC: '#3a8fa3',   // Screwball        — darker teal
  KN: '#7094a8',   // Knuckleball      — muted blue
  EP: '#b8c8d4',   // Eephus           — very muted blue-gray
}

export const pitchColor = (pt: string) => PITCH_COLORS[pt] ?? '#78909C'
