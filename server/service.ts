import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  actionSchemas,
  nutrientKeys,
  type Action,
  type Product,
  type Dish,
  type DishInput,
  type Entry,
  type LogInput,
  type User,
  type Stats,
} from "../src/shared.js";
import type { Database } from "./db.js";
import {
  AppError,
  grams,
  normalize,
  range,
  scale,
  sum,
  validateDate,
} from "./nutrition.js";
import { hash } from "./auth.js";
import { externalSearch, search, type Provider } from "./search.js";

export class Service {
  constructor(
    public database: Database,
    public user: User,
    public provider: Provider = externalSearch,
  ) {}
  async list<T>(table: "products" | "dishes"): Promise<T[]> {
    const { rows } = await this.database.query(
      `SELECT id,data,updated_at FROM ${table} WHERE user_id=$1 ORDER BY data->>'name'`,
      [this.user.id],
    );
    return rows.map((r) => ({
      ...r.data,
      id: r.id,
      updatedAt: String(r.updated_at),
    }));
  }
  async get<T>(table: "products" | "dishes", id: string): Promise<T> {
    const { rows } = await this.database.query(
      `SELECT id,data,updated_at FROM ${table} WHERE user_id=$1 AND id=$2`,
      [this.user.id, id],
    );
    if (!rows[0])
      throw new AppError(
        "not_found",
        "This item no longer exists or belongs to another account.",
        404,
      );
    return {
      ...rows[0].data,
      id: rows[0].id,
      updatedAt: String(rows[0].updated_at),
    };
  }
  async save(table: "products" | "dishes", data: unknown, id?: string) {
    const result = id
      ? await this.database.query(
          `UPDATE ${table} SET data=$3,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING id`,
          [this.user.id, id, JSON.stringify(data)],
        )
      : await this.database.query(
          `INSERT INTO ${table}(id,user_id,data) VALUES($1,$2,$3) RETURNING id`,
          [randomUUID(), this.user.id, JSON.stringify(data)],
        );
    if (!result.rows[0])
      throw new AppError("not_found", "Item not found.", 404);
    return this.get(table, result.rows[0].id);
  }
  async remove(table: "products" | "dishes" | "entries", id: string) {
    if (table === "products") {
      const dishes = await this.list<Dish>("dishes");
      if (dishes.some((d) => d.ingredients.some((i) => i.productId === id)))
        throw new AppError(
          "in_use",
          "Remove this product from your dishes before deleting it.",
          409,
        );
    }
    const { rows } = await this.database.query(
      table === "entries"
        ? `UPDATE entries SET deleted=true WHERE user_id=$1 AND id=$2 AND NOT deleted RETURNING id`
        : `DELETE FROM ${table} WHERE user_id=$1 AND id=$2 RETURNING id`,
      [this.user.id, id],
    );
    if (!rows[0]) throw new AppError("not_found", "Item not found.", 404);
    return { deleted: true };
  }
  async dishItems(dish: DishInput) {
    return Promise.all(
      dish.ingredients.map(async (i) => {
        const product = await this.get<Product>("products", i.productId);
        const weight = grams(product, i);
        if (product.nutrients.calories === undefined)
          throw new AppError(
            "clarification_required",
            `Add calories per 100g for ${product.name} before logging.`,
            422,
            { missing: ["calories"], productId: product.id },
          );
        return {
          name: product.name,
          grams: weight,
          nutrients: scale(product.nutrients, weight / 100),
        };
      }),
    );
  }
  async log(input: LogInput): Promise<{ entry: Entry; replayed: boolean }> {
    validateDate(input.date);
    if (input.ingredients && !input.dishId)
      throw new AppError(
        "invalid_input",
        "Ingredient overrides require a dish.",
      );
    const fingerprint = hash(JSON.stringify(input));
    const existing = await this.database.query(
      "SELECT id,data,request_hash,deleted FROM entries WHERE user_id=$1 AND idempotency_key=$2",
      [this.user.id, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].deleted)
        throw new AppError(
          "entry_deleted",
          "This request was already logged and later deleted. It will not be recreated by a retry.",
          409,
        );
      if (existing.rows[0].request_hash !== fingerprint)
        throw new AppError(
          "idempotency_conflict",
          "This request already saved different values. Review the journal and correct that entry before starting a new log.",
          409,
        );
      return { entry: existing.rows[0].data, replayed: true };
    }
    let name: string;
    let items: Entry["items"];
    if (input.productId) {
      const p = await this.get<Product>("products", input.productId);
      if (p.nutrients.calories === undefined)
        throw new AppError(
          "clarification_required",
          "Add calories per 100g before logging this product.",
          422,
          { missing: ["calories"], productId: p.id },
        );
      const weight = grams(p, input);
      name = p.name;
      items = [
        { name, grams: weight, nutrients: scale(p.nutrients, weight / 100) },
      ];
    } else {
      const d = await this.get<Dish>("dishes", input.dishId!);
      const recipe = { ...d, ingredients: input.ingredients || d.ingredients };
      name = d.name;
      let factor: number;
      if (input.unit === "serving") factor = input.amount / d.servings;
      else if (
        ["g", "kg", "oz", "lb"].includes(input.unit) &&
        d.cookedWeight &&
        !input.ingredients
      )
        factor =
          grams({ portions: [] } as unknown as Product, input) / d.cookedWeight;
      else
        throw new AppError(
          "clarification_required",
          "Use servings for this dish, or save its cooked weight before logging by weight. Ingredient overrides use servings.",
          422,
          { missing: ["servings or cooked weight"] },
        );
      items = (await this.dishItems(recipe)).map((i) => ({
        ...i,
        grams: i.grams * factor,
        nutrients: scale(i.nutrients, factor),
      }));
    }
    const entry: Entry = {
      id: randomUUID(),
      name,
      date: input.date,
      meal: input.meal,
      amount: input.amount,
      unit: input.unit,
      nutrients: sum(items.map((i) => i.nutrients)),
      notes: input.notes,
      items,
      createdAt: new Date().toISOString(),
    };
    const inserted = await this.database.query(
      `INSERT INTO entries(id,user_id,date,data,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`,
      [
        entry.id,
        this.user.id,
        input.date,
        JSON.stringify(entry),
        input.idempotencyKey,
        fingerprint,
      ],
    );
    if (!inserted.rows[0]) return this.log(input);
    if (input.query && input.productId)
      await this.remember(input.query, input.productId);
    return { entry, replayed: false };
  }
  async remember(query: string, productId: string) {
    await this.get("products", productId);
    const normalized = normalize(query);
    if (!normalized)
      throw new AppError("invalid_query", "Provide a food name.");
    await this.database.query(
      `INSERT INTO choices(user_id,query,product_id) VALUES($1,$2,$3) ON CONFLICT(user_id,query) DO UPDATE SET product_id=$3,updated_at=now()`,
      [this.user.id, normalized, productId],
    );
    return { remembered: true };
  }
  async stats(start: string, end: string): Promise<Stats> {
    const dates = range(start, end);
    const { rows } = await this.database.query(
      `SELECT data FROM entries WHERE user_id=$1 AND NOT deleted AND date BETWEEN $2 AND $3 ORDER BY date DESC,created_at DESC`,
      [this.user.id, start, end],
    );
    const entries: Entry[] = rows.map((r) => r.data);
    return {
      start,
      end,
      entries,
      totals: sum(entries.map((e) => e.nutrients)),
      days: dates.map((date) => {
        const onDay = entries.filter((e) => e.date === date);
        return {
          date,
          nutrients: sum(onDay.map((e) => e.nutrients)),
          count: onDay.length,
        };
      }),
      missingNutrients: nutrientKeys.filter((k) =>
        entries.some((e) => e.items.some((i) => i.nutrients[k] === undefined)),
      ),
    };
  }
  async run(action: Action, raw: unknown): Promise<any> {
    // Serialize a user's mutations across web/MCP instances. This keeps recipe
    // references, preference writes and nutrition snapshots consistent in one commit.
    // ponytail: per-user write serialization suits 2–3 users; use row-level recipe
    // reference tables if concurrent writes within one account become substantial.
    if (
      this.database.transaction &&
      /^(save_|delete_|update_|remember_|log_)/.test(action)
    ) {
      return this.database.transaction(async (tx) => {
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          this.user.id,
        ]);
        return new Service(
          { query: (sql, values) => tx.query(sql, values) },
          this.user,
          this.provider,
        ).run(action, raw);
      });
    }
    const parsed = actionSchemas[action].safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "clarification_required",
        "Some information is missing or invalid. Please correct the listed fields.",
        422,
        {
          issues: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
      );
    const input = parsed.data as any;
    switch (action) {
      case "list_products":
        return this.list("products");
      case "search_products":
        return search(
          this.database,
          this.user.id,
          input.query,
          input.external,
          this.provider,
          input.broaden,
        );
      case "save_product":
        return this.save("products", input.product, input.id);
      case "delete_product":
        return this.remove("products", input.id);
      case "remember_choice":
        return this.remember(input.query, input.productId);
      case "list_dishes":
        return this.list("dishes");
      case "save_dish":
        await this.dishItems(input.dish);
        return this.save("dishes", input.dish, input.id);
      case "delete_dish":
        return this.remove("dishes", input.id);
      case "preview_dish": {
        const items = await this.dishItems(input.dish);
        return {
          items,
          total: sum(items.map((i) => i.nutrients)),
          perServing: scale(
            sum(items.map((i) => i.nutrients)),
            1 / input.dish.servings,
          ),
        };
      }
      case "resolve_food": {
        const result = await search(
          this.database,
          this.user.id,
          input.query,
          true,
          this.provider,
        );
        if (result.status !== "matched")
          return {
            ...result,
            next: "Ask the user to choose a candidate. Save external products with save_product, then remember_choice.",
          };
        if (result.candidates[0].nutrients.calories === undefined)
          return {
            ...result,
            status: "clarification_required",
            missing: ["calories per 100g"],
            question:
              "What are the calories per 100g on this product label? Save them before logging.",
          };
        if (!input.amount || !input.unit)
          return {
            ...result,
            status: "clarification_required",
            missing: [!input.amount && "amount", !input.unit && "unit"].filter(
              Boolean,
            ),
            question: "How much did you eat? Provide an amount and unit.",
          };
        const weight = grams(result.candidates[0], input);
        return {
          ...result,
          status: "ready",
          grams: weight,
          nutrients: scale(result.candidates[0].nutrients, weight / 100),
          next: "Call log_food with productId, amount, unit, date, meal, and a stable idempotencyKey. Nothing has been logged yet.",
        };
      }
      case "log_food":
        return this.log(input);
      case "delete_entry":
        return this.remove("entries", input.id);
      case "update_entry": {
        validateDate(input.date);
        const { rows } = await this.database.query(
          `UPDATE entries SET date=$3,data=data || $4::jsonb WHERE user_id=$1 AND id=$2 AND NOT deleted RETURNING data`,
          [
            this.user.id,
            input.id,
            input.date,
            JSON.stringify({
              date: input.date,
              meal: input.meal,
              notes: input.notes,
            }),
          ],
        );
        if (!rows[0]) throw new AppError("not_found", "Entry not found.", 404);
        return rows[0].data;
      }
      case "get_stats":
        return this.stats(input.start, input.end);
      case "get_profile":
        return {
          ...this.user,
          today: DateTime.now().setZone(this.user.timezone).toISODate(),
        };
      case "update_profile": {
        if (!DateTime.now().setZone(input.timezone).isValid)
          throw new AppError(
            "invalid_timezone",
            "Choose a valid IANA timezone.",
          );
        await this.database.query(
          "UPDATE users SET timezone=$2,unit_system=$3 WHERE id=$1",
          [this.user.id, input.timezone, input.unitSystem],
        );
        return { ...this.user, ...input };
      }
    }
  }
}
