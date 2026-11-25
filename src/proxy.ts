import { NextResponse, type NextRequest } from "next/server";
import { hostRedirect, isStaffHost } from "./lib/site";

// Keeps the customer site and the staff side on their own domains. Query strings
// (e.g. table QR tokens on old dotcowork.space/menu?t=… prints) are kept.
export function proxy(req: NextRequest) {
  // Staff host gets its own favicon (browsers fetch /favicon.ico on their own).
  if (req.nextUrl.pathname === "/favicon.ico") {
    return isStaffHost(req.headers.get("host") ?? "") ? NextResponse.rewrite(new URL("/staff-icons/favicon.ico", req.url)) : NextResponse.next();
  }
  const to = hostRedirect(req.headers.get("host") ?? "", req.nextUrl.pathname);
  if (!to) return NextResponse.next();
  const url = new URL(to, req.url);
  url.search = req.nextUrl.search;
  return NextResponse.redirect(url, to.startsWith("/") ? 307 : 308);
}

export const config = { matcher: ["/", "/favicon.ico", "/staff/:path*", "/setup/:path*", "/menu/:path*", "/events/:path*"] };
