import type { SessionUser } from "../auth";

export type ChatAttachment =
  | { type: "products"; items: ProductAttachment[]; device?: string | null }
  | { type: "options"; options: { label: string; value: string }[] }
  | { type: "cart"; lines: LineAttachment[]; subtotal: number; itemCount: number }
  | { type: "order_summary"; lines: LineAttachment[]; subtotal: number; discount: number; shipping: number; tax: number; total: number; deliverTo: string; shippingMethod: string; eta: string; contact: string }
  | { type: "payment"; orderNumber: string; total: number; paymentUrl: string | null; orderUrl: string }
  | { type: "order_status"; orderNumber: string; status: string; statusLabel: string; total: number; orderUrl: string | null }
  | { type: "handoff"; ticketNumber: string };

export type ProductAttachment = {
  productId: string;
  variantId: string | null;
  slug: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  qualityGrade: string | null;
  price: number;
  available: number;
  inStock: boolean;
  warrantyMonths: number;
};
export type LineAttachment = { variantId: string; name: string; variantName: string; quantity: number; unitPrice: number; lineTotal: number; imageUrl: string | null };

export type CheckoutDraft = {
  name?: string;
  email?: string;
  phone?: string;
  line1?: string;
  city?: string;
  state?: string;
  shippingMethodId?: string;
  shippingOptions?: { id: string; name: string }[];
  usedSavedAddress?: boolean;
};

/** Server-owned conversation state. The model can read summaries of it but never writes it. */
export type ConversationState = {
  focus?: { options: { productId: string; variantId: string; label: string; grade: string | null }[]; device?: string | null };
  pending?: { kind: "device"; candidateIds: string[]; categoryId: string | null; text: string } | { kind: "choose_product"; quantity: number | null };
  checkout?: CheckoutDraft & { awaiting?: "name" | "email" | "phone" | "line1" | "city" | "state" | "shipping" | "confirm" | "order_email" };
  /** Order summary shown to the customer and waiting for their explicit confirmation. */
  quote?: { hash: string; args: Record<string, unknown>; createdAt: number };
  /** Set ONLY by a customer action (confirm button or an affirmative message), never by the model. */
  confirmedHash?: string;
  lastOrderNumber?: string;
  pendingOrderLookup?: string;
};

export type ToolContext = {
  conversationId: string;
  user: SessionUser | null;
  state: ConversationState;
  orderingEnabled: boolean;
  /** Returns the customer's cart id; creates the cart (and its cookie) when `create` is true. */
  getCartId(create: boolean): Promise<string | null>;
};

export type ToolResult = { ok: boolean; data: unknown; attachments?: ChatAttachment[]; status?: "OK" | "DENIED" | "INVALID" | "ERROR" };
