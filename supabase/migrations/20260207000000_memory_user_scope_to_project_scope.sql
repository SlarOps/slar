-- Migration: Change claude_memory from user-scoped to project-scoped
-- 
-- Before: Memory per user (user_id, scope) — each user has their own CLAUDE.md
-- After:  Memory per project (project_id) — all users in a project share one CLAUDE.md
--
-- This matches Claude Code's "project" scope (.claude/CLAUDE.md):
-- One shared memory per project, visible to all project members.

-- Step 1: Add project_id column
ALTER TABLE public.claude_memory 
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- Step 2: Add last_updated_by to track who last edited
ALTER TABLE public.claude_memory 
ADD COLUMN IF NOT EXISTS last_updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Step 3: Drop old constraints
ALTER TABLE public.claude_memory 
DROP CONSTRAINT IF EXISTS claude_memory_scope_check;

ALTER TABLE public.claude_memory 
DROP CONSTRAINT IF EXISTS claude_memory_user_id_scope_key;

-- Step 4: Drop old indexes
DROP INDEX IF EXISTS idx_claude_memory_user_scope;

-- Step 5: Add unique constraint — one memory per project
ALTER TABLE public.claude_memory 
ADD CONSTRAINT claude_memory_project_id_key UNIQUE (project_id);

-- Step 6: Add index for project lookups
CREATE INDEX IF NOT EXISTS idx_claude_memory_project_id ON public.claude_memory(project_id);

-- Step 7: Make user_id nullable (memory belongs to project, not user)
ALTER TABLE public.claude_memory 
ALTER COLUMN user_id DROP NOT NULL;

-- Step 8: Fix user_id FK: CASCADE → SET NULL (memory belongs to project, not user)
-- Without this, deleting a user could cascade-delete shared project memory
ALTER TABLE public.claude_memory 
DROP CONSTRAINT IF EXISTS claude_memory_user_id_fkey;

ALTER TABLE public.claude_memory 
ADD CONSTRAINT claude_memory_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- Step 9: Drop old unused indexes
DROP INDEX IF EXISTS idx_claude_memory_user_id;

-- Step 10: Drop scope column (no longer needed — always project scope)
ALTER TABLE public.claude_memory 
DROP COLUMN IF EXISTS scope;

-- Step 11: Update comments
COMMENT ON TABLE public.claude_memory IS 'Stores CLAUDE.md content (memory/context) shared per project. All users in the same project see the same memory.';
COMMENT ON COLUMN public.claude_memory.project_id IS 'Project UUID — one CLAUDE.md per project';
COMMENT ON COLUMN public.claude_memory.user_id IS 'Deprecated — kept for backward compat. Use last_updated_by instead.';
COMMENT ON COLUMN public.claude_memory.last_updated_by IS 'User who last updated this memory';
