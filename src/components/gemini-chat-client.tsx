"use client"

import dynamic from 'next/dynamic'

const GeminiChat = dynamic(
  () => import('@/components/gemini-chat').then(m => m.GeminiChat),
  { ssr: false }
)

export function GeminiChatClient() {
  return <GeminiChat />
}
