/**
 * Guards automatic region naming.
 *
 * A region code the providers ship tomorrow must resolve to a customer-safe
 * Persian name with a stable number — and a provider's own label or the raw
 * region code must never become a display name (the سیمین/گوته leak).
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignRegionDisplayName,
  fallbackRegionCity,
  inferRegionCity,
  nextRegionDisplayName,
  regionShortLabelFromDisplayName,
  usedCityNumbers,
} from "../lib/cloud-servers/region-naming.ts";

test("the parser reads the city out of unseen region codes", () => {
  assert.deepEqual(inferRegionCity("ir-mhd-x1"), {
    city: "مشهد",
    country: "ایران",
    zone: "IRAN",
    preferredNumber: 1,
  });
  assert.deepEqual(inferRegionCity("shiraz2"), {
    city: "شیراز",
    country: "ایران",
    zone: "IRAN",
    preferredNumber: 2,
  });
  assert.equal(inferRegionCity("frankfurt3")?.city, "فرانکفورت");
  assert.equal(inferRegionCity("ir-thr-zz9")?.city, "تهران");
  assert.equal(inferRegionCity("totally-unknown"), null);
});

test("the fail-safe is a generic Persian category, never the raw code", () => {
  assert.deepEqual(fallbackRegionCity("ir-xyz-q1"), {
    city: "ایران",
    country: null,
    zone: "IRAN",
  });
  assert.deepEqual(fallbackRegionCity("mars-west-1"), {
    city: "بین‌الملل",
    country: null,
    zone: "ABROAD",
  });
});

test("numbering reads existing names and never collides across providers", () => {
  const existing = [
    "تهران ۱، ایران", // Arvan
    "تهران ۲، ایران",
    "تهران ۴، ایران",
    "فرانکفورت، آلمان", // unnumbered = 1
  ];
  assert.deepEqual(usedCityNumbers("تهران", existing), new Set([1, 2, 4]));
  assert.deepEqual(usedCityNumbers("فرانکفورت", existing), new Set([1]));

  // Next free Tehran number is ۳ — the gap, not the tail.
  assert.equal(
    nextRegionDisplayName(
      { city: "تهران", country: "ایران", zone: "IRAN" },
      existing,
    ),
    "تهران ۳، ایران",
  );
  // The code's own trailing number wins while it is free…
  assert.equal(
    assignRegionDisplayName("tehran12", existing),
    "تهران ۱۲، ایران",
  );
  // …and yields when taken.
  assert.equal(
    assignRegionDisplayName("tehran2", existing),
    "تهران ۳، ایران",
  );
  // A second Frankfurt gets a number; the first stays bare.
  assert.equal(
    assignRegionDisplayName("frankfurt7", existing),
    "فرانکفورت ۷، آلمان",
  );
  // The first site of a brand-new city stays unnumbered.
  assert.equal(assignRegionDisplayName("ir-mhd-a1", existing), "مشهد، ایران");
});

test("assigned names are deterministic and customer-safe for any input", () => {
  for (const code of ["weird_code!", "x", "ir-abc-def-99", "eu-central-9"]) {
    const first = assignRegionDisplayName(code, []);
    const second = assignRegionDisplayName(code, []);
    assert.equal(first, second, "same inputs must give the same name");
    assert.doesNotMatch(
      first,
      /[a-zA-Z]/,
      `display name for ${code} must never contain the raw code: ${first}`,
    );
  }
});

test("short label strips the country segment for server titles", () => {
  assert.equal(regionShortLabelFromDisplayName("تهران ۴، ایران"), "تهران ۴");
  assert.equal(regionShortLabelFromDisplayName("اروپا"), "اروپا");
});

test("discovery never persists the provider's label as a display name", async () => {
  const source = await readFile(
    "lib/infrastructure/provider-region-config.ts",
    "utf8",
  );
  assert.match(source, /discoveredRegionDisplayName/);
  assert.match(source, /assignRegionDisplayName/);
  // The exact leaks this module closed:
  assert.doesNotMatch(
    source,
    /displayName:\s*region\.displayName/,
    "Arvan sync must not store the fetch-level (provider) label",
  );
});
