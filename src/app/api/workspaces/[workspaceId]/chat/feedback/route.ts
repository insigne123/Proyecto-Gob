import { NextResponse } from "next/server"
import { z } from "zod"

import { applyAssistantFeedbackUsage } from "@/lib/chat-feedback"
import { clearRuntimeCache } from "@/lib/runtime-cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

const FeedbackSchema = z
  .object({
    messageId: z.string().uuid(),
    vote: z.enum(["useful", "not_useful"]),
    reason: z.string().trim().max(240).nullable().optional(),
    evidenceVotes: z
      .array(
        z
          .object({
            chunkId: z.string().trim().min(1).max(120),
            vote: z.enum(["useful", "not_useful"]),
            reason: z.string().trim().max(240).nullable().optional(),
            traceId: z.string().uuid().nullable().optional(),
          })
          .strict()
      )
      .max(8)
      .optional(),
  })
  .strict()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: member } = await supabase
    .from("gob_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = FeedbackSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: message, error: messageErr } = await admin
    .from("gob_chat_messages")
    .select("id,workspace_id,role,usage")
    .eq("id", parsed.data.messageId)
    .eq("workspace_id", workspaceId)
    .eq("role", "assistant")
    .maybeSingle()

  if (messageErr) return NextResponse.json({ error: messageErr.message }, { status: 500 })
  if (!message?.id) return NextResponse.json({ error: "Assistant message not found" }, { status: 404 })

  const now = new Date().toISOString()
  const usage = applyAssistantFeedbackUsage({
    usage: message.usage,
    feedback: {
      vote: parsed.data.vote,
      reason: parsed.data.reason ?? null,
      at: now,
      byUser: user.id,
    },
    evidenceFeedback: (parsed.data.evidenceVotes || []).map((item) => ({
      chunkId: item.chunkId,
      vote: item.vote,
      reason: item.reason ?? null,
      traceId: item.traceId ?? null,
    })),
  })

  const { error: updateErr } = await admin
    .from("gob_chat_messages")
    .update({ usage })
    .eq("id", message.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const { data: traces } = await admin
    .from("gob_rag_retrieval_traces")
    .select("id,metadata")
    .eq("workspace_id", workspaceId)
    .eq("message_id", message.id)
    .limit(20)

  for (const trace of traces || []) {
    const metadata = trace?.metadata && typeof trace.metadata === "object" && !Array.isArray(trace.metadata)
      ? trace.metadata
      : {}
    await admin
      .from("gob_rag_retrieval_traces")
      .update({
        metadata: {
          ...metadata,
          assistant_feedback: {
            vote: parsed.data.vote,
            reason: parsed.data.reason ?? null,
            at: now,
            byUser: user.id,
          },
          evidence_feedback: (parsed.data.evidenceVotes || []).slice(0, 8),
        },
      })
      .eq("id", trace.id)
  }

  await admin.from("gob_audit_logs").insert({
    user_id: user.id,
    action: "chat.message.feedback",
    target_resource: "gob_chat_messages",
    details: {
      workspace_id: workspaceId,
        message_id: message.id,
        vote: parsed.data.vote,
        reason: parsed.data.reason ?? null,
        evidence_votes: parsed.data.evidenceVotes || [],
      },
    timestamp: now,
  })

  await clearRuntimeCache("rag-feedback-signals")

  return NextResponse.json({
    ok: true,
    feedback: {
      vote: parsed.data.vote,
      reason: parsed.data.reason ?? null,
      at: now,
      byUser: user.id,
    },
  })
}
