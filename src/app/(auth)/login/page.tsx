import LoginClient from "./login-client"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const nextRaw = sp.next
  const next = typeof nextRaw === "string" ? nextRaw : "/workspaces"
  return <LoginClient next={next} />
}
