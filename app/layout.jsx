import 'leaflet/dist/leaflet.css'
import { Analytics } from '@vercel/analytics/next'

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const title = 'Leið — sonify the city'
const description =
  'Leið turns live public transport into music: each line a part, each arrival a note. A browser DAW that plays the city in real time.'

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0a',
}

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: '%s · Leið',
  },
  description,
  applicationName: 'Leið',
  keywords: [
    'Leið',
    'transit music',
    'sonification',
    'public transport',
    'GTFS',
    'generative music',
    'browser DAW',
    'trainjazz',
  ],
  authors: [{ name: 'Leið' }],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'Leið',
    title,
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0d0d0d' }}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
