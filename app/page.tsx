import { Suspense } from 'react'
import PageClient from './page.client'

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900" />}>
      <PageClient />
    </Suspense>
  )
}
