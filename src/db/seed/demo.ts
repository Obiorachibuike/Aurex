import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { brands, categories, coupons, customerGroups, customerProfiles, deviceModels, inventory, inventoryMovements, productCompatibility, productImages, productVariants, products, reviews, users, wholesalePriceRules } from "@/db/schema";
import { slugify } from "@/lib/utils";
import { createUser, setUserRole } from "@/services/auth";

/**
 * DEMO DATA — for development and staging only. Every product and review is flagged is_demo
 * so `npm run db:seed -- --purge-demo` can remove them before real inventory is loaded.
 */
type V = { sku: string; name?: string; retail: number; compareAt?: number; wholesale?: number; minQty?: number; stock: number; attrs?: Record<string, string> };
type P = { name: string; cat: string; brand: string; grade?: string; warranty: number; img: string; devices: string[]; universal?: boolean; featured?: boolean; sold?: number; specs: Record<string, string>; desc: string; variants: V[]; daysAgo?: number };

const N = (naira: number) => naira * 100;

const DEMO_PRODUCTS: P[] = [
  { name: "Samsung Galaxy A15 4G Display Assembly — Service Pack", cat: "screens", brand: "Samsung", grade: "Original (Service Pack)", warranty: 6, img: "screen", devices: ["Samsung Galaxy A15 4G"], featured: true, sold: 184, specs: { "Panel type": "Super AMOLED", Size: "6.5 inch", Resolution: "1080 × 2340", Frame: "Included", "Refresh rate": "90Hz" }, desc: "Genuine service-pack Super AMOLED display with frame for the Galaxy A15 4G (SM-A155F). Factory colour calibration and full touch response.", variants: [{ sku: "AUR-SCR-A154G-SP", retail: N(38500), compareAt: N(42000), wholesale: N(34000), minQty: 5, stock: 24 }] },
  { name: "Samsung Galaxy A15 4G Display — OLED", cat: "screens", brand: "AUREX", grade: "OLED (Aftermarket)", warranty: 3, img: "screen", devices: ["Samsung Galaxy A15 4G"], sold: 131, specs: { "Panel type": "OLED", Size: "6.5 inch", Frame: "Not included" }, desc: "High-quality aftermarket OLED panel for the Galaxy A15 4G with vivid colour and fingerprint support.", variants: [{ sku: "AUR-SCR-A154G-OL", retail: N(24500), wholesale: N(21000), minQty: 5, stock: 40 }] },
  { name: "Samsung Galaxy A15 4G Display — Incell", cat: "screens", brand: "AUREX", grade: "Incell (Budget)", warranty: 1, img: "screen", devices: ["Samsung Galaxy A15 4G"], sold: 96, specs: { "Panel type": "Incell LCD", Size: "6.5 inch", Frame: "Not included" }, desc: "Budget-friendly Incell LCD replacement for the Galaxy A15 4G. Reliable touch; lower contrast than OLED.", variants: [{ sku: "AUR-SCR-A154G-IN", retail: N(14500), wholesale: N(12000), minQty: 10, stock: 60 }] },
  { name: "Samsung Galaxy A15 5G Display Assembly — Service Pack", cat: "screens", brand: "Samsung", grade: "Original (Service Pack)", warranty: 6, img: "screen", devices: ["Samsung Galaxy A15 5G"], sold: 72, specs: { "Panel type": "Super AMOLED", Size: "6.5 inch", Frame: "Included" }, desc: "Genuine service-pack display with frame for the Galaxy A15 5G (SM-A156B). Not compatible with the A15 4G.", variants: [{ sku: "AUR-SCR-A155G-SP", retail: N(41000), wholesale: N(36500), minQty: 5, stock: 12 }] },
  { name: "Samsung Galaxy A14 Display — Incell (4G/5G)", cat: "screens", brand: "AUREX", grade: "Incell (Budget)", warranty: 1, img: "screen", devices: ["Samsung Galaxy A14 4G", "Samsung Galaxy A14 5G"], sold: 110, specs: { "Panel type": "PLS LCD", Size: "6.6 inch" }, desc: "LCD replacement that fits both the Galaxy A14 4G and A14 5G.", variants: [{ sku: "AUR-SCR-A14-IN", retail: N(13500), wholesale: N(11200), minQty: 10, stock: 35 }] },
  { name: "iPhone 11 Display Assembly", cat: "screens", brand: "AUREX", warranty: 3, img: "screen", devices: ["Apple iPhone 11"], featured: true, sold: 240, specs: { Size: "6.1 inch", "3D touch plate": "Pre-installed" }, desc: "Replacement display assembly for iPhone 11, available in two quality grades.", variants: [
    { sku: "AUR-SCR-IP11-IN", name: "Incell", retail: N(16500), wholesale: N(14000), minQty: 10, stock: 55, attrs: { Grade: "Incell" } },
    { sku: "AUR-SCR-IP11-OR", name: "Original Refurbished", retail: N(34000), wholesale: N(30500), minQty: 5, stock: 14, attrs: { Grade: "Original Refurbished" } },
  ] },
  { name: "iPhone 13 Display — Soft OLED", cat: "screens", brand: "AUREX", grade: "OLED (Aftermarket)", warranty: 3, img: "screen", devices: ["Apple iPhone 13"], sold: 88, daysAgo: 4, specs: { "Panel type": "Soft OLED", Size: "6.1 inch" }, desc: "Soft OLED replacement for iPhone 13 with true-tone data transfer support.", variants: [{ sku: "AUR-SCR-IP13-OL", retail: N(52000), compareAt: N(58000), wholesale: N(47000), minQty: 5, stock: 9 }] },
  { name: "Tecno Spark 10 Display", cat: "screens", brand: "Tecno", grade: "Original", warranty: 3, img: "screen", devices: ["Tecno Spark 10"], sold: 150, specs: { "Panel type": "IPS LCD", Size: "6.6 inch" }, desc: "Original-quality IPS LCD for Tecno Spark 10 (KI5q).", variants: [{ sku: "AUR-SCR-SPK10", retail: N(12500), wholesale: N(10300), minQty: 10, stock: 48 }] },
  { name: "Infinix Hot 30 Display", cat: "screens", brand: "Infinix", grade: "Original", warranty: 3, img: "screen", devices: ["Infinix Hot 30"], sold: 122, specs: { "Panel type": "IPS LCD", Size: "6.78 inch" }, desc: "Original-quality IPS LCD for Infinix Hot 30 (X6831).", variants: [{ sku: "AUR-SCR-HOT30", retail: N(13800), wholesale: N(11500), minQty: 10, stock: 0 }] },
  { name: "Redmi Note 12 4G Display — OLED", cat: "screens", brand: "AUREX", grade: "OLED (Aftermarket)", warranty: 3, img: "screen", devices: ["Xiaomi Redmi Note 12 4G"], sold: 44, daysAgo: 2, specs: { "Panel type": "OLED", Size: "6.67 inch" }, desc: "OLED replacement display for Redmi Note 12 4G.", variants: [{ sku: "AUR-SCR-RN12-OL", retail: N(27500), wholesale: N(24000), minQty: 5, stock: 18 }] },

  { name: "Samsung Galaxy A15 Battery (4G/5G)", cat: "batteries", brand: "Samsung", grade: "Original", warranty: 6, img: "battery", devices: ["Samsung Galaxy A15 4G", "Samsung Galaxy A15 5G"], featured: true, sold: 205, specs: { Capacity: "5000mAh", Model: "EB-BA156ABY" }, desc: "Original-specification 5000mAh battery that fits both the Galaxy A15 4G and A15 5G.", variants: [{ sku: "AUR-BAT-A15", retail: N(9500), wholesale: N(7800), minQty: 10, stock: 80 }] },
  { name: "iPhone 11 Battery — High Capacity", cat: "batteries", brand: "AUREX", grade: "High Capacity", warranty: 6, img: "battery", devices: ["Apple iPhone 11"], sold: 260, specs: { Capacity: "3510mAh", "Cycle count": "0" }, desc: "High-capacity replacement battery for iPhone 11 with zero cycle count.", variants: [{ sku: "AUR-BAT-IP11-HC", retail: N(11500), compareAt: N(13000), wholesale: N(9400), minQty: 10, stock: 64 }] },
  { name: "iPhone XR Battery", cat: "batteries", brand: "AUREX", grade: "Standard", warranty: 3, img: "battery", devices: ["Apple iPhone XR"], sold: 140, specs: { Capacity: "2942mAh" }, desc: "Standard-capacity replacement battery for iPhone XR.", variants: [{ sku: "AUR-BAT-IPXR", retail: N(8500), wholesale: N(6900), minQty: 10, stock: 3 }] },
  { name: "Tecno Spark 10 / Spark 20 Battery", cat: "batteries", brand: "Tecno", grade: "Original", warranty: 6, img: "battery", devices: ["Tecno Spark 10", "Tecno Spark 20"], sold: 170, specs: { Capacity: "5000mAh", Model: "BL-49GT" }, desc: "5000mAh battery compatible with Tecno Spark 10 and Spark 20.", variants: [{ sku: "AUR-BAT-SPK", retail: N(6500), wholesale: N(5200), minQty: 10, stock: 90 }] },
  { name: "Infinix Hot 30 / Hot 40i Battery", cat: "batteries", brand: "Infinix", grade: "Original", warranty: 6, img: "battery", devices: ["Infinix Hot 30", "Infinix Hot 40i"], sold: 118, specs: { Capacity: "5000mAh", Model: "BL-49FX" }, desc: "5000mAh battery compatible with Infinix Hot 30 and Hot 40i.", variants: [{ sku: "AUR-BAT-HOT", retail: N(6800), wholesale: N(5400), minQty: 10, stock: 70 }] },

  { name: "Samsung Galaxy A15 4G Charging Port Board", cat: "charging-ports", brand: "AUREX", grade: "Original", warranty: 3, img: "charging-flex", devices: ["Samsung Galaxy A15 4G"], sold: 132, specs: { Connector: "USB Type-C", "Fast charging": "Supported", Includes: "Microphone, headphone jack" }, desc: "Charging sub-board for the Galaxy A15 4G with fast-charging IC.", variants: [{ sku: "AUR-CHG-A154G", retail: N(4500), wholesale: N(3500), minQty: 10, stock: 75 }] },
  { name: "Samsung Galaxy A15 5G Charging Port Board", cat: "charging-ports", brand: "AUREX", grade: "Original", warranty: 3, img: "charging-flex", devices: ["Samsung Galaxy A15 5G"], sold: 51, specs: { Connector: "USB Type-C", "Fast charging": "Supported" }, desc: "Charging sub-board for the Galaxy A15 5G. Not interchangeable with the 4G board.", variants: [{ sku: "AUR-CHG-A155G", retail: N(4800), wholesale: N(3800), minQty: 10, stock: 30 }] },
  { name: "iPhone 11 Charging Port Flex", cat: "charging-ports", brand: "AUREX", grade: "Original", warranty: 3, img: "charging-flex", devices: ["Apple iPhone 11"], sold: 99, specs: { Connector: "Lightning", Includes: "Microphones" }, desc: "Lightning charging flex with microphones for iPhone 11.", variants: [{ sku: "AUR-CHG-IP11-BK", name: "Black", retail: N(6500), wholesale: N(5300), minQty: 10, stock: 40, attrs: { Colour: "Black" } }, { sku: "AUR-CHG-IP11-WH", name: "White", retail: N(6500), wholesale: N(5300), minQty: 10, stock: 22, attrs: { Colour: "White" } }] },
  { name: "Tecno Spark 10 Charging Port Board", cat: "charging-ports", brand: "AUREX", grade: "Original", warranty: 3, img: "charging-flex", devices: ["Tecno Spark 10"], sold: 77, specs: { Connector: "USB Type-C" }, desc: "Charging sub-board for Tecno Spark 10.", variants: [{ sku: "AUR-CHG-SPK10", retail: N(3000), wholesale: N(2300), minQty: 10, stock: 65 }] },

  { name: "Samsung Galaxy A15 Power & Volume Flex (4G/5G)", cat: "button-flex", brand: "AUREX", grade: "Original", warranty: 3, img: "button-flex", devices: ["Samsung Galaxy A15 4G", "Samsung Galaxy A15 5G"], sold: 40, specs: { Includes: "Power and volume switches" }, desc: "Side-key flex cable with power and volume switches for Galaxy A15 4G and 5G.", variants: [{ sku: "AUR-FLX-A15-PV", retail: N(2500), wholesale: N(1900), minQty: 10, stock: 50 }] },
  { name: "iPhone 12 Power Button Flex", cat: "button-flex", brand: "AUREX", grade: "Original", warranty: 3, img: "button-flex", devices: ["Apple iPhone 12"], sold: 28, specs: { Includes: "Power switch, flash, microphone" }, desc: "Power button flex with flash and microphone for iPhone 12.", variants: [{ sku: "AUR-FLX-IP12-PW", retail: N(4200), wholesale: N(3400), minQty: 10, stock: 26 }] },

  { name: "Samsung Galaxy A15 4G Rear Camera (50MP)", cat: "cameras", brand: "Samsung", grade: "Original", warranty: 3, img: "camera", devices: ["Samsung Galaxy A15 4G"], sold: 22, specs: { Resolution: "50MP", Position: "Rear main" }, desc: "Original 50MP main rear camera module for the Galaxy A15 4G.", variants: [{ sku: "AUR-CAM-A154G-R", retail: N(11500), wholesale: N(9800), minQty: 5, stock: 15 }] },
  { name: "iPhone 11 Rear Camera Module", cat: "cameras", brand: "Apple", grade: "Original Pulled", warranty: 3, img: "camera", devices: ["Apple iPhone 11"], sold: 35, specs: { Resolution: "12MP + 12MP", Position: "Rear dual" }, desc: "Original pulled dual rear camera module for iPhone 11.", variants: [{ sku: "AUR-CAM-IP11-R", retail: N(21000), wholesale: N(18500), minQty: 5, stock: 8 }] },

  { name: "Samsung Galaxy A15 Loudspeaker (4G/5G)", cat: "audio", brand: "AUREX", grade: "Original", warranty: 3, img: "speaker", devices: ["Samsung Galaxy A15 4G", "Samsung Galaxy A15 5G"], sold: 33, specs: { Type: "Loudspeaker / ringer" }, desc: "Loudspeaker module for Galaxy A15 4G and 5G.", variants: [{ sku: "AUR-SPK-A15", retail: N(2800), wholesale: N(2100), minQty: 10, stock: 44 }] },
  { name: "iPhone 11 Earpiece Speaker with Sensor Flex", cat: "audio", brand: "AUREX", grade: "Original", warranty: 3, img: "speaker", devices: ["Apple iPhone 11"], sold: 30, specs: { Type: "Earpiece + proximity sensor flex" }, desc: "Earpiece speaker with sensor flex for iPhone 11.", variants: [{ sku: "AUR-SPK-IP11-E", retail: N(5500), wholesale: N(4500), minQty: 10, stock: 20 }] },

  { name: "USB Type-C Charging Connector (10-pack)", cat: "components", brand: "AUREX", warranty: 0, img: "chip", devices: [], universal: true, sold: 60, specs: { Pins: "16-pin", Pack: "10 pieces" }, desc: "Board-level USB-C charging connectors for technicians. Universal 16-pin footprint.", variants: [{ sku: "AUR-CMP-USBC-10", retail: N(3500), wholesale: N(2700), minQty: 5, stock: 120 }] },
  { name: "Charging IC — SM5714 (Samsung A-series)", cat: "components", brand: "AUREX", warranty: 0, img: "chip", devices: ["Samsung Galaxy A15 4G", "Samsung Galaxy A14 4G", "Samsung Galaxy A25 5G"], sold: 18, daysAgo: 6, specs: { Package: "BGA", Function: "Charging / power management" }, desc: "Replacement charging IC used on several Samsung A-series boards. For board-level repair.", variants: [{ sku: "AUR-CMP-SM5714", retail: N(4200), wholesale: N(3300), minQty: 5, stock: 35 }] },

  { name: "Samsung Galaxy A15 4G Back Cover", cat: "housing", brand: "AUREX", warranty: 0, img: "housing", devices: ["Samsung Galaxy A15 4G"], sold: 46, specs: { Material: "Polycarbonate", Includes: "Camera lens, adhesive" }, desc: "Replacement back cover with camera lens for Galaxy A15 4G.", variants: [{ sku: "AUR-HSG-A154G-BK", name: "Blue Black", retail: N(5500), wholesale: N(4400), minQty: 10, stock: 28, attrs: { Colour: "Blue Black" } }, { sku: "AUR-HSG-A154G-YL", name: "Yellow", retail: N(5500), wholesale: N(4400), minQty: 10, stock: 10, attrs: { Colour: "Yellow" } }] },
  { name: "iPhone 11 Full Housing with Frame", cat: "housing", brand: "AUREX", warranty: 0, img: "housing", devices: ["Apple iPhone 11"], sold: 52, specs: { Material: "Glass + aluminium", Includes: "Side buttons, SIM tray" }, desc: "Complete back housing with frame for iPhone 11.", variants: [{ sku: "AUR-HSG-IP11-BK", name: "Black", retail: N(18500), wholesale: N(16000), minQty: 5, stock: 12, attrs: { Colour: "Black" } }] },

  { name: "Tempered Glass Screen Protector — Galaxy A15 (4G/5G)", cat: "screen-protectors", brand: "AUREX", warranty: 0, img: "protector", devices: ["Samsung Galaxy A15 4G", "Samsung Galaxy A15 5G"], sold: 300, specs: { Hardness: "9H", Thickness: "0.33mm", Coverage: "Full glue, full cover" }, desc: "9H full-cover tempered glass for Galaxy A15 4G and 5G.", variants: [{ sku: "AUR-PRT-A15", retail: N(1500), wholesale: N(700), minQty: 20, stock: 400 }] },
  { name: "Tempered Glass Screen Protector — iPhone 11 / XR", cat: "screen-protectors", brand: "AUREX", warranty: 0, img: "protector", devices: ["Apple iPhone 11", "Apple iPhone XR"], sold: 420, specs: { Hardness: "9H", Thickness: "0.33mm" }, desc: "9H full-cover tempered glass that fits iPhone 11 and iPhone XR.", variants: [{ sku: "AUR-PRT-IP11", retail: N(1500), wholesale: N(700), minQty: 20, stock: 350 }] },

  { name: "AUREX 25W USB-C Fast Charger", cat: "accessories", brand: "AUREX", warranty: 6, img: "accessory", devices: [], universal: true, featured: true, sold: 310, daysAgo: 1, specs: { Output: "25W PD / PPS", Plug: "UK 3-pin", Cable: "1m USB-C to USB-C included" }, desc: "25W Power Delivery fast charger with cable. Works with any USB-C phone.", variants: [{ sku: "AUR-ACC-CHG25", retail: N(8500), compareAt: N(10000), wholesale: N(6500), minQty: 10, stock: 150 }] },
  { name: "AUREX Braided USB-C Cable (1.2m)", cat: "accessories", brand: "AUREX", warranty: 3, img: "accessory", devices: [], universal: true, sold: 280, specs: { Length: "1.2m", Current: "3A", Connector: "USB-A to USB-C" }, desc: "Durable braided 3A USB-A to USB-C cable.", variants: [{ sku: "AUR-ACC-CBL-C", retail: N(2500), wholesale: N(1600), minQty: 20, stock: 240 }] },

  { name: "Precision Screwdriver & Opening Tool Kit (25-in-1)", cat: "tools", brand: "AUREX", warranty: 0, img: "chip", devices: [], universal: true, sold: 75, specs: { Pieces: "25", Includes: "Pentalobe, tri-point, Phillips, spudgers, suction cup" }, desc: "Technician tool kit for opening and repairing smartphones.", variants: [{ sku: "AUR-TLS-KIT25", retail: N(7500), wholesale: N(6000), minQty: 5, stock: 45 }] },
];

const DEMO_REVIEWS = [
  { sku: "AUR-SCR-A154G-SP", author: "Chinedu O.", rating: 5, title: "Exactly like the original", body: "Fitted it for a customer the same day. Colours and touch are perfect, and it came with the frame." },
  { sku: "AUR-SCR-A154G-SP", author: "Funmi A.", rating: 4, title: "Good quality", body: "Delivery to Ibadan took three days. Screen quality is excellent." },
  { sku: "AUR-BAT-IP11-HC", author: "Ibrahim S.", rating: 5, title: "Battery health back to 100%", body: "Lasts the whole day again. Well packaged." },
  { sku: "AUR-SCR-IP11-IN", author: "Blessing E.", rating: 4, title: "Great value for the price", body: "Not as bright as original but very good for the price. My customers are happy." },
  { sku: "AUR-ACC-CHG25", author: "Tunde B.", rating: 5, title: "Proper fast charging", body: "Charges my Samsung with super fast charging. Solid build." },
  { sku: "AUR-BAT-A15", author: "Ngozi K.", rating: 5, title: "Genuine battery", body: "Compatibility listing was accurate — fitted my A15 5G without issues." },
];

export const DEMO_PASSWORD = "AurexDemo2026!";

export async function seedDemo(db: Db): Promise<void> {
  const [cats, brandRows, devices] = await Promise.all([db.select().from(categories), db.select().from(brands), db.select({ id: deviceModels.id, name: deviceModels.name, brandId: deviceModels.brandId }).from(deviceModels)]);
  const deviceByLabel = new Map(devices.map((d) => [`${brandRows.find((b) => b.id === d.brandId)!.name} ${d.name}`, d.id]));

  for (const p of DEMO_PRODUCTS) {
    const slug = slugify(p.name);
    const [exists] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug));
    if (exists) continue;
    const [prod] = await db
      .insert(products)
      .values({
        name: p.name, slug, description: p.desc, categoryId: cats.find((c) => c.slug === p.cat)!.id, brandId: brandRows.find((b) => b.name === p.brand)?.id ?? null,
        specs: p.specs, qualityGrade: p.grade ?? null, warrantyMonths: p.warranty,
        warrantyInfo: p.warranty > 0 ? `${p.warranty}-month warranty against manufacturing defects. Physical and liquid damage are not covered.` : "No warranty on this item. Please test before installation.",
        status: "ACTIVE", isFeatured: !!p.featured, isUniversal: !!p.universal, isDemo: true, soldCount: p.sold ?? 0,
        createdAt: new Date(Date.now() - (p.daysAgo ?? 20 + Math.floor((p.sold ?? 0) / 10)) * 86_400_000),
      })
      .returning();
    await db.insert(productImages).values({ productId: prod!.id, url: `/demo/${p.img}.jpg`, alt: p.name, sortOrder: 0 });
    for (const [i, v] of p.variants.entries()) {
      const [variant] = await db.insert(productVariants).values({ productId: prod!.id, sku: v.sku, name: v.name ?? "Standard", attributes: v.attrs ?? {}, retailPrice: v.retail, compareAtPrice: v.compareAt ?? null, wholesalePrice: v.wholesale ?? null, minWholesaleQty: v.minQty ?? 1, isDefault: i === 0 }).returning();
      await db.insert(inventory).values({ variantId: variant!.id, onHand: v.stock, lowStockThreshold: 5 });
      if (v.stock > 0) await db.insert(inventoryMovements).values({ variantId: variant!.id, type: "RECEIVE", quantity: v.stock, note: "Demo opening stock" });
    }
    const ids = p.devices.map((label) => {
      const id = deviceByLabel.get(label);
      if (!id) throw new Error(`Demo seed: unknown device "${label}"`);
      return { productId: prod!.id, deviceModelId: id };
    });
    if (ids.length) await db.insert(productCompatibility).values(ids);
  }

  // Demo reviews (+ rating aggregates)
  const variantRows = await db.select({ sku: productVariants.sku, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.sku, DEMO_REVIEWS.map((r) => r.sku)));
  const [hasReviews] = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.isDemo, true)).limit(1);
  if (!hasReviews) {
    for (const r of DEMO_REVIEWS) {
      const productId = variantRows.find((v) => v.sku === r.sku)?.productId;
      if (productId) await db.insert(reviews).values({ productId, authorName: r.author, rating: r.rating, title: r.title, body: r.body, status: "APPROVED", isVerifiedPurchase: true, isDemo: true });
    }
    for (const productId of new Set(variantRows.map((v) => v.productId))) {
      const rs = await db.select({ rating: reviews.rating }).from(reviews).where(eq(reviews.productId, productId));
      await db.update(products).set({ ratingCount: rs.length, ratingAvg: Math.round((rs.reduce((s, x) => s + x.rating, 0) / rs.length) * 100) }).where(eq(products.id, productId));
    }
  }

  await db.insert(coupons).values({ code: "WELCOME10", description: "10% off your first order (max ₦5,000)", type: "PERCENT", value: 10, maxDiscount: N(5000), minSubtotal: N(10000), perCustomerLimit: 1 }).onConflictDoNothing();
  await db.insert(coupons).values({ code: "FREESHIP", description: "Free delivery on orders over ₦50,000", type: "FREE_SHIPPING", minSubtotal: N(50000) }).onConflictDoNothing();

  const [group] = await db.select().from(customerGroups).where(eq(customerGroups.name, "Standard Wholesale"));
  const [rule] = await db.select({ id: wholesalePriceRules.id }).from(wholesalePriceRules).limit(1);
  if (!rule) await db.insert(wholesalePriceRules).values({ name: "Bulk: extra 5% off wholesale at 50+ units", minQuantity: 50, priceType: "PERCENT_OFF", value: 5 });

  // Demo accounts
  const demoUsers = [
    { name: "Demo Customer", email: "customer@aurex.test", role: "customer" as const },
    { name: "Demo Wholesaler", email: "wholesale@aurex.test", role: "wholesale_customer" as const },
    { name: "Demo Admin", email: "admin@aurex.test", role: "super_admin" as const },
  ];
  for (const u of demoUsers) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email));
    if (existing) continue;
    const user = await createUser({ name: u.name, email: u.email, password: DEMO_PASSWORD, emailVerified: true, phone: "+2348030000000" }, db);
    await setUserRole(user.id, u.role, db);
    if (u.role === "wholesale_customer") await db.update(customerProfiles).set({ wholesaleStatus: "APPROVED", groupId: group?.id ?? null, businessName: "Demo Phone Repairs Ltd" }).where(eq(customerProfiles.userId, user.id));
  }
}

export async function purgeDemo(db: Db): Promise<{ products: number }> {
  const deleted = await db.delete(products).where(eq(products.isDemo, true)).returning({ id: products.id });
  await db.delete(reviews).where(eq(reviews.isDemo, true));
  await db.delete(users).where(inArray(users.email, ["customer@aurex.test", "wholesale@aurex.test", "admin@aurex.test"]));
  await db.delete(coupons).where(inArray(coupons.code, ["WELCOME10", "FREESHIP"]));
  return { products: deleted.length };
}
