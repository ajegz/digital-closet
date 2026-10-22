export type Status = "Confirmed" | "Needs review";
export type Garment = "tee" | "shirt" | "pants" | "coat";

export interface ClosetItem {
  id: string;
  name: string;
  category: string;
  brand: string;
  color: string;
  status: Status;
  garment?: Garment;
  image?: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  sample?: boolean;
}
