console.log("🚀 Server process started...");
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  loadDocuments,
  getKnowledgeBaseStats,
} from "./src/services/ragService.js";
import chatController from "./src/controllers/chatController.js";
import feedbackController from "./src/controllers/feedbackController.js";
import realtimeController from "./src/controllers/realtimeController.js";

dotenv.config();

const app = express();

// =======================
// CORS CONFIGURATION
// =======================
app.use(cors());
app.options('*', cors());
app.use(express.json());

// =======================
// LOAD KNOWLEDGE BASE
// =======================
await loadDocuments();

// =======================
// ROUTES
// =======================
app.use("/", chatController);
app.use("/feedback", feedbackController);
app.use("/realtime-session", realtimeController);

// =======================
// HEALTH CHECK
// =======================
app.get("/health", (req, res) => {
  const stats = getKnowledgeBaseStats();
  res.json({
    status: "✅ Veda RAG System Running",
    ...stats,
  });
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5002;
app.listen(PORT, () =>
  console.log(`🚀 Veda backend live at http://localhost:${PORT}`),
);
