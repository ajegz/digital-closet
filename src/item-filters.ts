// Owner-defined, mutually exclusive browsing types. Every garment gets one.
// Suggestions come from its saved name and never rewrite the original record.
const normalize = (value: string) => value.toLowerCase().replace(/[‐‑–—_-]/g, " ").replace(/\s+/g, " ").trim();

export const CLOTHING_TYPES = [
  "Shirt", "Polo", "Polo short sleeves", "T-shirt", "Long sleeves", "Short sleeves", "Hoodie",
  "Sweatshirt", "Sweater", "Cardigan", "Half zip", "Quarter zip", "Jacket",
  "Coat", "Vest", "Jeans", "Trousers", "Shorts", "Dress", "Skirt", "Other",
] as const;
export type ClothingType = typeof CLOTHING_TYPES[number];

const TYPE_TONES: Record<ClothingType, string> = {
  "Shirt": "leaf", "Polo": "grape", "Polo short sleeves": "grape", "T-shirt": "berry",
  "Long sleeves": "sky", "Short sleeves": "berry", "Hoodie": "warm",
  "Sweatshirt": "grape", "Sweater": "leaf", "Cardigan": "warm",
  "Half zip": "teal", "Quarter zip": "sun", "Jacket": "teal",
  "Coat": "grape", "Vest": "sky", "Jeans": "sky", "Trousers": "leaf",
  "Shorts": "warm", "Dress": "berry", "Skirt": "grape", "Other": "neutral",
};

export const clothingTypeTone = (type: string) => TYPE_TONES[type as ClothingType] ?? "neutral";

export function clothingType(name: string): ClothingType {
  const text = normalize(name);
  const tee = /\b(t ?shirt|tee)\b/.test(text);
  const polo = /\bpolo\b|\b(camp|resort) collar\b/.test(text);
  const shirt = /\b(shirt|overshirt)\b/.test(text) && !tee;

  // Specific constructions win over generic sleeve or shirt words.
  if (/\bhalf zip\b|\b1\s*\/\s*2 zip\b/.test(text)) return "Half zip";
  if (/\bquarter zip\b|\b1\s*\/\s*4 zip\b/.test(text)) return "Quarter zip";
  if (/\bhoodie\b|\bhooded sweatshirt\b/.test(text)) return "Hoodie";
  if (/\b(jacket|blazer|windbreaker|anorak)\b/.test(text)) return "Jacket";
  if (/\b(coat|overcoat|trench)\b/.test(text)) return "Coat";
  if (/\b(vest|gilet)\b/.test(text)) return "Vest";
  if (/\bcardigan\b/.test(text)) return "Cardigan";
  if (/\bsweatshirt\b/.test(text)) return "Sweatshirt";
  if (/\b(sweater|jumper|pullover)\b/.test(text)) return "Sweater";
  if (/\bjeans\b/.test(text)) return "Jeans";
  if (/\b(trousers|pants|chinos|joggers)\b/.test(text)) return "Trousers";
  if (/\bshorts\b/.test(text)) return "Shorts";
  if (/\bdress\b/.test(text) && !/\bdress shirt\b/.test(text)) return "Dress";
  if (/\bskirt\b/.test(text)) return "Skirt";

  if (/\blong sleeves?\b/.test(text)) return "Long sleeves";
  if (/\bshort sleeves?\b/.test(text) && (polo || shirt)) return "Polo short sleeves";
  if (polo) return "Polo";
  if (tee) return "T-shirt";
  if (shirt) return "Shirt";
  if (/\bshort sleeves?\b/.test(text)) return "Short sleeves";
  return "Other";
}

/** Prefix keeps real brand names separate from the select's reserved values. */
export function brandKey(brand: string): string {
  return `brand:${brand.trim().replace(/\s+/g, " ").toLowerCase()}`;
}
