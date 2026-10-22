import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Without these the app runs local-only, exactly as it did before accounts existed.
export const supabase = url && key
  ? createClient<Database>(url, key, {
      // Sign-in uses typed email codes, so there is never a session to pick up from the URL.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    })
  : null;

export const PHOTO_BUCKET = "closet-photos";
