"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"

type ActionKind = "pause" | "resume" | "check" | "delete"

export function WatchlistActions({
  workspaceId,
  watchlistId,
  status,
  fileName,
  basePath,
}: {
  workspaceId: string
  watchlistId: string
  status: string
  fileName: string
  basePath?: string
}) {
  const router = useRouter()
  const [busyKind, setBusyKind] = useState<ActionKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  async function execute(kind: ActionKind) {
    setError(null)
    setInfo(null)
    setBusyKind(kind)

    try {
      let response: Response
      if (kind === "check") {
        response = await fetch(
          `/api/workspaces/${workspaceId}/watchlists/${watchlistId}/check`,
          {
            method: "POST",
          }
        )
      } else if (kind === "delete") {
        response = await fetch(
          `/api/workspaces/${workspaceId}/watchlists/${watchlistId}`,
          {
            method: "DELETE",
          }
        )
      } else {
        response = await fetch(
          `/api/workspaces/${workspaceId}/watchlists/${watchlistId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: kind }),
          }
        )
      }

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo ejecutar la accion")
      }

      if (kind === "delete") {
        router.replace(basePath || `/excel/${workspaceId}`)
        router.refresh()
        return
      }

      if (kind === "check") {
        if (json?.queued === false && json?.reason === "already_queued") {
          setInfo("Ya existe una revision pendiente o en curso para este monitor.")
        } else {
          setInfo("Revision manual encolada. Se ejecutara en breve.")
        }
      }
      if (kind === "pause") setInfo("Monitor pausado.")
      if (kind === "resume") setInfo("Monitor reanudado y revision encolada.")

      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? "Error al ejecutar accion")
    } finally {
      setBusyKind(null)
    }
  }

  async function run(kind: ActionKind) {
    if (kind === "delete") {
      setIsDeleteDialogOpen(true)
      return
    }
    await execute(kind)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!!busyKind}
          onClick={() => run("check").catch(() => null)}
        >
          {busyKind === "check" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Revisar ahora
        </Button>

        {status === "paused" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!!busyKind}
            onClick={() => run("resume").catch(() => null)}
          >
            {busyKind === "resume" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Reanudar
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!!busyKind}
            onClick={() => run("pause").catch(() => null)}
          >
            {busyKind === "pause" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PauseCircle className="h-3.5 w-3.5" />
            )}
            Pausar
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive"
          disabled={!!busyKind}
          onClick={() => run("delete").catch(() => null)}
        >
          {busyKind === "delete" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Eliminar
        </Button>
      </div>

      {info ? (
        <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {info}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar monitor</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara el monitor &apos;{fileName}&apos; junto con su historial de corridas y correos. Esta accion no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyKind === "delete"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyKind === "delete"}
              onClick={(event) => {
                event.preventDefault()
                execute("delete")
                  .then(() => setIsDeleteDialogOpen(false))
                  .catch(() => null)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyKind === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
