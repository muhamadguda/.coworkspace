import type { Metadata } from "next";
import { SetupOwner } from "@/staff/SetupOwner";

export const metadata: Metadata = { title: "Setup", robots: { index: false, follow: false }, manifest: "/staff.webmanifest", appleWebApp: { capable: true, title: "dots staff" } };

export default function SetupPage() {
  return <SetupOwner />;
}
