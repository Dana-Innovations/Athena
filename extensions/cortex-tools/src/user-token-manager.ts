/**
 * Per-User Token Manager for Cortex Tools.
 *
 * Manages the lifecycle of short-lived per-user API keys obtained via
 * Cortex's token exchange endpoint. When an Athena user authenticates
 * via Sonance SSO, this manager exchanges the service API key + user
 * email for a per-user key so Cortex can attribute usage individually.
 *
 * Cache strategy:
 *   - Keys are cached by email with a 5-minute safety buffer before expiry
 *   - On exchange failure, falls back to the service API key (graceful degradation)
 *   - Expired entries are evicted lazily on next access
 */

type CachedToken = {
  apiKey: string;
  expiresAt: number; // Unix timestamp ms
  userId: string;
};

type TokenExchangeResponse = {
  api_key: string;
  user_id: string;
  email: string;
  expires_in: number; // seconds
};

/** Buffer before actual expiry to trigger refresh (5 minutes). */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class UserTokenManager {
  private readonly cache = new Map<string, CachedToken>();
  private readonly cortexUrl: string;
  private readonly serviceApiKey: string;

  /** In-flight exchange promises to prevent duplicate concurrent requests. */
  private readonly pending = new Map<string, Promise<CachedToken>>();

  constructor(cortexUrl: string, serviceApiKey: string) {
    this.cortexUrl = cortexUrl.replace(/\/+$/, "");
    this.serviceApiKey = serviceApiKey;
  }

  /**
   * Get a per-user API key for the given employee email.
   *
   * Returns a cached key if still valid, otherwise performs a token exchange
   * with Cortex. Falls back to the service API key on failure.
   */
  async getKeyForUser(email: string): Promise<string> {
    const normalizedEmail = email.trim().toLowerCase();

    // Check cache
    const cached = this.cache.get(normalizedEmail);
    if (cached && cached.expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
      return cached.apiKey;
    }

    // De-duplicate concurrent requests for the same user
    const inflight = this.pending.get(normalizedEmail);
    if (inflight) {
      try {
        const result = await inflight;
        return result.apiKey;
      } catch {
        return this.serviceApiKey;
      }
    }

    const exchangePromise = this.exchange(normalizedEmail);
    this.pending.set(normalizedEmail, exchangePromise);

    try {
      const token = await exchangePromise;
      return token.apiKey;
    } catch {
      // Graceful degradation: use service key if exchange fails
      return this.serviceApiKey;
    } finally {
      this.pending.delete(normalizedEmail);
    }
  }

  /**
   * Call Cortex token exchange endpoint.
   */
  private async exchange(email: string): Promise<CachedToken> {
    const url = `${this.cortexUrl}/api/v1/auth/token-exchange`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.serviceApiKey,
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as TokenExchangeResponse;

    const token: CachedToken = {
      apiKey: data.api_key,
      userId: data.user_id,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    this.cache.set(email, token);
    this.evictExpired();

    return token;
  }

  /**
   * Remove expired entries from the cache.
   */
  private evictExpired(): void {
    if (this.cache.size < 50) return; // Don't bother for small caches
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }
}
