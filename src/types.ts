export type Status = "Confirmed" | "Needs review";
export type Garment = "tee" | "shirt" | "pants" | "coat";

export const WEATHER = ["Hot", "Mild", "Cold", "Rainy"] as const;
export const OCCASIONS = ["Casual", "Work", "Formal", "Sport", "Lounge"] as const;
export type Weather = (typeof WEATHER)[number];
export type Occasion = (typeof OCCASIONS)[number];

export interface ClosetItem {
  id: string;
  name: string;
  category: string;
  brand: string;
  color: string;
  status: Status;
  garment?: Garment;
  /** Detail-size photo (data URL, max 1600px). */
  image?: string;
  /** Grid-size photo (data URL, max 480px). Older items may only have `image`. */
  thumb?: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  sample?: boolean;
  size?: string;
  material?: string;
  weather?: Weather[];
  occasions?: Occasion[];
  price?: number;
  /** Purchase date as YYYY-MM-DD. */
  purchasedOn?: string;
  store?: string;
  care?: string;
}
