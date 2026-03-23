import type { Metadata } from 'next'
import { Inter, Orbitron } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import Nav from '@/components/Nav'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-orbitron',
  weight: ['700', '900'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Samalytics | MLB Engine',
  description: 'ELO ratings, playoff odds, and predictions for every MLB team.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${orbitron.variable}`}>
      <body className="bg-538-bg text-538-text">
        <Nav />
        <main className="max-w-screen-xl mx-auto px-4 py-6">{children}</main>
        <Analytics />
      </body>
    </html>
  )
}
