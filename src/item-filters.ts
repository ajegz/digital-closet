// A piece can match both a garment shape and a sleeve/zip style. These are
// browsing suggestions from the saved name, not new facts written to the piece.
const normalize = (value: string) => value.toLowerCase().replace(/[‐‑–—_-]/g, " ").replace(/\s+/g, " ").trim();

export const CLOTHING_TYPES = [
  "Shirt", "Polo shirt", "T-shirt", "Long sleeves", "Short sleeves", "Hoodie",
  "Sweatshirt", "Sweater", "Cardigan", "Half zip", "Quarter zip", "Jacket",
  "Coat", "Vest", "Jeans", "Trousers", "Shorts", "Dress", "Skirt", "Other",
] as const;
export type ClothingType = typeof CLOTHING_TYPES[number];

const TYPE_TONES: Record<ClothingType, string> = {
  "Shirt": "leaf", "Polo shirt": "grape", "T-shirt": "berry",
  "Long sleeves": "sky", "Short sleeves": "berry", "Hoodie": "warm",
  "Sweatshirt": "grape", "Sweater": "leaf", "Cardigan": "warm",
  "Half zip": "teal", "Quarter zip": "sun", "Jacket": "teal",
  "Coat": "grape", "Vest": "sky", "Jeans": "sky", "Trousers": "leaf",
  "Shorts": "warm", "Dress": "berry", "Skirt": "grape", "Other": "neutral",
};

export const clothingTypeTone = (type: string) => TYPE_TONES[type as ClothingType] ?? "neutral";

export function clothingTypes(name: string): ClothingType[] {
  const text = normalize(name);
  const types: ClothingType[] = [];
  const add = (type: ClothingType, matches: boolean) => { if (matches) types.push(type); };
  const tee = /\b(t ?shirt|tee)\b/.test(text);
  const polo = /\bpolo\b/.test(text);
  const hoodie = /\bhoodie\b|\bhooded sweatshirt\b/.test(text);
  const longSleeves = /\blong sleeves?\b/.test(text);
  add("Shirt", !tee && !polo && /\b(shirt|overshirt)\b/.test(text));
  add("Polo shirt", polo);
  // The owner's browsing taxonomy treats long-sleeve tees as Long sleeves.
  add("T-shirt", tee && !longSleeves);
  add("Long sleeves", longSleeves);
  add("Short sleeves", /\bshort sleeves?\b/.test(text));
  add("Hoodie", hoodie);
  add("Sweatshirt", /\bsweatshirt\b/.test(text));
  add("Sweater", /\b(sweater|jumper)\b/.test(text) || (!hoodie && !/\bsweatshirt\b/.test(text) && /\bpullover\b/.test(text)));
  add("Cardigan", /\bcardigan\b/.test(text));
  add("Half zip", /\bhalf zip\b|\b1\s*\/\s*2 zip\b/.test(text));
  add("Quarter zip", /\bquarter zip\b|\b1\s*\/\s*4 zip\b/.test(text));
  add("Jacket", /\b(jacket|blazer|windbreaker|anorak)\b/.test(text));
  add("Coat", /\b(coat|overcoat|trench)\b/.test(text));
  add("Vest", /\b(vest|gilet)\b/.test(text));
  add("Jeans", /\bjeans\b/.test(text));
  add("Trousers", /\b(trousers|pants|chinos|joggers)\b/.test(text));
  add("Shorts", /\bshorts\b/.test(text));
  add("Dress", /\bdress\b/.test(text) && !/\bdress shirt\b/.test(text));
  add("Skirt", /\bskirt\b/.test(text));
  return types.length ? types : ["Other"];
}

/** Prefix keeps real brand names separate from the select's reserved values. */
export function brandKey(brand: string): string {
  return `brand:${brand.trim().replace(/\s+/g, " ").toLowerCase()}`;
}
