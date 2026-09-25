import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mcpAuthRouter,
  createOAuthMetadata,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidClientMetadataError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Database } from "./db.js";
import { authenticate, hash, limit, login } from "./auth.js";
import { AppError } from "./nutrition.js";

export const issuer = () =>
  new URL(process.env.APP_URL || "https://calorie-ledger-six.vercel.app")
    .origin;
export const resource = () => `${issuer()}/mcp`;
const secret = () => randomBytes(32).toString("base64url");
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function validateResource(value?: URL) {
  if (value?.href !== resource())
    throw new InvalidRequestError(
      "The resource must be this server's /mcp URL.",
    );
}
function validateScopes(scopes?: string[]) {
  if (scopes?.some((s) => s !== "ledger"))
    throw new InvalidScopeError("Only the ledger scope is supported.");
}
function validRedirect(value: string) {
  const u = new URL(value);
  return (
    !u.hash &&
    !u.username &&
    !u.password &&
    (u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
  );
}
export function oauthRouter(database: Database) {
  const router = express.Router();
  const provider: OAuthServerProvider = {
    clientsStore: {
      async getClient(id) {
        return (
          await database.query("SELECT data FROM oauth_clients WHERE id=$1", [
            id,
          ])
        ).rows[0]?.data;
      },
      async registerClient(client) {
        if (
          client.token_endpoint_auth_method !== "none" ||
          !client.redirect_uris.length ||
          client.redirect_uris.length > 5 ||
          !client.redirect_uris.every(validRedirect)
        )
          throw new InvalidClientMetadataError(
            "Use public-client PKCE and HTTPS (or loopback) redirect URIs.",
          );
        validateScopes(client.scope?.split(" "));
        const saved = {
          ...client,
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: (client.client_name || "MCP client").slice(0, 80),
        };
        await database.query(
          "INSERT INTO oauth_clients(id,data) VALUES($1,$2)",
          [saved.client_id, JSON.stringify(saved)],
        );
        return saved;
      },
    },
    async authorize(client, params, res) {
      validateResource(params.resource);
      validateScopes(params.scopes);
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
        throw new InvalidRequestError("Use an S256 PKCE challenge.");
      const id = secret(),
        csrf = secret();
      await database.query(
        "DELETE FROM oauth_requests WHERE expires_at < now()",
      );
      await database.query("DELETE FROM oauth_codes WHERE expires_at < now()");
      await database.query(
        "INSERT INTO oauth_requests(id,client_id,data,csrf_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
        [
          id,
          client.client_id,
          JSON.stringify({ ...params, resource: params.resource!.href }),
          hash(csrf),
        ],
      );
      res.cookie("oauth_csrf", csrf, {
        httpOnly: true,
        secure: issuer().startsWith("https:"),
        sameSite: "lax",
        path: "/oauth",
        maxAge: 600000,
      });
      res.redirect(303, `/oauth/consent?request=${id}`);
    },
    async challengeForAuthorizationCode(client, code) {
      const { rows } = await database.query(
        "SELECT data FROM oauth_codes WHERE code_hash=$1 AND client_id=$2 AND expires_at>now()",
        [hash(code), client.client_id],
      );
      if (!rows[0])
        throw new InvalidGrantError(
          "Authorization code expired or already used.",
        );
      return rows[0].data.codeChallenge;
    },
    async exchangeAuthorizationCode(
      client,
      code,
      _verifier,
      redirectUri,
      target,
    ) {
      validateResource(target);
      return database.transaction!(async (tx) => {
        const { rows } = await tx.query(
          "DELETE FROM oauth_codes WHERE code_hash=$1 AND client_id=$2 AND expires_at>now() AND data->>'redirectUri'=$3 AND data->>'resource'=$4 RETURNING *",
          [hash(code), client.client_id, redirectUri, resource()],
        );
        if (!rows[0])
          throw new InvalidGrantError(
            "Invalid or consumed authorization code.",
          );
        const id = randomUUID();
        await tx.query(
          "INSERT INTO api_tokens(id,user_id,name,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days')",
          [
            id,
            rows[0].user_id,
            `OAuth: ${client.client_name || "MCP client"}`.slice(0, 80),
            hash(secret()),
          ],
        );
        await tx.query(
          "INSERT INTO oauth_grants(id,client_id,resource) VALUES($1,$2,$3)",
          [id, client.client_id, resource()],
        );
        return issueTokens(tx, id);
      });
    },
    async exchangeRefreshToken(client, token, scopes, target) {
      validateResource(target);
      validateScopes(scopes);
      // Keep spent refresh hashes until grant revocation so replay invalidates the entire grant.
      const result = await database.transaction!(async (tx) => {
        const { rows } = await tx.query(
          "SELECT t.*,g.id FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id JOIN api_tokens a ON a.id=g.id WHERE t.token_hash=$1 AND t.kind='refresh' AND g.client_id=$2 AND g.resource=$3 AND t.expires_at>now() AND a.expires_at>now() FOR UPDATE OF a,t",
          [hash(token), client.client_id, resource()],
        );
        if (!rows[0]) return undefined;
        if (rows[0].used) {
          await tx.query("DELETE FROM api_tokens WHERE id=$1", [rows[0].id]);
          return undefined;
        }
        await tx.query(
          "UPDATE oauth_tokens SET used=true WHERE token_hash=$1",
          [hash(token)],
        );
        return issueTokens(tx, rows[0].id);
      });
      if (!result)
        throw new InvalidGrantError(
          "Refresh token expired, revoked, or replayed. Reconnect your account.",
        );
      return result;
    },
    async verifyAccessToken(token) {
      const { rows } = await database.query(
        "SELECT g.*,a.user_id,t.expires_at FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id JOIN api_tokens a ON a.id=g.id WHERE t.token_hash=$1 AND t.kind='access' AND t.expires_at>now() AND a.expires_at>now() AND g.resource=$2",
        [hash(token), resource()],
      );
      if (!rows[0]) throw new InvalidGrantError("Invalid access token.");
      return {
        token,
        clientId: rows[0].client_id,
        scopes: ["ledger"],
        expiresAt: Math.floor(new Date(rows[0].expires_at).getTime() / 1000),
        resource: new URL(resource()),
        extra: { userId: rows[0].user_id },
      };
    },
    async revokeToken(client, request) {
      await database.query(
        "DELETE FROM api_tokens WHERE id IN (SELECT g.id FROM oauth_grants g JOIN oauth_tokens t ON t.grant_id=g.id WHERE t.token_hash=$1 AND g.client_id=$2)",
        [hash(request.token), client.client_id],
      );
    },
  };
  async function pending(req: express.Request) {
    const id = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(req.method === "POST" ? req.body.request : req.query.request);
    const { rows } = await database.query(
      "SELECT r.*,c.data AS client FROM oauth_requests r JOIN oauth_clients c ON c.id=r.client_id WHERE r.id=$1 AND r.csrf_hash=$2 AND r.expires_at>now()",
      [id, hash(req.cookies?.oauth_csrf || "")],
    );
    if (!rows[0])
      throw new AppError(
        "invalid_authorization",
        "This connection request expired. Start again from your MCP client.",
        400,
      );
    return rows[0];
  }
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path === "/authorize") {
      const redirect = res.redirect.bind(res);
      res.redirect = ((status: number | string, location?: string) => {
        const target = location || String(status);
        if (target.startsWith("/"))
          return redirect(typeof status === "number" ? status : 302, target);
        const url = new URL(target);
        url.searchParams.set("iss", issuer());
        return redirect(typeof status === "number" ? status : 302, url.href);
      }) as typeof res.redirect;
    }
    if (req.path.startsWith("/oauth/"))
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
    next();
  });
  router.get("/oauth/consent", async (req, res) => {
    const row = await pending(req);
    // Browsers also apply form-action to the OAuth callback redirect after POST.
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(row.data.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    let username = "";
    try {
      username = (await authenticate(database, req)).username;
    } catch (e) {
      if (!(e instanceof AppError) || e.status !== 401) throw e;
    }
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Calorie Ledger</title><style>body{font:17px system-ui;background:#f7f7f2;color:#263d32;max-width:480px;padding:24px;margin:5vh auto}label{display:block;margin:16px 0}input,button{box-sizing:border-box;font:inherit;padding:12px;width:100%;margin-top:8px}button{cursor:pointer}small{overflow-wrap:anywhere}</style><h1>Connect Calorie Ledger</h1><p><strong>${escape(row.client.client_name)}</strong> wants access to your food journal.</p><p>This lets it read, add, edit, and delete your foods, recipes, journal entries, and preferences.</p><p>Return address:<br><small>${escape(new URL(row.data.redirectUri).origin)}</small></p><p>Access lasts up to 90 days. Revoke it anytime in Settings → Agent tokens.</p><form method="post" action="/oauth/consent"><input type="hidden" name="request" value="${escape(row.id)}">${username ? `<p>Signed in as <strong>${escape(username)}</strong>.</p>` : '<label>Username<input name="username" autocomplete="username" required maxlength="60"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>'}<button name="decision" value="allow">Allow access</button><button name="decision" value="deny" formnovalidate>Cancel</button></form></html>`,
      );
  });
  router.post(
    "/oauth/consent",
    express.urlencoded({ extended: false, limit: "8kb" }),
    async (req, res) => {
      if (req.headers.origin !== issuer() || req.headers.authorization)
        throw new AppError(
          "invalid_origin",
          "Submit this form from Calorie Ledger.",
          403,
        );
      const row = await pending(req);
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(row.data.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
      );
      const decision = z.enum(["allow", "deny"]).parse(req.body.decision);
      let userId: string | undefined;
      if (decision === "allow") {
        try {
          userId = (await authenticate(database, req)).id;
        } catch (e) {
          if (!(e instanceof AppError) || e.status !== 401) throw e;
        }
        if (!userId) {
          const input = z
            .object({
              username: z.string().min(1).max(60),
              password: z.string().min(1).max(256),
            })
            .parse(req.body);
          await limit(
            database,
            `oauth-login:${hash(req.ip || "unknown")}`,
            30,
            600,
          );
          const result = await login(database, input.username, input.password);
          userId = result.user.id;
          res.cookie("session", result.token, {
            httpOnly: true,
            secure: issuer().startsWith("https:"),
            sameSite: "strict",
            path: "/",
            maxAge: 604800000,
          });
        }
      }
      const code = secret();
      await database.transaction!(async (tx) => {
        const consumed = await tx.query(
          "DELETE FROM oauth_requests WHERE id=$1 AND expires_at>now() RETURNING id",
          [row.id],
        );
        if (!consumed.rows[0])
          throw new AppError(
            "invalid_authorization",
            "Request already completed.",
            400,
          );
        if (userId)
          await tx.query(
            "INSERT INTO oauth_codes(code_hash,client_id,user_id,data,expires_at) VALUES($1,$2,$3,$4,now()+interval '60 seconds')",
            [hash(code), row.client_id, userId, JSON.stringify(row.data)],
          );
      });
      const redirect = new URL(row.data.redirectUri);
      redirect.searchParams.set("iss", issuer());
      if (row.data.state) redirect.searchParams.set("state", row.data.state);
      redirect.searchParams.set(
        userId ? "code" : "error",
        userId ? code : "access_denied",
      );
      res
        .clearCookie("oauth_csrf", { path: "/oauth" })
        .redirect(303, redirect.href);
    },
  );
  const options = {
    provider,
    issuerUrl: new URL(issuer()),
    resourceServerUrl: new URL(resource()),
    scopesSupported: ["ledger"],
    authorizationOptions: { rateLimit: false as const },
    tokenOptions: { rateLimit: false as const },
    revocationOptions: { rateLimit: false as const },
    clientRegistrationOptions: { rateLimit: false as const },
  };
  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) =>
    res.json({
      resource: resource(),
      authorization_servers: [issuer()],
      scopes_supported: ["ledger"],
    }),
  );
  router.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.json({
      ...createOAuthMetadata(options),
      issuer: issuer(),
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    }),
  );
  router.use(async (req, _res, next) => {
    await limit(
      database,
      `oauth:${req.path}:${hash(req.ip || "unknown")}`,
      req.path === "/register" ? 20 : 100,
      600,
    );
    if (
      req.path === "/register" &&
      req.method === "POST" &&
      req.body &&
      req.body.token_endpoint_auth_method === undefined
    )
      req.body.token_endpoint_auth_method = "none";
    next();
  });
  router.use(mcpAuthRouter(options));
  return { router, provider };
}
async function issueTokens(tx: Database, grantId: string) {
  const access = secret(),
    refresh = secret();
  await tx.query(
    "DELETE FROM oauth_tokens WHERE grant_id=$1 AND kind='access' AND expires_at<now()",
    [grantId],
  );
  await tx.query(
    "INSERT INTO oauth_tokens(token_hash,grant_id,kind,expires_at) VALUES($1,$3,'access',now()+interval '1 hour'),($2,$3,'refresh',now()+interval '30 days')",
    [hash(access), hash(refresh), grantId],
  );
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refresh,
    scope: "ledger",
  };
}
