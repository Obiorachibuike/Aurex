/** Server-side environment access. Never import this from client components. */
export const env = {
  get appUrl(): string {
    const url = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    return url.replace(/\/$/, "");
  },
  get authSecret(): string {
    const s = process.env.AUTH_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === "production" && !process.env.AUREX_ALLOW_WEAK_SECRET) {
        throw new Error("AUTH_SECRET must be set to at least 32 characters in production.");
      }
      return s ?? "development-only-secret-do-not-use-in-production";
    }
    return s;
  },
  get isProduction(): boolean {
    return process.env.VERCEL_ENV ? process.env.VERCEL_ENV === "production" : process.env.NODE_ENV === "production";
  },
  paystack: {
    get secretKey() { return process.env.PAYSTACK_SECRET_KEY ?? ""; },
    get publicKey() { return process.env.PAYSTACK_PUBLIC_KEY ?? ""; },
    get apiUrl() { return (process.env.PAYSTACK_API_URL ?? "https://api.paystack.co").replace(/\/$/, ""); },
  },
  flutterwave: {
    get secretKey() { return process.env.FLUTTERWAVE_SECRET_KEY ?? ""; },
    get publicKey() { return process.env.FLUTTERWAVE_PUBLIC_KEY ?? ""; },
    get webhookHash() { return process.env.FLUTTERWAVE_WEBHOOK_HASH ?? ""; },
    get apiUrl() { return (process.env.FLUTTERWAVE_API_URL ?? "https://api.flutterwave.com/v3").replace(/\/$/, ""); },
  },
  /**
   * Development-only Paystack simulator (see src/app/api/dev/paystack-sim).
   * Hard-disabled on Vercel production deployments regardless of the flag.
   */
  get paymentSimulatorEnabled(): boolean {
    return process.env.ENABLE_PAYMENT_SIMULATOR === "true" && process.env.VERCEL_ENV !== "production";
  },
  ai: {
    get agnesKey() { return process.env.AGNES_API_KEY ?? ""; },
    get agnesUrl() { return (process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1").replace(/\/$/, ""); },
    get openaiKey() { return process.env.OPENAI_API_KEY ?? ""; },
    get openaiUrl() { return (process.env.OPENAI_API_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""); },
    get customKey() { return process.env.AI_CUSTOM_API_KEY ?? ""; },
  },
  resend: {
    get apiKey() { return process.env.RESEND_API_KEY ?? ""; },
    get from() { return process.env.EMAIL_FROM ?? "AUREX <orders@aurex.ng>"; },
  },
  whatsapp: {
    get accessToken() { return process.env.WHATSAPP_ACCESS_TOKEN ?? ""; },
    get phoneNumberId() { return process.env.WHATSAPP_PHONE_NUMBER_ID ?? ""; },
    get businessAccountId() { return process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? ""; },
    get apiVersion() { return process.env.WHATSAPP_API_VERSION ?? "v21.0"; },
    get appSecret() { return process.env.WHATSAPP_APP_SECRET ?? ""; },
  },
  cloudinary: {
    get cloudName() { return process.env.CLOUDINARY_CLOUD_NAME ?? ""; },
    get apiKey() { return process.env.CLOUDINARY_API_KEY ?? ""; },
    get apiSecret() { return process.env.CLOUDINARY_API_SECRET ?? ""; },
  },
  redis: {
    get restUrl() { return process.env.UPSTASH_REDIS_REST_URL ?? ""; },
    get restToken() { return process.env.UPSTASH_REDIS_REST_TOKEN ?? ""; },
  },
  get cronSecret() { return process.env.CRON_SECRET ?? ""; },
  get sentryDsn() { return process.env.SENTRY_DSN ?? ""; },
};
