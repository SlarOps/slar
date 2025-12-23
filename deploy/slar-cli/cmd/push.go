package cmd

import (
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

var (
	registry string
	tag      string
	services []string
)

// All available services
var allServices = []string{"web", "api", "ai", "slack-worker"}

// Service to target image name mapping
var serviceImageMap = map[string]string{
	"web":          "slar-web",
	"api":          "slar-api",
	"ai":           "slar-ai",
	"slack-worker": "slar-slack-worker",
}

var pushCmd = &cobra.Command{
	Use:   "push [services...]",
	Short: "Build and push Docker images",
	Long: `Build Next.js app, build Docker images, and push to registry.

Examples:
  slar push                    # Build and push all services
  slar push ai                 # Build and push only AI service
  slar push api ai             # Build and push API and AI services
  slar push --registry=myregistry.io/myorg --tag=2.0.0 web api`,
	Run: func(cmd *cobra.Command, args []string) {
		targetServices := getTargetServices(args)
		runPush(targetServices)
	},
}

var buildCmd = &cobra.Command{
	Use:   "build [services...]",
	Short: "Build Docker images only",
	Long: `Build Next.js app and Docker images without pushing.

Examples:
  slar build                   # Build all services
  slar build ai                # Build only AI service
  slar build api ai            # Build API and AI services
  slar build --tag=2.0.0 web   # Build web service with custom tag`,
	Run: func(cmd *cobra.Command, args []string) {
		targetServices := getTargetServices(args)
		runBuildOnly(targetServices)
	},
}

func init() {
	rootCmd.AddCommand(pushCmd)
	rootCmd.AddCommand(buildCmd)

	// Add flags to both commands
	for _, c := range []*cobra.Command{pushCmd, buildCmd} {
		c.Flags().StringVar(&registry, "registry", "ghcr.io/slarops", "Docker registry")
		c.Flags().StringVar(&tag, "tag", "1.0.1", "Image tag")
	}
}

// getTargetServices returns the list of services to build/push
// If no args provided, returns all services
func getTargetServices(args []string) []string {
	if len(args) == 0 {
		return allServices
	}

	// Validate provided services
	var validServices []string
	for _, svc := range args {
		svc = strings.ToLower(strings.TrimSpace(svc))
		if _, ok := serviceImageMap[svc]; ok {
			validServices = append(validServices, svc)
		} else {
			fmt.Printf("Warning: Unknown service '%s', skipping. Available: %v\n", svc, allServices)
		}
	}

	if len(validServices) == 0 {
		logError(fmt.Sprintf("No valid services specified. Available services: %v", allServices))
	}

	return validServices
}

func runPush(targetServices []string) {
	log(fmt.Sprintf("Starting push process for services: %v", targetServices))
	checkEnv()
	fixLineEndings()

	// Only build Next.js if web is in target services
	if containsService(targetServices, "web") {
		buildNextJS()
	}

	buildImages(registry, tag, targetServices)
	tagImages(registry, tag, targetServices)
	pushImages(registry, tag, targetServices)
}

func runBuildOnly(targetServices []string) {
	log(fmt.Sprintf("Starting build process for services: %v", targetServices))
	checkEnv()
	fixLineEndings()

	// Only build Next.js if web is in target services
	if containsService(targetServices, "web") {
		buildNextJS()
	}

	buildImages(registry, tag, targetServices)
	tagImages(registry, tag, targetServices)
}

func containsService(services []string, target string) bool {
	for _, s := range services {
		if s == target {
			return true
		}
	}
	return false
}

// Helpers

func log(msg string) {
	fmt.Println(msg)
}

func logError(msg string) {
	fmt.Fprintf(os.Stderr, "ERROR: %s\n", msg)
	os.Exit(1)
}

func runCommand(name string, args []string, dir string) {
	cmd := exec.Command(name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		logError(fmt.Sprintf("Command failed: %s %v", name, args))
	}
}

func getProjectRoot() string {
	dir, _ := os.Getwd()
	return filepath.Join(dir, "../../..")
}

func checkEnv() {
	root := "../../" 
	if _, err := os.Stat(filepath.Join(root, ".env")); os.IsNotExist(err) {
		fmt.Println("Warning: .env file not found at repository root (checked ../../.env)")
	}
}

func fixLineEndings() {
	log("Fixing line endings...")
	scriptPath := "../../api/ai/docker-entrypoint.sh"
	content, err := ioutil.ReadFile(scriptPath)
	if err == nil {
		newContent := strings.ReplaceAll(string(content), "\r\n", "\n")
		ioutil.WriteFile(scriptPath, []byte(newContent), 0755)
	}
}

func buildNextJS() {
	log("Building Next.js...")
	webDir := "../../web/slar"

	if _, err := os.Stat(filepath.Join(webDir, "node_modules")); os.IsNotExist(err) {
		log("Installing dependencies...")
		runCommand("npm", []string{"ci"}, webDir)
	}

	runCommand("npm", []string{"run", "build"}, webDir)

	if _, err := os.Stat(filepath.Join(webDir, ".next/standalone")); os.IsNotExist(err) {
		logError("Next.js build failed: .next/standalone not found")
	}
	log("Next.js build completed")
}

func buildImages(reg, t string, targetServices []string) {
	log(fmt.Sprintf("Building Docker images for: %v", targetServices))

	deployDir := "../docker"
	composeFile := filepath.Join(deployDir, "docker-compose.yaml")
	tempComposeFile := filepath.Join(deployDir, "docker-compose.tmp.yaml")

	content, err := ioutil.ReadFile(composeFile)
	if err != nil {
		logError(fmt.Sprintf("Failed to read docker-compose.yaml: %v", err))
	}

	// Just copy the file since we are handling tagging manually now
	ioutil.WriteFile(tempComposeFile, content, 0644)

	defer os.Remove(tempComposeFile)

	// Build only specified services
	// Use -p slar to ensure deterministic image names (slar-api, slar-web etc)
	args := []string{"compose", "-p", "slar", "-f", "docker-compose.tmp.yaml", "build"}
	args = append(args, targetServices...)

	runCommand("docker", args, deployDir)
	log("Images built")
}

func tagImages(reg, t string, targetServices []string) {
	log("Tagging images...")

	for _, svc := range targetServices {
		targetName := serviceImageMap[svc]
		sourceImage := fmt.Sprintf("slar-%s", svc)
		targetImage := fmt.Sprintf("%s/%s:%s", reg, targetName, t)

		log(fmt.Sprintf("  %s -> %s", sourceImage, targetImage))
		runCommand("docker", []string{"tag", sourceImage, targetImage}, "")
	}
	log("Images tagged")
}

func pushImages(reg, t string, targetServices []string) {
	log(fmt.Sprintf("Pushing images to %s...", reg))

	for _, svc := range targetServices {
		targetName := serviceImageMap[svc]
		img := fmt.Sprintf("%s/%s:%s", reg, targetName, t)
		log(fmt.Sprintf("Pushing %s...", img))
		runCommand("docker", []string{"push", img}, "")
	}
	log("Images pushed")
}
