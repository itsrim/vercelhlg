import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env racine (VITE_GOOGLE_SHEETS_*) puis backend/.env (JWT, Mailjet…)
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server } from "socket.io";
import { allowedOrigins, port } from "./lib/config.js";
import { storageMode } from "./lib/chatStore.js";
import { authStorageMode } from "./lib/authStore.js";
import { isPushConfigured } from "./lib/pushService.js";
import { isSheetsReadConfigured } from "./lib/googleSheets.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { pushRoutes } from "./routes/push.js";
import { registerChatSocket } from "./socket/chatSocket.js";

const app = Fastify({ logger: true });
const origins = allowedOrigins();

await app.register(cors, {
  origin: origins.includes("*") ? true : origins,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
});

app.get("/api/health", async () => ({
  ok: true,
  service: "hlg-chat-api",
  storage: storageMode(),
  auth: authStorageMode(),
  sheets: isSheetsReadConfigured(),
  realtime: "socket.io",
  push: isPushConfigured(),
  timestamp: Date.now(),
}));

await app.register(authRoutes);
await app.register(chatRoutes);
await app.register(pushRoutes);

const io = new Server(app.server, {
  cors: {
    origin: origins.includes("*") ? "*" : origins,
    methods: ["GET", "POST"],
  },
});

registerChatSocket(io);

const listenPort = port();
await app.listen({ port: listenPort, host: "0.0.0.0" });

app.log.info(`Nel chat API listening on http://0.0.0.0:${listenPort}`);
