import { HabitsProvider } from '@/contexts/HabitsContext'

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: 'transparent' }}>
      <body style={{ background: 'transparent', margin: 0, padding: 0 }}>
        <HabitsProvider>
          {children}
        </HabitsProvider>
      </body>
    </html>
  )
}