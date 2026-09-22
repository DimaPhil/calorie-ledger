import { copyFile, mkdir } from "node:fs/promises";
await mkdir("public", { recursive: true });
await copyFile(
  ".agents/skills/calorie-ledger/SKILL.md",
  "public/agent-skill.md",
);
