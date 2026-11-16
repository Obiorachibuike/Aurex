import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { reportError } from "@/lib/monitoring";
import { orderUrl } from "@/services/order-shared";
import { dispatchQueuedNotifications } from "@/services/notifications";
import { verifyPayment } from "@/services/payments";

export const dynamic = "force-dynamic";

/**
 * Where the gateway sends the customer back after checkout. Nothing in this URL is trusted:
 * the reference is looked up and verified server-to-server, and the order page shows whatever
 * the gateway actually reports (paid, pending or failed).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const reference = (url.searchParams.get("reference") ?? url.searchParams.get("trxref") ?? url.searchParams.get("tx_ref") ?? "").slice(0, 100);
  // Relative redirects keep working behind proxies and preview hosts.
  const home = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
  if (!reference) return home("/track");
  try {
    const [row] = await db.select({ order: orders }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(payments.reference, reference)).limit(1);
    if (!row) return home("/track");
    let outcome = "PENDING";
    try {
      outcome = (await verifyPayment(reference, "callback")).outcome;
      await dispatchQueuedNotifications(10).catch(() => undefined);
    } catch (e) {
      reportError(e, { where: "checkout.callback", reference }); // gateway unreachable → webhook / cron will settle it
    }
    const result = outcome === "PAID" || outcome === "ALREADY_PAID" ? "success" : outcome === "PENDING" ? "pending" : outcome === "PAID_OUT_OF_STOCK" || outcome === "DUPLICATE_PAYMENT" ? "review" : "failed";
    // Possession of the unguessable payment reference is what authorises viewing this order.
    return home(`${orderUrl(row.order).replace(/^https?:\/\/[^/]+/, "")}&payment=${result}`);
  } catch (e) {
    reportError(e, { where: "checkout.callback" });
    return home("/track");
  }
}
