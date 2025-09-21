package services

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type UserService struct {
	PG    *sql.DB
	Redis *redis.Client
}

func NewUserService(pg *sql.DB, redis *redis.Client) *UserService {
	return &UserService{PG: pg, Redis: redis}
}

// User CRUD operations
func (s *UserService) ListUsers() ([]db.User, error) {
	rows, err := s.PG.Query(`SELECT id, name, email, COALESCE(phone, '') as phone, role, team, COALESCE(fcm_token, '') as fcm_token, is_active, created_at, updated_at FROM users WHERE is_active = true ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []db.User
	for rows.Next() {
		var u db.User
		err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Phone, &u.Role, &u.Team, &u.FCMToken, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
		if err != nil {
			continue
		}
		users = append(users, u)
	}
	return users, nil
}

func (s *UserService) GetUser(id string) (db.User, error) {
	var u db.User
	err := s.PG.QueryRow(`SELECT id, provider, provider_id, name, email, COALESCE(phone, '') as phone, role, team, COALESCE(fcm_token, '') as fcm_token, is_active, created_at, updated_at FROM users WHERE provider_id = $1`, id).
		Scan(&u.ID, &u.Provider, &u.ProviderID, &u.Name, &u.Email, &u.Phone, &u.Role, &u.Team, &u.FCMToken, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

func (s *UserService) CreateUser(c *gin.Context) (db.User, error) {
	var user db.User
	if err := c.ShouldBindJSON(&user); err != nil {
		return user, err
	}

	user.ID = uuid.New().String()
	user.IsActive = true
	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()

	// Ensure empty strings for optional fields to avoid NULL issues
	if user.Phone == "" {
		user.Phone = ""
	}
	if user.FCMToken == "" {
		user.FCMToken = ""
	}

	_, err := s.PG.Exec(`INSERT INTO users (id, name, email, phone, role, team, fcm_token, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		user.ID, user.Name, user.Email, user.Phone, user.Role, user.Team, user.FCMToken, user.IsActive, user.CreatedAt, user.UpdatedAt)

	return user, err
}

func (s *UserService) UpdateUser(id string, c *gin.Context) (db.User, error) {
	var user db.User
	if err := c.ShouldBindJSON(&user); err != nil {
		return user, err
	}

	user.ID = id
	user.UpdatedAt = time.Now()

	var err error

	_, err = s.PG.Exec(`UPDATE users SET name=$2, email=$3, phone=$4, role=$5, team=$6, fcm_token=$7, updated_at=$8 WHERE id=$1`,
		user.ID, user.Name, user.Email, user.Phone, user.Role, user.Team, user.FCMToken, user.UpdatedAt)

	return user, err
}

func (s *UserService) DeleteUser(id string) error {
	_, err := s.PG.Exec(`UPDATE users SET is_active = false, updated_at = $1 WHERE id = $2`, time.Now(), id)
	return err
}

// On-call schedule operations
func (s *UserService) GetCurrentOnCallUser() (db.User, error) {
	var u db.User
	now := time.Now()

	err := s.PG.QueryRow(`
		SELECT u.id, u.name, u.email, COALESCE(u.phone, '') as phone, u.role, u.team, COALESCE(u.fcm_token, '') as fcm_token, u.is_active, u.created_at, u.updated_at 
		FROM users u 
		JOIN on_call_schedules ocs ON u.id = ocs.user_id 
		WHERE ocs.start_time <= $1 AND ocs.end_time >= $1 AND ocs.is_active = true AND u.is_active = true
		ORDER BY ocs.start_time DESC 
		LIMIT 1`, now).
		Scan(&u.ID, &u.Name, &u.Email, &u.Phone, &u.Role, &u.Team, &u.FCMToken, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)

	return u, err
}

// Check if a specific user is currently on-call
func (s *UserService) IsUserOnCall(userID string) (bool, error) {
	now := time.Now()
	var count int

	err := s.PG.QueryRow(`
		SELECT COUNT(*) 
		FROM shifts ocs 
		WHERE ocs.user_id = $1 AND ocs.start_time <= $2 AND ocs.end_time >= $2 AND ocs.is_active = true`,
		userID, now).Scan(&count)

	if err != nil {
		return false, err
	}

	return count > 0, nil
}

func (s *UserService) CreateOnCallSchedule(c *gin.Context) (db.Shift, error) {
	var schedule db.Shift
	if err := c.ShouldBindJSON(&schedule); err != nil {
		return schedule, err
	}

	schedule.ID = uuid.New().String()
	schedule.IsActive = true
	schedule.CreatedAt = time.Now()

	_, err := s.PG.Exec(`INSERT INTO shifts (id, user_id, start_time, end_time, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		schedule.ID, schedule.UserID, schedule.StartTime, schedule.EndTime, schedule.IsActive, schedule.CreatedAt)

	return schedule, err
}

func (s *UserService) ListOnCallSchedules() ([]db.Shift, error) {
	rows, err := s.PG.Query(`
		SELECT 
			ocs.id, ocs.user_id, ocs.start_time, ocs.end_time, ocs.is_active, ocs.created_at,
			u.name, u.email, u.team
		FROM shifts ocs
		JOIN users u ON ocs.user_id = u.id
		WHERE ocs.is_active = true 
		ORDER BY ocs.start_time DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schedules []db.Shift
	for rows.Next() {
		var s db.Shift
		err := rows.Scan(&s.ID, &s.UserID, &s.StartTime, &s.EndTime, &s.IsActive, &s.CreatedAt,
			&s.UserName, &s.UserEmail, &s.UserTeam)
		if err != nil {
			continue
		}
		schedules = append(schedules, s)
	}
	return schedules, nil
}

func (s *UserService) UpdateOnCallSchedule(id string, c *gin.Context) (db.Shift, error) {
	var schedule db.Shift
	if err := c.ShouldBindJSON(&schedule); err != nil {
		return schedule, err
	}

	schedule.ID = id

	_, err := s.PG.Exec(`UPDATE shifts SET user_id = $2, start_time = $3, end_time = $4 WHERE id = $1 AND is_active = true`,
		id, schedule.UserID, schedule.StartTime, schedule.EndTime)

	if err != nil {
		return schedule, err
	}

	return s.GetOnCallSchedule(id)
}

func (s *UserService) DeleteOnCallSchedule(id string) error {
	_, err := s.PG.Exec(`UPDATE shifts SET is_active = false WHERE id = $1`, id)
	return err
}

func (s *UserService) GetOnCallSchedule(id string) (db.Shift, error) {
	var schedule db.Shift
	err := s.PG.QueryRow(`SELECT id, user_id, start_time, end_time, is_active, created_at FROM shifts WHERE id = $1 AND is_active = true`, id).
		Scan(&schedule.ID, &schedule.UserID, &schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.CreatedAt)
	return schedule, err
}

// UpdateFCMToken updates user's FCM token
func (s *UserService) UpdateFCMToken(userID, fcmToken string) error {
	_, err := s.PG.Exec(
		"UPDATE users SET fcm_token = $1, updated_at = NOW() WHERE id = $2",
		fcmToken, userID,
	)
	return err
}

// CreateUserRecord creates a user record directly (used for auto-sync from Supabase)
func (s *UserService) CreateUserRecord(user db.User) error {
	// Ensure empty strings for optional fields to avoid NULL issues
	if user.Phone == "" {
		user.Phone = ""
	}
	if user.FCMToken == "" {
		user.FCMToken = ""
	}

	_, err := s.PG.Exec(`
		INSERT INTO users (id, provider, provider_id, name, email, phone, role, team, fcm_token, is_active, created_at, updated_at) 
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (provider_id) DO UPDATE SET
			name = EXCLUDED.name,
			email = EXCLUDED.email,
			updated_at = EXCLUDED.updated_at`,
		user.ID, user.Provider, user.ProviderID, user.Name, user.Email, user.Phone, user.Role, user.Team,
		user.FCMToken, user.IsActive, user.CreatedAt, user.UpdatedAt)

	return err
}

// SearchUsers searches for users by name, email, or role (GitHub-style)
func (s *UserService) SearchUsers(query string, excludeIDs []string, limit int) ([]db.User, error) {
	var users []db.User

	// Build the query
	baseQuery := `
		SELECT id, name, email, phone, role, team, fcm_token, is_active, created_at, updated_at 
		FROM users 
		WHERE is_active = true`

	args := []interface{}{}
	argCount := 0

	// Add search filter if query provided
	if query != "" {
		argCount++
		baseQuery += fmt.Sprintf(` AND (
			name ILIKE $%d OR 
			email ILIKE $%d OR 
			role ILIKE $%d OR
			team ILIKE $%d
		)`, argCount, argCount, argCount, argCount)
		searchTerm := "%" + query + "%"
		args = append(args, searchTerm)
	}

	// Add exclude filter if IDs provided
	if len(excludeIDs) > 0 {
		placeholders := make([]string, len(excludeIDs))
		for i, id := range excludeIDs {
			argCount++
			placeholders[i] = fmt.Sprintf("$%d", argCount)
			args = append(args, id)
		}
		baseQuery += fmt.Sprintf(" AND id NOT IN (%s)", strings.Join(placeholders, ","))
	}

	// Add ordering and limit
	baseQuery += " ORDER BY name ASC"
	if limit > 0 {
		argCount++
		baseQuery += fmt.Sprintf(" LIMIT $%d", argCount)
		args = append(args, limit)
	}

	rows, err := s.PG.Query(baseQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var user db.User
		err := rows.Scan(
			&user.ID, &user.Name, &user.Email, &user.Phone,
			&user.Role, &user.Team, &user.FCMToken, &user.IsActive,
			&user.CreatedAt, &user.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}

	return users, nil
}
