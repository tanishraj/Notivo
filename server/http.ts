import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import type { Env } from "../src/types";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Serves the built portal: exact files,
 * `/x` as `x.html` or `x/index.html`, and a plain 404 for anything else. */
export function staticAssets(root: string): NonNullable<Env["ASSETS"]> {
  const base = normalize(root + sep);
  const file = async (path: string) => {
    const full = normalize(join(base, path));
    if (!full.startsWith(base)) return null;
    try {
      return (await stat(full)).isFile() ? full : null;
    } catch {
      return null;
    }
  };
  return {
    async fetch(request) {
      let path: string;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response(null, { status: 404 });
      }
      const found =
        (await file(path.endsWith("/") ? `${path}index.html` : path)) ??
        (path.endsWith("/") ? null : ((await file(`${path}.html`)) ?? (await file(`${path}/index.html`))));
      if (!found) return new Response(null, { status: 404 });
      const hashed = path.startsWith("/assets/");
      return new Response(request.method === "HEAD" ? null : await readFile(found), {
        headers: {
          "Content-Type": TYPES[extname(found)] ?? "application/octet-stream",
          "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
        },
      });
    },
  };
}

/** Turn a Node request into a web Request. Coolify's proxy (Traefik) terminates
 * HTTPS, so the scheme comes from X-Forwarded-Proto and the client address from
 * X-Real-Ip, passed on as x-client-ip, which is what the login rate limit reads. */
export function toRequest(incoming: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined || name === "x-client-ip") continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const realIp = incoming.headers["x-real-ip"];
  const ip = (Array.isArray(realIp) ? realIp[0] : realIp) ?? incoming.socket.remoteAddress;
  if (ip) headers.set("x-client-ip", ip);
  const forwarded = String(incoming.headers["x-forwarded-proto"] ?? "").split(",")[0]!.trim();
  const scheme = forwarded === "https" ? "https" : "http";
  const url = new URL(incoming.url ?? "/", `${scheme}://${incoming.headers.host ?? "localhost"}`);
  const method = incoming.method ?? "GET";
  return new Request(url, {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? undefined : (Readable.toWeb(incoming) as unknown as ReadableStream),
    duplex: "half",
  } as RequestInit);
}

export async function sendResponse(response: Response, outgoing: ServerResponse) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  outgoing.writeHead(response.status, headers);
  if (!response.body) return void outgoing.end();
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(response.body as never)
      .on("error", reject)
      .pipe(outgoing)
      .on("finish", resolve)
      .on("error", reject);
  });
}
