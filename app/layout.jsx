import 'leaflet/dist/leaflet.css'

export const metadata = {
  title: 'Leið — sonify the city',
  description: 'Leið turns live public transport into music: each line a part, each arrival a note.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
