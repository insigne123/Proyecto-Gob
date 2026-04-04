"use client"

import { useMemo, useState } from "react"
import { ExternalLink, Scale, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { buildJurisprudenceRows, type TribunalCauseLite } from "@/lib/tribunal/analytics"

export function TribunalAnalyticsTable({ causes }: { causes: TribunalCauseLite[] }) {
  const [search, setSearch] = useState("")
  const [themeFilter, setThemeFilter] = useState("ALL")
  const [outcomeFilter, setOutcomeFilter] = useState("ALL")
  const [supremaFilter, setSupremaFilter] = useState("ALL")
  const [lookupState, setLookupState] = useState<Record<string, any>>({})
  const [lookupLoading, setLookupLoading] = useState<Record<string, boolean>>({})

  async function lookupSuprema(rol: string, tribunal: string) {
    const key = `${tribunal}:${rol}`
    setLookupLoading((prev) => ({ ...prev, [key]: true }))
    try {
      const params = new URLSearchParams({ rol, tribunal })
      const res = await fetch(`/api/tribunal/suprema/search?${params.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" },
      })
      const json = await res.json().catch(() => null)
      setLookupState((prev) => ({ ...prev, [key]: json || { status: "error" } }))
    } finally {
      setLookupLoading((prev) => ({ ...prev, [key]: false }))
    }
  }

  const rows = useMemo(() => buildJurisprudenceRows(causes || []), [causes])

  const uniqueThemes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.temaPrincipal))).filter(Boolean),
    [rows]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      const matchSearch =
        !q ||
        row.rol.toLowerCase().includes(q) ||
        row.caratula.toLowerCase().includes(q) ||
        row.temaPrincipal.toLowerCase().includes(q)
      const matchTheme = themeFilter === "ALL" || row.temaPrincipal === themeFilter
      const matchOutcome = outcomeFilter === "ALL" || row.outcome === outcomeFilter
      const matchSuprema = supremaFilter === "ALL" || row.suprema.stage === supremaFilter
      return matchSearch && matchTheme && matchOutcome && matchSuprema
    })
  }, [rows, search, themeFilter, outcomeFilter, supremaFilter])

  const summary = useMemo(() => {
    const total = rows.length
    const favorable = rows.filter((r) => r.outcome === "favorable_sea").length
    const unfavorable = rows.filter((r) => r.outcome === "desfavorable_sea").length
    const pending = rows.filter((r) => r.outcome === "pendiente").length
    const withCasacion = rows.filter((r) => r.suprema.hasCasacion).length
    return { total, favorable, unfavorable, pending, withCasacion }
  }, [rows])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Total causas</div>
            <div className="text-xl font-semibold">{summary.total}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Favorable SEA</div>
            <div className="text-xl font-semibold">{summary.favorable}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Desfavorable SEA</div>
            <div className="text-xl font-semibold">{summary.unfavorable}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Pendientes</div>
            <div className="text-xl font-semibold">{summary.pending}</div>
          </CardContent>
        </Card>
        <Card className="bg-background/35">
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">Con señal casación</div>
            <div className="text-xl font-semibold">{summary.withCasacion}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" />
            Analitica jurisprudencial (estimada)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por Rol, caratula o tema"
                className="pl-8"
              />
            </div>

            <Select value={themeFilter} onValueChange={setThemeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tema" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los temas</SelectItem>
                {uniqueThemes.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {theme}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Resultado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los resultados</SelectItem>
                <SelectItem value="favorable_sea">Favorable SEA</SelectItem>
                <SelectItem value="desfavorable_sea">Desfavorable SEA</SelectItem>
                <SelectItem value="mixto">Mixto</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="indeterminado">Indeterminado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <Select value={supremaFilter} onValueChange={setSupremaFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Continuidad Corte Suprema" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="sin_senal">Sin señal</SelectItem>
                <SelectItem value="recurso_detectado">Recurso detectado</SelectItem>
                <SelectItem value="en_suprema">En Corte Suprema</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center text-xs text-muted-foreground">
              Resultado y continuidad son inferidos automaticamente desde metadatos/documentos.
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rol</TableHead>
                  <TableHead>Tema</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Corte Suprema</TableHead>
                  <TableHead>Patron util</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!filtered.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                      Sin resultados para esos filtros.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, 300).map((row) => (
                    <TableRow key={row.causeId}>
                      <TableCell>
                        <div className="font-medium">{row.rol}</div>
                        <div className="text-xs text-muted-foreground">{row.estado || "Estado N/A"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{row.temaPrincipal}</div>
                        <div className="text-xs text-muted-foreground">Docs: {row.docsCount}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.outcomeLabel}</Badge>
                      </TableCell>
                      <TableCell>
                        {row.suprema.stage === "sin_senal" ? (
                          <span className="text-xs text-muted-foreground">Sin señal</span>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xs font-medium">
                              {row.suprema.stage === "en_suprema" ? "En Suprema" : "Recurso detectado"}
                            </div>
                            {row.suprema.recursoTipo ? (
                              <div className="text-[11px] text-muted-foreground">{row.suprema.recursoTipo}</div>
                            ) : null}
                            {row.suprema.searchUrl ? (
                              <a
                                href={row.suprema.searchUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                              >
                                Buscar en Suprema
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>
                        )}

                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => lookupSuprema(row.rol, row.tribunal)}
                            disabled={lookupLoading[`${row.tribunal}:${row.rol}`]}
                            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            {lookupLoading[`${row.tribunal}:${row.rol}`]
                              ? "Consultando Suprema..."
                              : "Consultar conector Suprema"}
                          </button>
                          {lookupState[`${row.tribunal}:${row.rol}`]?.status ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Estado conector: {String(lookupState[`${row.tribunal}:${row.rol}`].status)}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[420px] text-xs text-muted-foreground">
                        {row.argumentPattern}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
