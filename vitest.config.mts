import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5439/aurex_test",
      AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
      APP_URL: "http://localhost:3000",
      PAYSTACK_SECRET_KEY: "sk_test_fake_paystack_key",
      PAYSTACK_API_URL: "https://paystack.test",
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-fake",
      FLUTTERWAVE_WEBHOOK_HASH: "flw-webhook-hash",
      FLUTTERWAVE_API_URL: "https://flutterwave.test/v3",
      DISABLE_RATE_LIMIT: "false",
    },
  },
});
