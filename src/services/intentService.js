export function detectContactIntent(text) {
  // Detect if user wants to share contact or if message contains email/phone
  const hasContactKeywords =
    /contact|connect|reach|talk|speak|call|email|get in touch|join/i.test(text);
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  const hasPhone = /(?:\+?\d{1,3})?[\s-]?\d{7,12}/.test(text);

  return hasContactKeywords || (hasEmail && hasPhone);
}

export function extractContactDetails(text) {
  // Clean the text - remove extra spaces and common separators
  const cleanText = text.replace(/[,|;]/g, " ").trim();

  // Extract email (most reliable identifier)
  const emailMatch = cleanText.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  );

  // Extract phone number (with various formats)
  const phoneMatch = cleanText.match(
    /(?:\+?\d{1,3})?[\s-]?(?:\(?\d{3}\)?[\s-]?)?\d{7,10}/,
  );

  // Extract name - assume it's the text before email/phone or first word(s)
  let name = "";
  if (emailMatch || phoneMatch) {
    // Remove email and phone from text to get name
    let nameText = cleanText
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, "")
      .replace(/(?:\+?\d{1,3})?[\s-]?(?:\(?\d{3}\)?[\s-]?)?\d{7,10}/, "")
      .trim();

    // Take first 1-3 words as name
    const words = nameText.split(/\s+/).filter((w) => w.length > 0);
    name = words.slice(0, 3).join(" ");
  }

  // If name is empty, try to extract first word from original text
  if (!name) {
    const firstWord = cleanText.split(/\s+/)[0];
    if (firstWord && /^[A-Za-z]+$/.test(firstWord)) {
      name = firstWord;
    }
  }

  return {
    name: name || "User",
    phone: phoneMatch?.[0]?.replace(/[\s-]/g, "") || "",
    email: emailMatch?.[0] || "",
  };
}
