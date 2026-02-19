/**
 * Apollo SDK-compat fetch interceptor.
 *
 * Responsibilities:
 * 1. Inject `x-cortex-user-id` header on Apollo-bound requests so Apollo
 *    can resolve per-user Anthropic keys (Phase 2 multi-auth).
 * 2. Capture `key_source` from Apollo responses — first from the
 *    `x-cortex-key-source` header (non-streaming), then as a fallback
 *    from the `cortex_usage.keySource` field in the response body.
 *
 * Note: system field flattening (array → string) was removed — Cortex
 * natively accepts both `system: "string"` and `system: [{type, text}]`.
 */

export type ApolloCompatOptions = {
  apolloBaseUrl: string;
  logger: { info(msg: string): void; warn(msg: string): void };
  /** Returns the current Sonance user ID, if known. */
  resolveUserId?: () => string | undefined;
};

// Shared key-source tracking — last `key_source` seen from Apollo responses.
const KEY_SOURCE_SYM = Symbol.for("sonance.apollo.lastKeySource");

/** Read the last key_source value captured from an Apollo response. */
export function getLastApolloKeySource(): string | undefined {
  return (globalThis as Record<symbol, unknown>)[KEY_SOURCE_SYM] as string | undefined;
}

function setLastApolloKeySource(source: string): void {
  (globalThis as Record<symbol, unknown>)[KEY_SOURCE_SYM] = source;
}

/**
 * Try to extract keySource from the response — header first, then body.
 * For non-streaming responses, clones the response to read the body
 * without consuming the original stream.
 */
async function captureKeySource(response: Response): Promise<void> {
  const fromHeader = response.headers.get("x-cortex-key-source");
  if (fromHeader) {
    setLastApolloKeySource(fromHeader);
    return;
  }

  // Fallback: parse keySource from the cortex_usage field in the response body.
  // Only attempt for JSON responses (non-streaming).
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return;

  try {
    const clone = response.clone();
    const body = await clone.json();
    const ks = body?.cortex_usage?.keySource ?? body?.cortex_usage?.key_source;
    if (typeof ks === "string" && ks) {
      setLastApolloKeySource(ks);
    }
  } catch {
    // Body parse failed — ignore
  }
}

/**
 * Install a fetch wrapper that enriches Apollo-bound requests.
 * Returns a teardown function that restores the original fetch.
 */
export function installApolloFetchCompat(
  apolloBaseUrlOrOpts: string | ApolloCompatOptions,
  loggerArg?: { info(msg: string): void; warn(msg: string): void },
): () => void {
  const opts: ApolloCompatOptions =
    typeof apolloBaseUrlOrOpts === "string"
      ? { apolloBaseUrl: apolloBaseUrlOrOpts, logger: loggerArg! }
      : apolloBaseUrlOrOpts;

  const { apolloBaseUrl, logger, resolveUserId } = opts;
  const originalFetch = globalThis.fetch;
  const apolloOrigin = new URL(apolloBaseUrl).origin;

  const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    const isApollo = url.startsWith(apolloOrigin);

    if (isApollo) {
      const userId = resolveUserId?.();
      if (userId) {
        const existingHeaders = new Headers(init?.headers as HeadersInit);
        existingHeaders.set("x-cortex-user-id", userId);
        const resp = await originalFetch(input, {
          ...init,
          headers: Object.fromEntries(existingHeaders.entries()),
        });
        void captureKeySource(resp);
        return resp;
      }
    }

    const resp = await originalFetch(input, init);
    if (isApollo) {
      void captureKeySource(resp);
    }
    return resp;
  };

  globalThis.fetch = wrappedFetch;
  logger.info("[apollo-compat] fetch interceptor installed for " + apolloOrigin);

  return () => {
    if (globalThis.fetch === wrappedFetch) {
      globalThis.fetch = originalFetch;
    }
  };
}
