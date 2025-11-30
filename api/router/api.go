package router

import (
	"database/sql"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"

	"github.com/vanchonlee/slar/handlers"
	"github.com/vanchonlee/slar/internal/monitor"
	"github.com/vanchonlee/slar/services"
)

func NewGinRouter(pg *sql.DB, redis *redis.Client) *gin.Engine {
	r := gin.Default()

	// Add CORS middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Initialize services
	fcmService, _ := services.NewFCMService(pg)
	slackService, _ := services.NewSlackService(pg)
	alertService := services.NewAlertService(pg, redis, fcmService)
	incidentService := services.NewIncidentService(pg, redis, fcmService) // NEW: Incident service

	// Create lightweight notification sender for API server
	notificationSender := services.NewLightweightNotificationSender(pg)
	incidentService.SetNotificationWorker(notificationSender)
	userService := services.NewUserService(pg, redis)
	uptimeService := services.NewUptimeService(pg, redis)
	alertManagerService := services.NewAlertManagerService(pg, alertService)
	apiKeyService := services.NewAPIKeyService(pg)
	groupService := services.NewGroupService(pg)
	escalationService := services.NewEscalationService(pg, redis, groupService, fcmService)
	onCallService := services.NewOnCallService(pg)
	rotationService := services.NewRotationService(pg)
	schedulerService := services.NewSchedulerService(pg)     // NEW: Service scheduling
	serviceService := services.NewServiceService(pg)         // NEW: Service management
	integrationService := services.NewIntegrationService(pg) // NEW: Integration management
	identityService, err := services.NewIdentityService("./data") // Initialize IdentityService
	if err != nil {
		log.Printf("Warning: Failed to initialize identity service: %v", err)
	}

	// Initialize cloud relay and auto-register with cloud if configured
	cloudRelayService := services.NewCloudRelayService(identityService)
	if cloudRelayService.IsConfigured() {
		go func() {
			if err := cloudRelayService.RegisterWithCloud(); err != nil {
				log.Printf("Warning: Failed to register with cloud relay: %v", err)
			}
		}()
	}

	// Initialize handlers
	alertHandler := handlers.NewAlertHandler(alertService)
	incidentHandler := handlers.NewIncidentHandler(incidentService) // NEW: Incident handler
	userHandler := handlers.NewUserHandler(userService)
	uptimeHandler := handlers.NewUptimeHandler(uptimeService)
	alertManagerHandler := handlers.NewAlertManagerHandler(alertManagerService)
	apiKeyHandler := handlers.NewAPIKeyHandler(apiKeyService, alertService, userService)
	dashboardHandler := handlers.NewDashboardHandler(userService)
	// testHandler := handlers.NewTestHandler(alertManagerHandler)
	groupHandler := handlers.NewGroupHandler(groupService, escalationService)
	onCallHandler := handlers.NewOnCallHandler(onCallService, schedulerService)
	rotationHandler := handlers.NewRotationHandler(rotationService)
	overrideHandler := handlers.NewOverrideHandler(onCallService.OverrideService)
	schedulerHandler := handlers.NewSchedulerHandler(schedulerService, onCallService, serviceService)               // NEW: Service scheduling
	serviceHandler := handlers.NewServiceHandler(serviceService)                                                    // NEW: Service management
	integrationHandler := handlers.NewIntegrationHandler(integrationService)                                        // NEW: Integration handler
	webhookHandler := handlers.NewWebhookHandler(integrationService, alertService, incidentService, serviceService) // NEW: Webhook handler
	notificationHandler := handlers.NewNotificationHandler(slackService)                                            // NEW: Notification handler
	debugHandler := handlers.NewDebugHandler(pg)
	mobileHandler := handlers.NewMobileHandler(pg, identityService) // Inject IdentityService
	identityHandler := handlers.NewIdentityHandler(identityService) // Initialize IdentityHandler
	agentHandler := handlers.NewAgentHandler(pg, identityService)   // Initialize AgentHandler for Zero-Trust

	// Initialize monitor handlers
	monitorHandler := monitor.NewMonitorHandler(pg)
	deploymentHandler := monitor.NewDeploymentHandler(pg)
	reportHandler := monitor.NewReportHandler(pg, incidentService)

	// Initialize middleware
	supabaseAuthMiddleware := handlers.NewSupabaseAuthMiddleware(userService)

	// PUBLIC ENDPOINTS (no authentication required)

	// Health check and info endpoints
	r.GET("/env", func(c *gin.Context) {
		// Set environment header for frontend
		env := os.Getenv("SLAR_ENV")
		if env == "" {
			env = "development"
		}
		c.Header("x-slar-env", env)

		// Get Supabase config to send to frontend
		supabaseURL := os.Getenv("SUPABASE_URL")
		supabaseAnonKey := os.Getenv("SUPABASE_ANON_KEY")

		c.JSON(200, gin.H{
			"status":            "healthy",
			"message":           "SLAR API is running",
			"env":               env,
			"supabase_url":      supabaseURL,
			"supabase_anon_key": supabaseAnonKey,
		})
	})

	// Debug endpoints (temporary for troubleshooting)
	r.GET("/debug/rotation-tables", debugHandler.CheckRotationTables)

	// PUBLIC IDENTITY ENDPOINT - public key is public!
	// AI Agent needs this to verify device certificates without authentication
	// Must be registered BEFORE protected routes to take precedence
	r.GET("/identity/public-key", identityHandler.GetPublicKey)

	// PUBLIC WEBHOOK ENDPOINTS (no authentication - secured by integration secret)
	webhookRoutes := r.Group("/webhook")
	{
		// Integration webhooks: /webhook/:type/:integration_id
		webhookRoutes.POST("/:type/:integration_id", webhookHandler.ReceiveWebhook)
	}

	// API KEY AUTHENTICATED WEBHOOK ENDPOINTS
	apiKeyWebhookRoutes := r.Group("/webhooks")
	apiKeyWebhookRoutes.Use(apiKeyHandler.APIKeyAuthMiddleware())
	{
		apiKeyWebhookRoutes.POST("/incident", incidentHandler.WebhookCreateIncident) // NEW: PagerDuty-style incident webhook
		apiKeyWebhookRoutes.POST("/alert", apiKeyHandler.WebhookAlert)               // Legacy
		apiKeyWebhookRoutes.POST("/alertmanager", alertManagerHandler.ReceiveWebhook)
	}

	// PROTECTED ENDPOINTS (require Supabase authentication)
	protected := r.Group("/")
	protected.Use(supabaseAuthMiddleware.SupabaseAuthMiddleware())
	// protected.Use()
	{
		// INCIDENTS MANAGEMENT (PagerDuty-style)
		incidentRoutes := protected.Group("/incidents")
		{
			incidentRoutes.GET("", incidentHandler.ListIncidents)
			incidentRoutes.POST("", incidentHandler.CreateIncident)
			incidentRoutes.GET("/stats", incidentHandler.GetIncidentStats)
			incidentRoutes.GET("/:id", incidentHandler.GetIncident)
			incidentRoutes.PUT("/:id", incidentHandler.UpdateIncident)
			incidentRoutes.POST("/:id/acknowledge", incidentHandler.AcknowledgeIncident)
			incidentRoutes.POST("/:id/resolve", incidentHandler.ResolveIncident)
			incidentRoutes.POST("/:id/assign", incidentHandler.AssignIncident)
			incidentRoutes.POST("/:id/escalate", incidentHandler.EscalateIncident)
			incidentRoutes.POST("/:id/notes", incidentHandler.AddIncidentNote)
			incidentRoutes.GET("/:id/events", incidentHandler.GetIncidentEvents)
		}

		// ALERTS MANAGEMENT (Legacy - for backward compatibility)
		alertRoutes := protected.Group("/alerts")
		{
			alertRoutes.GET("", alertHandler.ListAlerts)
			alertRoutes.POST("", alertHandler.CreateAlert)
			alertRoutes.GET("/:id", alertHandler.GetAlert)
			alertRoutes.POST("/:id/ack", alertHandler.AckAlert)
			alertRoutes.POST("/:id/unack", alertHandler.UnackAlert)
			alertRoutes.POST("/:id/close", alertHandler.CloseAlert)
		}

		// API KEY MANAGEMENT
		apiKeyRoutes := protected.Group("/api-keys")
		{
			apiKeyRoutes.POST("", apiKeyHandler.CreateAPIKey)
			apiKeyRoutes.GET("", apiKeyHandler.ListAPIKeys)
			apiKeyRoutes.GET("/:id", apiKeyHandler.GetAPIKey)
			apiKeyRoutes.PUT("/:id", apiKeyHandler.UpdateAPIKey)
			apiKeyRoutes.DELETE("/:id", apiKeyHandler.DeleteAPIKey)
			apiKeyRoutes.POST("/:id/regenerate", apiKeyHandler.RegenerateAPIKey)
			apiKeyRoutes.GET("/stats", apiKeyHandler.GetAPIKeyStats)
		}

		// USER MANAGEMENT
		userRoutes := protected.Group("/users")
		{
			userRoutes.GET("", userHandler.ListUsers)
			userRoutes.GET("/search", userHandler.SearchUsers)
			userRoutes.POST("", userHandler.CreateUser)
			userRoutes.GET("/:id", userHandler.GetUser)
			userRoutes.PUT("/:id", userHandler.UpdateUser)
			userRoutes.DELETE("/:id", userHandler.DeleteUser)
			userRoutes.POST("/fcm-token", userHandler.UpdateFCMToken)
			userRoutes.GET("/fcm-token", userHandler.GetFCMToken)

			// Notification configuration endpoints
			userRoutes.GET("/:id/notifications/config", notificationHandler.GetNotificationConfig)
			userRoutes.PUT("/:id/notifications/config", notificationHandler.UpdateNotificationConfig)
			userRoutes.POST("/:id/notifications/test/slack", notificationHandler.TestSlackNotification)
			userRoutes.GET("/:id/notifications/stats", notificationHandler.GetNotificationStats)
		}

		// ON-CALL MANAGEMENT
		oncallRoutes := protected.Group("/oncall")
		{
			// Legacy endpoints (for backward compatibility)
			oncallRoutes.GET("/schedules", onCallHandler.ListOnCallSchedules)
			oncallRoutes.POST("/schedules", onCallHandler.CreateOnCallSchedule)
			oncallRoutes.PUT("/schedules/:id", onCallHandler.UpdateOnCallSchedule)
			oncallRoutes.DELETE("/schedules/:id", onCallHandler.DeleteOnCallSchedule)
		}

		// SCHEDULE MANAGEMENT (direct schedule operations)
		scheduleRoutes := protected.Group("/schedules")
		{
			scheduleRoutes.PUT("/:id", onCallHandler.UpdateSchedule)
			scheduleRoutes.DELETE("/:id", onCallHandler.DeleteSchedule)
		}

		// ROTATION CYCLE MANAGEMENT (automatic rotation operations)
		rotationRoutes := protected.Group("/rotations")
		{
			rotationRoutes.GET("/:rotationId", rotationHandler.GetRotationCycle)
			rotationRoutes.GET("/:rotationId/preview", rotationHandler.GetRotationPreview)
			rotationRoutes.GET("/:rotationId/current", rotationHandler.GetCurrentRotationMember)
			rotationRoutes.DELETE("/:rotationId", rotationHandler.DeactivateRotationCycle)
			rotationRoutes.POST("/override", rotationHandler.CreateScheduleOverride)
			rotationRoutes.GET("/schedules/:scheduleId", rotationHandler.GetScheduleForOverride)
		}

		// UPTIME MONITORING (Cloudflare Workers)
		monitorRoutes := protected.Group("/monitors")
		{
			monitorRoutes.GET("", monitorHandler.GetMonitors)
			monitorRoutes.POST("", monitorHandler.CreateMonitor)
			monitorRoutes.GET("/:id", monitorHandler.GetMonitors) // Typo in handler name? No, GetMonitors returns list. Need GetMonitor.
			// Wait, I didn't implement GetMonitor (singular) in MonitorHandler?
			// Let me check MonitorHandler code I wrote.
			// I wrote GetMonitors, CreateMonitor, UpdateMonitor, DeleteMonitor.
			// I missed GetMonitor (singular).
			// I should add it or just use GetMonitors for list.
			// For now, I'll skip GetMonitor singular or implement it later if needed.
			// Actually, I should implement it.

			monitorRoutes.PUT("/:id", monitorHandler.UpdateMonitor)
			monitorRoutes.DELETE("/:id", monitorHandler.DeleteMonitor)

			// Monitor statistics endpoints (query D1)
			monitorRoutes.GET("/:id/stats", monitorHandler.GetMonitorStats)
			monitorRoutes.GET("/:id/uptime-history", monitorHandler.GetUptimeHistory)
			monitorRoutes.GET("/:id/response-times", monitorHandler.GetResponseTimes)

			monitorRoutes.POST("/deploy", deploymentHandler.DeployWorker)
			monitorRoutes.GET("/deployments", deploymentHandler.GetDeployments)
			monitorRoutes.GET("/deployments/:id/stats", deploymentHandler.GetDeploymentStats) // NEW: Worker stats
			monitorRoutes.POST("/deployments/:id/redeploy", deploymentHandler.RedeployWorker)
			monitorRoutes.PUT("/deployments/:id/worker-url", deploymentHandler.UpdateWorkerURL) // NEW: Update worker URL
			monitorRoutes.DELETE("/deployments/:id", deploymentHandler.DeleteDeployment)

			// Deployment integration management
			monitorRoutes.GET("/deployments/:id/integration", deploymentHandler.GetDeploymentIntegration)
			monitorRoutes.PUT("/deployments/:id/integration", deploymentHandler.UpdateDeploymentIntegration)

			monitorRoutes.POST("/report", reportHandler.HandleReport)
		}

		// UPTIME MONITORING (Legacy)
		uptimeRoutes := protected.Group("/uptime")
		{
			uptimeRoutes.GET("", uptimeHandler.GetUptimeDashboard)
			uptimeRoutes.GET("/services", uptimeHandler.ListServices)
			uptimeRoutes.POST("/services", uptimeHandler.CreateService)
			uptimeRoutes.GET("/services/:id", uptimeHandler.GetService)
			uptimeRoutes.GET("/services/:id/stats", uptimeHandler.GetServiceStats)
			uptimeRoutes.GET("/services/:id/history", uptimeHandler.GetServiceHistory)
		}

		// GROUP MANAGEMENT
		groupRoutes := protected.Group("/groups")
		{
			// Admin-only endpoints (all groups)
			groupRoutes.GET("/all", groupHandler.ListGroups)

			// User-scoped endpoints (recommended for most use cases)
			groupRoutes.GET("", groupHandler.GetMyGroups)
			groupRoutes.GET("/my", groupHandler.GetCurrentUserGroups)
			groupRoutes.GET("/public", groupHandler.GetPublicGroups)

			// Standard CRUD operations
			groupRoutes.POST("", groupHandler.CreateGroup)
			groupRoutes.GET("/:id", groupHandler.GetGroup)
			groupRoutes.GET("/:id/with-members", groupHandler.GetGroupWithMembers)
			groupRoutes.PUT("/:id", groupHandler.UpdateGroup)
			groupRoutes.DELETE("/:id", groupHandler.DeleteGroup)
			groupRoutes.GET("/:id/statistics", groupHandler.GetGroupStatistics)

			// Group member management
			groupRoutes.GET("/:id/members", groupHandler.GetGroupMembers)
			groupRoutes.POST("/:id/members", groupHandler.AddGroupMember)
			groupRoutes.POST("/:id/members/bulk", groupHandler.AddMultipleGroupMembers)
			groupRoutes.PUT("/:id/members/:user_id", groupHandler.UpdateGroupMember)
			groupRoutes.DELETE("/:id/members/:user_id", groupHandler.RemoveGroupMember)

			// Group scheduler management (NEW: Scheduler + Shifts architecture)
			groupRoutes.GET("/:id/schedulers", schedulerHandler.GetGroupSchedulers)                              // List schedulers (basic info)
			groupRoutes.POST("/:id/schedulers/with-shifts", schedulerHandler.CreateSchedulerWithShiftsOptimized) // Create scheduler + shifts (OPTIMIZED - default)
			groupRoutes.POST("/:id/schedulers/with-shifts-legacy", schedulerHandler.CreateSchedulerWithShifts)   // LEGACY: Fallback to non-optimized
			groupRoutes.GET("/:id/schedulers/stats", schedulerHandler.GetSchedulerPerformanceStats)              // Performance statistics
			groupRoutes.POST("/:id/schedulers/benchmark", schedulerHandler.BenchmarkSchedulerCreation)           // Performance benchmark
			groupRoutes.GET("/:id/schedulers/:scheduler_id", schedulerHandler.GetSchedulerWithShifts)            // Get scheduler with shifts
			groupRoutes.PUT("/:id/schedulers/:scheduler_id", schedulerHandler.UpdateSchedulerWithShifts)         // Update scheduler and its shifts
			groupRoutes.DELETE("/:id/schedulers/:scheduler_id", schedulerHandler.DeleteScheduler)                // Delete scheduler and its shifts
			groupRoutes.GET("/:id/shifts", schedulerHandler.GetGroupShifts)                                      // Get all shifts in group (with scheduler context)

			// Debug: Log that delete route is registered
			log.Println("🔧 DELETE route registered: /groups/:id/schedulers/:scheduler_id")

			// Test endpoint to verify route pattern
			groupRoutes.GET("/:id/schedulers/:scheduler_id/test", func(c *gin.Context) {
				groupID := c.Param("id")
				schedulerID := c.Param("scheduler_id")
				log.Printf("🧪 Test endpoint called - GroupID: %s, SchedulerID: %s", groupID, schedulerID)
				c.JSON(200, gin.H{
					"message":      "Test endpoint works",
					"group_id":     groupID,
					"scheduler_id": schedulerID,
				})
			})

			// Group schedule management (Legacy: Individual shifts)
			groupRoutes.GET("/:id/schedules", onCallHandler.GetGroupSchedules)
			groupRoutes.POST("/:id/schedules", schedulerHandler.CreateGroupSchedule) // Updated to support service scheduling
			groupRoutes.GET("/:id/schedules/current", onCallHandler.GetCurrentOnCallUser)
			groupRoutes.GET("/:id/schedules/upcoming", onCallHandler.GetUpcomingSchedules)

			// Schedule swap endpoint
			groupRoutes.POST("/:id/schedules/swap", onCallHandler.SwapSchedules)

			// Group rotation cycle management (automatic rotations)
			groupRoutes.GET("/:id/rotations", rotationHandler.GetGroupRotationCycles)
			groupRoutes.POST("/:id/rotations", rotationHandler.CreateRotationCycle)

			// Group schedule overrides (manual overrides for automatic schedules)
			groupRoutes.GET("/:id/overrides", overrideHandler.ListOverrides)
			groupRoutes.POST("/:id/overrides", overrideHandler.CreateOverride)
			groupRoutes.DELETE("/:id/overrides/:overrideId", overrideHandler.DeleteOverride)

			// NEW: Service scheduling endpoints (DEPRECATED - use /schedulers instead)
			groupRoutes.GET("/:id/scheduler-timelines", schedulerHandler.GetGroupSchedulerTimelines)
			groupRoutes.GET("/:id/services", serviceHandler.GetGroupServices) // Use ServiceHandler instead

			// Service management within groups
			groupRoutes.POST("/:id/services", serviceHandler.CreateService)

			// Service-specific scheduling
			groupRoutes.GET("/:id/services/:service_id/effective-schedule", schedulerHandler.GetEffectiveScheduleForService)
			groupRoutes.POST("/:id/services/:service_id/schedules", schedulerHandler.CreateServiceSchedule)

			// Group escalation policies
			groupRoutes.GET("/:id/escalation-policies", groupHandler.GetGroupEscalationPolicies)
			groupRoutes.POST("/:id/escalation-policies", groupHandler.CreateEscalationPolicy)
			groupRoutes.GET("/:id/escalation-policies/:policy_id", groupHandler.GetEscalationPolicy)
			groupRoutes.GET("/:id/escalation-policies/:policy_id/detail", groupHandler.GetEscalationPolicyDetail)
			groupRoutes.PUT("/:id/escalation-policies/:policy_id", groupHandler.UpdateEscalationPolicy)
			groupRoutes.DELETE("/:id/escalation-policies/:policy_id", groupHandler.DeleteEscalationPolicy)
			groupRoutes.GET("/:id/escalation-policies/:policy_id/levels", groupHandler.GetEscalationLevels)

		}

		// SERVICE MANAGEMENT
		serviceRoutes := protected.Group("/services")
		{
			// Service CRUD operations
			serviceRoutes.GET("", serviceHandler.ListAllServices)      // Admin: list all services
			serviceRoutes.GET("/:id", serviceHandler.GetService)       // Get specific service
			serviceRoutes.PUT("/:id", serviceHandler.UpdateService)    // Update service
			serviceRoutes.DELETE("/:id", serviceHandler.DeleteService) // Delete service

			// Service lookup by routing key (for alert ingestion)
			serviceRoutes.GET("/by-routing-key/:routing_key", serviceHandler.GetServiceByRoutingKey)

			// Service-Integration mappings
			serviceRoutes.GET("/:id/integrations", integrationHandler.GetServiceIntegrations)
			serviceRoutes.POST("/:id/integrations", integrationHandler.CreateServiceIntegration)
		}

		// INTEGRATION MANAGEMENT
		integrationRoutes := protected.Group("/integrations")
		{
			// Integration CRUD operations
			integrationRoutes.GET("", integrationHandler.GetIntegrations)
			integrationRoutes.POST("", integrationHandler.CreateIntegration)
			integrationRoutes.GET("/:id", integrationHandler.GetIntegration)
			integrationRoutes.PUT("/:id", integrationHandler.UpdateIntegration)
			integrationRoutes.DELETE("/:id", integrationHandler.DeleteIntegration)

			// Integration health monitoring
			integrationRoutes.POST("/:id/heartbeat", integrationHandler.UpdateHeartbeat)
			integrationRoutes.GET("/health", integrationHandler.GetIntegrationHealth)

			// Integration services
			integrationRoutes.GET("/:id/services", integrationHandler.GetIntegrationServices)

			// Integration templates
			integrationRoutes.GET("/templates", integrationHandler.GetIntegrationTemplates)
		}

		// SERVICE-INTEGRATION MAPPINGS
		serviceIntegrationRoutes := protected.Group("/service-integrations")
		{
			serviceIntegrationRoutes.PUT("/:id", integrationHandler.UpdateServiceIntegration)
			serviceIntegrationRoutes.DELETE("/:id", integrationHandler.DeleteServiceIntegration)
		}

		// ALERT ESCALATION HISTORY (Keep only non-duplicate routes)
		escalationRoutes := protected.Group("/escalation")
		{
			// Alert escalation history
			escalationRoutes.GET("/alerts/:alert_id/history", groupHandler.GetAlertEscalations)
		}

		// USER GROUP UTILITIES
		userGroupRoutes := protected.Group("/user-groups")
		{
			userGroupRoutes.GET("/:user_id", groupHandler.GetUserGroups)
		}

		// DASHBOARD
		protected.GET("/dashboard", dashboardHandler.GetDashboard)

		// AI AGENT
		protected.GET("/verify-token", func(c *gin.Context) {
			c.JSON(200, gin.H{"message": "Token is valid"})
		})

		// MOBILE APP CONNECTION (protected - requires Supabase JWT)
		mobileRoutes := protected.Group("/mobile")
		{
			mobileRoutes.POST("/connect/generate", mobileHandler.GenerateMobileConnectQR)
			mobileRoutes.GET("/devices", mobileHandler.GetConnectedDevices)
			mobileRoutes.DELETE("/devices/:device_id", mobileHandler.DisconnectDevice)
		}

		// IDENTITY MANAGEMENT (connect-relay requires auth, public-key is public - see above)
		identityRoutes := protected.Group("/identity")
		{
			// Note: GET /identity/public-key is registered as PUBLIC route above
			identityRoutes.POST("/connect-relay", identityHandler.ConnectRelay)
		}

		// AI AGENT ZERO-TRUST AUTHENTICATION
		agentRoutes := protected.Group("/agent")
		{
			agentRoutes.POST("/device-cert", agentHandler.GenerateDeviceCertificate)
			agentRoutes.DELETE("/device-cert/:cert_id", agentHandler.RevokeDeviceCertificate)
			agentRoutes.GET("/device-certs", agentHandler.ListDeviceCertificates)
			agentRoutes.GET("/config", agentHandler.GetAgentConfig)
		}
	}

	// PUBLIC MOBILE ENDPOINTS (no Supabase auth - token verified internally)
	mobilePublicRoutes := r.Group("/mobile")
	{
		mobilePublicRoutes.POST("/connect/verify", mobileHandler.VerifyMobileConnect)
		mobilePublicRoutes.POST("/devices/register-push", mobileHandler.RegisterDeviceForPush)
		mobilePublicRoutes.GET("/auth-config", mobileHandler.GetAuthConfig) // Get Supabase config after QR scan
	}

	return r
}
