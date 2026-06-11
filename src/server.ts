import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server } from "socket.io";
import { allowedOrigins, port } from "./lib/config.js";
import { storageMode } from "./lib/chatStore.js";
import { isPushConfigured } from "./lib/pushService.js";
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
