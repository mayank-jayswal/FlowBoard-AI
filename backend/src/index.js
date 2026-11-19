import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import { Server } from "socket.io";

import { prisma } from "./lib/prisma.js";
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import boardsRouter from "./routes/boards.js";
import aiRouter from "./routes/ai.js";

import { authenticate } from "./middleware/auth.js";
import jwt from "jsonwebtoken";

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

// Attach io to every request so route handlers can emit
app.use((req, _res, next) => {
  req.io = app.get("io");
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/boards", boardsRouter);
app.use("/api/boards/:id/ai", authenticate, aiRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ─── HTTP + Socket.IO ────────────────────────────────────────────────────────
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  },
});

app.set("io", io);

// Authenticate socket connections with the same JWT
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, avatar_url: true },
    });
    if (!user) return next(new Error("User not found"));
    socket.user = user;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

// Presence tracking: boardId → Set of user objects
const boardPresence = new Map();

io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.user.name} (${socket.id})`);

  socket.on("board:join", (boardId) => {
    socket.join(boardId);
    socket.currentBoardId = boardId;

    if (!boardPresence.has(boardId)) boardPresence.set(boardId, new Map());
    boardPresence.get(boardId).set(socket.id, socket.user);

    // Send full presence list to the joiner
    socket.emit("presence:sync", {
      users: [...boardPresence.get(boardId).values()],
    });

    // Notify others
    socket.to(boardId).emit("presence:join", { user: socket.user });
  });

  socket.on("board:leave", (boardId) => {
    socket.leave(boardId);
    boardPresence.get(boardId)?.delete(socket.id);
    socket.to(boardId).emit("presence:leave", { user: socket.user });
    socket.currentBoardId = null;
  });

  socket.on("disconnect", () => {
    const boardId = socket.currentBoardId;
    if (boardId) {
      boardPresence.get(boardId)?.delete(socket.id);
      socket.to(boardId).emit("presence:leave", { user: socket.user });
    }
    console.log(`❌ Socket disconnected: ${socket.user.name}`);
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5050;
httpServer.listen(PORT, () => {
  console.log(`🚀 FlowBoard AI backend running on http://localhost:${PORT}`);
});

