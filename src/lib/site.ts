// Two domains, one app. dotswork.space is the public customer site (home, menu, events);
// dotcowork.space is the staff side (/staff, /setup). Any other host (localhost, Vercel
// previews) serves everything, so dev and e2e work unchanged.
export const BRAND = "dots";
export const CUSTOMER_HOST = "dotswork.space";
export const STAFF_HOST = "dotcowork.space";
export const CUSTOMER_ORIGIN = `https://www.${CUSTOMER_HOST}`; // Vercel serves www; apex redirects to it
export const STAFF_ORIGIN = `https://www.${STAFF_HOST}`;

const STAFF_PATHS = ["/staff", "/setup"];
const CUSTOMER_PATHS = ["/menu", "/events"];
const under = (path: string, roots: string[]) => roots.some((r) => path === r || path.startsWith(r + "/"));
const bare = (host: string) => host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");

/** Where a request should go instead, or null to serve it here. */
export function hostRedirect(host: string, path: string): string | null {
  const h = bare(host);
  if (h === CUSTOMER_HOST && under(path, STAFF_PATHS)) return STAFF_ORIGIN + path;
  if (h === STAFF_HOST) {
    if (path === "/") return "/staff";
    if (under(path, CUSTOMER_PATHS)) return CUSTOMER_ORIGIN + path;
  }
  return null;
}

/** Origin for links customers open (QR codes, share links). Staff pages run on the staff host. */
export function customerOrigin(): string {
  if (typeof location === "undefined") return CUSTOMER_ORIGIN;
  return bare(location.host) === STAFF_HOST ? CUSTOMER_ORIGIN : location.origin;
}
