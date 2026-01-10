/**
 * NextAuth API Route - Standard OIDC Authentication
 *
 * Works with any OIDC-compliant provider via wellKnown discovery.
 * Supports: Zitadel, Keycloak, Auth0, Okta, Google, Azure AD, etc.
 *
 * Required env vars:
 *   - OIDC_ISSUER: The OIDC provider URL (e.g., https://auth.example.com)
 *   - OIDC_CLIENT_ID: Your application's client ID
 *
 * Optional env vars:
 *   - OIDC_CLIENT_SECRET: Client secret (empty for public clients using PKCE)
 *   - OIDC_SCOPES: Custom scopes (default: "openid profile email")
 */

import NextAuth from "next-auth";

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
      // Initial sign-in: persist tokens and profile
      if (account && profile) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.idToken = account.id_token;
        token.expiresAt = account.expires_at;

        // Standard OIDC claims
        token.sub = profile.sub;
        token.email = profile.email;
        token.name = profile.name || profile.preferred_username || profile.email?.split("@")[0];
        token.picture = profile.picture;

        // Optional claims (if provider supports)
        token.roles = profile.roles || profile["urn:zitadel:iam:org:project:roles"] || [];
        token.groups = profile.groups || [];
      }
      return token;
    },

    async session({ session, token }) {
      // Use idToken for backend auth (it's a JWT that backend can verify)
      session.accessToken = token.idToken || token.accessToken;
      session.idToken = token.idToken;

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
