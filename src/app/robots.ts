import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/account", "/checkout", "/cart", "/orders/", "/dev/", "/login", "/register", "/reset-password", "/verify-email"] }], sitemap: `${env.appUrl}/sitemap.xml` };
}
