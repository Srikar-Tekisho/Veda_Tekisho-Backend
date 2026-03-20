import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

// Initialize Supabase only if credentials are provided
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  console.log("✅ Supabase connected");
} else {
  console.log(
    "⚠️ Supabase credentials not found - contact/feedback features disabled",
  );
}

export async function saveContact({ name, phone, email }) {
  if (!supabase) {
    console.log("📝 Contact saved (memory only):", { name, phone, email });
    return { data: null, error: null };
  }

  console.log("💾 Saving contact to database:", { name, phone, email });
  const result = await supabase
    .from("contacts")
    .insert([{ name, phone, email }]);

  if (result.error) {
    console.error("❌ Error saving contact:", result.error);
  } else {
    console.log("✅ Contact saved successfully!");
  }

  return result;
}

export async function saveFeedback(message) {
  if (!supabase) {
    console.log("📝 Feedback saved (memory only):", message);
    return { data: null, error: null };
  }
  return await supabase.from("feedback").insert([{ message }]);
}
