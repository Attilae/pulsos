import { SITE_URL } from '@/lib/siteMetadata.js'

export default function sitemap() {
  const paths = ['/', '/guide', '/legal', '/privacy', '/terms', '/licenses', '/feedback']
  if (process.env.NEXT_PUBLIC_MCP_ENABLED === 'true') {
    paths.push('/guides/mcp', '/guides/composer-skill')
  }
  return paths.map(path => ({ url: new URL(path, SITE_URL).href }))
}
