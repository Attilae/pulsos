import { pageMetadata } from '@/lib/siteMetadata.js'
import UserGuide from '@/components/guide/UserGuide.jsx'

export const metadata = pageMetadata('User guide', 'Make your first song with Leið, then explore every control: transit lanes, instruments, effects, drums, AI Composer, saving, exports and Song Chainer.', '/guide')

export default function GuidePage() {
  return <UserGuide />
}
