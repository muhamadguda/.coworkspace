"use client";

import { useEffect, useState } from "react";
import { serverNow, useStaff } from "./store";
import type { Snapshot } from "@/lib/types";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** The live snapshot (server state + queued offline ops). Only call under <StaffApp>, which guarantees it exists. */
export function useSnap(): Snapshot {
  return useStaff((s) => s.view)!;
}

export const useIsOwner = () => useStaff((s) => s.view?.me.role === "owner");
export const useOnline = () => useStaff((s) => s.online);
