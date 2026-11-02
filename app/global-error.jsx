'use client'

import NextError from 'next/error'
import { useEffect } from 'react'
import { captureProductException } from '@/lib/productAnalytics.js'

export default function GlobalError({ error }) {
  useEffect(() => {
    captureProductException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
