"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { bool, optStr, runAction, str, type ActionState } from "@/lib/action";
import { getClientIp, requireUserAction } from "@/lib/auth/session";
import { UnauthorizedError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getViewer } from "@/lib/viewer";
import { applyForWholesale, createSupportTicket, deleteAddress, saveAddress, submitReview, subscribeNewsletter, toggleWishlist, updateProfile } from "@/services/account";

export async function updateProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUserAction();
    await updateProfile(user.id, { name: str(fd, "name"), phone: str(fd, "phone"), marketingOptIn: bool(fd, "marketingOptIn"), orderUpdatesByEmail: bool(fd, "orderUpdatesByEmail"), primaryDevice: optStr(fd, "primaryDevice") });
    revalidatePath("/account", "layout");
    return { message: "Profile saved" };
  });
}

export async function saveAddressAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUserAction();
    await saveAddress(user.id, { fullName: str(fd, "fullName"), phone: str(fd, "phone"), line1: str(fd, "line1"), line2: str(fd, "line2"), city: str(fd, "city"), state: str(fd, "state") as never, label: optStr(fd, "label"), isDefault: bool(fd, "isDefault") }, optStr(fd, "id"));
    revalidatePath("/account/addresses");
    return { message: "Address saved" };
  });
}

export async function deleteAddressAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUserAction();
    await deleteAddress(user.id, z.string().uuid().parse(str(fd, "id")));
    revalidatePath("/account/addresses");
    return { message: "Address removed" };
  });
}

export async function toggleWishlistAction(productId: string): Promise<ActionState<{ saved: boolean }>> {
  return runAction(async () => {
    const { user } = await getViewer();
    if (!user) throw new UnauthorizedError("Sign in to save items to your wishlist.");
    const saved = await toggleWishlist(user.id, z.string().uuid().parse(productId));
    revalidatePath("/account/wishlist");
    return { message: saved ? "Saved to your wishlist" : "Removed from your wishlist", data: { saved } };
  });
}

export async function submitReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUserAction();
    await enforceRateLimit(`review:${user.id}`, 10, 3600);
    await submitReview(user, { productId: str(fd, "productId"), rating: str(fd, "rating"), title: optStr(fd, "title"), body: str(fd, "body") });
    return { message: "Thank you! Your review will appear once it has been approved." };
  });
}

export async function newsletterAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await enforceRateLimit(`newsletter:${await getClientIp()}`, 5, 3600);
    await subscribeNewsletter(str(fd, "email"));
    return { message: "You're subscribed. Watch your inbox for new arrivals and offers." };
  });
}

export async function wholesaleApplyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUserAction();
    await enforceRateLimit(`wholesale:${user.id}`, 5, 3600);
    await applyForWholesale(user.id, { businessName: str(fd, "businessName"), businessType: str(fd, "businessType"), registrationNumber: optStr(fd, "registrationNumber"), phone: str(fd, "phone"), address: str(fd, "address"), state: str(fd, "state") as never, expectedMonthlyVolume: optStr(fd, "expectedMonthlyVolume"), notes: optStr(fd, "notes") });
    revalidatePath("/account", "layout");
    return { message: "Application submitted. We usually respond within 2 business days." };
  });
}

export async function contactAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await enforceRateLimit(`contact:${await getClientIp()}`, 5, 3600, "You have sent several messages recently. Please wait a while before sending another.");
    if (str(fd, "company")) return { message: "Thanks — message received." }; // honeypot field, filled only by bots
    const { user } = await getViewer();
    const number = await createSupportTicket({ name: str(fd, "name"), email: str(fd, "email"), phone: optStr(fd, "phone"), subject: str(fd, "subject"), message: str(fd, "message") }, user?.id ?? null);
    return { message: `Message received. Your reference is ${number} — we'll reply by email.` };
  });
}
