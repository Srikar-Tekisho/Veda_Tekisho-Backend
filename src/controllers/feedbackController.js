import express from "express";
import { saveFeedback } from "../repositories/supabaseRepo.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Feedback
 *   description: Store user feedback
 */

/**
 * @swagger
 * /feedback:
 *   post:
 *     summary: Submit user feedback
 *     tags: [Feedback]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Feedback saved successfully
 */
router.post("/", async (req, res) => {
  try {
    await saveFeedback(req.body);
    res.json({ status: "success" });
  } catch (err) {
    console.error("Feedback Error:", err);
    res.status(500).json({ error: "Feedback failed" });
  }
});

export default router;
