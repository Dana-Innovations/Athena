/**
 * Apollo SDK-compat fetch interceptor.
 *
 * Apollo's Pydantic model expects `system` as a plain string, but the
 * Anthropic SDK (used by pi-ai) sends it as an array of content blocks
 * with cache_control. This module patches globalThis.fetch to flatten
 * the `system` field for requests targeting the Apollo URL.
 *
 * Removable once Apollo accepts `Union[str, list[ContentBlock]]` for system.
 */

type ContentBlock = { type?: string; text?: string };

function flattenSystemBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text" || !b.type)
    .map((b) => b.text ?? "")
    .join("\n\n");
}

/**
 * Install a fetch wrapper that transforms Anthropic SDK requests for Apollo.
 * Returns a teardown function that restores the original fetch.
 */
export function installApolloFetchCompat(
  apolloBaseUrl: string,
  logger: { info(msg: string): void; warn(msg: string): void },
): () => void {
  const originalFetch = globalThis.fetch;
  const apolloOrigin = new URL(apolloBaseUrl).origin;

  const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (
      url.startsWith(apolloOrigin) &&
      url.includes("/messages") &&
      init?.method === "POST" &&
      init.body
    ) {
      try {
        const bodyStr =
          typeof init.body === "string"
            ? init.body
            : new TextDecoder().decode(init.body as ArrayBuffer);
        const parsed = JSON.parse(bodyStr);

        if (Array.isArray(parsed.system)) {
          parsed.system = flattenSystemBlocks(parsed.system);
          logger.info("[apollo-compat] flattened system array → string for Apollo");
          return originalFetch(input, {
            ...init,
            body: JSON.stringify(parsed),
          });
        }
      } catch {
        // JSON parse failed — forward as-is
      }
    }

    return originalFetch(input, init);
  };

  globalThis.fetch = wrappedFetch;
  logger.info("[apollo-compat] fetch interceptor installed for " + apolloOrigin);

  return () => {
    if (globalThis.fetch === wrappedFetch) {
      globalThis.fetch = originalFetch;
    }
  };
}
