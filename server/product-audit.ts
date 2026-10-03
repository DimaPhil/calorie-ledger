import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { productSchema, type User } from "../src/shared.js";
import type { Database } from "./db.js";
import { Service } from "./service.js";

export const productAuditPlanSchema = z
  .object({
    username: z.string().trim().min(1),
    changes: z
      .array(
        z
          .object({
            id: z.uuid(),
            before: productSchema,
            after: productSchema,
            evidence: z.array(z.string().trim().min(1)).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine(
    (plan) =>
      new Set(plan.changes.map((c) => c.id)).size === plan.changes.length,
    "Duplicate product IDs",
  );

export class ProductAuditError extends Error {}

export async function auditProducts(
  database: Database,
  raw: unknown,
  options: {
    apply?: boolean;
    backup?: (snapshot: unknown) => Promise<void>;
  } = {},
) {
  const plan = productAuditPlanSchema.parse(raw);
  if (!database.transaction)
    throw new ProductAuditError("A transaction-capable database is required.");
  if (options.apply && !options.backup)
    throw new ProductAuditError("Apply requires a durable backup destination.");
  return database.transaction(async (tx) => {
    const { rows: users } = await tx.query(
      "SELECT id,username,timezone,unit_system FROM users WHERE username=$1 FOR UPDATE",
      [plan.username],
    );
    if (!users[0]) throw new ProductAuditError("Audit owner not found.");
    const user: User = {
      id: users[0].id,
      username: users[0].username,
      timezone: users[0].timezone,
      unitSystem: users[0].unit_system,
    };
    // Strip transaction from the handle: the outer transaction owns the user lock.
    const service = new Service(
      { query: (sql, values) => tx.query(sql, values) },
      user,
    );
    const pending: typeof plan.changes = [];
    const entries = new Map<string, Record<string, any>>();
    let alreadyApplied = 0;
    for (const change of plan.changes) {
      const { rows } = await tx.query(
        "SELECT data FROM products WHERE user_id=$1 AND id=$2",
        [user.id, change.id],
      );
      if (!rows[0])
        throw new ProductAuditError(
          `Product ${change.id} is missing or belongs to another owner.`,
        );
      if (isDeepStrictEqual(rows[0].data, change.after)) {
        alreadyApplied++;
        continue;
      }
      if (!isDeepStrictEqual(rows[0].data, change.before))
        throw new ProductAuditError(
          `Product ${change.id} changed since review; rebuild the plan.`,
        );
      pending.push(change);
      for (const entry of (await service.linked("products", change.id)).rows)
        entries.set(entry.id, entry);
    }
    const report = {
      mode: options.apply ? "applied" : "dry-run",
      products: plan.changes.length,
      pending: pending.length,
      alreadyApplied,
      linkedEntries: entries.size,
    };
    if (options.apply && pending.length) {
      await options.backup!({
        createdAt: new Date().toISOString(),
        userId: user.id,
        report,
        plan: { ...plan, changes: pending },
        reversePlan: {
          username: plan.username,
          changes: pending.map((c) => ({
            ...c,
            before: c.after,
            after: c.before,
          })),
        },
        linkedEntries: [...entries.values()],
      });
      for (const change of pending)
        await service.run("save_product", {
          id: change.id,
          product: change.after,
        });
    }
    return report;
  });
}
