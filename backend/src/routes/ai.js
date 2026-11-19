import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/auth.js";

const router = Router({ mergeParams: true }); // gives us :id (boardId)

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getBoardRole = async (boardId, userId) => {
  const member = await prisma.boardMember.findUnique({
    where: { board_id_user_id: { board_id: boardId, user_id: userId } },
  });
  return member?.role ?? null;
};

/** Call Gemini or OpenAI based on AI_PROVIDER env var. */
const callAI = async (prompt) => {
  const provider = process.env.AI_PROVIDER || "google";

  if (provider === "google") {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const candidates = [
      { model: "gemini-3.5-flash-lite" },
      { model: "gemini-3.1-flash-lite" },
      { model: "gemini-3.8-flash" },
      { model: "gemini-3.5-flash" },
      { model: "gemini-flash-latest" },
    ];

    let lastError = null;
    for (const cand of candidates) {
      try {
        const model = genAI.getGenerativeModel(
          {
            model: cand.model,
            generationConfig: { responseMimeType: "application/json" },
          },
          cand.requestOptions
        );
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err) {
        lastError = err;
        if (
          err.status === 404 ||
          err.status === 503 ||
          err.message?.includes("404") ||
          err.message?.includes("503") ||
          err.message?.includes("not found") ||
          err.message?.includes("high demand")
        ) {
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  if (provider === "openai") {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    return chat.choices[0].message.content;
  }

  throw new Error("Unknown AI_PROVIDER");
};

/** Extract the first JSON array or object from an LLM response string. */
const extractJSON = (text) => {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/) || cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    return JSON.parse(match ? match[1].trim() : cleaned);
  }
};

// ─── POST /api/boards/:id/ai/generate-tasks ───────────────────────────────────
router.post("/generate-tasks", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const { goal, count = 6, column_id } = req.body;
  if (!goal) return res.status(400).json({ error: "goal is required" });

  const prompt = `You are a project management assistant. 
Generate exactly ${count} Kanban tasks for this goal: "${goal}".

Respond ONLY with a JSON array. Each item must have:
- "title": short action-oriented task title (max 60 chars)
- "description": one-sentence description
- "priority": one of "low", "medium", "high", "urgent"

Example:
[
  {"title": "Design login screen", "description": "Create wireframes for the login UI.", "priority": "high"},
  ...
]`;

  let rawTasks;
  try {
    const text = await callAI(prompt);
    rawTasks = extractJSON(text);
    if (!Array.isArray(rawTasks)) throw new Error("Expected array");
  } catch (err) {
    return res.status(502).json({ error: "AI failed to generate tasks: " + err.message });
  }

  // If column_id is not provided, treat as preview mode (don't persist to DB yet)
  if (!column_id) {
    return res.json({
      tasks: rawTasks.slice(0, count).map((t, i) => ({
        id: `preview-${i}`,
        title: t.title || "Untitled",
        description: t.description || null,
        priority: ["low", "medium", "high", "urgent"].includes(t.priority) ? t.priority : "medium",
      })),
    });
  }

  const targetColumnId = column_id;

  // Persist tasks to DB
  const lastTask = await prisma.task.findFirst({
    where: { column_id: targetColumnId },
    orderBy: { position: "desc" },
  });
  let basePosition = (lastTask?.position ?? 0) + 1000;

  const created = await Promise.all(
    rawTasks.slice(0, count).map((t, i) =>
      prisma.task.create({
        data: {
          board_id: req.params.id,
          column_id: targetColumnId,
          title: t.title || "Untitled",
          description: t.description || null,
          priority: ["low", "medium", "high", "urgent"].includes(t.priority) ? t.priority : "medium",
          position: basePosition + i * 1000,
          created_by: req.user.id,
        },
        include: { assignee: { select: { id: true, name: true, email: true, avatar_url: true } } },
      })
    )
  );

  const tasks = created.map((t) => ({
    ...t,
    assignee_name: null,
    assignee_email: null,
    assignee_avatar: null,
    assignee: undefined,
  }));

  // Broadcast each new task via socket
  tasks.forEach((t) => req.io?.to(req.params.id).emit("task:created", t));

  return res.json({ tasks });
});

// ─── POST /api/boards/:id/ai/breakdown ────────────────────────────────────────
router.post("/breakdown", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: "taskId is required" });

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: "Task not found" });

  const prompt = `You are a project management assistant.
Break down this task into 3–5 clear, concrete subtasks:

Task title: "${task.title}"
${task.description ? `Description: "${task.description}"` : ""}

Respond ONLY with a JSON array. Each item must have:
- "title": short action-oriented subtask title (max 60 chars)
- "description": one sentence
- "priority": one of "low", "medium", "high", "urgent"

Example:
[
  {"title": "Define data model", "description": "Outline the schema and relationships.", "priority": "high"},
  ...
]`;

  let subtasks;
  try {
    const text = await callAI(prompt);
    subtasks = extractJSON(text);
    if (!Array.isArray(subtasks)) throw new Error("Expected array");
  } catch (err) {
    return res.status(502).json({ error: "AI breakdown failed: " + err.message });
  }

  return res.json({ subtasks });
});

// ─── POST /api/boards/:id/ai/summary ─────────────────────────────────────────
router.post("/summary", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const [columns, tasks] = await Promise.all([
    prisma.column.findMany({ where: { board_id: req.params.id }, orderBy: { position: "asc" } }),
    prisma.task.findMany({
      where: { board_id: req.params.id },
      include: { assignee: { select: { name: true } } },
    }),
  ]);

  if (!tasks.length) return res.json({ summary: { headline: "No tasks on this board yet.", completed: [], inProgress: [], risks: [], recommendations: [] } });

  const colTitle = Object.fromEntries(columns.map((c) => [c.id, c.title]));
  const taskLines = tasks
    .map((t) => `- [${colTitle[t.column_id] ?? "?"}] ${t.title} (priority: ${t.priority}${t.assignee ? `, assignee: ${t.assignee.name}` : ", unassigned"}${t.due_date ? `, due: ${t.due_date.toISOString().slice(0, 10)}` : ""})`)
    .join("\n");

  const prompt = `You are a project management assistant. Analyze this Kanban board and produce a sprint summary.

Tasks:
${taskLines}

Respond ONLY with a JSON object matching exactly:
{
  "headline": "One paragraph summary of board status",
  "completed": ["item in Done column 1", ...],
  "inProgress": ["item being worked on 1", ...],
  "risks": ["risk or blocker 1", ...],
  "recommendations": ["action recommendation 1", ...]
}`;

  let summary;
  try {
    const text = await callAI(prompt);
    summary = extractJSON(text);
  } catch (err) {
    return res.status(502).json({ error: "AI summary failed: " + err.message });
  }

  return res.json({ summary });
});

export default router;

