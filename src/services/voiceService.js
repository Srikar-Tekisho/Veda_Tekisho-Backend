import multer from "multer";
import { openai } from "../providers/openaiProvider.js";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// File handler for receiving audio
export const upload = multer({ storage: multer.memoryStorage() });

/**
 * Clean text for TTS - remove markdown symbols, emojis, and special characters
 */
function cleanTextForTTS(text) {
  if (!text) return text;

  return (
    text
      // Remove emojis and special symbols
      .replace(
        /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
        "",
      )
      // Remove warning symbols ⚠️ ❌ ✅ etc
      .replace(/[⚠️❌✅✓✔️⭐🚀📚💡🎯🔒🔐🌐💬📞📧🏢👥]/g, "")
      // Remove markdown bold/italic
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      // Remove markdown headers (# ## ###)
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bullet points
      .replace(/^[\s]*[•\-\*]\s+/gm, "")
      // Remove numbered lists (1. 2. 3.)
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Remove code blocks and inline code
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      // Remove markdown links [text](url)
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
      // Remove extra whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

export async function processVoice(audioBuffer) {
  try {
    // Create a File-like object for OpenAI API
    const audioFile = new File([audioBuffer], "audio.webm", {
      type: "audio/webm",
    });

    // Convert speech -> text
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });

    const text = transcription.text || "Sorry, I didn't catch that.";
    console.log("🎤 Transcribed:", text);

    // Call the /ask endpoint internally
    const response = await fetch("http://localhost:5002/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text }),
    });

    const result = await response.json();

    // Convert text -> speech (clean symbols first)
    const ttsVoice = process.env.TTS_VOICE || "shimmer";

    // Clean the answer text before TTS
    const cleanAnswer = cleanTextForTTS(
      result.answer || "I couldn't process that.",
    );

    const ttsResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: ttsVoice,
      input: cleanAnswer,
      format: "mp3",
    });

    const audioOut = Buffer.from(await ttsResponse.arrayBuffer());

    return {
      text: result.answer,
      audio: audioOut.toString("base64"),
      followUps: result.followUps || [],
    };
  } catch (error) {
    console.error("Voice processing error:", error);
    return {
      text: "⚠️ Voice processing failed",
      audio: null,
      followUps: [],
    };
  }
}

// Create OpenAI Realtime session
export async function createRealtimeSession() {
  try {
    const realtimeResp = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "realtime=v1",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview",
          voice: process.env.TTS_VOICE || "shimmer",

          max_response_output_tokens: 1024,

          turn_detection: {
            type: "server_vad",
            threshold: 0.4,
            prefix_padding_ms: 400,
            silence_duration_ms: 900,
            create_response: true,
          },

          input_audio_transcription: {
            model: "whisper-1",
          },

          instructions: `
You are Veda, the official AI voice assistant for Tekisho Infotech.
Speak clearly, professionally, and warmly — like a knowledgeable company representative.

CRITICAL: ALWAYS complete your full answer. Never cut off mid-sentence.
CRITICAL: NEVER guess or hallucinate. Only use facts listed below.

When users say "your", "you", or "yours" they mean TEKISHO INFOTECH.

VERIFIED COMPANY FACTS — USE EXACTLY THESE:
- Company: Tekisho Infotech (USA: Tekisho Infotech Inc. | India: Tekisho Infotech Pvt. Ltd.)
- Co-Founders: Srikanth Bonugu and Mallikarjun Dontula
- Managing Director: Manasa Donthineni
- Board Director and Strategic Advisor: Ramakrishna Botta (also called Ram Botta)
- USA Office: 5005 West Royal Lane, Suite 288, Irving, Texas 75063
- India Office: 505 A, 5th Floor, Techno 1, Gachibowli Road, Raidurg, Hyderabad, Telangana 500032
- Phone: plus 91 73311 04192
- Email: info at tekishoinfotech dot com
- Website: tekisho dot ai

TEKISHO SERVICES:
Artificial Intelligence and Machine Learning, Cloud Solutions on AWS Azure and Google Cloud, SAP and ERP implementations, Cybersecurity, Digital Transformation consulting, RPA and Automation, Data Analytics and Business Intelligence, IoT Solutions, DevOps and Infrastructure, and Custom Software Development.

VOICE RULES:
- No asterisks, bullet points, emojis, or markdown. Plain natural English only.
- Use "first", "second", "also" instead of lists.
- Always finish every sentence completely.

GREETING: Start with "Hi, I'm Veda, the AI assistant for Tekisho Infotech. How can I help you today?"

OFF-TOPIC: If asked anything unrelated to Tekisho, say "I'm here specifically to assist with questions about Tekisho Infotech. Is there anything about our services or company I can help you with?"
`,
        }),
      },
    );

    const data = await realtimeResp.json();

    if (!data.client_secret) {
      console.error("Realtime session error:", data);
      throw new Error("Failed to create realtime session");
    }

    console.log("🎧 Realtime session created!");
    return data;
  } catch (error) {
    console.error("Realtime Session Failed:", error);
    throw error;
  }
}

// Exchange SDP for WebRTC connection
export async function exchangeSDP(sdp, token) {
  try {
    if (!sdp || !token) {
      throw new Error("SDP and token are required");
    }

    const sdpResp = await fetch(
      "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          Authorization: `Bearer ${token}`,
          "OpenAI-Beta": "realtime=v1",
        },
        body: sdp,
      },
    );

    if (!sdpResp.ok) {
      const errorText = await sdpResp.text();
      console.error("SDP exchange failed:", sdpResp.status, errorText);
      throw new Error(`SDP exchange failed: ${errorText}`);
    }

    const answer = await sdpResp.text();
    return answer;
  } catch (error) {
    console.error("SDP exchange error:", error);
    throw error;
  }
}
