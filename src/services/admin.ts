import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiConversations, aiMessages, aiToolExecutions, auditLogs, customerGroups, customerProfiles, inventory, inventoryMovements, notifications, orderItems, orders, payments, productVariants, products, roles, supportTickets, userSessions, users, wholesaleApplications } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { ROLE_KEYS, type RoleKey } from "@/lib/auth/permissions";
import { escapeLike } from "@/lib/utils";
import { audit } from "./audit";
import { hasPermission, setUserRole, type SessionUser } from "./auth";
import { queueNotification } from "./notifications";
import { getSetting } from "./settings";

const n = (v: unknown) => Number(v ?? 0);
/** Orders that count as revenue: payment verified and not refunded/cancelled. */
const REVENUE = sql`${orders.paidAt} is not null and ${orders.status} not in ('REFUNDED', 'CANCELLED')`;
/** Reporting uses the store's local day (Africa/Lagos). */
const TZ = "Africa/Lagos";

export async function getOverview() {
  const [totals] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${orders.total}) filter (where ${REVENUE}), 0)`,
      paidOrders: sql<number>`count(*) filter (where ${REVENUE})`,
      today: sql<number>`coalesce(sum(${orders.total}) filter (where ${REVENUE} and (${orders.paidAt} at time zone ${TZ})::date = (now() at time zone ${TZ})::date), 0)`,
      month: sql<number>`coalesce(sum(${orders.total}) filter (where ${REVENUE} and date_trunc('month', ${orders.paidAt} at time zone ${TZ}) = date_trunc('month', now() at time zone ${TZ})), 0)`,
      wholesaleRevenue: sql<number>`coalesce(sum(${orders.total}) filter (where ${REVENUE} and ${orders.pricingTier} = 'WHOLESALE'), 0)`,
      wholesaleOrders: sql<number>`count(*) filter (where ${REVENUE} and ${orders.pricingTier} = 'WHOLESALE')`,
      aiOrders: sql<number>`count(*) filter (where ${REVENUE} and ${orders.source} = 'AI')`,
      pending: sql<number>`count(*) filter (where ${orders.status} in ('PENDING', 'AWAITING_PAYMENT'))`,
      toFulfil: sql<number>`count(*) filter (where ${orders.status} in ('PAID', 'PROCESSING', 'READY_FOR_DISPATCH'))`,
      completed: sql<number>`count(*) filter (where ${orders.status} = 'DELIVERED')`,
      totalOrders: sql<number>`count(*)`,
    })
    .from(orders);

  const [byStatus, byState, daily, bestSellers, lowStock, recentPayments, [customers], [wholesalePending], [openTickets], [refundsOpen]] = await Promise.all([
    db.select({ status: orders.status, count: sql<number>`count(*)::int` }).from(orders).groupBy(orders.status),
    db.select({ state: sql<string>`${orders.shippingAddress}->>'state'`, count: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${orders.total}) filter (where ${REVENUE}), 0)` }).from(orders).groupBy(sql`${orders.shippingAddress}->>'state'`).orderBy(sql`count(*) desc`).limit(8),
    db.execute<{ day: string; revenue: string; orders: string }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(o.total), 0) as revenue, count(o.id) as orders
      from generate_series((now() at time zone ${TZ})::date - 13, (now() at time zone ${TZ})::date, interval '1 day') as d(day)
      left join orders o on (o.paid_at at time zone ${TZ})::date = d.day::date and o.status not in ('REFUNDED', 'CANCELLED')
      group by d.day order by d.day`),
    db.select({ productId: orderItems.productId, name: orderItems.productName, sku: sql<string>`min(${orderItems.sku})`, units: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<number>`sum(${orderItems.lineTotal})` })
      .from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId)).where(REVENUE).groupBy(orderItems.productId, orderItems.productName).orderBy(sql`sum(${orderItems.quantity}) desc`).limit(6),
    listLowStock(8),
    db.select({ id: payments.id, reference: payments.reference, provider: payments.provider, status: payments.status, amount: payments.amount, createdAt: payments.createdAt, orderNumber: orders.number, customer: orders.customerName })
      .from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).orderBy(desc(payments.createdAt)).limit(8),
    db.select({ total: sql<number>`count(*)::int`, wholesale: sql<number>`count(*) filter (where ${customerProfiles.wholesaleStatus} = 'APPROVED')::int`, newThisMonth: sql<number>`count(*) filter (where ${users.createdAt} >= date_trunc('month', now()))::int` })
      .from(users).innerJoin(roles, eq(roles.id, users.roleId)).leftJoin(customerProfiles, eq(customerProfiles.userId, users.id)).where(and(eq(roles.isStaff, false), isNull(users.deletedAt))),
    db.select({ count: sql<number>`count(*)::int` }).from(wholesaleApplications).where(eq(wholesaleApplications.status, "PENDING")),
    db.select({ count: sql<number>`count(*)::int` }).from(supportTickets).where(inArray(supportTickets.status, ["OPEN", "IN_PROGRESS"])),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(eq(orders.status, "REFUND_REQUESTED")),
  ]);

  return {
    revenue: n(totals?.revenue), paidOrders: n(totals?.paidOrders), today: n(totals?.today), month: n(totals?.month),
    wholesaleRevenue: n(totals?.wholesaleRevenue), wholesaleOrders: n(totals?.wholesaleOrders), aiOrders: n(totals?.aiOrders),
    pending: n(totals?.pending), toFulfil: n(totals?.toFulfil), completed: n(totals?.completed), totalOrders: n(totals?.totalOrders),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])) as Record<string, number>,
    byState: byState.map((r) => ({ state: r.state ?? "Unknown", count: r.count, revenue: n(r.revenue) })),
    daily: daily.rows.map((r) => ({ day: r.day, revenue: n(r.revenue), orders: n(r.orders) })),
    bestSellers: bestSellers.map((r) => ({ ...r, revenue: n(r.revenue) })),
    lowStock, recentPayments,
    customers: customers?.total ?? 0, wholesaleCustomers: customers?.wholesale ?? 0, newCustomers: customers?.newThisMonth ?? 0,
    wholesalePending: wholesalePending?.count ?? 0, openTickets: openTickets?.count ?? 0, refundsOpen: refundsOpen?.count ?? 0,
  };
}

/* ───────────────────────────── Inventory ───────────────────────────── */

const invSelect = {
  variantId: productVariants.id, sku: productVariants.sku, variantName: productVariants.name, productId: products.id, productName: products.name, status: products.status,
  onHand: inventory.onHand, reserved: inventory.reserved, threshold: inventory.lowStockThreshold, retailPrice: productVariants.retailPrice,
  available: sql<number>`(${inventory.onHand} - ${inventory.reserved})::int`,
};
const liveVariant = and(isNull(productVariants.deletedAt), isNull(products.deletedAt));

export async function listLowStock(limit = 50) {
  return db.select(invSelect).from(inventory).innerJoin(productVariants, eq(productVariants.id, inventory.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(liveVariant, eq(products.status, "ACTIVE"), sql`${inventory.onHand} - ${inventory.reserved} <= ${inventory.lowStockThreshold}`))
    .orderBy(sql`${inventory.onHand} - ${inventory.reserved}`).limit(limit);
}

export async function getInventoryReport(filter: { q?: string; view?: "all" | "low" | "out"; page?: number }) {
  const pageSize = 40;
  const page = Math.max(1, filter.page ?? 1);
  const q = filter.q?.trim();
  const where = and(
    liveVariant,
    q ? or(ilike(products.name, `%${escapeLike(q)}%`), ilike(productVariants.sku, `%${escapeLike(q)}%`)) : undefined,
    filter.view === "low" ? sql`${inventory.onHand} - ${inventory.reserved} <= ${inventory.lowStockThreshold}` : undefined,
    filter.view === "out" ? sql`${inventory.onHand} - ${inventory.reserved} <= 0` : undefined,
  );
  const base = () => db.select(invSelect).from(inventory).innerJoin(productVariants, eq(productVariants.id, inventory.variantId)).innerJoin(products, eq(products.id, productVariants.productId));
  const [rows, [summary], [count]] = await Promise.all([
    base().where(where).orderBy(products.name, productVariants.sku).limit(pageSize).offset((page - 1) * pageSize),
    db.select({
      skus: sql<number>`count(*)::int`, units: sql<number>`coalesce(sum(${inventory.onHand}), 0)::int`, reserved: sql<number>`coalesce(sum(${inventory.reserved}), 0)::int`,
      retailValue: sql<number>`coalesce(sum(${inventory.onHand}::bigint * ${productVariants.retailPrice}), 0)`,
      low: sql<number>`count(*) filter (where ${inventory.onHand} - ${inventory.reserved} <= ${inventory.lowStockThreshold} and ${inventory.onHand} - ${inventory.reserved} > 0)::int`,
      out: sql<number>`count(*) filter (where ${inventory.onHand} - ${inventory.reserved} <= 0)::int`,
    }).from(inventory).innerJoin(productVariants, eq(productVariants.id, inventory.variantId)).innerJoin(products, eq(products.id, productVariants.productId)).where(liveVariant),
    db.select({ c: sql<number>`count(*)::int` }).from(inventory).innerJoin(productVariants, eq(productVariants.id, inventory.variantId)).innerJoin(products, eq(products.id, productVariants.productId)).where(where),
  ]);
  return { rows, page, pageCount: Math.max(1, Math.ceil((count?.c ?? 0) / pageSize)), total: count?.c ?? 0, summary: { skus: summary?.skus ?? 0, units: summary?.units ?? 0, reserved: summary?.reserved ?? 0, retailValue: n(summary?.retailValue), low: summary?.low ?? 0, out: summary?.out ?? 0 } };
}

export async function listMovements(limit = 60, variantId?: string) {
  return db.select({ id: inventoryMovements.id, type: inventoryMovements.type, quantity: inventoryMovements.quantity, note: inventoryMovements.note, createdAt: inventoryMovements.createdAt, sku: productVariants.sku, productName: products.name, actor: users.name })
    .from(inventoryMovements).innerJoin(productVariants, eq(productVariants.id, inventoryMovements.variantId)).innerJoin(products, eq(products.id, productVariants.productId)).leftJoin(users, eq(users.id, inventoryMovements.actorId))
    .where(variantId ? eq(inventoryMovements.variantId, variantId) : undefined).orderBy(desc(inventoryMovements.createdAt)).limit(limit);
}

/* ───────────────────────────── Customers ───────────────────────────── */

export async function listCustomers(filter: { q?: string; segment?: "all" | "wholesale" | "pending" | "staff"; page?: number }) {
  const pageSize = 30;
  const page = Math.max(1, filter.page ?? 1);
  const q = filter.q?.trim();
  const like = q ? `%${escapeLike(q)}%` : null;
  const where = and(
    isNull(users.deletedAt),
    like ? or(ilike(users.email, like), ilike(users.name, like), ilike(users.phone, like), ilike(customerProfiles.businessName, like)) : undefined,
    filter.segment === "wholesale" ? eq(customerProfiles.wholesaleStatus, "APPROVED") : undefined,
    filter.segment === "pending" ? eq(customerProfiles.wholesaleStatus, "PENDING") : undefined,
    filter.segment === "staff" ? eq(roles.isStaff, true) : undefined,
  );
  const from = () => db.select({
    id: users.id, name: users.name, email: users.email, phone: users.phone, createdAt: users.createdAt, isSuspended: users.isSuspended, verified: users.emailVerifiedAt,
    role: roles.name, roleKey: roles.key, isStaff: roles.isStaff, wholesaleStatus: customerProfiles.wholesaleStatus, businessName: customerProfiles.businessName, group: customerGroups.name,
    orders: sql<number>`(select count(*)::int from orders o where o.user_id = ${users.id})`,
    spent: sql<number>`(select coalesce(sum(o.total), 0) from orders o where o.user_id = ${users.id} and o.paid_at is not null and o.status not in ('REFUNDED', 'CANCELLED'))`,
  }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).leftJoin(customerProfiles, eq(customerProfiles.userId, users.id)).leftJoin(customerGroups, eq(customerGroups.id, customerProfiles.groupId));
  const [rows, [count]] = await Promise.all([
    from().where(where).orderBy(desc(users.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ c: sql<number>`count(*)::int` }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).leftJoin(customerProfiles, eq(customerProfiles.userId, users.id)).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, spent: n(r.spent) })), page, total: count?.c ?? 0, pageCount: Math.max(1, Math.ceil((count?.c ?? 0) / pageSize)) };
}

export async function getCustomer(userId: string) {
  const [row] = await db.select({ user: users, role: roles, profile: customerProfiles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).leftJoin(customerProfiles, eq(customerProfiles.userId, users.id)).where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (!row) return null;
  const [orderRows, applications, tickets] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(25),
    db.select().from(wholesaleApplications).where(eq(wholesaleApplications.userId, userId)).orderBy(desc(wholesaleApplications.createdAt)),
    db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.createdAt)).limit(10),
  ]);
  const { passwordHash: _omit, ...user } = row.user;
  void _omit;
  return { user, role: row.role, profile: row.profile, orders: orderRows, applications, tickets };
}

export const listApplications = (status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING") =>
  db.select({ application: wholesaleApplications, name: users.name, email: users.email }).from(wholesaleApplications).innerJoin(users, eq(users.id, wholesaleApplications.userId)).where(eq(wholesaleApplications.status, status)).orderBy(desc(wholesaleApplications.createdAt)).limit(100);

/** Approves or rejects a wholesale application. Approval is the only way wholesale pricing is unlocked. */
export async function decideWholesale(applicationId: string, actor: SessionUser, decision: { approve: boolean; note?: string; groupId?: string | null }): Promise<void> {
  if (!hasPermission(actor, "customers.manage")) throw new ForbiddenError();
  await db.transaction(async (tx) => {
    const [app] = await tx.select().from(wholesaleApplications).where(eq(wholesaleApplications.id, applicationId)).for("update");
    if (!app) throw new NotFoundError("Application not found.");
    if (app.status !== "PENDING") throw new AppError("This application has already been reviewed.", "ALREADY_REVIEWED", 409);
    const status = decision.approve ? "APPROVED" : "REJECTED";
    await tx.update(wholesaleApplications).set({ status, reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: decision.note?.trim() || null }).where(eq(wholesaleApplications.id, app.id));
    const set = { wholesaleStatus: status, businessName: app.businessName, ...(decision.approve && decision.groupId !== undefined ? { groupId: decision.groupId } : {}) } as const;
    await tx.insert(customerProfiles).values({ userId: app.userId, ...set }).onConflictDoUpdate({ target: customerProfiles.userId, set });
    const [u] = await tx.select({ name: users.name, email: users.email, roleKey: roles.key, isStaff: roles.isStaff }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, app.userId));
    if (u && !u.isStaff) await setUserRole(app.userId, decision.approve ? "wholesale_customer" : "customer", tx);
    if (u) await queueNotification({ template: "wholesale_decision", recipient: u.email, userId: app.userId, payload: { name: u.name, approved: decision.approve, note: decision.note ?? "", url: `${env.appUrl}/account/wholesale` }, dedupeKey: `wholesale:${app.id}` }, tx);
    await audit({ actorId: actor.id, action: decision.approve ? "wholesale.approve" : "wholesale.reject", entityType: "user", entityId: app.userId, metadata: { applicationId: app.id, businessName: app.businessName } }, tx);
  });
}

export const customerUpdateSchema = z.object({ wholesaleStatus: z.enum(["NONE", "PENDING", "APPROVED", "REJECTED"]).optional(), groupId: z.string().uuid().nullable().optional(), isSuspended: z.boolean().optional(), role: z.enum(ROLE_KEYS).optional() });
export async function updateCustomer(userId: string, actor: SessionUser, raw: z.input<typeof customerUpdateSchema>): Promise<void> {
  if (!hasPermission(actor, "customers.manage")) throw new ForbiddenError();
  const v = customerUpdateSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, roleKey: roles.key, isStaff: roles.isStaff }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId));
    if (!target) throw new NotFoundError("Customer not found.");
    const targetRole = target.roleKey as RoleKey;
    // Staff accounts and role changes are reserved for super administrators.
    const touchesStaff = target.isStaff || (v.role !== undefined && v.role !== targetRole);
    if (touchesStaff && !hasPermission(actor, "staff.manage")) throw new ForbiddenError("Only a super administrator can change staff accounts or roles.");
    if (userId === actor.id && (v.role !== undefined || v.isSuspended)) throw new AppError("You cannot change your own role or suspend yourself.", "SELF_CHANGE", 400);

    if (v.isSuspended !== undefined) {
      await tx.update(users).set({ isSuspended: v.isSuspended }).where(eq(users.id, userId));
      if (v.isSuspended) await tx.delete(userSessions).where(eq(userSessions.userId, userId));
    }
    if (v.wholesaleStatus !== undefined || v.groupId !== undefined) {
      const set = { ...(v.wholesaleStatus !== undefined ? { wholesaleStatus: v.wholesaleStatus } : {}), ...(v.groupId !== undefined ? { groupId: v.groupId } : {}) };
      await tx.insert(customerProfiles).values({ userId, ...set }).onConflictDoUpdate({ target: customerProfiles.userId, set });
      if (v.wholesaleStatus !== undefined && !target.isStaff && v.role === undefined) await setUserRole(userId, v.wholesaleStatus === "APPROVED" ? "wholesale_customer" : "customer", tx);
    }
    if (v.role !== undefined && v.role !== targetRole) {
      await setUserRole(userId, v.role, tx);
      await tx.delete(userSessions).where(eq(userSessions.userId, userId));
    }
    await audit({ actorId: actor.id, action: "customer.update", entityType: "user", entityId: userId, metadata: v }, tx);
  });
}

/* ───────────────────────────── Support ───────────────────────────── */

export async function listTickets(status?: "OPEN" | "IN_PROGRESS" | "RESOLVED") {
  return db.select({ ticket: supportTickets, assignee: users.name }).from(supportTickets).leftJoin(users, eq(users.id, supportTickets.assignedTo)).where(status ? eq(supportTickets.status, status) : undefined).orderBy(desc(supportTickets.createdAt)).limit(200);
}
export async function getTicket(id: string) {
  const [row] = await db.select({ ticket: supportTickets, assignee: users.name }).from(supportTickets).leftJoin(users, eq(users.id, supportTickets.assignedTo)).where(eq(supportTickets.id, id));
  return row ?? null;
}
export async function updateTicket(id: string, actor: SessionUser, patch: { status?: "OPEN" | "IN_PROGRESS" | "RESOLVED"; internalNotes?: string; assignToMe?: boolean }): Promise<void> {
  if (!hasPermission(actor, "support.manage")) throw new ForbiddenError();
  const [t] = await db.update(supportTickets).set({ ...(patch.status ? { status: patch.status } : {}), ...(patch.internalNotes !== undefined ? { internalNotes: patch.internalNotes.slice(0, 4000) } : {}), ...(patch.assignToMe ? { assignedTo: actor.id } : {}) }).where(eq(supportTickets.id, id)).returning();
  if (!t) throw new NotFoundError("Ticket not found.");
  if (patch.status === "RESOLVED" && t.conversationId) await db.update(aiConversations).set({ status: "CLOSED" }).where(and(eq(aiConversations.id, t.conversationId), eq(aiConversations.status, "ESCALATED")));
  await audit({ actorId: actor.id, action: "ticket.update", entityType: "support_ticket", entityId: id, metadata: { status: patch.status, assigned: !!patch.assignToMe } });
}

/* ───────────────────────────── AI reporting ───────────────────────────── */

export async function listConversations(filter: { view?: "all" | "escalated" | "unresolved"; page?: number }) {
  const pageSize = 30;
  const page = Math.max(1, filter.page ?? 1);
  const where = filter.view === "escalated" ? eq(aiConversations.status, "ESCALATED") : filter.view === "unresolved" ? eq(aiConversations.hasUnresolved, true) : undefined;
  const rows = await db.select({
    id: aiConversations.id, status: aiConversations.status, title: aiConversations.title, hasUnresolved: aiConversations.hasUnresolved, updatedAt: aiConversations.updatedAt, createdAt: aiConversations.createdAt,
    customer: users.name, email: users.email,
    messages: sql<number>`(select count(*)::int from ai_messages m where m.conversation_id = ${aiConversations.id} and m.role in ('user', 'assistant', 'agent'))`,
    lastMessage: sql<string | null>`(select left(m.content, 140) from ai_messages m where m.conversation_id = ${aiConversations.id} and m.role = 'user' order by m.created_at desc limit 1)`,
  }).from(aiConversations).leftJoin(users, eq(users.id, aiConversations.userId)).where(where).orderBy(desc(aiConversations.updatedAt)).limit(pageSize + 1).offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

export async function getConversationAdmin(id: string) {
  const [conv] = await db.select({ conv: aiConversations, customer: users.name, email: users.email }).from(aiConversations).leftJoin(users, eq(users.id, aiConversations.userId)).where(eq(aiConversations.id, id));
  if (!conv) return null;
  const [messages, tools, tickets, convOrders] = await Promise.all([
    db.select().from(aiMessages).where(and(eq(aiMessages.conversationId, id), inArray(aiMessages.role, ["user", "assistant", "agent"]))).orderBy(aiMessages.createdAt),
    db.select().from(aiToolExecutions).where(eq(aiToolExecutions.conversationId, id)).orderBy(aiToolExecutions.createdAt).limit(300),
    db.select().from(supportTickets).where(eq(supportTickets.conversationId, id)),
    db.select({ number: orders.number, status: orders.status, total: orders.total }).from(orders).where(eq(orders.conversationId, id)),
  ]);
  return { ...conv, messages, tools, tickets, orders: convOrders };
}

/** Questions the assistant could not answer or that customers marked unhelpful — the knowledge-base to-do list. */
export async function listUnresolved(limit = 100) {
  const rows = await db.execute<{ id: string; conversation_id: string; answer: string; question: string | null; feedback: number | null; created_at: Date }>(sql`
    select m.id, m.conversation_id, left(m.content, 300) as answer, m.feedback, m.created_at,
      (select left(u.content, 300) from ai_messages u where u.conversation_id = m.conversation_id and u.role = 'user' and u.created_at <= m.created_at order by u.created_at desc limit 1) as question
    from ai_messages m where m.role = 'assistant' and m.unresolved = true order by m.created_at desc limit ${limit}`);
  return rows.rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, question: r.question ?? "", answer: r.answer, feedback: r.feedback, createdAt: new Date(r.created_at) }));
}
export async function resolveUnresolved(messageId: string, actorId: string): Promise<void> {
  const [m] = await db.update(aiMessages).set({ unresolved: false }).where(eq(aiMessages.id, messageId)).returning({ conversationId: aiMessages.conversationId });
  if (!m) return;
  const [left] = await db.select({ c: sql<number>`count(*)::int` }).from(aiMessages).where(and(eq(aiMessages.conversationId, m.conversationId), eq(aiMessages.unresolved, true)));
  if (!left?.c) await db.update(aiConversations).set({ hasUnresolved: false }).where(eq(aiConversations.id, m.conversationId));
  await audit({ actorId, action: "ai.unresolved.dismiss", entityType: "ai_message", entityId: messageId });
}

export async function getAiUsage(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const ai = await getSetting("ai");
  const [[t], byModel, daily, [conv], tools, [fb]] = await Promise.all([
    db.select({ prompt: sql<number>`coalesce(sum(${aiMessages.promptTokens}), 0)`, completion: sql<number>`coalesce(sum(${aiMessages.completionTokens}), 0)`, replies: sql<number>`count(*) filter (where ${aiMessages.role} = 'assistant')::int`, questions: sql<number>`count(*) filter (where ${aiMessages.role} = 'user')::int` }).from(aiMessages).where(gte(aiMessages.createdAt, since)),
    db.select({ provider: sql<string>`coalesce(${aiMessages.provider}, 'builtin')`, model: sql<string>`coalesce(${aiMessages.model}, '—')`, replies: sql<number>`count(*)::int`, prompt: sql<number>`coalesce(sum(${aiMessages.promptTokens}), 0)`, completion: sql<number>`coalesce(sum(${aiMessages.completionTokens}), 0)` }).from(aiMessages).where(and(gte(aiMessages.createdAt, since), eq(aiMessages.role, "assistant"))).groupBy(sql`1`, sql`2`).orderBy(sql`3 desc`),
    db.execute<{ day: string; replies: string; tokens: string }>(sql`select to_char((created_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day, count(*) filter (where role = 'assistant') as replies, coalesce(sum(prompt_tokens + completion_tokens), 0) as tokens from ai_messages where created_at >= ${since.toISOString()}::timestamptz group by 1 order by 1`),
    db.select({ total: sql<number>`count(*)::int`, escalated: sql<number>`count(*) filter (where ${aiConversations.status} = 'ESCALATED')::int`, unresolved: sql<number>`count(*) filter (where ${aiConversations.hasUnresolved})::int` }).from(aiConversations).where(gte(aiConversations.createdAt, since)),
    db.select({ tool: aiToolExecutions.toolName, calls: sql<number>`count(*)::int`, failed: sql<number>`count(*) filter (where ${aiToolExecutions.status} <> 'OK')::int`, avgMs: sql<number>`round(avg(${aiToolExecutions.durationMs}))::int` }).from(aiToolExecutions).where(gte(aiToolExecutions.createdAt, since)).groupBy(aiToolExecutions.toolName).orderBy(sql`count(*) desc`),
    db.select({ up: sql<number>`count(*) filter (where ${aiMessages.feedback} = 1)::int`, down: sql<number>`count(*) filter (where ${aiMessages.feedback} = -1)::int` }).from(aiMessages).where(gte(aiMessages.createdAt, since)),
  ]);
  const [aiOrders] = await db.select({ count: sql<number>`count(*)::int`, paid: sql<number>`count(*) filter (where ${orders.paidAt} is not null)::int`, revenue: sql<number>`coalesce(sum(${orders.total}) filter (where ${REVENUE}), 0)` }).from(orders).where(and(eq(orders.source, "AI"), gte(orders.createdAt, since)));
  const prompt = n(t?.prompt), completion = n(t?.completion);
  return {
    days, promptTokens: prompt, completionTokens: completion, replies: t?.replies ?? 0, questions: t?.questions ?? 0,
    /** Estimate only: tokens × the per-1k rates configured in AI settings. */
    estimatedCostUsd: (prompt / 1000) * ai.costPer1kPromptUsd + (completion / 1000) * ai.costPer1kCompletionUsd,
    ratesConfigured: ai.costPer1kPromptUsd > 0 || ai.costPer1kCompletionUsd > 0,
    byModel: byModel.map((r) => ({ ...r, prompt: n(r.prompt), completion: n(r.completion) })),
    daily: daily.rows.map((r) => ({ day: r.day, replies: n(r.replies), tokens: n(r.tokens) })),
    conversations: conv?.total ?? 0, escalated: conv?.escalated ?? 0, unresolved: conv?.unresolved ?? 0,
    tools, thumbsUp: fb?.up ?? 0, thumbsDown: fb?.down ?? 0,
    aiOrders: aiOrders?.count ?? 0, aiOrdersPaid: aiOrders?.paid ?? 0, aiRevenue: n(aiOrders?.revenue),
  };
}

/* ───────────────────────── Audit & notification logs ───────────────────────── */

export async function listAuditLogs(filter: { q?: string; page?: number; from?: Date; to?: Date }) {
  const pageSize = 50;
  const page = Math.max(1, filter.page ?? 1);
  const q = filter.q?.trim();
  const like = q ? `%${escapeLike(q)}%` : null;
  const rows = await db.select({ log: auditLogs, actor: users.name, actorEmail: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(like ? or(ilike(auditLogs.action, like), ilike(auditLogs.entityType, like), ilike(users.email, like), ilike(auditLogs.entityId, like)) : undefined, filter.from ? gte(auditLogs.createdAt, filter.from) : undefined, filter.to ? lte(auditLogs.createdAt, filter.to) : undefined))
    .orderBy(desc(auditLogs.createdAt)).limit(pageSize + 1).offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}
export const listNotifications = (limit = 60) => db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
export const listPaymentsAdmin = (limit = 100) =>
  db.select({ payment: payments, orderNumber: orders.number, customer: orders.customerName }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).orderBy(desc(payments.createdAt)).limit(limit);
