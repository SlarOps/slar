/**
 * NextAuth API Route - Standard OIDC Authentication + Backend Token Exchange
 *
 * Authentication flow:
 *   1. User clicks "Login" → redirected to OIDC provider (Cloudflare, Google, Zitadel, etc.)
 *   2. OIDC provider authenticates user → returns ID Token (JWT, ~5min lifetime)
 *   3. NextAuth receives ID Token → exchanges with backend for session token (1h) + refresh token (7d)
 *   4. Frontend uses session token for all API calls
 *   5. When session token expires → auto-refresh using refresh token (no user interaction)
 *   6. When refresh token expires → user must re-login via OIDC
 *
 * This decouples the API from OIDC provider's short-lived tokens
 * and works identically for ALL providers (Cloudflare, Google, Zitadel, Dex, etc.)
 *
 * Required env vars:
 *   - OIDC_ISSUER: The OIDC provider URL
 *   - OIDC_CLIENT_ID: Your application's client ID
 *
 * Optional env vars:
 *   - OIDC_CLIENT_SECRET: Client secret (empty for public clients using PKCE)
 *   - OIDC_SCOPES: Custom scopes (default: "openid profile email")
 *   - BACKEND_API_URL: Backend URL for token exchange (default: tries NEXT_PUBLIC_API_URL)
 */

import NextAuth from "next-auth";

/**
 * Get the backend API URL for server-side token exchange
 * Falls back gracefully - if not configured, token exchange is skipped
 */
function getBackendURL() {
  return process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || '';
}

/**
 * Exchange OIDC ID Token for backend session token
 * POST /auth/token → { session_token, refresh_token, expires_in }
 *
 * If backend URL is not configured or exchange fails, returns null
 * (frontend will fall back to sending ID token directly)
 */
async function exchangeTokenWithBackend(idToken) {
  const backendURL = getBackendURL();
  if (!backendURL || !idToken) {
    return null;
  }

  try {
    const response = await fetch(`${backendURL}/session/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error("[NextAuth] Token exchange failed:", response.status, error);
      return null;
    }

    const data = await response.json();
    console.log("[NextAuth] Token exchange SUCCESS - session_token issued (expires_in:", data.expires_in, "s)");
    return data;
  } catch (error) {
    console.error("[NextAuth] Token exchange error:", error.message);
    return null;
  }
}

/**
 * Refresh session token using refresh token
 * POST /auth/refresh → { session_token, refresh_token, expires_in }
 */
async function refreshSessionToken(refreshToken) {
  const backendURL = getBackendURL();
  if (!backendURL || !refreshToken) {
    return null;
  }

  try {
    const response = await fetch(`${backendURL}/session/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error("[NextAuth] Token refresh failed:", response.status, error);
      return null;
    }

    const data = await response.json();
    console.log("[NextAuth] Token refresh SUCCESS (expires_in:", data.expires_in, "s)");
    return data;
  } catch (error) {
    console.error("[NextAuth] Token refresh error:", error.message);
    return null;
  }
}

/**
 * Build OIDC provider using wellKnown discovery
 * Auto-discovers all endpoints from /.well-known/openid-configuration
 */
function getOIDCProvider() {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  if (!issuer || !clientId) {
    console.error("[NextAuth] Missing required env: OIDC_ISSUER, OIDC_CLIENT_ID");
    return null;
  }

  const hasSecret = !!clientSecret && clientSecret.length > 0;

  console.log("[NextAuth] OIDC config:", {
    issuer,
    clientId: clientId.substring(0, 8) + "...",
    clientType: hasSecret ? "confidential" : "public",
    backendURL: getBackendURL() || "(not configured - using ID token directly)",
  });

  return {
    id: "oidc",
    name: "SSO",
    type: "oauth",

    // OIDC Discovery - auto-fetches authorization, token, userinfo endpoints
    wellKnown: `${issuer}/.well-known/openid-configuration`,

    clientId,
    clientSecret: clientSecret || "",

    // Client authentication method
    client: {
      token_endpoint_auth_method: hasSecret ? "client_secret_post" : "none",
    },

    authorization: {
      params: {
        scope: process.env.OIDC_SCOPES || "openid profile email",
      },
    },

    // Use ID token for user info (standard OIDC)
    idToken: true,

    // Security checks - state always, PKCE for public clients only
    // Some providers (Google) don't support PKCE with confidential clients
    checks: hasSecret ? ["state"] : ["pkce", "state"],

    // Standard OIDC profile mapping
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name || profile.preferred_username || profile.email?.split("@")[0],
        email: profile.email,
        image: profile.picture,
      };
    },
  };
}

const oidcProvider = getOIDCProvider();

const handler = NextAuth({
  providers: oidcProvider ? [oidcProvider] : [],

  callbacks: {
    async jwt({ token, account, profile }) {
      // === INITIAL SIGN-IN: Exchange ID Token for backend session token ===
      if (account && profile) {
        console.log("[NextAuth] Initial sign-in - OIDC provider response:", {
          email: profile.email,
          has_access_token: !!account.access_token,
          has_refresh_token: !!account.refresh_token,
          has_id_token: !!account.id_token,
        });

        // Standard OIDC claims
        token.sub = profile.sub;
        token.email = profile.email;
        token.name = profile.name || profile.preferred_username || profile.email?.split("@")[0];
        token.picture = profile.picture;
        token.roles = profile.roles || profile["urn:zitadel:iam:org:project:roles"] || [];
        token.groups = profile.groups || [];

        // Store OIDC tokens as fallback
        token.idToken = account.id_token;
        token.oidcRefreshToken = account.refresh_token;

        // Try to exchange ID Token for backend session token
        const exchangeResult = await exchangeTokenWithBackend(account.id_token);

        if (exchangeResult) {
          // Backend token exchange succeeded
          token.sessionToken = exchangeResult.session_token;
          token.backendRefreshToken = exchangeResult.refresh_token;
          token.sessionExpiresAt = Math.floor(Date.now() / 1000) + exchangeResult.expires_in;
          token.useSessionToken = true;
          console.log("[NextAuth] Using backend session token (expires in", exchangeResult.expires_in, "s)");
        } else {
          // Fallback: use ID Token directly (backward compatible)
          token.sessionToken = null;
          token.backendRefreshToken = null;
          token.sessionExpiresAt = account.expires_at || 0;
          token.useSessionToken = false;
          console.log("[NextAuth] Fallback: using OIDC ID Token directly");
        }

        return token;
      }

      // === SUBSEQUENT REQUESTS: Check if session token needs refresh ===
      if (token.useSessionToken && token.sessionExpiresAt) {
        const now = Math.floor(Date.now() / 1000);
        const bufferSeconds = 5 * 60; // Refresh 5 minutes before expiry

        if (now >= token.sessionExpiresAt - bufferSeconds) {
          console.log("[NextAuth] Session token expiring soon, refreshing...");

          const refreshResult = await refreshSessionToken(token.backendRefreshToken);

          if (refreshResult) {
            token.sessionToken = refreshResult.session_token;
            token.backendRefreshToken = refreshResult.refresh_token;
            token.sessionExpiresAt = Math.floor(Date.now() / 1000) + refreshResult.expires_in;
            console.log("[NextAuth] Session token refreshed (expires in", refreshResult.expires_in, "s)");
          } else {
            // Refresh failed - try re-exchanging with ID token (if still valid)
            console.warn("[NextAuth] Refresh failed, attempting re-exchange with ID token...");
            const reExchange = await exchangeTokenWithBackend(token.idToken);

            if (reExchange) {
              token.sessionToken = reExchange.session_token;
              token.backendRefreshToken = reExchange.refresh_token;
              token.sessionExpiresAt = Math.floor(Date.now() / 1000) + reExchange.expires_in;
            } else {
              // Both refresh and re-exchange failed
              // Signal to frontend that re-authentication is needed
              console.error("[NextAuth] All token refresh attempts failed");
              token.error = "RefreshAccessTokenError";
            }
          }
        }
      }

      return token;
    },

    async session({ session, token }) {
      // Use backend session token if available, otherwise fallback to ID token
      if (token.useSessionToken && token.sessionToken) {
        session.accessToken = token.sessionToken;
      } else {
        // Fallback: ID Token (backward compatible, but 5-min lifetime)
        session.accessToken = token.idToken;
      }
      session.idToken = token.idToken;

      // Pass through error for frontend handling
      if (token.error) {
        session.error = token.error;
      }

      if (session.user) {
        session.user.id = token.sub;
        session.user.email = token.email;
        session.user.name = token.name;
        session.user.image = token.picture;
        session.user.roles = token.roles;
        session.user.groups = token.groups;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return `${baseUrl}/incidents`;
    },
  },

  pages: {
    signIn: "/login",
    signOut: "/login",
    error: "/login",
  },

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
});

export { handler as GET, handler as POST };
