import { HTMLRewriter as Engine, type ElementHandlers } from "html-rewriter-wasm";

/** Cloudflare's HTMLRewriter for Node. It runs the same lol-html engine, compiled
 * to WebAssembly, behind the `.on(...).transform(response)` interface. */
export class HTMLRewriter {
  readonly #handlers: [string, ElementHandlers][] = [];

  on(selector: string, handlers: ElementHandlers) {
    this.#handlers.push([selector, handlers]);
    return this;
  }

  transform(response: Response) {
    const handlers = this.#handlers;
    const source = response.body;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const engine = new Engine((chunk) => controller.enqueue(chunk));
        for (const [selector, handler] of handlers) engine.on(selector, handler);
        try {
          if (source) for await (const chunk of source) await engine.write(chunk);
          await engine.end();
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          engine.free();
        }
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
}

/** Make `HTMLRewriter` global, as it is on Cloudflare. */
export function installHTMLRewriter() {
  (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter ??= HTMLRewriter;
}
