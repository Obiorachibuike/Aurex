import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin, jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { chatSessionToken, getViewer } from "@/lib/viewer";
import { recordFeedback } from "@/services/ai/agent";

const schema = z.object({ messageId: z.string().uuid(), value: z.union([z.literal(1), z.literal(-1)]) });

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
    const token = await chatSessionToken(false);
    if (!token) return NextResponse.json({ error: "No conversation." }, { status: 404 });
    await enforceRateLimit(`ai:fb:${token.slice(0, 24)}`, 30, 60);
    const body = schema.parse(await req.json());
    await recordFeedback({ sessionToken: token, user: (await getViewer()).user }, body.messageId, body.value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e, "assistant.feedback");
  }
}
