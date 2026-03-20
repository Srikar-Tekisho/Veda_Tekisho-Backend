import express from "express";
import {
  createRealtimeSession,
  exchangeSDP,
} from "../services/voiceService.js";

const router = express.Router();

// Create realtime session and return ephemeral key
router.get("/", async (req, res) => {
  try {
    const data = await createRealtimeSession();
    res.json(data);
  } catch (err) {
    console.error("Realtime Session Failed:", err);
    res.status(500).json({ error: "Realtime session failed" });
  }
});

// Proxy SDP exchange to avoid CORS issues
router.post("/sdp", async (req, res) => {
  try {
    const { sdp, token } = req.body;

    if (!sdp || !token) {
      return res.status(400).json({ error: "SDP and token required" });
    }

    const answer = await exchangeSDP(sdp, token);
    res.set("Content-Type", "application/sdp");
    res.send(answer);
  } catch (err) {
    console.error("SDP exchange error:", err);
    res.status(500).json({ error: "SDP exchange failed" });
  }
});

export default router;
