package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ConversationShareHandler handles conversation sharing endpoints
type ConversationShareHandler struct {
	PG *sql.DB
}

// NewConversationShareHandler creates a new ConversationShareHandler
func NewConversationShareHandler(pg *sql.DB) *ConversationShareHandler {
	return &ConversationShareHandler{PG: pg}
}

// ConversationShare represents a share link
type ConversationShare struct {
	ID             string     `json:"id"`
	ConversationID string     `json:"conversation_id"`
	ShareToken     string     `json:"share_token"`
	CreatedBy      string     `json:"created_by"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	Title          *string    `json:"title,omitempty"`
	Description    *string    `json:"description,omitempty"`
	ViewCount      int        `json:"view_count"`
	LastViewedAt   *time.Time `json:"last_viewed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// CreateShareRequest is the request body for creating a share
type CreateShareRequest struct {
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	ExpiresIn   int    `json:"expires_in,omitempty"` // Hours, default 168 (7 days)
}

// SharedConversation is the public view of a shared conversation
type SharedConversation struct {
	Title        string                   `json:"title"`
	Description  *string                  `json:"description,omitempty"`
	Messages     []SharedMessage          `json:"messages"`
	CreatedAt    time.Time                `json:"created_at"`
	MessageCount int                      `json:"message_count"`
	SharedBy     string                   `json:"shared_by,omitempty"` // Display name if available
}

// SharedMessage is a message in the shared view
type SharedMessage struct {
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	Type      string                 `json:"type"`
	ToolName  *string                `json:"tool_name,omitempty"`
	ToolInput map[string]interface{} `json:"tool_input,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
}

// CreateShare creates a new share link for a conversation
// POST /api/conversations/:id/share
func (h *ConversationShareHandler) CreateShare(c *gin.Context) {
	userID := c.GetString("user_id")
	log.Printf("CreateShare: userID from context = %s", userID)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	conversationID := c.Param("id")
	log.Printf("CreateShare: conversationID = %s", conversationID)
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Conversation ID required"})
		return
	}

	var req CreateShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Optional body, use defaults
		req.ExpiresIn = 168 // 7 days default
	}

	// Set default expiry if not provided
	if req.ExpiresIn <= 0 {
		req.ExpiresIn = 168 // 7 days
	}

	// Verify user owns this conversation
	// Note: conversationID from URL is the TEXT conversation_id field, not the UUID id
	var dbID string // UUID primary key
	var ownerID string
	var convTitle sql.NullString
	err := h.PG.QueryRow(`
		SELECT id, user_id, title FROM claude_conversations WHERE conversation_id = $1
	`, conversationID).Scan(&dbID, &ownerID, &convTitle)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	log.Printf("CreateShare: dbID=%s, ownerID=%s, userID=%s", dbID, ownerID, userID)
	if ownerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only share your own conversations"})
		return
	}

	// Generate share token
	token, err := generateShareToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate share token"})
		return
	}

	// Calculate expiry
	expiresAt := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)

	// Use conversation title if no custom title provided
	shareTitle := req.Title
	if shareTitle == "" && convTitle.Valid {
		shareTitle = convTitle.String
	}

	// Insert share record
	// Note: conversation_id in conversation_shares references claude_conversations.id (UUID)
	var share ConversationShare
	err = h.PG.QueryRow(`
		INSERT INTO conversation_shares (conversation_id, share_token, created_by, expires_at, title, description)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, conversation_id, share_token, created_by, expires_at, title, description, view_count, created_at
	`, dbID, token, userID, expiresAt, nullString(shareTitle), nullString(req.Description)).Scan(
		&share.ID, &share.ConversationID, &share.ShareToken, &share.CreatedBy,
		&share.ExpiresAt, &share.Title, &share.Description, &share.ViewCount, &share.CreatedAt,
	)

	if err != nil {
		log.Printf("Failed to create share: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create share", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"share":     share,
		"share_url": "/shared/" + token,
	})
}

// GetSharedConversation returns a shared conversation (PUBLIC - no auth required)
// GET /shared/:token
func (h *ConversationShareHandler) GetSharedConversation(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Share token required"})
		return
	}

	// Get share record
	var share ConversationShare
	var conversationID string
	err := h.PG.QueryRow(`
		SELECT id, conversation_id, share_token, created_by, expires_at, title, description, view_count, created_at
		FROM conversation_shares
		WHERE share_token = $1
	`, token).Scan(
		&share.ID, &conversationID, &share.ShareToken, &share.CreatedBy,
		&share.ExpiresAt, &share.Title, &share.Description, &share.ViewCount, &share.CreatedAt,
	)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share link not found or expired"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	// Check expiry
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "Share link has expired"})
		return
	}

	// Update view count
	h.PG.Exec(`
		UPDATE conversation_shares
		SET view_count = view_count + 1, last_viewed_at = NOW()
		WHERE id = $1
	`, share.ID)

	// Get conversation
	// conversationID here is the UUID (claude_conversations.id)
	// We also need the TEXT conversation_id for querying messages
	var convTitle, firstMessage sql.NullString
	var textConversationID string // TEXT field for messages table
	var convCreatedAt time.Time
	var messageCount int
	err = h.PG.QueryRow(`
		SELECT conversation_id, title, first_message, created_at, message_count
		FROM claude_conversations
		WHERE id = $1
	`, conversationID).Scan(&textConversationID, &convTitle, &firstMessage, &convCreatedAt, &messageCount)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	// Get messages using TEXT conversation_id
	rows, err := h.PG.Query(`
		SELECT role, content, message_type, tool_name, tool_input, created_at
		FROM claude_messages
		WHERE conversation_id = $1
		ORDER BY created_at ASC
	`, textConversationID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load messages"})
		return
	}
	defer rows.Close()

	var messages []SharedMessage
	for rows.Next() {
		var msg SharedMessage
		var toolInput sql.NullString
		err := rows.Scan(&msg.Role, &msg.Content, &msg.Type, &msg.ToolName, &toolInput, &msg.CreatedAt)
		if err != nil {
			continue
		}
		// Parse tool_input JSON if present
		if toolInput.Valid && toolInput.String != "" {
			// Simplified - just store as raw for now
			msg.ToolInput = map[string]interface{}{"raw": toolInput.String}
		}
		messages = append(messages, msg)
	}

	// Build response
	title := "AI Conversation"
	if share.Title != nil && *share.Title != "" {
		title = *share.Title
	} else if convTitle.Valid && convTitle.String != "" {
		title = convTitle.String
	}

	response := SharedConversation{
		Title:        title,
		Description:  share.Description,
		Messages:     messages,
		CreatedAt:    convCreatedAt,
		MessageCount: len(messages),
	}

	c.JSON(http.StatusOK, response)
}

// ListShares lists all shares for a conversation
// GET /api/conversations/:id/shares
func (h *ConversationShareHandler) ListShares(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	conversationID := c.Param("id")

	rows, err := h.PG.Query(`
		SELECT id, conversation_id, share_token, created_by, expires_at, title, description, view_count, last_viewed_at, created_at
		FROM conversation_shares
		WHERE conversation_id = $1 AND created_by = $2
		ORDER BY created_at DESC
	`, conversationID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}
	defer rows.Close()

	var shares []ConversationShare
	for rows.Next() {
		var share ConversationShare
		err := rows.Scan(
			&share.ID, &share.ConversationID, &share.ShareToken, &share.CreatedBy,
			&share.ExpiresAt, &share.Title, &share.Description, &share.ViewCount,
			&share.LastViewedAt, &share.CreatedAt,
		)
		if err != nil {
			continue
		}
		shares = append(shares, share)
	}

	c.JSON(http.StatusOK, gin.H{"shares": shares})
}

// RevokeShare deletes a share link
// DELETE /api/conversations/:id/shares/:shareId
func (h *ConversationShareHandler) RevokeShare(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	shareID := c.Param("shareId")

	result, err := h.PG.Exec(`
		DELETE FROM conversation_shares
		WHERE id = $1 AND created_by = $2
	`, shareID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Share link revoked"})
}

// Helper functions

func generateShareToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	token := base64.URLEncoding.EncodeToString(bytes)
	// Remove padding
	token = strings.TrimRight(token, "=")
	return token, nil
}

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{String: s, Valid: true}
}
