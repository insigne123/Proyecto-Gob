"use client";

import React, { useMemo, useState, Fragment } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, ChevronRight, FileText, Search, Download, ExternalLink } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";
import { isStrictTribunalKeyDocument } from "@/lib/tribunal/document-role";
import { pickDocumentsForDefense } from "@/lib/tribunal/document-selection";

// Tipos basados en nuestra base de datos
export type TribunalDocument = {
    id: string;
    document_type: string;
    date: string | null;
    fojas: string | null;
    name: string;
    storage_path: string | null;
    url: string | null;
};

export type TribunalCause = {
    id: string;
    tribunal: string;
    rol: string;
    fecha_ingreso: string | null;
    caratula: string;
    estado_subtipo: string | null;
    estado: string | null;
    link_causa: string | null;
    gob_tribunal_documents: TribunalDocument[];
};

interface TribunalCausesTableProps {
    initialData: TribunalCause[];
}

function normalizeForSearch(value: unknown): string {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function detectSupremaSignal(cause: TribunalCause) {
    const docsText = (cause.gob_tribunal_documents || [])
        .map((doc) => `${doc.document_type || ""} ${doc.name || ""}`)
        .join(" ");
    const text = normalizeForSearch(`${cause.caratula || ""} ${cause.estado || ""} ${docsText}`);

    const hasCasacion = text.includes("casacion");
    const hasSuprema = text.includes("corte suprema") || text.includes("suprema");
    const recursoTipo = text.includes("casacion en el fondo")
        ? "Casacion en el fondo"
        : text.includes("casacion en la forma")
            ? "Casacion en la forma"
            : hasCasacion
                ? "Casacion"
                : null;

    return {
        hasCasacion,
        hasSuprema,
        recursoTipo,
    };
}

function buildSupremaLookupUrl(cause: TribunalCause): string | null {
    if (!cause.rol) return null;
    const q = encodeURIComponent(`site:pjud.cl ${cause.rol} corte suprema casacion tribunal ambiental ${cause.tribunal || "1TA"}`);
    return `https://www.google.com/search?q=${q}`;
}

function parseDocDateMs(value: string | null) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime();
}

function extract2TADocumentIdFromUrl(value: string | null) {
    const text = String(value || "").trim();
    if (!text) return null;
    const match = text.match(/^https?:\/\/2ta\.lexsoft\.cl\/2ta\/download\/(\d+)(?:[/?#].*)?$/i);
    if (!match) return null;
    return match[1] || null;
}

function pickKeyDocumentsForDisplay(docs: TribunalDocument[]) {
    const strictDocs = docs.filter((doc) => isStrictTribunalKeyDocument({
        documentType: doc.document_type,
        name: doc.name,
        title: doc.document_type,
    }));

    const prioritized = pickDocumentsForDefense(strictDocs, { limit: 3 });
    if (prioritized.length > 0) return prioritized;

    const docsByDate = docs.slice();
    docsByDate.sort((a, b) => {
        const aMs = parseDocDateMs(a.date) ?? Number.NEGATIVE_INFINITY;
        const bMs = parseDocDateMs(b.date) ?? Number.NEGATIVE_INFINITY;
        if (aMs !== bMs) return bMs - aMs;
        return String(a.id).localeCompare(String(b.id));
    });

    return docsByDate.slice(0, 3);
}

export function TribunalCausesTable({ initialData }: TribunalCausesTableProps) {
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

    // Filtros
    const [searchRol, setSearchRol] = useState("");
    const [filterEstado, setFilterEstado] = useState("ALL");
    const [filterTribunal, setFilterTribunal] = useState("ALL");

    const toggleRow = (id: string) => {
        setExpandedRows((prev) => ({
            ...prev,
            [id]: !prev[id],
        }));
    };

    // Extraer todos los estados únicos para el filtro
    const uniqueEstados = Array.from(new Set(initialData.map((d) => d.estado).filter(Boolean))) as string[];
    const uniqueTribunals = Array.from(new Set(initialData.map((d) => d.tribunal).filter(Boolean))) as string[];

    // Aplicar filtros
    const filteredData = useMemo(() => initialData.filter((cause) => {
        const matchesRol = cause.rol.toLowerCase().includes(searchRol.toLowerCase()) ||
            cause.caratula.toLowerCase().includes(searchRol.toLowerCase());
        const matchesEstado = filterEstado === "ALL" || cause.estado === filterEstado;
        const matchesTribunal = filterTribunal === "ALL" || cause.tribunal === filterTribunal;
        return matchesRol && matchesEstado && matchesTribunal;
    }), [filterEstado, filterTribunal, initialData, searchRol]);

    const summary = useMemo(() => filteredData.reduce(
        (acc, cause) => {
            const allDocs = cause.gob_tribunal_documents || [];
            const keyDocs = pickKeyDocumentsForDisplay(allDocs);
            acc.causes += 1;
            acc.docs += allDocs.length;
            acc.keyDocs += keyDocs.length;
            return acc;
        },
        { causes: 0, docs: 0, keyDocs: 0 }
    ), [filteredData]);

    const storageBucket = process.env.NEXT_PUBLIC_SUPABASE_SOURCES_BUCKET || "gob_sources";

    const getPublicUrl = (path: string | null) => {
        if (!path) return null;
        const cleanPath = String(path).trim();
        if (!cleanPath) return null;
        if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
        const normalizedPath = cleanPath.replace(/^\/+/, "");
        const pathWithoutBucket = normalizedPath.replace(/^(gob_sources|gob-sources)\//i, "");
        const { data } = supabase.storage.from(storageBucket).getPublicUrl(pathWithoutBucket);
        return data.publicUrl;
    };

    const getDocumentOpenUrl = (doc: TribunalDocument) => {
        const twoTaId = extract2TADocumentIdFromUrl(doc.url);
        if (twoTaId) {
            return `/api/tribunal/2ta/document/${encodeURIComponent(twoTaId)}`;
        }
        if (doc.url && /^https?:\/\//i.test(String(doc.url))) {
            return String(doc.url);
        }
        return getPublicUrl(doc.storage_path);
    };

    const getCauseOpenUrl = (cause: TribunalCause) => {
        const raw = String(cause.link_causa || "").trim();
        if (!raw) return null;
        if (String(cause.tribunal || "").toUpperCase() === "2TA") {
            if (/^https?:\/\/2ta\.lexsoft\.cl\/2ta\/ot\/causa\//i.test(raw)) {
                return "https://2ta.lexsoft.cl/2ta/search?proc=4";
            }
        }
        return raw;
    };

    return (
        <div className="space-y-4">
            {/* Barra de Filtros */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center gap-2">
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por Rol o Carátula..."
                            className="pl-8"
                            value={searchRol}
                            onChange={(e) => setSearchRol(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Select value={filterTribunal} onValueChange={setFilterTribunal}>
                        <SelectTrigger className="w-[150px]">
                            <SelectValue placeholder="Tribunal" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">Todos</SelectItem>
                            {uniqueTribunals.map((tribunal) => (
                                <SelectItem key={tribunal} value={tribunal}>
                                    {tribunal}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={filterEstado} onValueChange={setFilterEstado}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filtrar Estado" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">Todos los Estados</SelectItem>
                            {uniqueEstados.map((estado) => (
                                <SelectItem key={estado} value={estado}>
                                    {estado}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <Card className="bg-background/35">
                    <CardContent className="pt-4">
                        <div className="text-[11px] text-muted-foreground">Causas visibles</div>
                        <div className="text-xl font-semibold">{summary.causes}</div>
                    </CardContent>
                </Card>
                <Card className="bg-background/35">
                    <CardContent className="pt-4">
                        <div className="text-[11px] text-muted-foreground">Documentos clave</div>
                        <div className="text-xl font-semibold">{summary.keyDocs}</div>
                    </CardContent>
                </Card>
                <Card className="bg-background/35">
                    <CardContent className="pt-4">
                        <div className="text-[11px] text-muted-foreground">Documentos totales</div>
                        <div className="text-xl font-semibold">{summary.docs}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Tabla de Causas */}
            <div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40px]"></TableHead>
                            <TableHead>Tribunal</TableHead>
                            <TableHead>Rol</TableHead>
                            <TableHead>Fecha Ingreso</TableHead>
                            <TableHead className="min-w-[200px]">Carátula</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Docs</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredData.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center">
                                    No se encontraron causas que coincidan con los filtros.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredData.map((cause) => {
                                const allDocs = cause.gob_tribunal_documents || [];
                                const keyDocs = pickKeyDocumentsForDisplay(allDocs);
                                const causeOpenUrl = getCauseOpenUrl(cause);
                                return (
                                <Fragment key={cause.id}>
                                    <TableRow
                                        className="cursor-pointer transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                                        data-state={expandedRows[cause.id] ? "selected" : undefined}
                                        onClick={() => toggleRow(cause.id)}
                                    >
                                        <TableCell>
                                            {expandedRows[cause.id] ? (
                                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                            ) : (
                                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium text-muted-foreground">
                                            {cause.tribunal}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap font-medium">
                                            {cause.rol}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-muted-foreground">
                                            {cause.fecha_ingreso
                                                ? format(new Date(cause.fecha_ingreso), "dd/MM/yyyy")
                                                : "N/A"}
                                        </TableCell>
                                        <TableCell className="max-w-[300px] truncate" title={cause.caratula}>
                                            {cause.caratula}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                                                {cause.estado || "Desconocido"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <FileText className="h-4 w-4" />
                                                <span>{keyDocs.length} clave / {allDocs.length} total</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>

                                    {/* Fila Expandida (Documentos) */}
                                    {expandedRows[cause.id] && (
                                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                                            <TableCell colSpan={7} className="p-0">
                                                <div className="p-4 pl-12 border-b">
                                                    {(() => {
                                                        const suprema = detectSupremaSignal(cause);
                                                        const supremaUrl = buildSupremaLookupUrl(cause);
                                                        if (!suprema.hasCasacion && !suprema.hasSuprema) return null;
                                                        return (
                                                            <div className="mb-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                                                                <div className="font-medium">Continuidad detectada hacia Corte Suprema</div>
                                                                <div className="mt-1 text-amber-100/90">
                                                                    {suprema.recursoTipo || "Recurso detectado"}
                                                                    {suprema.hasSuprema ? " · Hay menciones explicitas a Suprema" : " · Requiere verificacion"}
                                                                </div>
                                                                {supremaUrl ? (
                                                                    <div className="mt-2">
                                                                        <a
                                                                            href={supremaUrl}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="inline-flex items-center gap-1 text-blue-300 hover:underline"
                                                                        >
                                                                            Buscar trazabilidad en Suprema
                                                                            <ExternalLink className="h-3 w-3" />
                                                                        </a>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        );
                                                    })()}

                                                    <div className="mb-3 flex items-center justify-between">
                                                        <div>
                                                            <h4 className="text-sm font-medium">Documentos clave de la causa</h4>
                                                            <div className="text-xs text-muted-foreground">
                                                                {keyDocs.length} clave(s) seleccionados de {allDocs.length} documento(s) registrados.
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <a
                                                                href={`/projects/new?rol=${encodeURIComponent(cause.rol)}&tribunal=${encodeURIComponent(cause.tribunal || "1TA")}&caratula=${encodeURIComponent(cause.caratula || "")}`}
                                                                className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                                                            >
                                                                Crear proyecto desde esta causa
                                                                <ExternalLink className="h-3 w-3" />
                                                            </a>
                                                            {causeOpenUrl && (
                                                                <a
                                                                    href={causeOpenUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                                                                >
                                                                    {String(cause.tribunal || "").toUpperCase() === "2TA"
                                                                        ? "Ir al buscador oficial 2TA"
                                                                        : `Ver causa original en ${cause.tribunal || "Tribunal"}`}
                                                                    <ExternalLink className="h-3 w-3" />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {keyDocs.length > 0 ? (
                                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                            {keyDocs.map((doc) => {
                                                                const fileUrl = getDocumentOpenUrl(doc);
                                                                return (
                                                                    <Card key={doc.id} className="bg-background shadow-sm overflow-hidden">
                                                                        <div className="flex items-start justify-between p-3 border-b border-border/50 bg-muted/20">
                                                                            <div className="flex items-center gap-2 overflow-hidden truncate">
                                                                                <FileText className="h-4 w-4 shrink-0 text-amber-500" />
                                                                                <span className="truncate text-sm font-medium" title={doc.document_type}>
                                                                                    {doc.document_type}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                        <CardContent className="p-3">
                                                                            <div className="flex flex-col gap-2">
                                                                                <span className="text-xs text-muted-foreground line-clamp-2" title={doc.name}>
                                                                                    {doc.name}
                                                                                </span>
                                                                                <div className="flex items-center justify-between mt-1">
                                                                                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                                                                        {doc.date ? doc.date.split('-').reverse().join('/') : "Sin fecha"}
                                                                                    </span>
                                                                                    <div className="flex items-center gap-2">
                                                                                        {fileUrl ? (
                                                                                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                                                                                                <a href={fileUrl} target="_blank" rel="noreferrer" title="Ver PDF">
                                                                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                                                                </a>
                                                                                            </Button>
                                                                                        ) : null}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </CardContent>
                                                                    </Card>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                                                            No hay documentos clave disponibles para esta causa.
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </Fragment>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
