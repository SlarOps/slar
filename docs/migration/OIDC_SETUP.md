# OIDC Authentication Setup Guide

SLAR supports authentication via any **OIDC-compliant identity provider**. This guide covers setup for popular providers.

## Supported Providers

- **Self-hosted**: Keycloak, Authentik, Dex
- **Cloud**: Auth0, Okta, Azure AD, Google Workspace, AWS Cognito

## Quick Start

### 1. Configure Environment Variables

```bash
# Required
OIDC_ISSUER=https://your-identity-provider.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret

# Required for NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# Optional
OIDC_PROVIDER_NAME=SSO           # Button text on login page
OIDC_SCOPES=openid profile email # Custom scopes if needed
```

### 2. Configure Your Identity Provider

Create an **OIDC/OAuth2 Application** with these settings:

| Setting | Value |
|---------|-------|
| Application Type | Web Application (Confidential) |
| Grant Types | Authorization Code |
| Redirect URI | `http://localhost:3000/api/auth/callback/oidc` |
| Post-Logout URI | `http://localhost:3000` |
| Scopes | `openid profile email offline_access` |

### 3. Install Dependencies

```bash
cd web/slar
npm install next-auth
```

### 4. Test Authentication

```bash
npm run dev
# Open http://localhost:3000/login
# Click "Sign in with SSO"
```

---

## Provider-Specific Setup

### Keycloak

```bash
OIDC_ISSUER=http://localhost:8080/realms/your-realm
OIDC_CLIENT_ID=slar-app
OIDC_CLIENT_SECRET=<from-keycloak>
```

**Setup**:
1. Create Realm → `slar` (or use existing)
2. Clients → Create → `slar-app`
3. Access Type: `confidential`
4. Valid Redirect URIs: `http://localhost:3000/api/auth/callback/oidc`

### Auth0

```bash
OIDC_ISSUER=https://your-tenant.auth0.com
OIDC_CLIENT_ID=<from-auth0>
OIDC_CLIENT_SECRET=<from-auth0>
```

**Setup**:
1. Applications → Create Application → Regular Web Application
2. Settings → Allowed Callback URLs: `http://localhost:3000/api/auth/callback/oidc`
3. Settings → Allowed Logout URLs: `http://localhost:3000`

### Okta

```bash
OIDC_ISSUER=https://your-org.okta.com
OIDC_CLIENT_ID=<from-okta>
OIDC_CLIENT_SECRET=<from-okta>
```

**Setup**:
1. Applications → Create App Integration → OIDC - Web Application
2. Sign-in redirect URIs: `http://localhost:3000/api/auth/callback/oidc`
3. Sign-out redirect URIs: `http://localhost:3000`

### Azure AD (Entra ID)

```bash
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=<application-id>
OIDC_CLIENT_SECRET=<client-secret>
```

**Setup**:
1. Azure Portal → App registrations → New registration
2. Redirect URI: `http://localhost:3000/api/auth/callback/oidc` (Web)
3. Certificates & secrets → New client secret

### Google Workspace

```bash
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=<from-google-cloud>
OIDC_CLIENT_SECRET=<from-google-cloud>
```

**Setup**:
1. Google Cloud Console → APIs & Services → Credentials
2. Create OAuth 2.0 Client → Web application
3. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/oidc`

---

## Backend Configuration

The Go API and Python AI service also verify OIDC tokens. Set these environment variables:

```bash
# For Go API
OIDC_ISSUER=https://your-identity-provider.com
OIDC_CLIENT_ID=your-client-id  # Optional, for audience validation

# For Python AI service
OIDC_ISSUER=https://your-identity-provider.com
OIDC_CLIENT_ID=your-client-id  # Optional
```

---

## Production Configuration

```bash
# OIDC Provider
OIDC_ISSUER=https://auth.your-domain.com
OIDC_CLIENT_ID=slar-production
OIDC_CLIENT_SECRET=<strong-secret>

# NextAuth
NEXTAUTH_URL=https://app.your-domain.com
NEXTAUTH_SECRET=<32-char-random-string>

# Optional: Restrict sign-in to specific domains
OIDC_ALLOWED_DOMAINS=your-company.com,partner-company.com
```

---

## Troubleshooting

### "Configuration Error"

Ensure all required environment variables are set:
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

### "Invalid redirect_uri"

The callback URL must match exactly:
```
http://localhost:3000/api/auth/callback/oidc  (development)
https://app.your-domain.com/api/auth/callback/oidc  (production)
```

### "Token verification failed"

1. Check `OIDC_ISSUER` is correct (include protocol)
2. Verify JWKS endpoint is accessible: `{issuer}/.well-known/openid-configuration`
3. Check clock sync between servers

### "CORS Error"

Add your frontend origin to the identity provider's allowed origins.

---

## Files Overview

| File | Description |
|------|-------------|
| `web/slar/src/app/api/auth/[...nextauth]/route.js` | NextAuth OIDC configuration |
| `web/slar/src/contexts/AuthContext.tsx` | React auth context (uses NextAuth) |
| `api/services/oidc_auth.go` | Go OIDC JWT verification |
| `api/handlers/oidc_middleware.go` | Go auth middleware |
| `api/ai/oidc_auth.py` | Python OIDC JWT verification |
| `api/ai/config.py` | Python OIDC configuration |

---

## Security Best Practices

1. **Always use HTTPS** in production
2. **Rotate secrets** regularly
3. **Enable MFA** on your identity provider
4. **Use short-lived tokens** (1 hour or less)
5. **Implement proper logout** (revoke tokens)
6. **Restrict redirect URIs** to exact matches only
