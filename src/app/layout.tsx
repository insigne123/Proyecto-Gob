import type { Metadata } from "next"
import { IBM_Plex_Mono, Manrope } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { validateWebEnv } from "@/lib/env"

const fontBody = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
})

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Cuaderno Ambiental",
  description:
    "Asistente documental con citas verificables + monitor de Excel para el Tribunal Ambiental de Chile.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  validateWebEnv()

  return (
    <html
      lang="es"
      className={`dark ${fontBody.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-svh bg-background font-body text-foreground antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
