import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
    FolderOpen,
    FileText,
    LayoutDashboard,
    Settings,
    LogOut,
    ChevronRight,
    User
} from "lucide-react"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="grid min-h-screen w-full lg:grid-cols-[260px_1fr]">
            {/* Sidebar */}
            <div className="hidden border-r bg-white lg:block">
                <div className="flex h-full max-h-screen flex-col">
                    <div className="flex h-16 items-center border-b px-6">
                        <Link className="flex items-center gap-2 font-bold" href="/dashboard">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-sm font-semibold">CA</span>
                            <span className="text-emerald-950">GobAmbiental</span>
                        </Link>
                    </div>

                    <div className="flex-1 overflow-auto py-6 px-4">
                        <nav className="grid items-start gap-1 text-sm font-medium">
                            <span className="px-2 text-xs font-semibold text-muted-foreground mb-2 mt-2">Principal</span>
                            <Link
                                className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-emerald-700 hover:bg-emerald-50"
                                href="/dashboard"
                            >
                                <LayoutDashboard className="h-4 w-4" />
                                Inicio
                            </Link>
                            <Link
                                className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-emerald-700 hover:bg-emerald-50"
                                href="/dashboard/projects"
                            >
                                <FolderOpen className="h-4 w-4" />
                                Proyectos
                            </Link>

                            <span className="px-2 text-xs font-semibold text-muted-foreground mb-2 mt-6">Herramientas</span>
                            <Link
                                className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-emerald-700 hover:bg-emerald-50"
                                href="/dashboard/reports"
                            >
                                <FileText className="h-4 w-4" />
                                Reportes
                            </Link>
                            <Link
                                className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-emerald-700 hover:bg-emerald-50"
                                href="/dashboard/watchlists"
                            >
                                <Settings className="h-4 w-4" />
                                Monitoreo Sheets
                            </Link>
                        </nav>
                    </div>

                    <div className="border-t p-4">
                        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 mb-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                                <User className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col">
                                <span className="font-medium">Evaluador</span>
                                <span className="text-xs text-muted-foreground">evaluador@sea.gob.cl</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex flex-col bg-slate-50/50">
                <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-white px-6 shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Link href="/dashboard" className="hover:text-foreground">GobAmbiental</Link>
                        <ChevronRight className="h-4 w-4" />
                        <span className="font-medium text-foreground">Dashboard</span>
                    </div>
                </header>

                <main className="flex flex-1 flex-col gap-4 p-6 md:p-8 lg:p-10">
                    {children}
                </main>
            </div>
        </div>
    )
}
