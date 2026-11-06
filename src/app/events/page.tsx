import type { Metadata } from "next";
import { EventsApp } from "@/customer/EventsApp";

export const metadata: Metadata = {
  title: "Events",
  description: "What's on at dot: talks, workshops, movie nights and tournaments. Save your seat.",
  alternates: { canonical: "https://dotcowork.space/events" },
};

export default function EventsPage() {
  return <EventsApp />;
}
