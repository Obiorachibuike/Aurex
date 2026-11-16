import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/auth/session";
import { jsonError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { searchSuggestions } from "@/services/catalog";

export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
    if (q.length < 2) return NextResponse.json({ products: [], devices: [], categories: [] });
    const rl = await rateLimit(`suggest:${await getClientIp()}`, 90, 60);
    if (!rl.allowed) return NextResponse.json({ products: [], devices: [], categories: [] }, { status: 429 });
    return NextResponse.json(await searchSuggestions(q), { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    return jsonError(e, "search.suggest");
  }
}
