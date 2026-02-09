package logger

import (
	"log"
	"os"
	"strings"
	"sync"
)

// Level represents the logging level
type Level int

const (
	// DebugLevel logs everything
	DebugLevel Level = iota
	// InfoLevel logs info, warnings, and errors
	InfoLevel
	// WarnLevel logs warnings and errors
	WarnLevel
	// ErrorLevel logs only errors
	ErrorLevel
)

var (
	currentLevel Level = InfoLevel // Default to INFO
	mu           sync.RWMutex

	debugLogger *log.Logger
	infoLogger  *log.Logger
	warnLogger  *log.Logger
	errorLogger *log.Logger
)

func init() {
	debugLogger = log.New(os.Stdout, "DEBUG: ", log.LstdFlags)
	infoLogger = log.New(os.Stdout, "INFO: ", log.LstdFlags)
	warnLogger = log.New(os.Stdout, "WARN: ", log.LstdFlags)
	errorLogger = log.New(os.Stderr, "ERROR: ", log.LstdFlags)
}

// ParseLevel parses a string log level to Level type
func ParseLevel(level string) Level {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "DEBUG":
		return DebugLevel
	case "INFO":
		return InfoLevel
	case "WARN", "WARNING":
		return WarnLevel
	case "ERROR":
		return ErrorLevel
	default:
		return InfoLevel
	}
}

// SetLevel sets the global log level
func SetLevel(level Level) {
	mu.Lock()
	defer mu.Unlock()
	currentLevel = level
}

// SetLevelString sets the global log level from a string
func SetLevelString(level string) {
	SetLevel(ParseLevel(level))
}

// GetLevel returns the current log level
func GetLevel() Level {
	mu.RLock()
	defer mu.RUnlock()
	return currentLevel
}

// GetLevelString returns the current log level as string
func GetLevelString() string {
	level := GetLevel()
	switch level {
	case DebugLevel:
		return "DEBUG"
	case InfoLevel:
		return "INFO"
	case WarnLevel:
		return "WARN"
	case ErrorLevel:
		return "ERROR"
	default:
		return "INFO"
	}
}

// Debug logs a debug message
func Debug(format string, v ...interface{}) {
	mu.RLock()
	lvl := currentLevel
	mu.RUnlock()

	if lvl <= DebugLevel {
		debugLogger.Printf(format, v...)
	}
}

// Info logs an info message
func Info(format string, v ...interface{}) {
	mu.RLock()
	lvl := currentLevel
	mu.RUnlock()

	if lvl <= InfoLevel {
		infoLogger.Printf(format, v...)
	}
}

// Warn logs a warning message
func Warn(format string, v ...interface{}) {
	mu.RLock()
	lvl := currentLevel
	mu.RUnlock()

	if lvl <= WarnLevel {
		warnLogger.Printf(format, v...)
	}
}

// Error logs an error message
func Error(format string, v ...interface{}) {
	mu.RLock()
	lvl := currentLevel
	mu.RUnlock()

	if lvl <= ErrorLevel {
		errorLogger.Printf(format, v...)
	}
}

// Println logs a message at Info level (compatibility with log.Println)
func Println(v ...interface{}) {
	mu.RLock()
	lvl := currentLevel
	mu.RUnlock()

	if lvl <= InfoLevel {
		infoLogger.Println(v...)
	}
}

// Printf logs a message at Info level (compatibility with log.Printf)
func Printf(format string, v ...interface{}) {
	mu.RLock()
	lvl := currentLevel
	mu.RUnlock()

	if lvl <= InfoLevel {
		infoLogger.Printf(format, v...)
	}
}
