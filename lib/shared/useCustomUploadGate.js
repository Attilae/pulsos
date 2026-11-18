'use client'
import { useCallback } from 'react'
import { useEntitlements } from './EntitlementsContext.jsx'

export function useCustomUploadGate(inputRef) {
  const { limits, openUpgrade } = useEntitlements()
  const allowed = limits?.customUploads === true
  const choose = useCallback(() => {
    if (allowed) inputRef.current?.click()
    else openUpgrade('custom_upload')
  }, [allowed, inputRef, openUpgrade])
  return { allowed, choose }
}

