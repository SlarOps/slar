package services

import (
	"database/sql"

	"github.com/vanchonlee/slar/db"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	PG         *sql.DB
	JWTService *JWTService
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	User    db.User `json:"user"`
	Token   string  `json:"token,omitempty"`
	Message string  `json:"message"`
}

func NewAuthService(pg *sql.DB) *AuthService {
	jwtService := NewJWTService("") // Use default secret for now
	return &AuthService{
		PG:         pg,
		JWTService: jwtService,
	}
}

// HashPassword creates a bcrypt hash of the password
func (s *AuthService) HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}
