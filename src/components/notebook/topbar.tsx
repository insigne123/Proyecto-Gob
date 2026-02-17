"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Activity,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Leaf,
  LogOut,
  PanelsTopLeft,
} from "lucide-react"

export function Topbar({
  workspaceId,
  title,
}: {
  workspaceId: string
  title: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [])

  async function onSignOut() {
    await supabase.auth.signOut()
    router.replace("/login")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/65 backdrop-blur supports-[backdrop-filter]:bg-background/45">
      <div className="mx-auto flex h-14 w-full max-w-[1800px] items-center gap-3 px-3 md:px-4">
        <Link
          href="/projects"
          className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <PanelsTopLeft className="h-4 w-4" />
          Proyectos
        </Link>

        <div className="h-5 w-px bg-border/70" />

        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/20">
            <Leaf className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-5">{title}</div>
            <div className="truncate text-[11px] text-muted-foreground">ID: {workspaceId}</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <span className="max-w-[160px] truncate text-xs">{email ?? "Cuenta"}</span>
                <ChevronDown className="h-4 w-4 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Sesion</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/workspaces">Inicio de modulos</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/projects">Volver a proyectos</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/audit">Auditoria</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/alerts">Alertas</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={`/projects/${workspaceId}/expediente`}
                  className="flex items-center"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Ficha proyecto
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/projects/${workspaceId}/ops`} className="flex items-center">
                  <Activity className="mr-2 h-4 w-4" />
                  Operaciones
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/excel/${workspaceId}`} className="flex items-center">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Monitor Excel
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesion
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
