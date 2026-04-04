import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/api/oauth/google/callback",
  "/api/oauth/microsoft/callback",
  "/api/health",
]

function isPublicPath(pathname: string) {
  if (pathname === "/favicon.ico") return true
  if (pathname.startsWith("/_next")) return true
  return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))
}

function withCopiedCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie)
  })
  return target
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })

          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refresh session (sets cookies if needed)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Never redirect API routes here; handle auth per-route.
  if (pathname.startsWith("/api/")) return response

  if (isPublicPath(pathname)) {
    if (user && pathname.startsWith("/login")) {
      const url = request.nextUrl.clone()
      url.pathname = "/workspaces"
      return withCopiedCookies(response, NextResponse.redirect(url))
    }
    return response
  }

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return withCopiedCookies(response, NextResponse.redirect(url))
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
