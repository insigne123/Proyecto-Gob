"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Loader2, Plus, Copy, Trash2 } from "lucide-react"

type WorkspaceInfo = {
  id: string
  title: string
  description: string | null
  status: string | null
  allowedDomains: string[]
  createdAt: string | null
  updatedAt: string | null
}

type PartyRow = {
  id: string
  role: string
  name: string
  entity_type: string
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

type EventRow = {
  id: string
  occurred_at: string | null
  kind: string
  title: string
  description: string | null
  created_at: string | null
  updated_at: string | null
}

type LinkRow = { event_id: string; snapshot_id: string }

type MemberRow = { user_id: string; role: string; created_at: string | null }

type InviteRow = {
  id: string
  email: string
  role: string
  token: string
  created_at: string | null
  expires_at: string | null
  accepted_at: string | null
  accepted_by: string | null
}

type Props = {
  workspace: WorkspaceInfo
  memberRole: string
  initial: {
    profile: any | null
    parties: PartyRow[]
    events: EventRow[]
    eventSnapshotLinks: LinkRow[]
    members: MemberRow[]
    invites: InviteRow[]
  }
}

function normalizeDomains(text: string) {
  const list = text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => d.replace(/^https?:\/\//i, "").replace(/\/$/, ""))
  return Array.from(new Set(list))
}

export default function ExpedienteClient(props: Props) {
  const { workspace, memberRole } = props
  const router = useRouter()

  const [domainsText, setDomainsText] = useState(() => (workspace.allowedDomains ?? []).join("\n"))
  const [isSavingDomains, setIsSavingDomains] = useState(false)
  const [domainsError, setDomainsError] = useState<string | null>(null)

  const profileInit = props.initial.profile
  const [profile, setProfile] = useState(() => ({
    causeType: profileInit?.cause_type ?? null,
    tribunalRole: profileInit?.tribunal_role ?? null,
    seaId: profileInit?.sea_id ?? null,
    seaRole: profileInit?.sea_role ?? null,
    holder: profileInit?.holder ?? null,
    proponent: profileInit?.proponent ?? null,
    region: profileInit?.region ?? null,
    comuna: profileInit?.comuna ?? null,
    latitude: typeof profileInit?.latitude === "number" ? profileInit.latitude : null,
    longitude: typeof profileInit?.longitude === "number" ? profileInit.longitude : null,
    proceduralStatus: profileInit?.procedural_status ?? null,
    keyDates: (profileInit?.key_dates as any) ?? {},
  }))
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [parties, setParties] = useState<PartyRow[]>(props.initial.parties ?? [])
  const [events, setEvents] = useState<EventRow[]>(props.initial.events ?? [])
  const [invites, setInvites] = useState<InviteRow[]>(props.initial.invites ?? [])

  useEffect(() => {
    setParties(props.initial.parties ?? [])
    setEvents(props.initial.events ?? [])
    setInvites(props.initial.invites ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initial.parties, props.initial.events, props.initial.invites])

  const linksByEvent = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const l of props.initial.eventSnapshotLinks ?? []) {
      const k = String(l.event_id)
      const arr = map.get(k) ?? []
      arr.push(String(l.snapshot_id))
      map.set(k, arr)
    }
    return map
  }, [props.initial.eventSnapshotLinks])

  async function saveDomains() {
    setDomainsError(null)
    setIsSavingDomains(true)
    try {
      const allowedDomains = normalizeDomains(domainsText)
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowedDomains }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo guardar")
      router.refresh()
    } catch (err: any) {
      setDomainsError(err?.message ?? "Error inesperado")
    } finally {
      setIsSavingDomains(false)
    }
  }

  async function saveProfile() {
    setProfileError(null)
    setIsSavingProfile(true)
    try {
      const cleanedKeyDates = Object.fromEntries(
        Object.entries((profile as any).keyDates ?? {}).filter(
          ([, v]) => typeof v === "string" && v.trim() !== ""
        )
      )

      const res = await fetch(`/api/workspaces/${workspace.id}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...profile, keyDates: cleanedKeyDates }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo guardar")
      router.refresh()
    } catch (err: any) {
      setProfileError(err?.message ?? "Error inesperado")
    } finally {
      setIsSavingProfile(false)
    }
  }

  // Parties
  const [newParty, setNewParty] = useState({
    role: "reclamante",
    name: "",
    entityType: "organizacion",
    contactEmail: "",
    contactPhone: "",
    notes: "",
  })
  const [isAddingParty, setIsAddingParty] = useState(false)
  const [partyError, setPartyError] = useState<string | null>(null)

  async function addParty() {
    setPartyError(null)
    setIsAddingParty(true)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/parties`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: newParty.role,
          name: newParty.name,
          entityType: newParty.entityType,
          contactEmail: newParty.contactEmail ? newParty.contactEmail : null,
          contactPhone: newParty.contactPhone ? newParty.contactPhone : null,
          notes: newParty.notes ? newParty.notes : null,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo agregar")
      setNewParty({
        role: "reclamante",
        name: "",
        entityType: "organizacion",
        contactEmail: "",
        contactPhone: "",
        notes: "",
      })
      router.refresh()
    } catch (err: any) {
      setPartyError(err?.message ?? "Error inesperado")
    } finally {
      setIsAddingParty(false)
    }
  }

  async function deleteParty(id: string) {
    if (!id) return
    setPartyError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/parties/${id}`, { method: "DELETE" })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo eliminar")
      router.refresh()
    } catch (err: any) {
      setPartyError(err?.message ?? "Error inesperado")
    }
  }

  // Timeline
  const [newEvent, setNewEvent] = useState({
    kind: "otro",
    occurredAt: "",
    title: "",
    description: "",
    snapshotIds: "",
  })
  const [isAddingEvent, setIsAddingEvent] = useState(false)
  const [eventError, setEventError] = useState<string | null>(null)

  async function addEvent() {
    setEventError(null)
    setIsAddingEvent(true)
    try {
      const occurredAtIso = newEvent.occurredAt ? new Date(newEvent.occurredAt).toISOString() : null
      const snapshotIds = newEvent.snapshotIds
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)

      const res = await fetch(`/api/workspaces/${workspace.id}/timeline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: newEvent.kind,
          occurredAt: occurredAtIso,
          title: newEvent.title,
          description: newEvent.description ? newEvent.description : null,
          snapshotIds,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo agregar")
      setNewEvent({ kind: "otro", occurredAt: "", title: "", description: "", snapshotIds: "" })
      router.refresh()
    } catch (err: any) {
      setEventError(err?.message ?? "Error inesperado")
    } finally {
      setIsAddingEvent(false)
    }
  }

  async function deleteEvent(id: string) {
    if (!id) return
    setEventError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/timeline/${id}`, { method: "DELETE" })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo eliminar")
      router.refresh()
    } catch (err: any) {
      setEventError(err?.message ?? "Error inesperado")
    }
  }

  // Invites
  const canInvite = memberRole === "admin"
  const [newInvite, setNewInvite] = useState({ email: "", role: "viewer", expiresInDays: 7 })
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [isCreatingInvite, setIsCreatingInvite] = useState(false)
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null)

  async function createInvite() {
    setInviteError(null)
    setIsCreatingInvite(true)
    setLastInviteLink(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: newInvite.email,
          role: newInvite.role,
          expiresInDays: newInvite.expiresInDays,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo crear")
      const token = String(json?.token || "")
      if (!token) throw new Error("Respuesta invalida")
      const link = `${window.location.origin}/invites/accept?token=${encodeURIComponent(token)}`
      setLastInviteLink(link)
      setNewInvite({ email: "", role: "viewer", expiresInDays: 7 })
      router.refresh()
    } catch (err: any) {
      setInviteError(err?.message ?? "Error inesperado")
    } finally {
      setIsCreatingInvite(false)
    }
  }

  async function deleteInvite(id: string) {
    if (!id) return
    setInviteError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/invites/${id}`, { method: "DELETE" })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "No se pudo eliminar")
      router.refresh()
    } catch (err: any) {
      setInviteError(err?.message ?? "Error inesperado")
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  const members = props.initial.members ?? []

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card/70 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Metadatos del expediente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo de causa</Label>
                <Input
                  value={profile.causeType ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, causeType: e.target.value || null }))}
                  placeholder="Ej: Reclamacion SEA"
                />
              </div>
              <div className="space-y-2">
                <Label>Rol del tribunal</Label>
                <Input
                  value={profile.tribunalRole ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, tribunalRole: e.target.value || null }))}
                  placeholder="Ej: Tribunal Ambiental"
                />
              </div>
              <div className="space-y-2">
                <Label>ID/rol SEA (si aplica)</Label>
                <Input
                  value={profile.seaId ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, seaId: e.target.value || null }))}
                  placeholder="ID SEA"
                />
              </div>
              <div className="space-y-2">
                <Label>Rol SEA</Label>
                <Input
                  value={profile.seaRole ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, seaRole: e.target.value || null }))}
                  placeholder="Ej: Titular / Servicio"
                />
              </div>
              <div className="space-y-2">
                <Label>Titular</Label>
                <Input
                  value={profile.holder ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, holder: e.target.value || null }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Proponente</Label>
                <Input
                  value={profile.proponent ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, proponent: e.target.value || null }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Input
                  value={profile.region ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, region: e.target.value || null }))}
                  placeholder="Ej: Valparaiso"
                />
              </div>
              <div className="space-y-2">
                <Label>Comuna</Label>
                <Input
                  value={profile.comuna ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, comuna: e.target.value || null }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Latitud</Label>
                <Input
                  type="number"
                  value={profile.latitude ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      latitude: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Longitud</Label>
                <Input
                  type="number"
                  value={profile.longitude ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      longitude: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Estado procesal</Label>
                <Input
                  value={profile.proceduralStatus ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, proceduralStatus: e.target.value || null }))}
                  placeholder="Ej: En tramitacion"
                />
              </div>

              <div className="space-y-2">
                <Label>Fecha ingreso</Label>
                <Input
                  type="date"
                  value={String((profile as any).keyDates?.ingreso ?? "")}
                  onChange={(e) =>
                    setProfile((p: any) => ({
                      ...p,
                      keyDates: { ...(p.keyDates ?? {}), ingreso: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha audiencia</Label>
                <Input
                  type="date"
                  value={String((profile as any).keyDates?.audiencia ?? "")}
                  onChange={(e) =>
                    setProfile((p: any) => ({
                      ...p,
                      keyDates: { ...(p.keyDates ?? {}), audiencia: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Fecha resolucion</Label>
                <Input
                  type="date"
                  value={String((profile as any).keyDates?.resolucion ?? "")}
                  onChange={(e) =>
                    setProfile((p: any) => ({
                      ...p,
                      keyDates: { ...(p.keyDates ?? {}), resolucion: e.target.value },
                    }))
                  }
                />
              </div>
            </div>

            {profileError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {profileError}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => saveProfile().catch(() => null)} disabled={isSavingProfile} className="gap-2">
                {isSavingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar metadatos
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Fuentes permitidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Whitelist opcional de dominios. Si esta vacia, se aceptan URLs publicas.
            </div>
            <div className="space-y-2">
              <Label>Dominios (uno por linea)</Label>
              <Textarea
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
                placeholder="sea.gob.cl\ntribunalambiental.cl"
                className="min-h-[140px]"
              />
            </div>

            {domainsError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {domainsError}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => saveDomains().catch(() => null)}
                disabled={isSavingDomains}
                className="gap-2"
              >
                {isSavingDomains && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Partes y actores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {parties.length ? (
              <div className="space-y-2">
                {parties.map((p) => (
                  <div key={p.id} className="rounded-xl border border-border/55 bg-background/25 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {p.role} · {p.entity_type}
                          {p.contact_email ? ` · ${p.contact_email}` : ""}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => deleteParty(p.id).catch(() => null)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {p.notes ? (
                      <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{p.notes}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin partes registradas.</div>
            )}

            <div className="rounded-xl border border-border/55 bg-background/20 p-3">
              <div className="mb-3 text-sm font-medium">Agregar</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Rol</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                    value={newParty.role}
                    onChange={(e) => setNewParty((p) => ({ ...p, role: e.target.value }))}
                  >
                    <option value="demandante">Demandante</option>
                    <option value="reclamante">Reclamante</option>
                    <option value="reclamado">Reclamado</option>
                    <option value="tercero">Tercero</option>
                    <option value="abogado">Abogado</option>
                    <option value="perito">Perito</option>
                    <option value="titular">Titular</option>
                    <option value="proponente">Proponente</option>
                    <option value="autoridad">Autoridad</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                    value={newParty.entityType}
                    onChange={(e) => setNewParty((p) => ({ ...p, entityType: e.target.value }))}
                  >
                    <option value="organizacion">Organizacion</option>
                    <option value="persona">Persona</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Nombre</Label>
                  <Input value={newParty.name} onChange={(e) => setNewParty((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Email (opcional)</Label>
                  <Input value={newParty.contactEmail} onChange={(e) => setNewParty((p) => ({ ...p, contactEmail: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Telefono (opcional)</Label>
                  <Input value={newParty.contactPhone} onChange={(e) => setNewParty((p) => ({ ...p, contactPhone: e.target.value }))} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Notas (opcional)</Label>
                  <Textarea value={newParty.notes} onChange={(e) => setNewParty((p) => ({ ...p, notes: e.target.value }))} className="min-h-[100px]" />
                </div>
              </div>

              {partyError && (
                <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {partyError}
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <Button onClick={() => addParty().catch(() => null)} disabled={isAddingParty} className="gap-2">
                  {isAddingParty ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Agregar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Linea de tiempo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {events.length ? (
              <div className="space-y-2">
                {events.map((e) => {
                  const snapshots = linksByEvent.get(String(e.id)) ?? []
                  return (
                    <div key={e.id} className="rounded-xl border border-border/55 bg-background/25 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {e.title}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {e.kind}
                            {e.occurred_at ? ` · ${new Date(e.occurred_at).toLocaleString("es-CL")}` : ""}
                            {snapshots.length ? ` · ${snapshots.length} snapshot(s)` : ""}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => deleteEvent(e.id).catch(() => null)} title="Eliminar">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {e.description ? (
                        <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{e.description}</div>
                      ) : null}
                      {snapshots.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {snapshots.slice(0, 8).map((sid) => (
                            <Badge key={sid} variant="outline" className="font-code text-[11px]">
                              {sid.slice(0, 8)}...
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin hitos aun.</div>
            )}

            <div className="rounded-xl border border-border/55 bg-background/20 p-3">
              <div className="mb-3 text-sm font-medium">Agregar hito</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                    value={newEvent.kind}
                    onChange={(e) => setNewEvent((x) => ({ ...x, kind: e.target.value }))}
                  >
                    <option value="ingreso">Ingreso</option>
                    <option value="oficio">Oficio</option>
                    <option value="informe">Informe</option>
                    <option value="audiencia">Audiencia</option>
                    <option value="resolucion">Resolucion</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha/hora (opcional)</Label>
                  <Input
                    type="datetime-local"
                    value={newEvent.occurredAt}
                    onChange={(e) => setNewEvent((x) => ({ ...x, occurredAt: e.target.value }))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Titulo</Label>
                  <Input
                    value={newEvent.title}
                    onChange={(e) => setNewEvent((x) => ({ ...x, title: e.target.value }))}
                    placeholder="Ej: Audiencia de alegatos"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Descripcion (opcional)</Label>
                  <Textarea
                    value={newEvent.description}
                    onChange={(e) => setNewEvent((x) => ({ ...x, description: e.target.value }))}
                    className="min-h-[100px]"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Snapshot IDs (coma o una linea)</Label>
                  <Textarea
                    value={newEvent.snapshotIds}
                    onChange={(e) => setNewEvent((x) => ({ ...x, snapshotIds: e.target.value }))}
                    placeholder="uuid1, uuid2"
                    className="min-h-[70px] font-code text-xs"
                  />
                </div>
              </div>

              {eventError && (
                <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {eventError}
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <Button onClick={() => addEvent().catch(() => null)} disabled={isAddingEvent} className="gap-2">
                  {isAddingEvent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Agregar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card/70 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Equipo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {members.length ? (
              members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between gap-2 rounded-lg border border-border/55 bg-background/20 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-code text-xs">{m.user_id.slice(0, 8)}...</div>
                    <div className="text-[11px] text-muted-foreground">{m.created_at ? new Date(m.created_at).toLocaleString("es-CL") : ""}</div>
                  </div>
                  <Badge variant="outline">{m.role}</Badge>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Sin miembros.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Invitaciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canInvite ? (
              <div className="text-sm text-muted-foreground">Solo admins pueden invitar.</div>
            ) : (
              <div className="rounded-xl border border-border/55 bg-background/20 p-3">
                <div className="mb-3 text-sm font-medium">Nueva invitacion</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Email</Label>
                    <Input value={newInvite.email} onChange={(e) => setNewInvite((x) => ({ ...x, email: e.target.value }))} placeholder="nombre@..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Rol</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background/35 px-3 py-2 text-sm"
                      value={newInvite.role}
                      onChange={(e) => setNewInvite((x) => ({ ...x, role: e.target.value }))}
                    >
                      <option value="viewer">viewer</option>
                      <option value="analyst">analyst</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Expira (dias)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={newInvite.expiresInDays}
                      onChange={(e) => setNewInvite((x) => ({ ...x, expiresInDays: Number(e.target.value || 7) }))}
                    />
                  </div>
                </div>

                {inviteError && (
                  <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {inviteError}
                  </div>
                )}

                {lastInviteLink && (
                  <div className="mt-3 rounded-xl border border-border/55 bg-background/25 p-3">
                    <div className="text-xs text-muted-foreground">Link</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate font-code text-xs">{lastInviteLink}</div>
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => copy(lastInviteLink)}>
                        <Copy className="h-4 w-4" />
                        Copiar
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex justify-end">
                  <Button onClick={() => createInvite().catch(() => null)} disabled={isCreatingInvite} className="gap-2">
                    {isCreatingInvite && <Loader2 className="h-4 w-4 animate-spin" />}
                    Crear
                  </Button>
                </div>
              </div>
            )}

            {invites.length ? (
              <div className="space-y-2">
                {invites.map((i) => {
                  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/invites/accept?token=${encodeURIComponent(i.token)}`
                  const accepted = !!i.accepted_at
                  return (
                    <div key={i.id} className="rounded-xl border border-border/55 bg-background/25 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{i.email}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {i.role}
                            {i.expires_at ? ` · exp: ${new Date(i.expires_at).toLocaleString("es-CL")}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={accepted ? "opacity-70" : "border-emerald-500/25 text-emerald-200"}>
                            {accepted ? "Aceptada" : "Pendiente"}
                          </Badge>
                          <Button variant="outline" size="sm" className="gap-2" onClick={() => copy(link)} disabled={!canInvite}>
                            <Copy className="h-4 w-4" />
                            Copiar
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteInvite(i.id).catch(() => null)} disabled={!canInvite}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin invitaciones.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
