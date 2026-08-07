import { assertEquals } from "@std/assert";

import { hasUtm, parseUtm } from "./agent-utm.ts";

Deno.test("parseUtm extracts the five known utm_* fields", () => {
  const utm = parseUtm(
    "utm_source=blog&utm_medium=cpc&utm_campaign=launch&utm_term=agents&utm_content=hero",
  );
  assertEquals(utm, {
    utm_source: "blog",
    utm_medium: "cpc",
    utm_campaign: "launch",
    utm_term: "agents",
    utm_content: "hero",
  });
});

Deno.test("parseUtm ignores non-utm keys and unknown params", () => {
  const utm = parseUtm(
    "utm_source=blog&ref=twitter&gclid=xyz&foo=bar&utm_campaign=launch",
  );
  assertEquals(utm, { utm_source: "blog", utm_campaign: "launch" });
});

Deno.test("parseUtm truncates over-long values to 64 chars", () => {
  const long = "a".repeat(200);
  const utm = parseUtm(`utm_campaign=${long}`);
  assertEquals(utm.utm_campaign?.length, 64);
  assertEquals(utm.utm_campaign, "a".repeat(64));
});

Deno.test("parseUtm drops empty values", () => {
  assertEquals(parseUtm("utm_source=&utm_medium=cpc"), { utm_medium: "cpc" });
});

Deno.test("parseUtm returns no fields for empty / undefined / garbage input", () => {
  assertEquals(parseUtm(""), {});
  assertEquals(parseUtm(undefined), {});
  assertEquals(parseUtm(null), {});
  assertEquals(parseUtm("just some random text without pairs"), {});
  assertEquals(parseUtm("source=blog&campaign=launch"), {});
});

Deno.test("parseUtm decodes URL-encoded values", () => {
  const utm = parseUtm("utm_campaign=summer%20launch&utm_source=news%2Bletter");
  assertEquals(utm.utm_campaign, "summer launch");
  assertEquals(utm.utm_source, "news+letter");
});

Deno.test("hasUtm reflects whether any field is present", () => {
  assertEquals(hasUtm({}), false);
  assertEquals(hasUtm(undefined), false);
  assertEquals(hasUtm({ utm_source: "blog" }), true);
});
