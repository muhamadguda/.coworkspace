import { test } from "node:test";
import assert from "node:assert/strict";
import { hostRedirect } from "./site.ts";

test("customer host sends staff pages to the staff host", () => {
  assert.equal(hostRedirect("dotswork.space", "/staff"), "https://dotcowork.space/staff");
  assert.equal(hostRedirect("www.dotswork.space", "/setup"), "https://dotcowork.space/setup");
  assert.equal(hostRedirect("dotswork.space", "/menu"), null);
  assert.equal(hostRedirect("dotswork.space", "/"), null);
  assert.equal(hostRedirect("dotswork.space", "/staffing"), null);
});

test("staff host sends customer pages to the customer host", () => {
  assert.equal(hostRedirect("dotcowork.space", "/"), "/staff");
  assert.equal(hostRedirect("dotcowork.space", "/menu"), "https://dotswork.space/menu");
  assert.equal(hostRedirect("www.dotcowork.space", "/events"), "https://dotswork.space/events");
  assert.equal(hostRedirect("dotcowork.space", "/staff"), null);
});

test("other hosts serve everything", () => {
  assert.equal(hostRedirect("localhost:3000", "/staff"), null);
  assert.equal(hostRedirect("dot-abc.vercel.app", "/menu"), null);
});
