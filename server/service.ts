import { randomUUID } from "node:crypto";
import {
  defaultGoals,
  metricDefinitions,
  checkInSchema,
  type GoalSettings,
} from "../src/goals-shared.js";
import { enrichProduct } from "./enrichment.js";
import { isDeepStrictEqual } from "node:util";
import { DateTime } from "luxon";
import {
  actionSchemas,
  nutrientKeys,
  legacyNutrientKeys,
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
  today() {
    return DateTime.now().setZone(this.user.timezone).toISODate()!;
  }
  async checkInStatus(date = this.today()) {
    validateDate(date);
    const { rows } = await this.database.query(
      "SELECT data FROM checkins WHERE user_id=$1 AND date=$2",
      [this.user.id, date],
    );
    const checkIn = rows[0] ? checkInSchema.strip().parse(rows[0].data) : null;
    return {
      status: checkIn ? "recorded" : "missing",
      date,
      timezone: this.user.timezone,
      checkedIn: !!checkIn,
      shouldAsk: !checkIn && date === this.today(),
      loggingComplete: checkIn?.complete ?? false,
      checkIn,
    };
  }
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
    if (id) await this.recalculate(table, id);
    return this.get(table, result.rows[0].id);
  }
  async dependencies(entryId: string, sources: { kind: string; id: string }[]) {
    await this.database.query(
      "DELETE FROM entry_dependencies WHERE user_id=$1 AND entry_id=$2",
      [this.user.id, entryId],
    );
    for (const source of sources)
      await this.database.query(
        "INSERT INTO entry_dependencies(user_id,entry_id,kind,source_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [this.user.id, entryId, source.kind, source.id],
      );
  }
  async linked(table: "products" | "dishes", id: string) {
    return this.database.query(
      "SELECT e.id,e.data,e.source_input FROM entry_dependencies d JOIN entries e ON e.user_id=d.user_id AND e.id=d.entry_id WHERE d.user_id=$1 AND d.kind=$2 AND d.source_id=$3 AND NOT e.deleted AND e.source_input IS NOT NULL",
      [this.user.id, table, id],
    );
  }
  async recalculate(table: "products" | "dishes", id: string) {
    const { rows } = await this.linked(table, id);
    for (const row of rows) {
      let calculated;
      try {
        calculated = await this.calculate(row.source_input);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        throw new AppError(
          "linked_entry_invalid",
          `Cannot update this saved item because a linked journal entry (${row.data.date}) cannot be recalculated: ${error.message} Keep the required nutrition/portion data, or manually correct that entry first.`,
          422,
        );
      }
      const { sources, ...nutrition } = calculated;
      // Entries only recalculate the metrics available when they were created.
      const tracked = row.data.trackedNutrients || legacyNutrientKeys;
      for (const item of nutrition.items)
        item.nutrients = Object.fromEntries(
          Object.entries(item.nutrients).filter(([k]) => tracked.includes(k)),
        );
      nutrition.nutrients = sum(nutrition.items.map((i) => i.nutrients));
      const updated = {
        ...row.data,
        ...nutrition,
        revision: (row.data.revision || 0) + 1,
      };
      await this.database.query(
        "UPDATE entries SET data=$3 WHERE user_id=$1 AND id=$2",
        [this.user.id, row.id, JSON.stringify(updated)],
      );
      await this.dependencies(row.id, sources);
    }
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
    if (table === "entries") await this.dependencies(id, []);
    else {
      const linked = await this.linked(table, id);
      for (const row of linked.rows) {
        await this.database.query(
          "UPDATE entries SET source_input=NULL,data=data || $3::jsonb WHERE user_id=$1 AND id=$2",
          [
            this.user.id,
            row.id,
            JSON.stringify({
              autoUpdate: false,
              revision: (row.data.revision || 0) + 1,
            }),
          ],
        );
        await this.dependencies(row.id, []);
      }
    }
    return { deleted: true };
  }
  async dishItems(dish: DishInput, requireCalories = true) {
    return Promise.all(
      dish.ingredients.map(async (i) => {
        const product = await this.get<Product>("products", i.productId);
        const weight = grams(product, i);
        if (requireCalories && product.nutrients.calories === undefined)
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
  async calculate(input: LogInput, requireCalories = true) {
    if (input.ingredients && !input.dishId)
      throw new AppError(
        "invalid_input",
        "Ingredient overrides require a dish.",
      );
    let name: string;
    let items: Entry["items"];
    let sources: { kind: string; id: string }[];
    if (input.productId) {
      const p = await this.get<Product>("products", input.productId);
      sources = [{ kind: "products", id: p.id }];
      if (requireCalories && p.nutrients.calories === undefined)
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
      sources = [
        { kind: "dishes", id: d.id },
        ...recipe.ingredients.map((i) => ({
          kind: "products",
          id: i.productId,
        })),
      ];
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
      items = (await this.dishItems(recipe, requireCalories)).map((i) => ({
        ...i,
        grams: i.grams * factor,
        nutrients: scale(i.nutrients, factor),
      }));
    }
    return {
      name,
      items,
      nutrients: sum(items.map((i) => i.nutrients)),
      sources,
    };
  }
  async log(input: LogInput): Promise<{ entry: Entry; replayed: boolean }> {
    validateDate(input.date);
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
    const { name, items, sources } = await this.calculate(input);
    const entry: Entry = {
      id: randomUUID(),
      autoUpdate: !input.ingredients,
      trackedNutrients: [...nutrientKeys],
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
      `INSERT INTO entries(id,user_id,date,data,idempotency_key,request_hash,source_input) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`,
      [
        entry.id,
        this.user.id,
        input.date,
        JSON.stringify(entry),
        input.idempotencyKey,
        fingerprint,
        entry.autoUpdate ? JSON.stringify(input) : null,
      ],
    );
    if (!inserted.rows[0]) return this.log(input);
    if (entry.autoUpdate) await this.dependencies(entry.id, sources);
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
    // ponytail: per-user write serialization suits 2–3 users; use finer-grained
    // locks if concurrent writes within one account become substantial.
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
      case "save_enriched_product": {
        const product = await this.get<Product>("products", input.id);
        const result = await enrichProduct(product);
        // Explicit source enrichment is for future logs; never rewrite journal snapshots.
        if (result.added.length)
          await this.database.query(
            "UPDATE products SET data=$3,updated_at=now() WHERE user_id=$1 AND id=$2",
            [this.user.id, input.id, JSON.stringify(result.product)],
          );
        return { id: input.id, added: result.added, warning: result.warning };
      }
      case "get_goals": {
        range(input.start, input.end, 378); // Include the boundary weeks of a 366-day journal range.
        const history = await this.database.query(
          "SELECT data FROM goals WHERE user_id=$1 ORDER BY effective_date",
          [this.user.id],
        );
        const settings: GoalSettings[] = history.rows.map((r) => ({
          ...r.data,
          targets: Object.fromEntries(
            metricDefinitions.map((m) => [
              m.key,
              r.data.targets[m.key] ?? m.target,
            ]),
          ),
        }));
        const fallback = { effectiveDate: "0001-01-01", targets: defaultGoals };
        const checkins = await this.database.query(
          "SELECT data FROM checkins WHERE user_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date",
          [this.user.id, input.start, input.end],
        );
        return {
          settings:
            settings.filter((s) => s.effectiveDate <= input.end).at(-1) ||
            fallback,
          history: [fallback, ...settings],
          checkins: checkins.rows.map((r) =>
            checkInSchema.strip().parse(r.data),
          ),
        };
      }
      case "save_goals":
        validateDate(input.effectiveDate);
        await this.database.query(
          "INSERT INTO goals(user_id,effective_date,data) VALUES($1,$2,$3) ON CONFLICT(user_id,effective_date) DO UPDATE SET data=$3",
          [this.user.id, input.effectiveDate, JSON.stringify(input)],
        );
        return input;
      case "save_checkin":
        validateDate(input.date);
        await this.database.query(
          "INSERT INTO checkins(user_id,date,data) VALUES($1,$2,$3) ON CONFLICT(user_id,date) DO UPDATE SET data=$3",
          [this.user.id, input.date, JSON.stringify(input)],
        );
        return input;
      case "get_checkin":
        return this.checkInStatus(input.date);
      case "update_checkin": {
        const previous = await this.checkInStatus(input.date);
        const merged = { complete: false, ...previous.checkIn, ...input };
        await this.database.query(
          "INSERT INTO checkins(user_id,date,data) VALUES($1,$2,$3) ON CONFLICT(user_id,date) DO UPDATE SET data=$3",
          [this.user.id, input.date, JSON.stringify(merged)],
        );
        return this.checkInStatus(input.date);
      }
      case "preview_food": {
        const date = input.date || this.today();
        validateDate(date);
        let meal;
        if (input.product) {
          const weight = grams(input.product, input);
          const nutrients = scale(input.product.nutrients, weight / 100);
          meal = {
            name: input.product.name,
            nutrients,
            items: [{ name: input.product.name, grams: weight, nutrients }],
          };
        } else {
          const { sources: _, ...calculated } = await this.calculate(
            {
              ...input,
              date,
              meal: "snack",
              notes: "",
              idempotencyKey: "preview-only",
            },
            false,
          );
          meal = calculated;
        }
        const current = await this.stats(date, date);
        const goals = await this.run("get_goals", { start: date, end: date });
        const missingNutrients = nutrientKeys.filter((k) =>
          meal.items.some(
            (i: Entry["items"][number]) => i.nutrients[k] === undefined,
          ),
        );
        return {
          logged: false,
          date,
          ...meal,
          missingNutrients,
          currentMissingNutrients: current.missingNutrients,
          comparisonBasis:
            "Already logged food plus this hypothetical portion; unlogged food is not included.",
          goalImpact: metricDefinitions
            .filter((m) => m.source === "food")
            .map((m) => {
              const key = m.key as keyof typeof meal.nutrients;
              const target = goals.settings.targets[key];
              const portion = meal.nutrients[key] ?? null;
              const currentLogged =
                current.totals[key] ??
                (current.entries.length === 0 ? 0 : null);
              const complete =
                !missingNutrients.includes(key) &&
                !current.missingNutrients.includes(key);
              const projected =
                complete && portion !== null && currentLogged !== null
                  ? currentLogged + portion
                  : null;
              return {
                key,
                unit: m.unit,
                kind: m.kind,
                target,
                portion,
                portionPercent:
                  portion === null || missingNutrients.includes(key)
                    ? null
                    : (portion / target) * 100,
                currentLogged,
                projected,
                projectedPercent:
                  projected === null ? null : (projected / target) * 100,
                remaining: projected === null ? null : target - projected,
                complete,
              };
            }),
        };
      }
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
        let result = await search(
          this.database,
          this.user.id,
          input.query,
          false,
          this.provider,
        );
        if (result.requiresProductConfirmation)
          result = await search(
            this.database,
            this.user.id,
            input.query,
            true,
            this.provider,
          );
        if (result.requiresProductConfirmation)
          return {
            ...result,
            next: "Ask the user to choose a candidate. Save external products with save_product, then remember_choice.",
          };
        const product = result.candidates.find(
          (p) => p.id === result.preferredProductId,
        )!;
        if (product.nutrients.calories === undefined)
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
        const weight = grams(product, input);
        return {
          ...result,
          status: "ready",
          grams: weight,
          nutrients: scale(product.nutrients, weight / 100),
          next: "Use preferredProductId as log_food.productId without reconfirming food identity. Include amount, unit, portionLabel if supplied, date, meal, and a stable idempotencyKey. Nothing has been logged yet.",
        };
      }
      case "log_food":
        return this.log(input);
      case "delete_entry":
        return this.remove("entries", input.id);
      case "update_entry": {
        validateDate(input.date);
        const existing = await this.database.query(
          "SELECT data FROM entries WHERE user_id=$1 AND id=$2 AND NOT deleted",
          [this.user.id, input.id],
        );
        if (!existing.rows[0])
          throw new AppError("not_found", "Entry not found.", 404);
        const previous = existing.rows[0].data as Entry;
        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== (previous.revision || 0)
        )
          throw new AppError(
            "entry_conflict",
            "This entry changed elsewhere. Close this dialog and refresh the journal before editing again.",
            409,
          );
        const { id: _id, expectedRevision: _expected, ...changes } = input;
        const detached = ["name", "amount", "unit", "items"].some(
          (key) =>
            input[key] !== undefined &&
            !isDeepStrictEqual(input[key], previous[key as keyof Entry]),
        );
        if (detached) {
          await this.dependencies(input.id, []);
          await this.database.query(
            "UPDATE entries SET source_input=NULL WHERE user_id=$1 AND id=$2",
            [this.user.id, input.id],
          );
        }
        const updated = {
          ...previous,
          ...changes,
          ...(detached ? { autoUpdate: false } : {}),
          nutrients: input.items
            ? sum(
                input.items.map(
                  (item: Entry["items"][number]) => item.nutrients,
                ),
              )
            : previous.nutrients,
          revision: (previous.revision || 0) + 1,
        };
        const { rows } = await this.database.query(
          `UPDATE entries SET date=$3,data=data || $4::jsonb WHERE user_id=$1 AND id=$2 AND NOT deleted RETURNING data`,
          [this.user.id, input.id, input.date, JSON.stringify(updated)],
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
