import UserGuide from '@/components/guide/UserGuide.jsx'

export const metadata = {
  title: 'User guide',
  description: 'Make your first song with Leið, then explore every control: transit lanes, instruments, effects, drums, AI Composer, saving, exports and Song Chainer.',
  alternates: { canonical: '/guide' },
}

export default function GuidePage() {
  return <UserGuide />
}
