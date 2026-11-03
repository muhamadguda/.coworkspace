import type { Metadata, Viewport } from "next";
import { El_Messiri, IBM_Plex_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const messiri = El_Messiri({ variable: "--font-messiri", subsets: ["arabic", "latin"], weight: ["500", "700"] });
const plexAr = IBM_Plex_Sans_Arabic({ variable: "--font-plex-ar", subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: { default: "dot · co-working & café", template: "%s · dot" },
  description: "dot co-working space and café: order from your table, check your bill, book a room.",
  applicationName: "dot",
  metadataBase: new URL("https://dotcowork.space"),
  appleWebApp: { capable: true, title: "dot", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eaf0ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1f1e" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Sets lang/dir before first paint so English users don't see an RTL flash.
const langScript = `try{var l=localStorage.getItem('dot.lang')==='en'?'en':'ar';document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={`${messiri.variable} ${plexAr.variable} ${plexMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: langScript }} />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
