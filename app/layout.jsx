import './globals.css'
import 'leaflet/dist/leaflet.css'
import { Analytics } from '@vercel/analytics/next'
import { Inter, JetBrains_Mono } from 'next/font/google'

// UI type: Inter (Atlassian Sans is an Inter derivative — this is the faithful,
// freely-hostable stand-in). Mono: JetBrains Mono for numeric/data readouts.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })

// Runs before paint: applies the persisted theme (or the OS preference) to
// <html> so there is no flash of the wrong theme on load.
const themeInit = `(function(){try{var t=localStorage.getItem('leid-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const title = 'Leið — sonify the city'
const description =
  'Leið turns public transport data into music: every line becomes a track and every stop becomes a note. A browser DAW for playing seven cities as generative music.'

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Let the page paint under the notch/home indicator; the layout pads itself
  // back out with the --safe-* tokens in globals.css.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
  ],
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
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body style={{ margin: 0 }}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
