# SLAR - Smart Live Alert & Response

A comprehensive on-call management system with intelligent alerting, schedule management, and incident response capabilities.

## 🚀 Features

- **📅 Schedule Management**: Create and manage on-call rotations with flexible shift patterns
- **🔔 Smart Alerting**: Intelligent incident escalation and notification system
- **👥 Team Management**: Organize teams and manage member availability
- **📊 Timeline Visualization**: Interactive schedule timeline with real-time updates
- **🔗 Slack Integration**: Native Slack notifications and incident management
- **🔐 Authentication**: Secure authentication via Supabase
- **📱 Responsive UI**: Modern web interface built with Next.js and Tailwind CSS

## 🏗️ Architecture

```
├── api/                    # Go backend API
│   ├── cmd/server/        # Main server application
│   ├── handlers/          # HTTP handlers
│   ├── services/          # Business logic
│   ├── workers/           # Background workers (Slack integration)
│   └── ai/                # AI agents for intelligent responses
├── web/slar/              # Next.js frontend
│   ├── src/components/    # React components
│   ├── src/services/      # API services
│   └── src/lib/           # Utilities and configurations
└── docs/                  # Documentation
```

## 🛠️ Tech Stack

### Backend
- **Go** - High-performance API server
- **Gin** - HTTP web framework
- **PostgreSQL** - Primary database with PGMQ for message queuing
- **Redis** - Caching and session management
- **Supabase** - Authentication and real-time features

### Frontend
- **Next.js 15** - React framework with SSR
- **React 19** - UI library
- **Tailwind CSS 4** - Utility-first CSS framework
- **Headless UI** - Accessible UI components
- **Vis.js Timeline** - Interactive schedule visualization

### Integrations
- **Slack SDK** - Native Slack integration
- **AutoGen** - AI-powered incident response
- **OpenAI GPT-4** - Intelligent alert processing

## 🚀 Quick Start

### Prerequisites

- **Go 1.24+**
- **Node.js 18+**
- **PostgreSQL 14+** with PGMQ extension
- **Redis 6+**
- **Supabase account**

### 1. Clone Repository

```bash
git clone https://github.com/vanchonlee/slar.git
cd slar
```

### 2. Backend Setup

```bash
cd api

# Install dependencies
go mod download

# Copy and configure environment
cp supabase_config.example .env
# Edit .env with your actual values

# Run database migrations (if applicable)
# go run cmd/migrate/main.go

# Start the API server
go run cmd/server/main.go
```

### 3. Frontend Setup

```bash
cd web/slar

# Install dependencies
npm install

# Copy and configure environment
cp supabase-config.example .env.local
# Edit .env.local with your actual values

# Start development server
npm run dev
```

### 4. Slack Worker Setup (Optional)

```bash
cd api/workers

# Install Python dependencies
pip install -r requirements.txt

# Copy and configure environment
cp config.example .env
# Edit .env with your Slack app credentials

# Start the worker
python slack_worker.py
```

## ⚙️ Configuration

### Supabase Setup

**Why Supabase for Authentication?**
- **Simple**: Quick setup with user-friendly UI, no complex configuration needed
- **Reliable**: Built on PostgreSQL with high uptime and robust security
- **Integrated**: Authentication, real-time, and database in one platform
- **Scalable**: Supports scaling from prototype to production seamlessly

#### 1. Create Supabase Project

1. Visit [supabase.com](https://supabase.com) and sign up/sign in
2. Click **"New Project"**
3. Select your Organization and enter project details:
   - **Name**: `slar-oss` (or your preferred name)
   - **Database Password**: Create a strong password and save it securely
   - **Region**: Choose the region closest to your users
4. Click **"Create new project"** and wait ~2 minutes for setup completion

#### 2. Configure Authentication

1. **Enable Email Authentication**:
   - Go to **Authentication > Settings**
   - Under **Auth Providers**, ensure **Email** is enabled
   - Configure **Site URL**: `http://localhost:3000` (development) or your production domain

2. **Configure Email Templates** (optional):
   - Go to **Authentication > Email Templates**
   - Customize confirmation emails and password reset templates

3. **Add Social Providers** (optional):
   ```bash
   # Example: Google OAuth
   # Go to Authentication > Settings > Auth Providers
   # Enable Google and enter Client ID, Client Secret
   ```

#### 3. Get API Keys and URLs

1. Go to **Settings > API**
2. Copy the following information:
   - **Project URL**: `https://your-project-ref.supabase.co`
   - **Project API Key (anon public)**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - **Project API Key (service_role)**: For backend use only, keep secret

#### 4. Update Environment Files

**Backend (.env)**:
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_JWT_SECRET=your-supabase-jwt-secret-here
```

**Frontend (.env.local)**:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

#### 5. Setup Database Schema

1. Go to **SQL Editor** in your Supabase Dashboard
2. Run the following script to create SLAR tables:

```sql
-- Enable Row Level Security
-- Note: RLS on auth.users is managed by Supabase; you generally should NOT alter it manually.
-- ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

-- Create profiles table to extend user information
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id)
);

-- Create RLS policies for profiles
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Trigger to automatically create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

#### 6. Test Authentication

1. Start the applications: `npm run dev` (frontend) and `go run cmd/server/main.go` (backend)
2. Navigate to `http://localhost:3000`
3. Try creating a new account
4. Check email for confirmation (if email confirmation is enabled)
5. Sign in and verify the session works

#### 7. Production Deployment

When deploying to production:

1. **Update Site URL**:
   - Go to **Authentication > Settings**
   - Change **Site URL** to your production domain: `https://yourdomain.com`

2. **Configure Custom SMTP** (recommended):
   - Go to **Settings > Auth**
   - Setup your own SMTP server instead of using Supabase SMTP

3. **Security Best Practices**:
   - Rotate API keys periodically
   - Monitor authentication logs in Dashboard
   - Setup rate limiting for auth endpoints
   - Use environment variables for all sensitive configuration

### Database Setup

```sql
-- Enable PGMQ extension for message queuing
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create required tables (schema will be provided)
-- Run migration scripts or create tables manually
```

### Slack Integration

1. Create a Slack app at [api.slack.com](https://api.slack.com/apps)
2. Enable Socket Mode and get App-Level Token
3. Add Bot Token Scopes: `chat:write`, `channels:read`, `users:read`
4. Install app to your workspace
5. Configure webhook URLs and event subscriptions

## 📖 Usage

### Creating On-Call Schedules

1. **Navigate to Schedules** - Access the schedule management interface
2. **Create Rotation** - Define shift patterns (daily, weekly, bi-weekly, monthly)
3. **Add Team Members** - Assign engineers to rotation
4. **Set Handoff Times** - Configure shift transition times
5. **Generate Timeline** - View interactive schedule visualization

### Managing Incidents

1. **Incident Creation** - Automatically created from monitoring alerts
2. **Smart Escalation** - AI-powered escalation based on severity
3. **Slack Notifications** - Real-time alerts to on-call engineers
4. **Response Tracking** - Monitor incident resolution progress

### Timeline Features

- **Multiple Views**: Day, Week, 2-Week, Month perspectives
- **Real-time Updates**: Current time indicator and active shifts
- **Interactive Navigation**: Zoom, pan, and time period selection
- **Responsive Design**: Works on desktop and mobile devices

## 🔧 Development

### API Development

```bash
# Install Air for hot reloading
go install github.com/cosmtrek/air@latest

# Start with hot reload
air
```

### Frontend Development

```bash
# Start with hot reload
npm run dev

# Build for production
npm run build
npm start
```

### Running Tests

```bash
# Backend tests
cd api
go test ./...

# Frontend tests (if configured)
cd web/slar
npm test
```

## 📚 API Documentation

The API provides RESTful endpoints for:

- **Authentication**: `/auth/*` - User authentication and session management
- **Schedules**: `/api/schedules/*` - Schedule CRUD operations
- **Incidents**: `/api/incidents/*` - Incident management
- **Teams**: `/api/teams/*` - Team and member management
- **Notifications**: `/api/notifications/*` - Alert configuration

Detailed API documentation available at `/docs` when running the server.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow Go conventions for backend code
- Use ESLint and Prettier for frontend code
- Write tests for new features
- Update documentation as needed

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Supabase](https://supabase.com) - Backend-as-a-Service platform
- [Vis.js](https://visjs.org) - Timeline visualization library
- [Headless UI](https://headlessui.com) - Accessible UI components
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS framework

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/vanchonlee/slar/issues)
- **Discussions**: [GitHub Discussions](https://github.com/vanchonlee/slar/discussions)
- **Documentation**: [Project Wiki](https://github.com/vanchonlee/slar/wiki)

---

**Built with ❤️ for reliable on-call management**