import { saveFeedback } from "../repositories/supabaseRepo.js";

export async function handleFeedback(message) {
  if (!message || message.trim().length < 3) {
    return { success: false, error: "Feedback too short" };
  }

  const { error } = await saveFeedback(message);

  if (error) {
    console.error("Supabase feedback save error:", error);
    return { success: false, error: "Database insert failed" };
  }

  return { success: true };
}
