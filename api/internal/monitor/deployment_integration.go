package monitor

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

// GetDeploymentIntegration retrieves integration info for a deployment
func (h *DeploymentHandler) GetDeploymentIntegration(c *gin.Context) {
	deploymentID := c.Param("id")

	var integrationID sql.NullString
	var integrationName, integrationType, webhookURL sql.NullString

	err := h.db.QueryRow(`
		SELECT 
			md.integration_id,
			i.name,
			i.type,
			i.webhook_url
		FROM monitor_deployments md
		LEFT JOIN integrations i ON md.integration_id = i.id
		WHERE md.id = $1
	`, deploymentID).Scan(&integrationID, &integrationName, &integrationType, &webhookURL)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Deployment not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	response := gin.H{
		"deployment_id": deploymentID,
		"integration":   nil,
	}

	if integrationID.Valid && integrationID.String != "" {
		response["integration"] = gin.H{
			"id":          integrationID.String,
			"name":        integrationName.String,
			"type":        integrationType.String,
			"webhook_url": webhookURL.String,
		}
	}

	c.JSON(http.StatusOK, response)
}

// UpdateDeploymentIntegration updates the integration link for a deployment
func (h *DeploymentHandler) UpdateDeploymentIntegration(c *gin.Context) {
	deploymentID := c.Param("id")

	var req struct {
		IntegrationID *string `json:"integration_id"` // null to unlink
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate integration exists if provided
	if req.IntegrationID != nil && *req.IntegrationID != "" {
		var exists bool
		err := h.db.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM integrations WHERE id = $1 AND is_active = true)
		`, *req.IntegrationID).Scan(&exists)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate integration"})
			return
		}

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found or inactive"})
			return
		}
	}

	// Update deployment
	_, err := h.db.Exec(`
		UPDATE monitor_deployments
		SET integration_id = $1, updated_at = NOW()
		WHERE id = $2
	`, req.IntegrationID, deploymentID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update deployment"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Integration updated successfully",
		"note":    "Please redeploy the worker for changes to take effect",
	})
}
