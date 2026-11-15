import { describe, expect, it } from "vitest";
import { isCompatible, resolveDevice, type DeviceRecord } from "@/services/compatibility";
import { parseQuery } from "@/services/query-parser";
import { CATEGORY_SEED, DEVICE_SEED } from "@/db/seed/base";
import { normalizeNigerianPhone, resolveState, findStateInText } from "@/lib/nigeria";
import { parseQuantity, isAffirmative } from "@/services/ai/builtin";
import { guardPaymentClaims } from "@/services/ai/agent";

const devices: DeviceRecord[] = DEVICE_SEED.map((d, i) => ({ id: `d${i}`, ...d }));
const cats = CATEGORY_SEED.map((c, i) => ({ id: `c${i}`, ...c }));
const name = (r: ReturnType<typeof resolveDevice>) => (r.status === "exact" ? `${r.device.brand} ${r.device.name}` : r.status === "ambiguous" ? r.candidates.map((c) => c.name).sort() : null);

describe("compatibility matching", () => {
  it("asks for clarification when a name covers several models (A15 → 4G or 5G)", () => {
    expect(name(resolveDevice("I need a screen for Samsung A15", devices))).toEqual(["Galaxy A15 4G", "Galaxy A15 5G"]);
    expect(name(resolveDevice("galaxy a15", devices))).toEqual(["Galaxy A15 4G", "Galaxy A15 5G"]);
  });
  it("resolves the exact model when the customer is specific", () => {
    expect(name(resolveDevice("A15 4G", devices))).toBe("Samsung Galaxy A15 4G");
    expect(name(resolveDevice("samsung a15 5g screen", devices))).toBe("Samsung Galaxy A15 5G");
    expect(name(resolveDevice("screen for SM-A155F", devices))).toBe("Samsung Galaxy A15 4G");
    expect(name(resolveDevice("sma156b", devices))).toBe("Samsung Galaxy A15 5G");
    expect(name(resolveDevice("iPhone 11 battery", devices))).toBe("Apple iPhone 11");
  });
  it("matches whole tokens only — similar names are not treated as the same phone", () => {
    expect(resolveDevice("A155 screen", devices).status).toBe("none");
    expect(resolveDevice("samsung a15s", devices).status).toBe("none");
    expect(resolveDevice("iphone 110", devices).status).toBe("none");
    expect(resolveDevice("nokia 3310", devices).status).toBe("none");
  });
  it("a product fits only linked devices unless it is universal", () => {
    expect(isCompatible({ isUniversal: false, compatibleDeviceIds: ["d0"] }, "d0")).toBe(true);
    expect(isCompatible({ isUniversal: false, compatibleDeviceIds: ["d0"] }, "d1")).toBe(false);
    expect(isCompatible({ isUniversal: true, compatibleDeviceIds: [] }, "d1")).toBe(true);
  });
});

describe("query parsing", () => {
  it("extracts device, category and leftover terms", () => {
    const p = parseQuery("I need an original screen for Samsung A15 4G", devices, cats);
    expect(name(p.device)).toBe("Samsung Galaxy A15 4G");
    expect(p.category?.slug).toBe("screens");
    expect(p.terms).toEqual([]);
  });
  it("prefers the longest category phrase", () => {
    expect(parseQuery("tecno spark 10 charging port", devices, cats).category?.slug).toBe("charging-ports");
    expect(parseQuery("iphone 12 power button", devices, cats).category?.slug).toBe("button-flex");
    expect(parseQuery("screen protector for iphone 11", devices, cats).category?.slug).toBe("screen-protectors");
    expect(parseQuery("batteries", devices, cats).category?.slug).toBe("batteries");
  });
  it("keeps meaningful words as search terms", () => {
    expect(parseQuery("oled display", devices, cats).terms).toEqual(["oled"]);
  });
});

describe("Nigerian validation", () => {
  it("normalises valid mobile numbers to E.164", () => {
    for (const n of ["08031234567", "0803 123 4567", "+2348031234567", "2348031234567", "8031234567", "+234 (0) 803-123-4567"]) expect(normalizeNigerianPhone(n)).toBe("+2348031234567");
    expect(normalizeNigerianPhone("09161234567")).toBe("+2349161234567");
  });
  it("rejects invalid numbers", () => {
    for (const n of ["", "12345", "0803123456", "080312345678", "06031234567", "+14155552671", "0803abc4567"]) expect(normalizeNigerianPhone(n)).toBeNull();
  });
  it("resolves states from free text", () => {
    expect(resolveState("lagos state")).toBe("Lagos");
    expect(resolveState("Abuja")).toBe("FCT");
    expect(resolveState("Atlantis")).toBeNull();
    expect(findStateInText("how much is delivery to akwa ibom?")).toBe("Akwa Ibom");
  });
});

describe("assistant language helpers", () => {
  it("reads quantities without confusing model numbers", () => {
    expect(parseQuantity("I need two")).toBe(2);
    expect(parseQuantity("add 3 pieces")).toBe(3);
    expect(parseQuantity("a15 4g screen")).toBeNull();
    expect(parseQuantity("the first one")).toBeNull();
    expect(parseQuantity("a dozen please")).toBe(12);
  });
  it("recognises explicit confirmation only", () => {
    expect(isAffirmative("Yes, confirm")).toBe(true);
    expect(isAffirmative("confirm")).toBe(true);
    expect(isAffirmative("yes but change the address")).toBe(false);
    expect(isAffirmative("no")).toBe(false);
    expect(isAffirmative("what is the total?")).toBe(false);
  });
  it("strips unverified payment-success claims from model output", () => {
    expect(guardPaymentClaims("Great news! Your payment was successful. Your order is on its way.", false)).not.toMatch(/payment was successful/i);
    expect(guardPaymentClaims("Your payment was successful.", true)).toMatch(/payment was successful/);
    expect(guardPaymentClaims("Your order is confirmed once the payment is verified.", false)).toMatch(/once the payment is verified/);
  });
});
