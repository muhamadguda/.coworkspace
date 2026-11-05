import type { Metadata } from "next";
import { StaffApp } from "@/staff/StaffApp";

// Its own manifest, so a counter PC that installs from here opens straight into /staff.
export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false }, manifest: "/staff.webmanifest" };

export default function StaffPage() {
  return <StaffApp />;
}
