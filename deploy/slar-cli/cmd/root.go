package cmd

import (
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "slar-cli",
	Short: "SLAR Deployment CLI",
	Long:  `A CLI tool for building and deploying SLAR services.`,
}

func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}

func init() {
	// Global flags can be defined here
}
