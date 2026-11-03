import type { Metadata } from "next";
import { Landing } from "@/landing/Landing";

export const metadata: Metadata = {
  title: { absolute: "dot · Focus. Work. Play." },
  description: "Co-working space and café: quiet tables to study, rooms by the hour for meetings, PlayStation and movie nights, and a corner to draw and paint.",
  openGraph: { title: "dot · Focus. Work. Play.", description: "Co-working space and café. Study, meet, work, watch, play, paint.", url: "https://dotcowork.space", siteName: "dot", type: "website" },
};

export default function Home() {
  return <Landing />;
}
