import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { fileURLToPath } from "url";
import { openai } from "../providers/openaiProvider.js";
import { textSplitter } from "../utils/textSplitter.js";
import { detectContactIntent } from "./intentService.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const LLM_MODEL_RAG = "gpt-4o-mini";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_DIR = path.join(__dirname, "../../upload");

// State
let documentChunks = [];
let chunkEmbeddings = [];
let knowledgeBaseLoaded = false;
let knowledgeBasePromise = null;
let knowledgeBaseError = null;
const queryEmbeddingCache = new Map();
const CACHE_MAX_SIZE = 100;

// Constants
const SUGGESTED_QUESTIONS = [
  "What services does Tekisho offer?",
  "Tell me about your AI solutions",
  "How can I contact Tekisho support?",
  "What are Tekisho's core technologies?",
];

const NOT_ALLOWED_KEYWORDS = [
  "actor",
  "song",
  "sports",
  "joke",
  "weather",
  "travel",
  "politics",
  "cooking",
  "movie",
  "music",
  "recipe",
  "game",
  "pizza",
  "food",
  "celebrity",
  "entertainment",
  "cricket",
  "football",
  "basketball",
  "tennis",
  "hockey",
  "athlete",
  "player",
  "team",
  "match",
  "tournament",
  // Health & Medical keywords
  "sick",
  "illness",
  "disease",
  "doctor",
  "hospital",
  "medicine",
  "medication",
  "medical",
  "health",
  "pain",
  "fever",
  "headache",
  "cough",
  "cold",
  "flu",
  "symptom",
  "treatment",
  "clinic",
  "patient",
  "diagnose",
  "therapy",
  "prescription",
  "surgery",
  "diabetes",
  "cancer",
  "blood pressure",
  // Personal advice keywords
  "relationship",
  "dating",
  "marriage",
  "divorce",
  "love",
  "breakup",
  "personal problem",
  "depression",
  "anxiety",
  "mental health",
  "girlfriend",
  "boyfriend",
  "spouse",
  // Suicide/Self-harm (CRITICAL)
  "die",
  "death",
  "kill",
  "suicide",
  "suicidal",
  "end my life",
  "harm myself",
  "hurt myself",
  "want to die",
  "kill myself",
  "end it all",
  "self harm",
  "cut myself",
  "overdose",
  "jump off",
  // Shopping and personal items
  "shopping",
  "buy",
  "purchase",
  "amazon",
  "flipkart",
  "online shopping",
  "clothes",
  "shoes",
  "fashion",
  "grocery",
  // Personal daily life problems
  "forgot my",
  "lost my",
  "misplaced",
  "can't find",
  "where is my",
  "locker",
  "key",
  "password forgot",
  "locked out",
  "door locked",
  "car key",
  "house key",
  "wallet",
  "phone lost",
  "how to open",
  "how to unlock",
  "how to fix",
  "broken",
  "repair",
  "plumber",
  "electrician",
  "mechanic",
  "cleaning",
  "washing",
  "laundry",
  "stuck",
  "trapped",
  "can't get out",
  "help me get",
  "emergency",
  "urgent help",
  "rescue",
  "escape",
  "room locked",
  "bathroom",
  "bedroom",
  "lift stuck",
  "elevator stuck",
  "traffic",
  "late for",
  "meeting late",
  "personal advice",
  "life advice",
  // Education (non-tech)
  "school",
  "college admission",
  "exam",
  "study tips",
  "homework",
  // General knowledge
  "who is the president",
  "capital of",
  "history of",
  "who invented",
  "famous person",
  "biography",
  // Finance advice
  "stock market",
  "investment",
  "mutual fund",
  "share price",
  "crypto",
  "bitcoin",
];

// Check if question is related to Tekisho or technology
function isRelevantToTekisho(question) {
  const lower = question.toLowerCase();

  // ---- STEP 1: Always allow if it mentions Tekisho (fuzzy match) ----
  if (/tek+i+sh+o|tekisho'?s?|veda/i.test(lower)) {
    return true;
  }

  // ---- STEP 2: Always allow "your/you" questions (user is asking about the company) ----
  if (/\byou(r|rs)?\b/.test(lower)) {
    return true;
  }

  // ---- STEP 3: Allow business/tech topic keywords ----
  const allowedTopics = [
    "service", "product", "solution", "offering", "pricing", "plan",
    "company", "business", "enterprise", "team", "support", "contact",
    "ai", "artificial intelligence", "machine learning", "deep learning",
    "cloud", "aws", "azure", "gcp", "saas", "paas", "iaas",
    "sap", "erp", "crm", "integration", "api", "automation",
    "cyber", "security", "data", "analytics", "software", "platform",
    "digital", "transformation", "consulting", "development", "devops",
    "iot", "blockchain", "rpa", "chatbot", "nlp", "computer vision",
    "technology", "tech", "infrastructure", "migration",
    "client", "customer", "partner", "case study", "portfolio",
  ];
  if (allowedTopics.some((kw) => lower.includes(kw))) {
    return true;
  }

  // ---- STEP 4: Block obviously irrelevant stuff ----
  const blocked = NOT_ALLOWED_KEYWORDS.some((kw) => lower.includes(kw));
  if (blocked) {
    return false;
  }

  // ---- STEP 5: For anything else, let it through — GPT will handle it ----
  // The GPT prompt is already instructed to stay on-topic.
  return true;
}

// ---------------------------------------------------------
// UTILITY FUNCTIONS
// ---------------------------------------------------------
function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return dot / (magA * magB);
}

function chunkText(text, file, maxWords = 180) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks = [];
  let current = [];
  let wordCount = 0;

  for (let sentence of sentences) {
    const words = sentence.split(" ");
    if (wordCount + words.length > maxWords) {
      chunks.push({ text: current.join(" ").trim(), source: file });
      current = [];
      wordCount = 0;
    }
    current.push(sentence);
    wordCount += words.length;
  }

  if (current.length > 0)
    chunks.push({ text: current.join(" ").trim(), source: file });

  // Add overlap for continuity
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1].text.split(" ").slice(-25).join(" ");
    chunks[i].text = prev + " " + chunks[i].text;
  }

  return chunks;
}

export function isGreetingOrNameMention(text) {
  const lower = text.toLowerCase();
  return /^(hi|hello|hey|hiya|howdy)\b/.test(lower) || /\baria\b/.test(lower);
}

export function isIrrelevantQuestion(text) {
  const lower = text.toLowerCase();
  return NOT_ALLOWED_KEYWORDS.some((kw) => lower.includes(kw));
}

export function getGreetingMessage() {
  return "Hi! I'm Veda, your AI assistant at Tekisho. How can I help you today?";
}

export function getSuggestedQuestions() {
  return SUGGESTED_QUESTIONS;
}

function isAddressQuestion(text) {
  const lower = text.toLowerCase();
  return /(address\b|\blocation\b|\boffice\b|\boffices\b|headquarter|\bhq\b|where (is|are|does) tekisho|where (are )?you (located|based|situated)|your (address|location|office|email|phone|number)|tekisho.*(address|location|office|email|phone|number|contact)|phone number|phone no|email address|contact (info|detail|number|us|tekisho)|how (to|can i|do i) (contact|reach|email|call)|tekisho contact|contact tekisho|reach tekisho|reach out to tekisho)/.test(lower);
}

function isFounderQuestion(text) {
  const lower = text.toLowerCase();
  return /(\bfounder|\bco.?founder|\bfounded\b|\bco.?founded\b|\bceo\b|chief executive|managing director|board director|leadership team|management team|who (founded|started|created|runs|leads|built|owns|heads?) (tekisho|the company|this company)|who (is|are|was|were) (the |tekisho.{0,15})(ceo|founder|director|head|leader|owner|boss)|tekisho.*(founded|started|leadership|management|directors?|team|owner)|founded by|started by|created by|built by|owned by|\bsrikanth\b|\bmallikarjun\b|\bmanasa\b|\bramakrishna\b|\bbonugu\b|\bdontula\b|\bdonthineni\b|\bbotta\b)/.test(lower);
}

// ---------------------------------------------------------
// LOAD DOCUMENTS + BUILD EMBEDDINGS
// ---------------------------------------------------------
export async function loadDocuments() {
  try {
    console.log("📚 Loading Tekisho documents...");
    const files = fs
      .readdirSync(DOCS_DIR)
      .filter((f) => f.match(/\.(pdf|docx|doc)$/i));

    if (files.length === 0) {
      console.warn("⚠️ No documents found in /upload folder. Answering from GPT directly.");
      knowledgeBaseLoaded = true;
      return;
    }

    let allChunks = [];
    for (const file of files) {
      const filePath = path.join(DOCS_DIR, file);
      let text = "";

      if (file.endsWith(".pdf")) {
        const pdfParse = (await import("pdf-parse")).default;
        const data = await pdfParse(fs.readFileSync(filePath));
        text = data.text || "";
      } else {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || "";
      }

      console.log(`📄 Loaded ${file} (${text.length} chars)`);
      allChunks.push(...chunkText(text, file));
    }

    documentChunks = allChunks;
    console.log(`✂️ Split into ${documentChunks.length} semantic chunks.`);

    const cachePath = path.join(__dirname, "../../embeddings_cache.json");
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (cached.chunks?.length === documentChunks.length) {
        console.log("⚡ Using cached embeddings...");
        chunkEmbeddings = cached.embeddings;
        knowledgeBaseLoaded = true;
        return;
      }
    }

    console.log("🔄 Creating embeddings...");
    const responses = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: documentChunks.map((c) => c.text),
    });

    chunkEmbeddings = responses.data.map((d) => d.embedding);
    knowledgeBaseLoaded = true;

    fs.writeFileSync(
      cachePath,
      JSON.stringify(
        { chunks: documentChunks, embeddings: chunkEmbeddings },
        null,
        2,
      ),
    );
    console.log("🧠 Knowledge base ready and cached!");
  } catch (err) {
    console.error("❌ Error loading documents:", err);
  }
}

// ---------------------------------------------------------
// RETRIEVE RELEVANT CHUNKS
// ---------------------------------------------------------
export async function retrieveRelevantChunks(question, topK = 3) {
  const cacheKey = question.toLowerCase().trim();
  let embedding;

  if (queryEmbeddingCache.has(cacheKey)) {
    embedding = queryEmbeddingCache.get(cacheKey);
  } else {
    const expandedQuery = `${question} company information services`;
    embedding = (
      await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: expandedQuery,
      })
    ).data[0].embedding;
    if (queryEmbeddingCache.size >= CACHE_MAX_SIZE) {
      queryEmbeddingCache.delete(queryEmbeddingCache.keys().next().value);
    }
    queryEmbeddingCache.set(cacheKey, embedding);
  }

  const sims = chunkEmbeddings.map((emb, i) => ({
    i,
    sim: cosineSimilarity(embedding, emb),
  }));
  sims.sort((a, b) => b.sim - a.sim);
  const filtered = sims.filter((s) => s.sim > 0.5).slice(0, topK);
  console.log(`📊 Retrieved ${filtered.length} chunks`);
  return filtered.map((s) => documentChunks[s.i]);
}

// ---------------------------------------------------------
// KNOWLEDGE BASE STATUS
// ---------------------------------------------------------
export function isKnowledgeBaseLoaded() {
  return knowledgeBaseLoaded;
}

export function getKnowledgeBaseStats() {
  return {
    loadedChunks: documentChunks.length,
    embeddings: chunkEmbeddings.length,
    loaded: knowledgeBaseLoaded,
  };
}

// ---------------------------------------------------------
// SMART FOLLOW-UP QUESTIONS (Tekisho-specific)
// ---------------------------------------------------------
async function generateFollowUps(answer) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Based on this answer about Tekisho Infotech: "${answer}"

Generate 3 SHORT follow-up questions (max 8 words each) that:
1. Are specifically about Tekisho Infotech's services, products, or capabilities
2. Would help users learn more about what Tekisho offers
3. Can be answered from company documentation

Examples of good questions:
- "What AI solutions does Tekisho provide?"
- "How does Tekisho ensure data security?"
- "What are Tekisho's main service offerings?"

Provide ONLY the 3 questions, one per line, no numbering or bullets.`,
        },
      ],
      temperature: 0.3,
      max_tokens: 80,
    });

    return response.choices[0].message.content
      .split("\n")
      .map((q) => q.replace(/^[\d.-]+\s*/, "").trim()) // Remove numbering
      .filter((q) => q.trim().length > 0)
      .slice(0, 3);
  } catch {
    // Fallback to Tekisho-specific default questions
    return [
      "What services does Tekisho offer?",
      "Tell me about Tekisho's technology",
      "How can Tekisho help my business?",
    ];
  }
}

// ---------------------------------------------------------
// INITIAL CHAT DATA (Welcome + Suggestions)
// ---------------------------------------------------------
export function getInitialChatData() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) greeting = "Good morning";
  else if (hour < 18) greeting = "Good afternoon";
  else greeting = "Good evening";

  return {
    welcomeMessage: `${greeting}. I'm Veda, your Tekisho assistant. How can I help you today?`,
    suggestions: [
      "What services does Tekisho offer?",
      "Tell me about your AI solutions",
      "How can I contact Tekisho support?",
    ],
  };
}

// ---------------------------------------------------------
// 🧠 MAIN AI RESPONSE LOGIC
// ---------------------------------------------------------
export async function handleUserQuestion(question) {
  const normalized = question.toLowerCase().trim();

  // ---------------------------------------------------------
  // 👋 GREETINGS & CASUAL CONVERSATION
  // ---------------------------------------------------------
  const greetingPatterns = [
    /^(hi|hello|hey|hiya|howdy|hola|yo)\b/,
    /^good\s*(morning|afternoon|evening|day|night)/,
    /^(gm|gn)\b/,
    /^(sup|what'?s\s*up|wassup)/,
  ];

  const farewellPatterns = [
    /^(bye|goodbye|see\s*you|take\s*care|good\s*night|later|cya|ttyl)/,
    /\b(bye|goodbye|see\s*you|take\s*care)\b/,
  ];

  const gratitudePatterns = [
    /^(thanks|thank\s*you|thx|ty|appreciate|grateful)/,
    /\b(thanks|thank\s*you)\b/,
  ];

  const smallTalkPatterns = [
    /^(how\s+are\s+you\b[\s?!.]*$|how\s+do\s+you\s+do|how'?s\s+it\s+going|what'?s\s+good)/,
    /^(who\s+are\s+you\b[\s?!.]*$|what\s+are\s+you\b[\s?!.]*$|what'?s\s+your\s+name[\s?!.]*$|^your\s+name[\s?!.]*$)/,
    /^(what\s+can\s+you\s+do|help\s+me$|can\s+you\s+help[\s?!.]*$)/,
    /^(nice|cool|awesome|great|okay|ok|sure|alright|got\s*it|i\s*see)\s*[.!]?$/,
  ];

  const isGreeting = greetingPatterns.some((p) => p.test(normalized));
  const isFarewell = farewellPatterns.some((p) => p.test(normalized));
  const isGratitude = gratitudePatterns.some((p) => p.test(normalized));
  const isSmallTalk = smallTalkPatterns.some((p) => p.test(normalized));

  if (isGreeting) {
    const hour = new Date().getHours();
    let timeGreeting = "Hello";
    if (hour < 12) timeGreeting = "Good morning";
    else if (hour < 18) timeGreeting = "Good afternoon";
    else timeGreeting = "Good evening";

    const answer = `${timeGreeting}. I'm Veda, your Tekisho assistant. How can I help you today?`;
    return {
      answer,
      followUps: [
        "What services does Tekisho offer?",
        "Tell me about your AI solutions",
        "How can I contact Tekisho support?",
      ],
      source: "greeting",
    };
  }

  if (isFarewell) {
    return {
      answer: "Goodbye! It was great chatting with you. Feel free to come back anytime you need help with Tekisho's services.",
      followUps: [],
      source: "farewell",
    };
  }

  if (isGratitude) {
    return {
      answer: "You're welcome! I'm happy to help. Is there anything else you'd like to know about Tekisho?",
      followUps: [
        "What services does Tekisho offer?",
        "Tell me about Tekisho's AI solutions",
      ],
      source: "gratitude",
    };
  }

  if (isSmallTalk) {
    if (/who\s+are\s+you\b[\s?!.]*$|what\s+are\s+you\b[\s?!.]*$|what'?s\s+your\s+name[\s?!.]*$/.test(normalized)) {
      return {
        answer: "I'm **Veda**, the AI assistant for **Tekisho Infotech**. I can help you learn about our services, AI solutions, cloud offerings, cybersecurity, and more. What would you like to know?",
        followUps: [
          "What services does Tekisho offer?",
          "Tell me about your AI solutions",
          "How can I contact Tekisho support?",
        ],
        source: "identity",
      };
    }
    if (/how\s+are\s+you\b[\s?!.]*$|how'?s\s+it\s+going/.test(normalized)) {
      return {
        answer: "I'm doing well, thanks for asking. Ready to help you with anything about Tekisho. What can I do for you?",
        followUps: [
          "What services does Tekisho offer?",
          "Tell me about your AI solutions",
        ],
        source: "smalltalk",
      };
    }
    if (/what\s*can\s*you\s*do|help\s*me|can\s*you\s*help/.test(normalized)) {
      return {
        answer: "I can help you with everything about **Tekisho Infotech** — our **AI solutions**, **cloud services**, **SAP** and enterprise solutions, **cybersecurity**, and company info. What would you like to know?",
        followUps: [
          "What services does Tekisho offer?",
          "Tell me about your AI solutions",
          "How can I contact Tekisho support?",
        ],
        source: "capabilities",
      };
    }
    // Generic acknowledgement (ok, cool, nice, etc.)
    return {
      answer: "Glad to hear that. Is there anything else you'd like to know about Tekisho?",
      followUps: [
        "What services does Tekisho offer?",
        "Tell me about Tekisho's AI solutions",
      ],
      source: "acknowledgement",
    };
  }

  // ---------------------------------------------------------
  // � ADDRESS / CONTACT INFO INTENT
  // ---------------------------------------------------------
  if (isAddressQuestion(question)) {
    const answer =
      "**Tekisho** has offices in **USA** (5005 W Royal Ln, Suite 288, Irving, TX 75063) and **India** (505 A, 5th Floor, Techno 1, Gachibowli Road, Raidurg, Hyderabad, Telangana 500032). Email: info@tekishoinfotech.com, Phone: +91 7331104192.";
    return {
      answer,
      followUps: [
        "What services does Tekisho offer?",
        "Who are the founders of Tekisho?",
        "How can I contact Tekisho support?",
      ],
      source: "address",
    };
  }

  // ---------------------------------------------------------
  // 👥 FOUNDERS / LEADERSHIP INTENT
  // ---------------------------------------------------------
  if (isFounderQuestion(question)) {
    const answer =
      "**Tekisho Infotech** was co-founded by **Srikanth Bonugu** and **Mallikarjun Dontula**. The leadership team also includes **Manasa Donthineni** (Managing Director) and **Ramakrishna Botta** (Board Director & Strategic Advisor).";
    return {
      answer,
      followUps: [
        "What is Tekisho's mission?",
        "What services does Tekisho offer?",
        "Where are Tekisho's offices?",
      ],
      source: "founders",
    };
  }

  // ---------------------------------------------------------
  // �📞 CONTACT SUPPORT INTENT
  // ---------------------------------------------------------
  if (detectContactIntent(question)) {
    const answer =
      "I'd be happy to connect you with our support team. Please share your name, email, and phone number, and our team will reach out to you shortly.";
    return {
      answer,
      followUps: [
        "What services does Tekisho offer?",
        "Tell me about Tekisho's AI solutions",
      ],
      source: "contact_intent",
    };
  }

  // ---------------------------------------------------------
  // ❌ CHECK RELEVANCE TO TEKISHO ONLY
  // ---------------------------------------------------------
  if (!isRelevantToTekisho(question)) {
    return {
      answer:
        "Thank you for your message. I am only able to assist with queries related to Tekisho Infotech, our services, and products.",
      followUps: [
        "What services does Tekisho offer?",
        "Tell me about Tekisho's AI solutions",
        "How can I contact Tekisho support?",
      ],
      source: "irrelevant",
    };
  }

  // ---------------------------------------------------------
  // ❌ BLOCK SPECIFIC IRRELEVANT TOPICS
  // ---------------------------------------------------------
  const containsNotAllowed = NOT_ALLOWED_KEYWORDS.some((kw) =>
    normalized.includes(kw),
  );

  if (containsNotAllowed) {
    // Check for critical mental health/suicide keywords
    const criticalKeywords = [
      "die",
      "death",
      "kill",
      "suicide",
      "suicidal",
      "harm myself",
      "hurt myself",
      "end my life",
    ];
    const isCritical = criticalKeywords.some((kw) => normalized.includes(kw));

    if (isCritical) {
      return {
        answer:
          "I'm not equipped to help with this. Please reach out to a mental health professional or crisis helpline immediately. Your safety matters.",
        followUps: [],
        source: "critical_blocked",
      };
    }

    return {
      answer:
        "Thank you for your message. I am only equipped to respond to queries related to Tekisho Infotech, our products, services, and technology solutions.",
      followUps: [
        "What services does Tekisho offer?",
        "How can Tekisho help with AI solutions?",
        "Tell me about Tekisho's technology stack",
      ],
      source: "restricted",
    };
  }

  // ---------------------------------------------------------
  // ⏳ KNOWLEDGE BASE LOADING
  // ---------------------------------------------------------
  if (!knowledgeBaseLoaded) {
    return {
      answer: "Loading company knowledge, please try again shortly.",
      followUps: [],
      source: "loading",
    };
  }

  // ---------------------------------------------------------
  // 🔍 RAG RETRIEVAL + ANSWERING
  // ---------------------------------------------------------
  try {
    let context = "";
    let citations = [];

    if (documentChunks.length > 0) {
      const relevantChunks = await retrieveRelevantChunks(question, 5);
      context = relevantChunks
        .map((chunk) => `${chunk.source}:\n${chunk.text}`)
        .join("\n\n");
      citations = [...new Set(relevantChunks.map((chunk) => chunk.source))];
    }

    const contextSection = context
      ? `Context from company documents:\n${context}`
      : `No documents are loaded yet. Answer based on general knowledge about Tekisho Infotech as an AI solutions company.`;

    const prompt = `
You are Veda, the friendly and helpful Tekisho Infotech company assistant.

IMPORTANT: When users say "your", "yours", "you" — they mean TEKISHO. Always interpret it that way.
IMPORTANT: Variations like "tekisho's", "Tekisho products", "tekisho ai" all refer to Tekisho Infotech.

VERIFIED COMPANY FACTS (always use these, never contradict them):
- Co-Founders: Srikanth Bonugu and Mallikarjun Dontula
- Managing Director: Manasa Donthineni
- Board Director & Strategic Advisor: Ramakrishna (Ram) Botta
- USA Office: Tekisho Infotech Inc., 5005 W Royal Ln, Suite 288, Irving, TX 75063
- India Office: Tekisho Infotech Pvt. Ltd., 505 A, 5th Floor, Techno 1, Gachibowli Road, Raidurg, Hyderabad, Telangana 500032
- Phone: +91 7331104192
- Email: info@tekishoinfotech.com
- Website: https://www.tekisho.ai

${contextSection}

Question: ${question}

RULES:
1. Answer in MAXIMUM 2 short sentences (under 40 words). Be direct and to the point.
2. Use **bold** only for 1-2 key terms. NO bullet lists — use a comma-separated phrase instead.
3. If off-topic (cooking, sports, celebrities), reply in ONE sentence: "Thank you for your message. I am only able to assist with queries related to Tekisho Infotech and its services."
4. Do NOT pad with extra sentences, summaries, or "Feel free to ask more".
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Veda, Tekisho Infotech's AI assistant. Give VERY SHORT answers — maximum 2 sentences, under 40 words. Be direct, formal, and professional. Do NOT use any emojis, informal phrases, or casual language. No long explanations or lists unless specifically asked.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 100,
    });

    const answer = response.choices[0].message.content.trim();
    const followUps = await generateFollowUps(answer);

    return {
      answer,
      followUps,
      citations,
      source: "knowledge_base",
    };
  } catch (err) {
    console.error("RAG Error:", err);

    return {
      answer: "⚠️ Sorry, I couldn’t find relevant information.",
      followUps: [],
      source: "fallback",
    };
  }
} // <-- CORRECT CLOSING BRACE
