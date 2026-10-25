/** Placeholder for brand and color the user hasn't filled in. Stored as null in the cloud. */
export const UNKNOWN = "To identify";

export type Status = "Confirmed" | "Needs review";
export type Garment = "tee" | "shirt" | "pants" | "coat";

export const WEATHER = ["Hot", "Mild", "Cold", "Rainy"] as const;
export const OCCASIONS = ["Casual", "Work", "Formal", "Sport", "Lounge"] as const;
export type Weather = (typeof WEATHER)[number];
export type Occasion = (typeof OCCASIONS)[number];

/** Provenance for an extra image, never a replacement for the real photo. */
export interface RenderMetadata {
  provider: string;
  model: string;
  createdAt: string;
  /** SHA-256 of the original file supplied with the import. */
  sourcePhotoSha256: string;
  prompt?: string;
  referenceUrl?: string;
}

export interface ItemAI {
  render?: RenderMetadata;
}

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
  /** Optional real reference photos, stored separately from the front photo. */
  labelImage?: string;
  backImage?: string;
  /** Additional generated view; every display must identify it as AI-generated. */
  renderImage?: string;
  renderThumb?: string;
  ai?: ItemAI;
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

  // Sync bookkeeping (Phase 3). Pieces saved before sync existed have none of these, which counts as "needs sending".
  /** False once the cloud has this exact version. */
  dirty?: boolean;
  /** A chat import's first push may insert, but must never overwrite an existing cloud id. */
  importOnly?: boolean;
  /** True when the photo changed on this device and hasn't been uploaded. */
  photoDirty?: boolean;
  /** Storage paths of the uploaded photo; a new photo gets new paths so other devices notice. */
  photoPath?: string;
  thumbPath?: string;
  labelPath?: string;
  backPath?: string;
  renderPath?: string;
  renderThumbPath?: string;
  /** True also represents an explicit removal when the corresponding image is absent. */
  labelDirty?: boolean;
  backDirty?: boolean;
  renderDirty?: boolean;
  /** Set when deleted while signed in; kept until the deletion reaches the cloud. */
  deletedAt?: number;
  /** The cloud's synced_at for the version this device has, to skip re-applying it. */
  remoteSyncedAt?: string;
}

/** Fields every synced record shares (outfits and wear logs; items have their own photo-aware set). */
interface SyncedRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
  remoteSyncedAt?: string;
}

export interface Outfit extends SyncedRecord {
  name: string;
  itemIds: string[];
}

export interface WearLog extends SyncedRecord {
  /** Local calendar day, YYYY-MM-DD. */
  wornOn: string;
  itemIds: string[];
  outfitId?: string;
}

export interface Collection {
  id: string;
  name: string;
  position: number;
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
}
