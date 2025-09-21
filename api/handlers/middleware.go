package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

type AuthMiddleware struct {
	JWTService *services.JWTService
}

func NewAuthMiddleware(jwtService *services.JWTService) *AuthMiddleware {
	return &AuthMiddleware{JWTService: jwtService}
}

// JWTAuthMiddleware validates JWT tokens
func (m *AuthMiddleware) JWTAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "authorization_required",
				"message": "Authorization header is required",
			})
			c.Abort()
			return
		}

		// Extract token from header
		token, err := m.JWTService.ExtractTokenFromHeader(authHeader)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_authorization_header",
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		// Validate token
		claims, err := m.JWTService.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_token",
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		// Set user information in context
		c.Set("user_id", claims.UserID)
		c.Set("user_email", claims.Email)
		c.Set("user_role", claims.Role)
		c.Set("auth_method", "jwt")

		c.Next()
	}
}

// AdminOnlyMiddleware ensures only admin users can access
func (m *AuthMiddleware) AdminOnlyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		userRole, exists := c.Get("user_role")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "authentication_required",
				"message": "User must be authenticated",
			})
			c.Abort()
			return
		}

		if userRole != "admin" {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "admin_required",
				"message": "Admin access required",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// OptionalAuthMiddleware validates token if present but doesn't require it
func (m *AuthMiddleware) OptionalAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			// No token provided, continue without authentication
			c.Next()
			return
		}

		// Extract and validate token if provided
		token, err := m.JWTService.ExtractTokenFromHeader(authHeader)
		if err == nil {
			claims, err := m.JWTService.ValidateToken(token)
			if err == nil {
				// Set user information in context if token is valid
				c.Set("user_id", claims.UserID)
				c.Set("user_email", claims.Email)
				c.Set("user_role", claims.Role)
				c.Set("auth_method", "jwt")
			}
		}

		c.Next()
	}
}
