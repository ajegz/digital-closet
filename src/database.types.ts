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
          ai: Json | null;
          label_path: string | null;
          back_path: string | null;
          render_path: string | null;
          render_thumb_path: string | null;
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
          ai?: Json | null;
          label_path?: string | null;
          back_path?: string | null;
          render_path?: string | null;
          render_thumb_path?: string | null;
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
          ai?: Json | null;
          label_path?: string | null;
          back_path?: string | null;
          render_path?: string | null;
          render_thumb_path?: string | null;
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
      outfits: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          item_ids: string[];
          name: string;
          synced_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at: string;
          deleted_at?: string | null;
          id: string;
          item_ids?: string[];
          name: string;
          synced_at?: string;
          updated_at: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          item_ids?: string[];
          name?: string;
          synced_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wear_logs: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          item_ids: string[];
          outfit_id: string | null;
          synced_at: string;
          updated_at: string;
          user_id: string;
          worn_on: string;
        };
        Insert: {
          created_at: string;
          deleted_at?: string | null;
          id: string;
          item_ids?: string[];
          outfit_id?: string | null;
          synced_at?: string;
          updated_at: string;
          user_id?: string;
          worn_on: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          item_ids?: string[];
          outfit_id?: string | null;
          synced_at?: string;
          updated_at?: string;
          user_id?: string;
          worn_on?: string;
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
