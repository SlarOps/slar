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
)

var pushCmd = &cobra.Command{
	Use:   "push",
	Short: "Build and push Docker images",
	Long:  `Build Next.js app, build Docker images, and push to registry.`,
	Run: func(cmd *cobra.Command, args []string) {
		runPush()
	},
}

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build Docker images only",
	Long:  `Build Next.js app and Docker images without pushing.`,
	Run: func(cmd *cobra.Command, args []string) {
		runBuildOnly()
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

func runPush() {
	log("Starting push process...")
	checkEnv()
	fixLineEndings()
	buildNextJS()
	buildImages(registry, tag)
	tagImages(registry, tag)
	pushImages(registry, tag)
}

func runBuildOnly() {
	log("Starting build process...")
	checkEnv()
	fixLineEndings()
	buildNextJS()
	buildImages(registry, tag)
	tagImages(registry, tag)
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

func buildImages(reg, t string) {
	log("Building Docker images...")
	
	deployDir := "../docker" 
	composeFile := filepath.Join(deployDir, "docker-compose.yaml")
	tempComposeFile := filepath.Join(deployDir, "docker-compose.tmp.yaml")

	content, err := ioutil.ReadFile(composeFile)
	if err != nil {
		logError(fmt.Sprintf("Failed to read docker-compose.yaml: %v", err))
	}

	// Just copy the file since we are handling tagging manually now
	// (Replacing registry URL is not needed if compose doesn't use it, but harmless)
	ioutil.WriteFile(tempComposeFile, content, 0644)

	defer os.Remove(tempComposeFile)

	// Use -p slar to ensure deterministic image names (slar-api, slar-web etc)
	runCommand("docker", []string{"compose", "-p", "slar", "-f", "docker-compose.tmp.yaml", "build"}, deployDir)
	log("Images built")
}

func tagImages(reg, t string) {
	log("Tagging images...")
	
	// Map service name (as defined in docker-compose) to target image name suffix
	// With -p slar, the source images will be named "slar-<service>"
	services := map[string]string{
		"web":          "slar-web",
		"api":          "slar-api",
		"ai":           "slar-ai",
		"slack-worker": "slar-slack-worker",
	}

	for svc, targetName := range services {
		sourceImage := fmt.Sprintf("slar-%s", svc)
		targetImage := fmt.Sprintf("%s/%s:%s", reg, targetName, t)
		
		log(fmt.Sprintf("  %s -> %s", sourceImage, targetImage))
		runCommand("docker", []string{"tag", sourceImage, targetImage}, "")
	}
	log("Images tagged")
}

func pushImages(reg, t string) {
	log(fmt.Sprintf("Pushing images to %s...", reg))
	
	images := []string{
		fmt.Sprintf("%s/slar-web:%s", reg, t),
		fmt.Sprintf("%s/slar-api:%s", reg, t),
		fmt.Sprintf("%s/slar-ai:%s", reg, t),
		fmt.Sprintf("%s/slar-slack-worker:%s", reg, t),
	}

	for _, img := range images {
		log(fmt.Sprintf("Pushing %s...", img))
		runCommand("docker", []string{"push", img}, "")
	}
	log("Images pushed")
}
