import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Leið — sonify the city: live public transport turned into music'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Brand line-type colors (mirrors LINE_TYPE_COLORS in lib/engine.js).
const LINES = ['#E2001A', '#FFD700', '#C8102E', '#0066CC', '#009640']

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background:
            'radial-gradient(120% 120% at 15% 0%, #16181d 0%, #0a0a0a 60%)',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* transit lines → notes motif */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {LINES.map((color, row) => (
            <div key={color} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 200 + row * 60,
                  height: 10,
                  borderRadius: 6,
                  background: color,
                }}
              />
              {[0, 1, 2].map((n) => (
                <div
                  key={n}
                  style={{
                    width: 10 + n * 6,
                    height: 10 + n * 6,
                    borderRadius: '50%',
                    background: color,
                    opacity: 0.9 - n * 0.2,
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 132,
              fontWeight: 800,
              color: '#fafafa',
              letterSpacing: -4,
              lineHeight: 1,
            }}
          >
            Leið
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 40,
              fontWeight: 500,
              color: '#c8ccd2',
              maxWidth: 900,
            }}
          >
            Live public transport, turned into music. Each line a part, each
            arrival a note.
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
