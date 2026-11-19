import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  // Runtime adapter uses the POOLED url (fast connections for the app)
  datasource: {
    url: process.env.DATABASE_URL,
  },
  // Migrations use the DIRECT url (pooler doesn't support migration protocol)
  migrate: {
    adapter: () =>
      new PrismaPg({
        connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
      }),
  },
});
