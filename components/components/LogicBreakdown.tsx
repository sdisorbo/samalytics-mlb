import { ReactNode } from 'react'

interface Section {
  title: string
  body: ReactNode
}

export function LogicBreakdown({ sections }: { sections: Section[] }) {
  return (
    <details className="mt-8 border-t border-538-border pt-4 group">
      <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-538-muted hover:text-538-text select-none">
        How this works · logic &amp; modeling
        <span className="ml-1 group-open:hidden">▾</span>
        <span className="ml-1 hidden group-open:inline">▴</span>
      </summary>
      <div className="mt-3 space-y-1.5">
        {sections.map((s, i) => (
          <details key={i} className="border border-538-border rounded bg-surface">
            <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-538-text hover:bg-538-bg select-none">
              {s.title}
            </summary>
            <div className="px-3 py-2 text-xs text-538-muted leading-relaxed border-t border-538-border space-y-2">
              {s.body}
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="bg-538-bg/50 border border-538-border rounded px-2 py-1.5 text-[10px] overflow-x-auto text-538-text font-mono leading-snug whitespace-pre">
      <code>{children}</code>
    </pre>
  )
}
