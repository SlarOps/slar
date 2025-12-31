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
	registry  string
	tag       string
	services  []string
	platforms string
	noCache   bool
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
		c.Flags().StringVar(&platforms, "platforms", "", "Target platforms (comma-separated, e.g., linux/amd64,linux/arm64)")
		c.Flags().BoolVar(&noCache, "no-cache", false, "Build without using cache")
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

	buildImages(registry, tag, platforms, targetServices)
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

	buildImages(registry, tag, platforms, targetServices)
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

// Service to Dockerfile and context mapping (relative to deploy/slar-cli)
// Note: Most Dockerfiles expect project root as context
var serviceDockerfiles = map[string]struct {
	context    string
	dockerfile string
}{
	"web": {
		context:    "../../web/slar",
		dockerfile: "../../web/slar/Dockerfile",
	},
	"api": {
		context:    "../..", // Project root (Dockerfile expects api/ and worker/ dirs)
		dockerfile: "../../api/Dockerfile",
	},
	"ai": {
		context:    "../../api/ai",
		dockerfile: "../../api/ai/Dockerfile",
	},
	"slack-worker": {
		context:    "../../api/workers",
		dockerfile: "../../api/workers/Dockerfile",
	},
}

func buildImages(reg, t, plat string, targetServices []string) {
	log(fmt.Sprintf("Building Docker images for: %v", targetServices))

	// Always use direct Dockerfile builds (docker-compose.yaml doesn't have build contexts)
	buildImagesDirectly(reg, t, plat, targetServices)
}

// buildImagesDirectly builds images using docker build command directly
func buildImagesDirectly(reg, t, plat string, targetServices []string) {
	for _, svc := range targetServices {
		dockerInfo, ok := serviceDockerfiles[svc]
		if !ok {
			logError(fmt.Sprintf("Unknown service: %s", svc))
		}

		// Image name matches service map (slar-web, slar-api, etc.)
		imageName := serviceImageMap[svc]
		localTag := fmt.Sprintf("%s:latest", imageName)

		log(fmt.Sprintf("Building %s...", svc))

		args := []string{"build", "-t", localTag}

		// Add --no-cache if specified
		if noCache {
			args = append(args, "--no-cache")
		}

		// Add platform if specified
		if plat != "" {
			args = append(args, "--platform", plat)
		}

		// Add dockerfile and context
		args = append(args, "-f", dockerInfo.dockerfile, dockerInfo.context)

		runCommand("docker", args, "")
	}

	log("Images built")
}

func buildImagesWithBuildx(reg, t, plat string, targetServices []string, deployDir string) {

	// Ensure buildx builder exists
	log("Checking buildx builder...")
	checkBuildxBuilder()

	for _, svc := range targetServices {
		dockerInfo, ok := serviceDockerfiles[svc]
		if !ok {
			logError(fmt.Sprintf("Unknown service: %s", svc))
		}

		targetName := serviceImageMap[svc]
		imageTag := fmt.Sprintf("%s/%s:%s", reg, targetName, t)

		log(fmt.Sprintf("Building %s for platforms: %s", svc, plat))

		// Build using buildx
		args := []string{
			"buildx", "build",
			"--platform", plat,
			"-t", imageTag,
			"-f", dockerInfo.dockerfile,
		}

		// Add --no-cache if specified
		if noCache {
			args = append(args, "--no-cache")
		}

		// Add context
		args = append(args, dockerInfo.context)

		// For multi-platform builds, we need to either push or use --load (but --load only works for single platform)
		platformCount := len(strings.Split(plat, ","))
		if platformCount > 1 {
			// Multi-platform: must push directly
			log("Multi-platform build detected, will push to registry")
			args = append(args, "--push")
		} else {
			// Single platform: load into local docker
			args = append(args, "--load")
		}

		runCommand("docker", args, "")
	}

	log("Multi-platform images built")
}

func checkBuildxBuilder() {
	// Check if default buildx builder supports multi-platform
	cmd := exec.Command("docker", "buildx", "inspect")
	err := cmd.Run()
	if err != nil {
		log("Creating buildx builder for multi-platform support...")
		runCommand("docker", []string{"buildx", "create", "--use", "--name", "slar-builder", "--driver", "docker-container"}, "")
	}
}

func tagImages(reg, t string, targetServices []string) {
	log("Tagging images...")

	for _, svc := range targetServices {
		imageName := serviceImageMap[svc]
		sourceImage := fmt.Sprintf("%s:latest", imageName)
		targetImage := fmt.Sprintf("%s/%s:%s", reg, imageName, t)

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
