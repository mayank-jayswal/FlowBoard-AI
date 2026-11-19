import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if user is a member (or owner) of the board; return their role. */
const getBoardRole = async (boardId, userId) => {
  const member = await prisma.boardMember.findUnique({
    where: { board_id_user_id: { board_id: boardId, user_id: userId } },
  });
  return member?.role ?? null;
};

/** Full board detail object expected by the frontend. */
const boardDetail = async (boardId, userId) => {
  const board = await prisma.board.findUnique({ where: { id: boardId } });
  if (!board) return null;

  const [columns, tasks, members] = await Promise.all([
    prisma.column.findMany({ where: { board_id: boardId }, orderBy: { position: "asc" } }),
    prisma.task.findMany({
      where: { board_id: boardId },
      orderBy: { position: "asc" },
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
      },
    }),
    prisma.boardMember.findMany({
      where: { board_id: boardId },
      include: { user: { select: { id: true, name: true, email: true, avatar_url: true } } },
    }),
  ]);

  const role = members.find((m) => m.user_id === userId)?.role ?? "member";

  return {
    board,
    columns,
    tasks: tasks.map((t) => ({
      ...t,
      assignee_id: t.assignee_id,
      assignee_name: t.assignee?.name ?? null,
      assignee_email: t.assignee?.email ?? null,
      assignee_avatar: t.assignee?.avatar_url ?? null,
      assignee: undefined,
    })),
    members: members.map((m) => ({ ...m.user, role: m.role })),
    role,
  };
};

/** Log an activity entry and emit via socket. */
const logActivity = async (io, { boardId, userId, action, message }) => {
  const activity = await prisma.activity.create({
    data: { board_id: boardId, user_id: userId, action, message },
    include: { user: { select: { id: true, name: true, avatar_url: true } } },
  });
  io?.to(boardId).emit("activity:created", {
    ...activity,
    user_name: activity.user.name,
    user_avatar: activity.user.avatar_url,
  });
  return activity;
};

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/boards
router.get("/", authenticate, async (req, res) => {
  const memberships = await prisma.boardMember.findMany({
    where: { user_id: req.user.id },
    include: {
      board: {
        include: {
          _count: {
            select: {
              tasks: true,
              members: true,
            },
          },
        },
      },
    },
    orderBy: { board: { updated_at: "desc" } },
  });
  const boards = memberships.map((m) => ({
    ...m.board,
    role: m.role,
    is_owner: m.role === "owner" || m.board.owner_id === req.user.id,
    task_count: m.board._count.tasks,
    member_count: m.board._count.members,
    _count: undefined,
  }));
  return res.json({ boards });
});

// POST /api/boards
router.post("/", authenticate, async (req, res) => {
  const { title, description, color } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });

  const board = await prisma.$transaction(async (tx) => {
    const b = await tx.board.create({
      data: { title, description, color: color || "#2f8159", owner_id: req.user.id },
    });
    // Add owner as member with 'owner' role
    await tx.boardMember.create({
      data: { board_id: b.id, user_id: req.user.id, role: "owner" },
    });
    // Create default columns
    const cols = ["Todo", "In Progress", "Review", "Done"];
    await tx.column.createMany({
      data: cols.map((title, i) => ({ board_id: b.id, title, position: (i + 1) * 1000 })),
    });
    return b;
  });

  const payload = {
    ...board,
    role: "owner",
    is_owner: true,
    task_count: 0,
    member_count: 1,
  };

  return res.status(201).json({ board: payload });
});

// GET /api/boards/:id
router.get("/:id", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const detail = await boardDetail(req.params.id, req.user.id);
  if (!detail) return res.status(404).json({ error: "Board not found" });
  return res.json(detail);
});

// PATCH /api/boards/:id
router.patch("/:id", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role || role === "member") return res.status(403).json({ error: "Insufficient permissions" });

  const { title, description, color } = req.body;
  const board = await prisma.board.update({
    where: { id: req.params.id },
    data: { ...(title && { title }), ...(description !== undefined && { description }), ...(color && { color }) },
  });

  req.io?.to(req.params.id).emit("board:updated", board);
  return res.json({ board });
});

// DELETE /api/boards/:id
router.delete("/:id", authenticate, async (req, res) => {
  const board = await prisma.board.findUnique({ where: { id: req.params.id } });
  if (!board) return res.status(404).json({ error: "Board not found" });
  if (board.owner_id !== req.user.id) return res.status(403).json({ error: "Only the owner can delete this board" });

  await prisma.board.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
});

// GET /api/boards/:id/activity
router.get("/:id/activity", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const activities = await prisma.activity.findMany({
    where: { board_id: req.params.id },
    orderBy: { created_at: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true, avatar_url: true } } },
  });

  return res.json({
    activities: activities.map((a) => ({
      ...a,
      user_name: a.user.name,
      user_avatar: a.user.avatar_url,
      user: undefined,
    })),
  });
});

// POST /api/boards/:id/members
router.post("/:id/members", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role || role === "member") return res.status(403).json({ error: "Insufficient permissions" });

  const { email, role: memberRole } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: "No user found with that email" });

  const existing = await prisma.boardMember.findUnique({
    where: { board_id_user_id: { board_id: req.params.id, user_id: user.id } },
  });
  if (existing) return res.status(409).json({ error: "User is already a member" });

  const member = await prisma.boardMember.create({
    data: { board_id: req.params.id, user_id: user.id, role: memberRole === "admin" ? "admin" : "member" },
    include: { user: { select: { id: true, name: true, email: true, avatar_url: true } } },
  });

  await logActivity(req.io, {
    boardId: req.params.id,
    userId: req.user.id,
    action: "member.added",
    message: `${req.user.name} added ${user.name} to the board`,
  });

  return res.status(201).json({ member: { ...member.user, role: member.role } });
});

// DELETE /api/boards/:id/members/:userId
router.delete("/:id/members/:userId", authenticate, async (req, res) => {
  const callerRole = await getBoardRole(req.params.id, req.user.id);
  if (!callerRole || callerRole === "member") return res.status(403).json({ error: "Insufficient permissions" });

  const targetMember = await prisma.boardMember.findUnique({
    where: { board_id_user_id: { board_id: req.params.id, user_id: req.params.userId } },
    include: { user: { select: { name: true } } },
  });
  if (!targetMember) return res.status(404).json({ error: "Member not found" });
  if (targetMember.role === "owner") return res.status(400).json({ error: "Cannot remove the board owner" });

  await prisma.boardMember.delete({
    where: { board_id_user_id: { board_id: req.params.id, user_id: req.params.userId } },
  });

  await logActivity(req.io, {
    boardId: req.params.id,
    userId: req.user.id,
    action: "member.removed",
    message: `${req.user.name} removed ${targetMember.user.name} from the board`,
  });

  return res.json({ success: true });
});

// ─── Columns ──────────────────────────────────────────────────────────────────

// POST /api/boards/:id/columns
router.post("/:id/columns", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });

  // Position after last column
  const last = await prisma.column.findFirst({
    where: { board_id: req.params.id },
    orderBy: { position: "desc" },
  });
  const position = (last?.position ?? 0) + 1000;

  const column = await prisma.column.create({
    data: { board_id: req.params.id, title, position },
  });

  await prisma.board.update({ where: { id: req.params.id }, data: { updated_at: new Date() } });
  req.io?.to(req.params.id).emit("column:created", column);
  return res.status(201).json({ column });
});

// PATCH /api/boards/:id/columns/:colId
router.patch("/:id/columns/:colId", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const { title, position } = req.body;
  const column = await prisma.column.update({
    where: { id: req.params.colId },
    data: { ...(title && { title }), ...(position !== undefined && { position }) },
  });

  req.io?.to(req.params.id).emit("column:updated", column);
  return res.json({ column });
});

// DELETE /api/boards/:id/columns/:colId
router.delete("/:id/columns/:colId", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role || role === "member") return res.status(403).json({ error: "Insufficient permissions" });

  await prisma.column.delete({ where: { id: req.params.colId } });
  req.io?.to(req.params.id).emit("column:deleted", { id: req.params.colId });
  return res.json({ success: true });
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

// GET /api/boards/:id/tasks
router.get("/:id/tasks", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const tasks = await prisma.task.findMany({
    where: { board_id: req.params.id },
    orderBy: { position: "asc" },
    include: { assignee: { select: { id: true, name: true, email: true, avatar_url: true } } },
  });

  return res.json({
    tasks: tasks.map((t) => ({
      ...t,
      assignee_name: t.assignee?.name ?? null,
      assignee_email: t.assignee?.email ?? null,
      assignee_avatar: t.assignee?.avatar_url ?? null,
      assignee: undefined,
    })),
  });
});

// POST /api/boards/:id/tasks
router.post("/:id/tasks", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const { title, description, priority, due_date, assignee_id, column_id, position } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  if (!column_id) return res.status(400).json({ error: "column_id is required" });

  // Position at end of column if not provided
  let pos = position;
  if (pos === undefined) {
    const last = await prisma.task.findFirst({
      where: { column_id },
      orderBy: { position: "desc" },
    });
    pos = (last?.position ?? 0) + 1000;
  }

  const task = await prisma.task.create({
    data: {
      board_id: req.params.id,
      column_id,
      title,
      description: description || null,
      priority: priority || "medium",
      due_date: due_date ? new Date(due_date) : null,
      assignee_id: assignee_id || null,
      created_by: req.user.id,
      position: pos,
    },
    include: { assignee: { select: { id: true, name: true, email: true, avatar_url: true } } },
  });

  await prisma.board.update({ where: { id: req.params.id }, data: { updated_at: new Date() } });

  const payload = {
    ...task,
    assignee_name: task.assignee?.name ?? null,
    assignee_email: task.assignee?.email ?? null,
    assignee_avatar: task.assignee?.avatar_url ?? null,
    assignee: undefined,
  };

  req.io?.to(req.params.id).emit("task:created", payload);

  await logActivity(req.io, {
    boardId: req.params.id,
    userId: req.user.id,
    action: "task.created",
    message: `${req.user.name} created "${title}"`,
  });

  return res.status(201).json({ task: payload });
});

// PATCH /api/boards/:id/tasks/:taskId
router.patch("/:id/tasks/:taskId", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const { title, description, priority, due_date, assignee_id } = req.body;

  const task = await prisma.task.update({
    where: { id: req.params.taskId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(priority !== undefined && { priority }),
      ...(due_date !== undefined && { due_date: due_date ? new Date(due_date) : null }),
      ...(assignee_id !== undefined && { assignee_id: assignee_id || null }),
    },
    include: { assignee: { select: { id: true, name: true, email: true, avatar_url: true } } },
  });

  const payload = {
    ...task,
    assignee_name: task.assignee?.name ?? null,
    assignee_email: task.assignee?.email ?? null,
    assignee_avatar: task.assignee?.avatar_url ?? null,
    assignee: undefined,
  };

  req.io?.to(req.params.id).emit("task:updated", payload);

  await logActivity(req.io, {
    boardId: req.params.id,
    userId: req.user.id,
    action: "task.updated",
    message: `${req.user.name} updated "${task.title}"`,
  });

  return res.json({ task: payload });
});

// PATCH /api/boards/:id/tasks/:taskId/move
router.patch("/:id/tasks/:taskId/move", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const { column_id, position } = req.body;
  if (!column_id || position === undefined)
    return res.status(400).json({ error: "column_id and position are required" });

  const task = await prisma.task.update({
    where: { id: req.params.taskId },
    data: { column_id, position },
    include: { assignee: { select: { id: true, name: true, email: true, avatar_url: true } } },
  });

  await prisma.board.update({ where: { id: req.params.id }, data: { updated_at: new Date() } });

  const payload = {
    ...task,
    assignee_name: task.assignee?.name ?? null,
    assignee_email: task.assignee?.email ?? null,
    assignee_avatar: task.assignee?.avatar_url ?? null,
    assignee: undefined,
  };

  req.io?.to(req.params.id).emit("task:moved", payload);
  return res.json({ task: payload });
});

// DELETE /api/boards/:id/tasks/:taskId
router.delete("/:id/tasks/:taskId", authenticate, async (req, res) => {
  const role = await getBoardRole(req.params.id, req.user.id);
  if (!role) return res.status(403).json({ error: "Access denied" });

  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!task) return res.status(404).json({ error: "Task not found" });

  await prisma.task.delete({ where: { id: req.params.taskId } });
  req.io?.to(req.params.id).emit("task:deleted", { id: req.params.taskId });

  await logActivity(req.io, {
    boardId: req.params.id,
    userId: req.user.id,
    action: "task.deleted",
    message: `${req.user.name} deleted "${task.title}"`,
  });

  return res.json({ success: true });
});

export { logActivity };
export default router;

