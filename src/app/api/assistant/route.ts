import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/auth/session";
import { isSameOrigin, jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { chatSessionToken, currentCartId, getViewer } from "@/lib/viewer";
import { endConversation, getMessages, getOrCreateConversation, MAX_USER_MESSAGE, runTurn } from "@/services/ai/agent";
import { getSetting } from "@/services/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

/** Conversation history for this browser session (used to restore the chat after a reload). */
export async function GET() {
  try {
    const ai = await getSetting("ai");
    const token = await chatSessionToken(false);
    const { user } = await getViewer();
    if (!ai.enabled) return NextResponse.json({ enabled: false, orderingEnabled: false, messages: [] }, { headers: noStore });
    const conv = token ? await getOrCreateConversation({ sessionToken: token, user }, false) : null;
    return NextResponse.json({ enabled: true, orderingEnabled: ai.orderingEnabled, status: conv?.status ?? null, messages: conv ? await getMessages(conv.id) : [] }, { headers: noStore });
  } catch (e) {
    return jsonError(e, "assistant.get");
  }
}

const bodySchema = z.object({ text: z.string().max(MAX_USER_MESSAGE * 2).optional(), confirm: z.boolean().optional(), action: z.enum(["message", "end"]).default("message") });

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return NextResponse.json({ error: "Cross-site requests are not allowed.", code: "CSRF" }, { status: 403 });
    const ip = await getClientIp();
    const token = (await chatSessionToken(true))!;
    // Two windows: a burst limit per session and a wider one per network.
    const [a, b] = await Promise.all([rateLimit(`ai:s:${token.slice(0, 24)}`, 20, 60), rateLimit(`ai:ip:${ip}`, 120, 600)]);
    if (!a.allowed || !b.allowed) return NextResponse.json({ error: "You're sending messages very quickly. Please wait a moment and try again.", code: "RATE_LIMITED" }, { status: 429 });

    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const { user } = await getViewer();
    const owner = { sessionToken: token, user };
    if (body.action === "end") {
      await endConversation(owner);
      return NextResponse.json({ messages: [] }, { headers: noStore });
    }
    const result = await runTurn({ owner, text: body.confirm && !body.text ? "Confirm order" : (body.text ?? ""), confirm: body.confirm === true, getCartId: (create) => currentCartId(create) });
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    return jsonError(e, "assistant.post");
  }
}
