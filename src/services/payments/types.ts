export type ProviderKey = "PAYSTACK" | "FLUTTERWAVE";

export type InitializeInput = {
  reference: string;
  /** Minor units (kobo). */
  amount: number;
  currency: string;
  email: string;
  customerName: string;
  phone: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

export type VerificationResult = {
  /** success = money captured. pending = still in progress. failed/abandoned = no money captured. */
  status: "success" | "failed" | "abandoned" | "pending";
  reference: string;
  /** Minor units as reported by the gateway. */
  amount: number;
  currency: string;
  transactionId: string | null;
  channel: string | null;
  paidAt: Date | null;
  message: string | null;
};

export type WebhookEvent = {
  /** Stable identifier used for idempotency. */
  eventKey: string;
  eventType: string;
  reference: string | null;
  /** Whether this event type should trigger a server-side verification. */
  isChargeEvent: boolean;
};

export interface PaymentGateway {
  provider: ProviderKey;
  label: string;
  isConfigured(): boolean;
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string }>;
  /** Server-to-server verification — the only source of truth for payment status. */
  verify(reference: string): Promise<VerificationResult>;
  /** Returns null when the signature is missing or wrong. */
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
  refund(input: { reference: string; transactionId: string | null; amount: number }): Promise<{ providerReference: string | null; status: string }>;
}

export class GatewayError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "GatewayError";
  }
}
