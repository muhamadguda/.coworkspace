import type { Metadata } from "next";
import { StaffApp } from "@/staff/StaffApp";

export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false } };

export default function StaffPage() {
  return <StaffApp />;
}
