import { z } from "zod";
import { NIGERIAN_STATES, normalizeNigerianPhone } from "./nigeria";

export const emailSchema = z.string().trim().toLowerCase().min(3, "Enter your email address").max(254).email("Enter a valid email address");
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Include at least one letter and one number");
export const nameSchema = z.string().trim().min(2, "Enter your full name").max(100);
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Enter your phone number")
  .refine((v) => normalizeNigerianPhone(v) !== null, "Enter a valid Nigerian mobile number, e.g. 0803 123 4567");
export const stateSchema = z.enum(NIGERIAN_STATES, { message: "Select a state" });

export const addressSchema = z.object({
  fullName: nameSchema,
  phone: phoneSchema,
  line1: z.string().trim().min(5, "Enter the street address").max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(2, "Enter the city or town").max(80),
  state: stateSchema,
});
export type AddressInput = z.infer<typeof addressSchema>;

export const checkoutSchema = addressSchema.extend({
  email: emailSchema,
  shippingMethodId: z.string().uuid("Select a delivery method"),
  provider: z.enum(["PAYSTACK", "FLUTTERWAVE"]).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  saveAddress: z.boolean().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const registerSchema = z.object({ name: nameSchema, email: emailSchema, phone: phoneSchema.optional().or(z.literal("")), password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(128) });

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = i.path.join(".");
    if (k && !out[k]) out[k] = i.message;
  }
  return out;
}
