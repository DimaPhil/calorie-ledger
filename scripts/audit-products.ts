import { open, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { db } from "../server/db.js";
import { auditProducts, ProductAuditError } from "../server/product-audit.js";

try {
  const { values } = parseArgs({
    options: {
      plan: { type: "string" },
      backup: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (!values.plan || (values.apply && !values.backup))
    throw new ProductAuditError(
      "Usage: tsx scripts/audit-products.ts --plan plan.json [--apply --backup new-backup.json]",
    );
  const plan = JSON.parse(await readFile(values.plan, "utf8"));
  const report = await auditProducts(db(), plan, {
    apply: values.apply,
    backup: values.backup
      ? async (snapshot) => {
          const file = await open(values.backup!, "wx", 0o600);
          try {
            await file.writeFile(JSON.stringify(snapshot, null, 2) + "\n");
            await file.sync();
          } finally {
            await file.close();
          }
        }
      : undefined,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} catch (error) {
  console.error(
    error instanceof ProductAuditError
      ? error.message
      : "Audit failed; no transaction changes committed. Check plan validation, backup path, and database availability without printing credentials.",
  );
  process.exit(1);
}
