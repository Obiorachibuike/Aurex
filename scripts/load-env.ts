/** Loads .env.local / .env the same way Next.js does, so CLI scripts and the app share one configuration. */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });
