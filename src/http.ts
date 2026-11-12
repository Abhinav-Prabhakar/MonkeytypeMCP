import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { createServer } from "./server.js";
import { SERVER_NAME, VERSION } from "./version.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpServerOptions {
  host?: string;
  port?: number;
  config?: ServerConfig;
}

export interface RunningHttpServer {
  url: string;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds 4 MiB");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return undefined;
  return JSON.parse(text) as unknown;
}

/**
 * Serves the server over MCP Streamable HTTP (stateless JSON responses).
 * Endpoint: POST /mcp — health probe: GET /health.
 */
export async function startHttpServer(options: HttpServerOptions = {}): Promise<RunningHttpServer> {
  const config = options.config ?? loadConfig();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;

  const httpServer = createHttpServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (url.pathname === "/health" || url.pathname === "/") {
      sendJson(res, 200, {
        status: "ok",
        name: SERVER_NAME,
        version: VERSION,
        transport: "streamable-http",
        authenticated: Boolean(config.apiKey),
      });
      return;
    }

    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "Not found. MCP endpoint is /mcp." });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {
        error: "This server is stateless. Send JSON-RPC requests with POST /mcp.",
      });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const server = createServer({ config });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: error instanceof Error ? error.message : "Invalid request",
          },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
