import 'leaflet/dist/leaflet.css'

export const metadata = {
  title: 'Transit DAW',
  description: 'Sonify live public transport.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
