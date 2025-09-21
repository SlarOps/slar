# Contributing to SLAR

Thank you for your interest in contributing to SLAR! We welcome contributions from the community and are excited to see what you'll build.

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:
- **Go 1.24+**
- **Node.js 18+**
- **PostgreSQL 14+** with PGMQ extension
- **Redis 6+**
- **Git**

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/slar.git
   cd slar
   ```

3. **Set up the backend**:
   ```bash
   cd api
   cp supabase_config.example .env
   # Edit .env with your configuration
   go mod download
   go run cmd/server/main.go
   ```

4. **Set up the frontend**:
   ```bash
   cd web/slar
   cp .env.local.example .env.local
   # Edit .env.local with your configuration
   npm install
   npm run dev
   ```

## 📝 How to Contribute

### Reporting Issues

- **Search existing issues** before creating a new one
- **Use the issue templates** when available
- **Provide detailed information** including:
  - Steps to reproduce
  - Expected vs actual behavior
  - Environment details (OS, Go version, Node.js version)
  - Screenshots or logs if applicable

### Submitting Pull Requests

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our coding standards
3. **Write or update tests** for your changes
4. **Run the test suite** to ensure everything passes
5. **Commit your changes** with clear, descriptive messages
6. **Push to your fork** and create a pull request

### Pull Request Guidelines

- **Keep PRs focused** - one feature or fix per PR
- **Write clear descriptions** explaining what and why
- **Include tests** for new functionality
- **Update documentation** if needed
- **Follow the existing code style**
- **Ensure CI passes** before requesting review

## 🧪 Testing

### Backend Tests
```bash
cd api
go test ./...
```

### Frontend Tests
```bash
cd web/slar
npm test
```

### Integration Tests
```bash
# Run full test suite
make test
```

## 📋 Code Style

### Go Code Style
- Follow standard Go conventions
- Use `gofmt` for formatting
- Run `golint` and `go vet`
- Write meaningful variable and function names
- Add comments for exported functions

### JavaScript/React Code Style
- Use ESLint and Prettier configurations
- Follow React best practices
- Use meaningful component and variable names
- Write JSDoc comments for complex functions

### Commit Message Format
```
type(scope): brief description

Detailed explanation of the change (if needed)

Fixes #issue-number
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## 🏗️ Project Structure

```
├── api/                    # Go backend
│   ├── cmd/               # Main applications
│   ├── handlers/          # HTTP handlers
│   ├── services/          # Business logic
│   ├── models/            # Data models
│   └── workers/           # Background workers
├── web/slar/              # Next.js frontend
│   ├── src/components/    # React components
│   ├── src/services/      # API services
│   └── src/lib/           # Utilities
└── docs/                  # Documentation
```

## 🤝 Community Guidelines

- **Be respectful** and inclusive
- **Help others** learn and grow
- **Give constructive feedback**
- **Follow our Code of Conduct**

## 📚 Resources

- [Project Documentation](./README.md)
- [API Documentation](./docs/api.md)
- [Architecture Overview](./docs/architecture.md)
- [Deployment Guide](./docs/deployment.md)

## ❓ Questions?

- **GitHub Discussions** for general questions
- **GitHub Issues** for bugs and feature requests
- **Discord** (coming soon) for real-time chat

Thank you for contributing to SLAR! 🎉
