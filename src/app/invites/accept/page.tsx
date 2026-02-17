import { Suspense } from "react"

import AcceptInviteClient from "./accept-client"

function Fallback() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="rounded-xl border border-border/55 bg-card/70 px-4 py-6 text-sm text-muted-foreground">
        Cargando...
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <AcceptInviteClient />
    </Suspense>
  )
}
