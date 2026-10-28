import { SITE_URL } from '@/lib/siteMetadata.js'

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    host: SITE_URL,
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
