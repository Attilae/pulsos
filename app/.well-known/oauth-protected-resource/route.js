import { auth } from '@/lib/auth.js'

export const runtime = 'nodejs'
export const GET = (request) => auth.handler(request)
