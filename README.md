<p align="center">
<img src="./images/banner.png">
</p>

# SLAR - Smart Live Alert & Response

🚧 SLAR is currently in active development. An open-source on-call management platform with AI-powered incident response and intelligent alerting.

## Features

- **Schedule Management** - Flexible on-call rotations with automated handoffs
- **Smart Alerting** - AI-driven escalation and intelligent notification routing
- **Team Management** - Multi-team support with role-based access control
- **Timeline Visualization** - Interactive schedule views with real-time updates
- **Slack Integration** - Native notifications and incident management workflows
- **AI Runbook System** - Automated runbook retrieval and incident response guidance
- **Secure Authentication** - Comming soon


### Supabase Setup

1. **Create Project**: Visit [supabase.com](https://supabase.com), create new project
2. **Configure Auth**: Enable email authentication, set Site URL to `http://localhost:3000`
3. **Get Credentials**: Copy Project URL and API keys from Settings > API

### Migrate database

Install the [supabase CLI](https://supabase.com/docs/reference/cli/introduction)

```bash
supabase link
cd supabase && supabase db push
```

## Deployment

### Option A: Docker Compose (local)
- Create a .env file at the repo root with your credentials (or rely on defaults in the compose file):

```bash
move .env.example .env
```

- Build and start all services:
````bash
docker compose -f deploy/docker/docker-compose.yaml up -d
````

- Open the app: http://localhost:8000

### Option B: Kubernetes (Helm)
- Ensure container images exist and are accessible to your cluster. Defaults in the chart use ghcr.io/slarops images; change .Values.components.*.image.repository if pushing to your own registry.
- Create a minimal override file (values.slar.yaml) with your environment and optional ingress:

````yaml
kubectl create secret generic slar-secrets \
  --from-literal=openai-api-key=xxxx \
  --from-literal=database-url=xxxx \
  --from-literal=supabase-anon-key=xxxx \
  --from-literal=supabase-jwt-secret=xxxx \
  --from-literal=slack-bot-token=xxxx \
  --from-literal=slack-app-token=xxxx \
  --from-literal=supabase-url=xxxx
````

- Install/upgrade the chart:
````bash
cd deploy/helm/slar && helm install slar .
````

- Uninstall:
````bash
helm uninstall slar -n slar
````

## Contributing

1. Fork repository and create feature branch
2. Follow Go conventions (backend) and ESLint/Prettier (frontend)
3. Write tests for new features
4. Submit pull request with clear description

## License

Apache 2.0 License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/slarops/slar/issues)

---
