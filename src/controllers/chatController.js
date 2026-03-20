import express from "express";
import {
  handleUserQuestion,
  getInitialChatData,
} from "../services/ragService.js";
import { saveContact } from "../repositories/supabaseRepo.js";
import {
  detectContactIntent,
  extractContactDetails,
} from "../services/intentService.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Chatbot interaction APIs
 */

/**
 * @swagger
 * /init:
 *   get:
 *     summary: Get initial chat data (welcome message and suggestions)
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Initial chat data
 */
router.get("/init", (req, res) => {
  const data = getInitialChatData();
  res.json(data);
});

/**
 * @swagger
 * /onboard:
 *   post:
 *     summary: Save user onboarding details to database
 *     tags: [Chat]
 */
router.post("/onboard", async (req, res) => {
  console.log("📥 Received onboard request:", req.body);
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ error: "Name, email, and phone are required" });
    }
    const result = await saveContact({ name, phone, email });
    console.log("✅ saveContact result:", result);
    res.json({ success: true, message: "Onboarding details saved successfully" });
  } catch (error) {
    console.error("❌ Onboarding Error:", error);
    res.status(500).json({ error: "Server error during onboarding" });
  }
});

/**
 * @swagger
 * /ask:
 *   post:
 *     summary: Ask chatbot a question
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *             properties:
 *               question:
 *                 type: string
 *     responses:
 *       200:
 *         description: Chatbot response with follow-ups
 */
router.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    if (detectContactIntent(question)) {
      const { name, phone, email } = extractContactDetails(question);

      if (!phone || !email) {
        return res.json({
          answer:
            "To help you better, please share your contact details:\n• Name\n• Email\n• Phone Number\n\nOur support team will reach out to you shortly.",
          followUps: [],
        });
      }

      await saveContact({ name, phone, email });

      return res.json({
        answer: `Thank you for sharing your details, ${name}! 🎉\n\nOur team will reach out to you soon at ${email}.\n\nWe appreciate your interest and look forward to connecting with you!`,
        followUps: [
          "What services does Tekisho offer?",
          "Tell me about Tekisho's AI solutions",
        ],
      });
    }

    const result = await handleUserQuestion(question);
    res.json(result);
  } catch (error) {
    console.error("❌ Chat Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /ask-stream:
 *   post:
 *     summary: Ask chatbot a question with streaming response
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *             properties:
 *               question:
 *                 type: string
 *     responses:
 *       200:
 *         description: Streaming chatbot response
 */
router.post("/ask-stream", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    // Set headers for Server-Sent Events
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const result = await handleUserQuestion(question);

    // Stream the answer word by word
    const words = result.answer.split(" ");
    for (let i = 0; i < words.length; i++) {
      res.write(`data: ${JSON.stringify({ content: words[i] + " " })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms delay between words
    }

    // Send follow-ups, citations, and done signal
    res.write(
      `data: ${JSON.stringify({ followUps: result.followUps || [], citations: result.citations || [], done: true })}\n\n`,
    );
    res.end();
  } catch (error) {
    console.error("❌ Stream Error:", error);
    res.write(`data: ${JSON.stringify({ error: "Server error" })}\n\n`);
    res.end();
  }
});

export default router;
