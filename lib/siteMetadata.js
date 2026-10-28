// Public metadata must stay valid when deployment environment variables are absent.
export const SITE_URL = new URL(
  process.env.NEXT_PUBLIC_APP_URL || 'https://www.layth.space',
).origin

export function pageMetadata(title, description, pathname) {
  const socialTitle = `${title} · Leið`
  const image = {
    width: 1200,
    height: 630,
    alt: 'Leið: turn public transport data into music',
    type: 'image/png',
  }
  return {
    title,
    description,
    alternates: { canonical: pathname },
    openGraph: {
      type: 'website',
      siteName: 'Leið',
      title: socialTitle,
      description,
      url: new URL(pathname, SITE_URL).href,
      images: [{ ...image, url: '/opengraph-image' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      images: [{ ...image, url: '/twitter-image' }],
    },
  }
}
