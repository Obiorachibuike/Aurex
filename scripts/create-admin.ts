import "./load-env";
import { eq, sql } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { passwordSchema } from "../src/lib/validation";
import { createUser, setUserRole } from "../src/services/auth";

/** Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' ADMIN_NAME='Your Name' npm run admin:create */
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Administrator";
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD.");
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(`Weak password: ${check.error.issues[0]?.message}`);
  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (existing) {
    await db.update(users).set({ passwordHash: await hashPassword(password), emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), isSuspended: false }).where(eq(users.id, existing.id));
    await setUserRole(existing.id, "super_admin");
    console.log(`Updated ${email}: password reset and promoted to super administrator.`);
  } else {
    const user = await createUser({ name, email, password, emailVerified: true });
    await setUserRole(user.id, "super_admin");
    console.log(`Created super administrator ${email}.`);
  }
  await closeDb();
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
