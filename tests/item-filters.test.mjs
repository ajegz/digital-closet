import test from "node:test";
import assert from "node:assert/strict";
import { brandKey, clothingTypes } from "../src/item-filters.ts";

test("shirt shapes stay distinct while sleeve filters overlap", () => {
  assert.deepEqual(clothingTypes("TEST long-sleeve polo shirt"), ["Polo shirt", "Long sleeves"]);
  assert.deepEqual(clothingTypes("TEST short-sleeve T-shirt"), ["T-shirt", "Short sleeves"]);
  assert.deepEqual(clothingTypes("TEST utility overshirt"), ["Shirt"]);
  assert.deepEqual(clothingTypes("TEST dress shirt"), ["Shirt"]);
  assert.deepEqual(clothingTypes("TEST long sleeve tee"), ["T-shirt", "Long sleeves"]);
});

test("half and quarter zip require evidence, not just a zipper", () => {
  assert.deepEqual(clothingTypes("TEST Half–zip sweatshirt"), ["Sweatshirt", "Half zip"]);
  assert.deepEqual(clothingTypes("TEST 1/4 zip sweater"), ["Sweater", "Quarter zip"]);
  assert.deepEqual(clothingTypes("TEST full-zip hoodie"), ["Hoodie"]);
  assert.deepEqual(clothingTypes("TEST hooded windbreaker jacket"), ["Jacket"]);
});

test("bottoms and unknown names remain browsable", () => {
  assert.deepEqual(clothingTypes("TEST wide-leg trousers"), ["Trousers"]);
  assert.deepEqual(clothingTypes("TEST denim shorts"), ["Shorts"]);
  assert.deepEqual(clothingTypes("TEST denim jeans"), ["Jeans"]);
  assert.deepEqual(clothingTypes("TEST silk scarf"), ["Other"]);
});

test("brand choices ignore casing and whitespace without merging subbrands", () => {
  assert.equal(brandKey("  ZARA  "), brandKey("zara"));
  assert.equal(brandKey("H&M   Divided"), brandKey("h&m divided"));
  assert.notEqual(brandKey("H&M"), brandKey("H&M Divided"));
  assert.notEqual(brandKey("all"), "all");
});
