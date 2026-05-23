import { Suspense } from 'react'
import PageClient from './page.client'

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#171a21]" />}>
      <PageClient />
    </Suspense>
  )
}
