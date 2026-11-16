"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** While a payment is being confirmed, re-read the order from the server a few times. */
export function AutoRefresh({ everyMs = 4000, times = 12 }: { everyMs?: number; times?: number }) {
  const router = useRouter();
  const count = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => {
      if (++count.current > times) return clearInterval(timer);
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, times]);
  return null;
}
