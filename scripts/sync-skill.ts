import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { zip } from "../server/export.js";
await mkdir("public", { recursive: true });
await copyFile(
  ".agents/skills/calorie-ledger/SKILL.md",
  "public/agent-skill.md",
);
await writeFile(
  "public/calorie-ledger-skill.zip",
  zip([
    {
      name: "calorie-ledger/SKILL.md",
      body: await readFile(".agents/skills/calorie-ledger/SKILL.md", "utf8"),
    },
  ]),
);
