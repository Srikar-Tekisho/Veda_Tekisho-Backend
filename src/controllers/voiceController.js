import express from "express";
import { upload, processVoice } from "../services/voiceService.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Voice
 *   description: Voice AI processing
 */

/**
 * @swagger
 * /voice:
 *   post:
 *     summary: Process voice input and return AI response
 *     tags: [Voice]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Processed text + AI reply
 */
router.post("/", upload.single("audio"), async (req, res) => {
  try {
    const result = await processVoice(req.file.buffer);
    res.json(result);
  } catch (err) {
    console.error("Voice API error:", err);
    res.status(500).json({ error: "Voice processing failed" });
  }
});

export default router;
