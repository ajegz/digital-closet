import test from "node:test";
import assert from "node:assert/strict";
import { brandKey, clothingType, CLOTHING_TYPES } from "../src/item-filters.ts";

test("each garment has one exclusive owner-defined type", () => {
  assert.deepEqual(clothingType("TEST long-sleeve polo shirt"), "Long sleeves");
  assert.deepEqual(clothingType("TEST short-sleeve T-shirt"), "T-shirt");
  assert.deepEqual(clothingType("TEST utility overshirt"), "Shirt");
  assert.equal(clothingType("Zara stone short-sleeve utility shirt"), "Polo short sleeves");
  assert.equal(clothingType("TEST short-sleeve polo shirt"), "Polo short sleeves");
  assert.equal(clothingType("TEST long-sleeve button-front shirt"), "Long sleeves");
  assert.equal(clothingType("TEST polo shirt"), "Polo");
  assert.equal(clothingType("TEST camp-collar shirt"), "Polo");
  assert.deepEqual(clothingType("TEST dress shirt"), "Shirt");
  assert.deepEqual(clothingType("TEST long sleeve tee"), "Long sleeves");
  for (const name of [
    "Washed-charcoal chest-pocket long-sleeve T-shirt",
    "Cotton On T-Bar cream Peace & Quiet long-sleeve T-shirt",
    "H&M white Rick and Morty long-sleeve T-shirt",
    "Zara navy plain long-sleeve T-shirt",
  ]) assert.deepEqual(clothingType(name), "Long sleeves");
});

test("half and quarter zip require evidence, not just a zipper", () => {
  assert.deepEqual(clothingType("TEST Half–zip sweatshirt"), "Half zip");
  assert.deepEqual(clothingType("TEST 1/4 zip sweater"), "Quarter zip");
  assert.deepEqual(clothingType("TEST full-zip hoodie"), "Hoodie");
  assert.deepEqual(clothingType("TEST oversized pullover hoodie"), "Hoodie");
  assert.deepEqual(clothingType("TEST hooded windbreaker jacket"), "Jacket");
});

test("bottoms and unknown names remain browsable", () => {
  assert.deepEqual(clothingType("TEST wide-leg trousers"), "Trousers");
  assert.deepEqual(clothingType("TEST denim shorts"), "Shorts");
  assert.deepEqual(clothingType("TEST denim jeans"), "Jeans");
  assert.deepEqual(clothingType("TEST silk scarf"), "Other");
});

test("brand choices ignore casing and whitespace without merging subbrands", () => {
  assert.equal(brandKey("  ZARA  "), brandKey("zara"));
  assert.equal(brandKey("H&M   Divided"), brandKey("h&m divided"));
  assert.notEqual(brandKey("H&M"), brandKey("H&M Divided"));
  assert.notEqual(brandKey("all"), "all");
});

test("classification always returns one listed type even for compound names", () => {
  for (const name of ["long-sleeve polo shirt", "short-sleeve camp-collar shirt", "quarter-zip sweater", "hooded windbreaker jacket", "half-zip hoodie", "long sleeve tee", "unknown piece"]) {
    const type = clothingType(name);
    assert.equal(typeof type, "string");
    assert.ok(CLOTHING_TYPES.includes(type));
  }
});
