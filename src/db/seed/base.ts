import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { brands, categories, customerGroups, deviceModels, knowledgeDocuments, permissions, rolePermissions, roles, shippingMethods, shippingZones } from "@/db/schema";
import { PERMISSIONS, SYSTEM_ROLES, type RoleKey } from "@/lib/auth/permissions";
import { slugify } from "@/lib/utils";

/**
 * Base (production-safe) seed: roles, permissions, categories, device reference data,
 * starter shipping zones and starter policy/FAQ content. Idempotent — safe to re-run.
 * Review shipping fees and policy text in the admin dashboard before going live.
 */
export const CATEGORY_SEED: { name: string; slug: string; description: string; keywords: string[] }[] = [
  { name: "Screens & Displays", slug: "screens", description: "Replacement LCD and OLED display assemblies.", keywords: ["screen", "display", "lcd", "oled", "touch screen", "touchscreen", "amoled"] },
  { name: "Batteries", slug: "batteries", description: "Replacement phone batteries.", keywords: ["battery", "batteries", "cell"] },
  { name: "Charging Ports & Flex", slug: "charging-ports", description: "Charging ports, sub-boards and charging flex cables.", keywords: ["charging port", "charging flex", "charge port", "charging board", "sub board", "usb port", "charging pin", "charging system"] },
  { name: "Power & Volume Flex", slug: "button-flex", description: "Power button and volume button flex cables.", keywords: ["power button", "volume button", "power flex", "volume flex", "button flex", "on off flex"] },
  { name: "Camera Modules", slug: "cameras", description: "Front and rear camera modules and lenses.", keywords: ["camera", "back camera", "rear camera", "front camera", "camera lens", "camera module"] },
  { name: "Speakers & Microphones", slug: "audio", description: "Loudspeakers, earpieces and microphones.", keywords: ["speaker", "loudspeaker", "ringer", "buzzer", "earpiece", "microphone", "mic"] },
  { name: "Motherboards & Components", slug: "components", description: "Motherboards, ICs and board-level components.", keywords: ["motherboard", "board", "ic", "chip", "connector", "component", "panel"] },
  { name: "Housing & Frames", slug: "housing", description: "Back covers, housings and middle frames.", keywords: ["housing", "frame", "back cover", "back glass", "middle frame", "casing", "body"] },
  { name: "Screen Protectors", slug: "screen-protectors", description: "Tempered glass and film protectors.", keywords: ["screen protector", "screen guard", "tempered glass", "protector"] },
  { name: "Accessories", slug: "accessories", description: "Chargers, cables and other accessories.", keywords: ["charger", "cable", "usb cable", "adapter", "accessory", "accessories", "earphone", "power bank"] },
  { name: "Tools & Spare Parts", slug: "tools", description: "Repair tools, adhesives and other spares.", keywords: ["tool", "tools", "screwdriver", "adhesive", "glue", "opening tool", "repair kit"] },
];

export const BRAND_SEED = ["Samsung", "Apple", "Tecno", "Infinix", "Xiaomi", "itel", "AUREX"];

export const DEVICE_SEED: { brand: string; name: string; modelNumbers: string[]; aliases: string[] }[] = [
  { brand: "Samsung", name: "Galaxy A15 4G", modelNumbers: ["SM-A155F"], aliases: ["A15 4G", "A15", "Galaxy A15", "A15 LTE"] },
  { brand: "Samsung", name: "Galaxy A15 5G", modelNumbers: ["SM-A156B", "SM-A156E"], aliases: ["A15 5G", "A15", "Galaxy A15"] },
  { brand: "Samsung", name: "Galaxy A05", modelNumbers: ["SM-A055F"], aliases: ["A05"] },
  { brand: "Samsung", name: "Galaxy A14 4G", modelNumbers: ["SM-A145F"], aliases: ["A14 4G", "A14", "Galaxy A14"] },
  { brand: "Samsung", name: "Galaxy A14 5G", modelNumbers: ["SM-A146B"], aliases: ["A14 5G", "A14", "Galaxy A14"] },
  { brand: "Samsung", name: "Galaxy A25 5G", modelNumbers: ["SM-A256B"], aliases: ["A25", "A25 5G"] },
  { brand: "Samsung", name: "Galaxy S23", modelNumbers: ["SM-S911B"], aliases: ["S23"] },
  { brand: "Apple", name: "iPhone 11", modelNumbers: ["A2221"], aliases: ["iPhone11", "ip 11"] },
  { brand: "Apple", name: "iPhone 12", modelNumbers: ["A2403"], aliases: ["iPhone12", "ip 12"] },
  { brand: "Apple", name: "iPhone 13", modelNumbers: ["A2633"], aliases: ["iPhone13", "ip 13"] },
  { brand: "Apple", name: "iPhone XR", modelNumbers: ["A2105"], aliases: ["XR", "ip xr"] },
  { brand: "Tecno", name: "Spark 10", modelNumbers: ["KI5q"], aliases: ["Spark10"] },
  { brand: "Tecno", name: "Spark 20", modelNumbers: ["KJ5"], aliases: ["Spark20"] },
  { brand: "Tecno", name: "Camon 20", modelNumbers: ["CK6"], aliases: ["Camon20"] },
  { brand: "Infinix", name: "Hot 30", modelNumbers: ["X6831"], aliases: ["Hot30"] },
  { brand: "Infinix", name: "Hot 40i", modelNumbers: ["X6528"], aliases: ["Hot40i"] },
  { brand: "Infinix", name: "Note 30", modelNumbers: ["X6833B"], aliases: ["Note30"] },
  { brand: "Xiaomi", name: "Redmi Note 12 4G", modelNumbers: ["23021RAAEG"], aliases: ["Redmi Note 12", "Note 12 4G"] },
  { brand: "Xiaomi", name: "Redmi 13C", modelNumbers: ["23108RN04Y"], aliases: ["13C"] },
  { brand: "itel", name: "A70", modelNumbers: ["A665L"], aliases: ["itel A70"] },
];

const ZONES: { name: string; states: string[]; methods: { name: string; description: string; baseFee: number; perItemFee: number; freeAbove: number | null; eta: [number, number] }[] }[] = [
  {
    name: "Lagos",
    states: ["Lagos"],
    methods: [
      { name: "Lagos Standard Delivery", description: "Doorstep delivery within Lagos.", baseFee: 250000, perItemFee: 0, freeAbove: 15000000, eta: [1, 2] },
      { name: "Lagos Express (Same/Next Day)", description: "Priority dispatch rider for orders placed before 12 noon.", baseFee: 450000, perItemFee: 0, freeAbove: null, eta: [0, 1] },
    ],
  },
  { name: "South West", states: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"], methods: [{ name: "South West Standard Delivery", description: "Courier delivery to your address.", baseFee: 400000, perItemFee: 20000, freeAbove: null, eta: [2, 4] }] },
  { name: "Abuja (FCT)", states: ["FCT"], methods: [{ name: "Abuja Standard Delivery", description: "Courier delivery within the FCT.", baseFee: 450000, perItemFee: 20000, freeAbove: null, eta: [2, 4] }] },
  { name: "Rest of Nigeria", states: ["*"], methods: [{ name: "Nationwide Standard Delivery", description: "Courier delivery to your address or nearest terminal.", baseFee: 550000, perItemFee: 30000, freeAbove: null, eta: [3, 6] }] },
];

export const KNOWLEDGE_SEED: { slug: string; title: string; type: "FAQ" | "POLICY" | "BUSINESS" | "WHOLESALE"; content: string }[] = [
  {
    slug: "about",
    title: "About AUREX",
    type: "BUSINESS",
    content:
      "AUREX is a mobile technologies and electronics components brand owned by KodexTeck. We supply smartphone replacement parts — screens, batteries, charging ports, flex cables, camera modules, speakers, housings — plus screen protectors, accessories and board-level components to repair technicians, retailers and individual customers across Nigeria.\n\nEvery part is listed against the exact phone models it fits, so you can order with confidence. Our tagline is Built for Performance.",
  },
  {
    slug: "shipping",
    title: "Shipping Information",
    type: "POLICY",
    content:
      "We deliver nationwide across Nigeria.\n\nDelivery fees and estimated delivery times depend on your state and the delivery method you choose. The exact fee and delivery window for your address are always shown at checkout before you pay, and our assistant can look them up for you.\n\nOrders are dispatched after payment has been confirmed. Orders confirmed before 12 noon on a business day are normally dispatched the same day. You will receive an email when your order is processed, shipped and delivered, and you can follow progress on the order tracking page with your order number and email address.\n\nPlease make sure someone is available to receive the parcel and that your phone number is reachable.",
  },
  {
    slug: "returns",
    title: "Return & Refund Policy",
    type: "POLICY",
    content:
      "You can request a return within 7 days of delivery if the item is unused, uninstalled and in its original packaging with protective films and seals intact.\n\nItems that arrive damaged, defective or different from what you ordered will be replaced or refunded in full, including delivery costs. Please report these within 48 hours of delivery with photos.\n\nParts that have been installed, soldered, had their films removed or show physical or liquid damage cannot be returned unless they fail under warranty.\n\nTo start, open your order page and choose \"Request refund\", or contact support with your order number. Approved refunds are sent to your original payment method; banks usually take 3–10 business days to reflect them.",
  },
  {
    slug: "warranty",
    title: "Warranty Policy",
    type: "POLICY",
    content:
      "Each product page states the warranty period for that item. The warranty covers manufacturing defects such as dead pixels, touch failure, lines on the display, or a battery that will not hold charge under normal use.\n\nThe warranty does not cover cracked or broken parts, liquid damage, torn flex cables, burn marks from incorrect installation, or damage caused by an unqualified repair.\n\nWe recommend testing every part before fully installing it and before removing protective films. To make a warranty claim, contact support with your order number, a description of the fault and photos or a short video.",
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    type: "POLICY",
    content:
      "We collect the information needed to run your account and deliver your orders: your name, email address, phone number, delivery addresses, order history and messages you send to our support team or shopping assistant.\n\nPayments are processed by our payment partners (Paystack and Flutterwave). AUREX never sees or stores your full card details.\n\nWe use your information to process orders, provide customer support, prevent fraud and — only if you opt in — send you offers. We do not sell your personal information. We share it only with service providers who help us operate (payments, delivery, email) and when the law requires.\n\nYou may request a copy, correction or deletion of your personal data by contacting support. We handle personal data in line with the Nigeria Data Protection Act.",
  },
  {
    slug: "terms",
    title: "Terms & Conditions",
    type: "POLICY",
    content:
      "By using the AUREX website and placing an order you agree to these terms.\n\nPrices are shown in Nigerian Naira and may change without notice; the price confirmed at checkout applies to your order. An order is accepted once payment has been verified. If an item becomes unavailable after payment we will offer a replacement or a full refund.\n\nIt is your responsibility to confirm that a part matches your exact phone model before ordering; compatibility is listed on each product page and our team is glad to help. Installation of replacement parts should be carried out by a qualified technician.\n\nWholesale pricing is available only to approved wholesale accounts and may not be shared. AUREX is a KodexTeck company. These terms are governed by the laws of the Federal Republic of Nigeria.",
  },
  {
    slug: "wholesale-policy",
    title: "Wholesale Purchasing",
    type: "WHOLESALE",
    content:
      "AUREX offers wholesale pricing to repair shops, retailers and distributors.\n\nHow it works: create an account, submit a wholesale application with your business details, and our team will review it. Once approved, wholesale prices appear automatically when you are signed in.\n\nEach product has a minimum wholesale quantity; the wholesale price applies when you order at least that quantity of the item. Larger quantities can unlock additional bulk discounts, shown on the product page for approved accounts.\n\nWholesale prices are not visible to retail customers or guests, and the assistant can only quote them to signed-in, approved wholesale accounts.",
  },
  { slug: "faq-payment-methods", title: "What payment methods do you accept?", type: "FAQ", content: "We accept debit and credit cards, bank transfer and other local payment options through our secure payment partners, Paystack and Flutterwave. All prices are in Nigerian Naira (NGN). Your order is confirmed only after the payment provider has verified your payment." },
  { slug: "faq-compatibility", title: "How do I know a part fits my phone?", type: "FAQ", content: "Every product lists the exact phone models it is compatible with. Search by your phone model (for example \"Samsung Galaxy A15 4G\") or ask our shopping assistant. Some models have 4G and 5G versions that use different parts — check your model number in Settings > About phone if you are not sure." },
  { slug: "faq-quality-grades", title: "What do the quality grades mean?", type: "FAQ", content: "Original / Service Pack parts are made by or for the phone manufacturer. OLED (aftermarket) screens use OLED panels from third-party factories with colours close to original. Incell and TFT screens are budget LCD alternatives: reliable, but with lower brightness and contrast than OLED. High Capacity and Standard describe battery grades. The grade is shown on each product." },
  { slug: "faq-order-tracking", title: "How can I track my order?", type: "FAQ", content: "Use the Track Order page with your order number (it starts with AUR-) and the email address you used at checkout. If you have an account, all your orders are under My Account > Orders. Our assistant can also check an order's status when you are signed in or provide the order number and email." },
  { slug: "faq-cancel-order", title: "Can I cancel or change my order?", type: "FAQ", content: "You can cancel an order yourself from the order page any time before it is paid. Once an order has been paid, contact support as soon as possible; if it has not been dispatched we can cancel and refund it. Otherwise our return policy applies." },
  { slug: "faq-installation", title: "Do you install the parts?", type: "FAQ", content: "AUREX supplies parts; we do not currently offer an installation service. We recommend installation by a qualified phone technician, and testing each part before final assembly." },
  { slug: "faq-contact", title: "How do I contact support?", type: "FAQ", content: "You can reach our support team through the Contact page, by replying to any order email, or by asking the shopping assistant to connect you to a human agent. Support hours are Monday to Saturday, 9am to 6pm (WAT)." },
];

export async function seedBase(db: Db): Promise<void> {
  // Roles & permissions
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.insert(permissions).values({ key, description }).onConflictDoUpdate({ target: permissions.key, set: { description } });
  }
  const permRows = await db.select().from(permissions);
  for (const [key, def] of Object.entries(SYSTEM_ROLES) as [RoleKey, (typeof SYSTEM_ROLES)[RoleKey]][]) {
    const [role] = await db.insert(roles).values({ key, name: def.name, description: def.description, isStaff: def.isStaff }).onConflictDoUpdate({ target: roles.key, set: { name: def.name, description: def.description, isStaff: def.isStaff } }).returning();
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
    const ids = permRows.filter((p) => (def.permissions as string[]).includes(p.key)).map((p) => ({ roleId: role!.id, permissionId: p.id }));
    if (ids.length) await db.insert(rolePermissions).values(ids);
  }
  await db.insert(customerGroups).values({ name: "Standard Wholesale", description: "Default group for approved wholesale buyers." }).onConflictDoNothing();
  await db.insert(customerGroups).values({ name: "Distributor", description: "High-volume partners with additional bulk pricing." }).onConflictDoNothing();

  // Catalogue reference data
  for (const [i, c] of CATEGORY_SEED.entries()) await db.insert(categories).values({ ...c, sortOrder: i }).onConflictDoNothing({ target: categories.slug });
  for (const b of BRAND_SEED) await db.insert(brands).values({ name: b, slug: slugify(b) }).onConflictDoNothing();
  const brandRows = await db.select().from(brands).where(inArray(brands.name, BRAND_SEED));
  for (const d of DEVICE_SEED) {
    const brand = brandRows.find((b) => b.name === d.brand)!;
    await db.insert(deviceModels).values({ brandId: brand.id, name: d.name, slug: slugify(`${d.brand} ${d.name}`), modelNumbers: d.modelNumbers, aliases: d.aliases }).onConflictDoNothing({ target: deviceModels.slug });
  }

  // Shipping (only when nothing is configured yet)
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(shippingZones);
  if (n === 0) {
    for (const z of ZONES) {
      const [zone] = await db.insert(shippingZones).values({ name: z.name, states: z.states }).returning();
      await db.insert(shippingMethods).values(z.methods.map((m) => ({ zoneId: zone!.id, name: m.name, description: m.description, baseFee: m.baseFee, perItemFee: m.perItemFee, freeAbove: m.freeAbove, etaMinDays: m.eta[0], etaMaxDays: m.eta[1] })));
    }
  }

  // Knowledge base — never overwrites edits made in the admin dashboard
  for (const [i, k] of KNOWLEDGE_SEED.entries()) await db.insert(knowledgeDocuments).values({ ...k, sortOrder: i }).onConflictDoNothing({ target: knowledgeDocuments.slug });
}
