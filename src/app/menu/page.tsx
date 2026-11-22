import type { Metadata } from "next";
import { CustomerApp } from "@/customer/CustomerApp";

export const metadata: Metadata = { title: "Menu", description: "Order from your table, see your bill, and book a room at dots." };

export default function MenuPage() {
  return <CustomerApp />;
}
