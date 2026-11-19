import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/users/search?q=
router.get("/search", authenticate, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ users: [] });

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { id: { not: req.user.id } }, // exclude self
        {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, name: true, email: true, avatar_url: true },
    take: 10,
  });

  return res.json({ users });
});

export default router;

