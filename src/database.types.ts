// Generated from the Supabase schema (project hjmeabidvbkemmwcfifz). Regenerate after changing supabase/migrations.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      collections: {
        Row: {
          deleted_at: string | null;
          id: string;
          name: string;
          position: number;
          synced_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          deleted_at?: string | null;
          id: string;
          name: string;
          position?: number;
          synced_at?: string;
          updated_at: string;
          user_id?: string;
        };
        Update: {
          deleted_at?: string | null;
          id?: string;
          name?: string;
          position?: number;
          synced_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      items: {
        Row: {
          brand: string | null;
          care: string | null;
          category: string;
          color: string | null;
          created_at: string;
          deleted_at: string | null;
          favorite: boolean;
          id: string;
          material: string | null;
          name: string;
          occasions: string[] | null;
          photo_path: string | null;
          price: number | null;
          purchased_on: string | null;
          size: string | null;
          status: string;
          store: string | null;
          synced_at: string;
          thumb_path: string | null;
          updated_at: string;
          user_id: string;
          weather: string[] | null;
        };
        Insert: {
          brand?: string | null;
          care?: string | null;
          category: string;
          color?: string | null;
          created_at: string;
          deleted_at?: string | null;
          favorite?: boolean;
          id: string;
          material?: string | null;
          name: string;
          occasions?: string[] | null;
          photo_path?: string | null;
          price?: number | null;
          purchased_on?: string | null;
          size?: string | null;
          status?: string;
          store?: string | null;
          synced_at?: string;
          thumb_path?: string | null;
          updated_at: string;
          user_id?: string;
          weather?: string[] | null;
        };
        Update: {
          brand?: string | null;
          care?: string | null;
          category?: string;
          color?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          favorite?: boolean;
          id?: string;
          material?: string | null;
          name?: string;
          occasions?: string[] | null;
          photo_path?: string | null;
          price?: number | null;
          purchased_on?: string | null;
          size?: string | null;
          status?: string;
          store?: string | null;
          synced_at?: string;
          thumb_path?: string | null;
          updated_at?: string;
          user_id?: string;
          weather?: string[] | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
