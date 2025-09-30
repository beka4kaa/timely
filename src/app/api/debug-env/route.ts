import { NextResponse } from 'next/server'

export async function GET() {
  const envInfo = {
    hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
    hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
    googleClientIdLength: process.env.GOOGLE_CLIENT_ID?.length,
    googleClientIdStart: process.env.GOOGLE_CLIENT_ID?.substring(0, 15) + '...',
    nextAuthUrl: process.env.NEXTAUTH_URL,
    nodeEnv: process.env.NODE_ENV
  }
  
  console.log('📊 ENV DEBUG API called:', envInfo)
  
  return NextResponse.json(envInfo)
}