package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

type UptimeHandler struct {
	Service *services.UptimeService
}

func NewUptimeHandler(service *services.UptimeService) *UptimeHandler {
	return &UptimeHandler{Service: service}
}

// Service Management Endpoints
func (h *UptimeHandler) ListServices(c *gin.Context) {
	services, err := h.Service.ListServices()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch services"})
		return
	}
	c.JSON(http.StatusOK, services)
}

func (h *UptimeHandler) GetService(c *gin.Context) {
	id := c.Param("id")
	service, err := h.Service.GetService(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
		return
	}
	c.JSON(http.StatusOK, service)
}

func (h *UptimeHandler) CreateService(c *gin.Context) {
	service, err := h.Service.CreateService(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, service)
}

// Service Checking Endpoints
func (h *UptimeHandler) CheckService(c *gin.Context) {
	id := c.Param("id")
	check, err := h.Service.CheckService(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check service"})
		return
	}
	c.JSON(http.StatusOK, check)
}

// Statistics Endpoints
func (h *UptimeHandler) GetServiceStats(c *gin.Context) {
	id := c.Param("id")
	period := c.DefaultQuery("period", "24h")

	stats, err := h.Service.GetServiceStats(id, period)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Stats not found"})
		return
	}
	c.JSON(http.StatusOK, stats)
}

func (h *UptimeHandler) GetServiceHistory(c *gin.Context) {
	id := c.Param("id")
	hoursStr := c.DefaultQuery("hours", "24")

	hours, err := strconv.Atoi(hoursStr)
	if err != nil {
		hours = 24
	}

	history, err := h.Service.GetServiceHistory(id, hours)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch history"})
		return
	}
	c.JSON(http.StatusOK, history)
}

// Uptime Dashboard Endpoint
func (h *UptimeHandler) GetUptimeDashboard(c *gin.Context) {
	services, err := h.Service.ListServices()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch services"})
		return
	}

	// Get stats for each service
	var dashboardData []map[string]interface{}

	for _, service := range services {
		// Get 24h stats
		stats24h, err := h.Service.GetServiceStats(service.ID, "24h")
		if err != nil {
			continue
		}

		// Get 30d stats
		stats30d, err := h.Service.GetServiceStats(service.ID, "30d")
		if err != nil {
			continue
		}

		// Get recent history for status timeline
		history, err := h.Service.GetServiceHistory(service.ID, 2)
		if err != nil {
			continue
		}

		// Get current status
		currentStatus := "unknown"
		lastResponseTime := 0
		sslInfo := map[string]interface{}{}

		if len(history) > 0 {
			lastCheck := history[0]
			currentStatus = lastCheck.Status
			lastResponseTime = lastCheck.ResponseTime

			if lastCheck.SSLExpiry != nil {
				sslInfo = map[string]interface{}{
					"expiry":    lastCheck.SSLExpiry,
					"issuer":    lastCheck.SSLIssuer,
					"days_left": lastCheck.SSLDaysLeft,
				}
			}
		}

		serviceData := map[string]interface{}{
			"service":            service,
			"current_status":     currentStatus,
			"last_response_time": lastResponseTime,
			"stats_24h":          stats24h,
			"stats_30d":          stats30d,
			"ssl_info":           sslInfo,
			"monitoring_enabled": service.IsEnabled,
		}

		dashboardData = append(dashboardData, serviceData)
	}

	c.JSON(http.StatusOK, gin.H{
		"services": dashboardData,
		"summary": map[string]interface{}{
			"total_services":  len(services),
			"active_services": len(dashboardData),
		},
	})
}
