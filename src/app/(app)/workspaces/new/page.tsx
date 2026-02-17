import { redirect } from "next/navigation"

export default function LegacyNewWorkspacePage() {
  redirect("/projects/new")
}
