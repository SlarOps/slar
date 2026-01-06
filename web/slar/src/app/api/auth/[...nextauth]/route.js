/**
 * NextAuth API Route - Generic OIDC Authentication
 *
 * This handles authentication via any OIDC-compliant provider.
 * Supports: Keycloak, Auth0, Okta, Azure AD, Google Workspace, etc.
 *
 * Configuration via environment variables - no code changes needed to switch providers.
 */

import NextAuth from "next-auth";

/**
 * Generic OIDC Provider Configuration for NextAuth v4
 * Uses OAuth type with OIDC Discovery
 */
function getOIDCProvider() {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET || ""; // Empty for PKCE-only (Native/SPA apps)

  if (!issuer || !clientId) {
    console.error("OIDC configuration missing. Required: OIDC_ISSUER, OIDC_CLIENT_ID");
    return null;
  }

  console.log(`[NextAuth] Configuring OIDC provider with issuer: ${issuer}`);

  return {
    id: "oidc",
    name: process.env.OIDC_PROVIDER_NAME || "SSO",
    type: "oauth",

    // OIDC Discovery - automatically fetches endpoints
    wellKnown: `${issuer}/.well-known/openid-configuration`,

    clientId: clientId,
    clientSecret: clientSecret,

    // For PKCE public clients - don't send client_secret in token request
    client: {
      token_endpoint_auth_method: "none",
    },

    authorization: {
      params: {
        scope: process.env.OIDC_SCOPES || "openid profile email offline_access",
        response_type: "code",
      },
    },

    // Use ID token for user info
    idToken: true,

    // PKCE for security
    checks: ["pkce", "state"],

    // Map OIDC profile to NextAuth user
    profile(profile) {
      console.log("[NextAuth] Profile received:", JSON.stringify(profile, null, 2));
      return {
        id: profile.sub,
        name: profile.name || profile.preferred_username || profile.given_name || profile.email?.split('@')[0] || "User",
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
      // Initial sign in - persist tokens
      if (account) {
        console.log("[NextAuth] JWT callback - initial sign in");
        console.log("[NextAuth] id_token present:", !!account.id_token);
        console.log("[NextAuth] access_token present:", !!account.access_token);
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.idToken = account.id_token; // JWT token for backend auth
        token.provider = account.provider;

        // Store profile claims (from userinfo endpoint for Zitadel)
        if (profile) {
          token.sub = profile.sub;
          token.email = profile.email;
          // Zitadel may return name in different fields
          token.name = profile.name || profile.preferred_username || profile.given_name || profile.email?.split('@')[0];
          token.picture = profile.picture;
          token.roles = profile.roles || [];
          token.groups = profile.groups || [];
          // Store preferred_username separately for reference
          token.preferred_username = profile.preferred_username;
        }
      }

      return token;
    },

    async session({ session, token }) {
      // Pass token data to client session
      // Use idToken (JWT) for backend auth, accessToken may be opaque
      session.accessToken = token.idToken || token.accessToken;
      session.idToken = token.idToken;
      session.error = token.error;
      session.provider = token.provider;

      // Ensure user data is populated
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

    async signIn({ user, account, profile }) {
      console.log("[NextAuth] SignIn callback - user:", user?.email);
      return true;
    },

    async redirect({ url, baseUrl }) {
      // Redirect to dashboard after sign in
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
