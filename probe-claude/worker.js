// Throwaway probe: which MCP protocol revision does claude.ai negotiate, and
// does it use CIMD or DCR? Logs to `wrangler tail`; never logs tokens, codes,
// PKCE verifiers, or Authorization headers. Accepts any client; no real data.
//
// MODE=cimd advertises CIMD and DCR; MODE=dcr advertises DCR only.

const enc = new TextEncoder();
const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pack = (obj) => b64url(enc.encode(JSON.stringify(obj)));
const unpack = (s) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
const rand = () => b64url(crypto.getRandomValues(new Uint8Array(18)));

const log = (event, data) => console.log(JSON.stringify({ event, ...data }));
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...headers },
  });

const REDACT = new Set(["code", "code_verifier", "refresh_token", "access_token", "client_secret", "state"]);
const redactParams = (params) =>
  Object.fromEntries([...params].map(([k, v]) => [k, REDACT.has(k) ? `<${v.length} chars>` : v]));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const mode = env.MODE ?? "cimd";
    const path = url.pathname;

    log("request", {
      mode,
      method: request.method,
      path,
      query: redactParams(url.searchParams),
      ua: request.headers.get("user-agent"),
      mcpProtocolVersion: request.headers.get("mcp-protocol-version"),
      hasAuthorization: request.headers.has("authorization"),
    });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
    }

    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      return json({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["probe"],
        bearer_methods_supported: ["header"],
      });
    }

    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) {
      const meta = {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["probe"],
      };
      if (mode === "cimd") meta.client_id_metadata_document_supported = true;
      return json(meta);
    }

    if (path === "/register" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { client_secret, ...rest } = body;
      log("dcr_register", { mode, metadata: rest });
      return json({ ...rest, client_id: `dcr-${rand()}`, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: "none" }, 201);
    }

    if (path === "/authorize") {
      const p = url.searchParams;
      const clientId = p.get("client_id") ?? "";
      const kind = /^https:\/\//.test(clientId) ? "cimd" : clientId.startsWith("dcr-") ? "dcr" : "other";
      const entry = {
        mode,
        clientIdKind: kind,
        clientId: kind === "dcr" ? "dcr-<issued>" : clientId,
        redirectUri: p.get("redirect_uri"),
        responseType: p.get("response_type"),
        scope: p.get("scope"),
        resource: p.getAll("resource"),
        codeChallengeMethod: p.get("code_challenge_method"),
        hasState: p.has("state"),
      };
      if (kind === "cimd") {
        try {
          const r = await fetch(clientId, { headers: { accept: "application/json" } });
          entry.cimdStatus = r.status;
          entry.cimdDocument = await r.json();
        } catch (e) {
          entry.cimdError = String(e);
        }
      }
      log("authorize", entry);
      const code = pack({ c: p.get("code_challenge"), r: p.get("redirect_uri"), exp: Date.now() + 300_000, n: rand() });
      const back = new URL(p.get("redirect_uri"));
      back.searchParams.set("code", code);
      if (p.has("state")) back.searchParams.set("state", p.get("state"));
      back.searchParams.set("iss", origin);
      return Response.redirect(back.toString(), 302);
    }

    if (path === "/token" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const grant = form.get("grant_type");
      const entry = { mode, grantType: grant, params: redactParams(form) };
      if (grant === "authorization_code") {
        try {
          const code = unpack(form.get("code"));
          const digest = await crypto.subtle.digest("SHA-256", enc.encode(form.get("code_verifier") ?? ""));
          entry.pkceOk = b64url(digest) === code.c;
          entry.redirectUriMatches = form.get("redirect_uri") === code.r;
          entry.expired = Date.now() > code.exp;
        } catch {
          entry.codeUnreadable = true;
        }
      }
      log("token", entry);
      return json({ access_token: `probe-at-${rand()}`, token_type: "Bearer", expires_in: 3600, refresh_token: `probe-rt-${rand()}`, scope: "probe" });
    }

    if (path === "/mcp") {
      const auth = request.headers.get("authorization") ?? "";
      const authed = auth.startsWith("Bearer probe-at-");
      const headers = {
        mcpProtocolVersion: request.headers.get("mcp-protocol-version"),
        mcpSessionId: request.headers.get("mcp-session-id"),
        accept: request.headers.get("accept"),
        contentType: request.headers.get("content-type"),
        authed,
      };

      if (request.method !== "POST") {
        log("mcp_non_post", { mode, method: request.method, ...headers });
        return new Response(null, { status: 405, headers: { allow: "POST" } });
      }

      const text = await request.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        log("mcp_bad_json", { mode, ...headers, length: text.length });
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
      }
      const messages = Array.isArray(body) ? body : [body];
      log("mcp", {
        mode,
        ...headers,
        batch: Array.isArray(body),
        messages: messages.map((m) => ({ id: m.id, method: m.method, params: JSON.stringify(m.params ?? null).slice(0, 2000) })),
      });

      if (!authed) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="probe"`,
        });
      }

      const replies = messages.filter((m) => m.id !== undefined).map((m) => respond(m));
      if (replies.length === 0) return new Response(null, { status: 202 });
      return json(Array.isArray(body) ? replies : replies[0]);
    }

    return new Response("rouvy-mcp protocol probe", { status: 404 });
  },
};

function respond(m) {
  const ok = (result) => ({ jsonrpc: "2.0", id: m.id, result });
  switch (m.method) {
    case "initialize":
      // Echo the client's requested revision, so we see what it asks for.
      return ok({
        protocolVersion: m.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "rouvy-mcp-probe", version: "0.0.0" },
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: [
          {
            name: "probe_echo",
            description: "Throwaway probe tool. Echoes its input.",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
          },
        ],
      });
    case "tools/call":
      return ok({ content: [{ type: "text", text: `probe_echo: ${m.params?.arguments?.text ?? ""}` }] });
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } };
  }
}
