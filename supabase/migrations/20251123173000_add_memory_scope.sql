-- Add scope column to claude_memory table to support local vs user memory
-- Local memory: project-specific (./.claude/CLAUDE.md)
-- User memory: global across projects (~/.claude/CLAUDE.md)

-- Add scope column with default 'local' for backward compatibility
ALTER TABLE public.claude_memory 
ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'local';

-- Drop old unique constraint
ALTER TABLE public.claude_memory 
DROP CONSTRAINT claude_memory_user_id_key;

-- Add new unique constraint for (user_id, scope)
ALTER TABLE public.claude_memory 
ADD CONSTRAINT claude_memory_user_id_scope_key UNIQUE (user_id, scope);

-- Add check constraint to ensure scope is either 'local' or 'user'
ALTER TABLE public.claude_memory 
ADD CONSTRAINT claude_memory_scope_check CHECK (scope IN ('local', 'user'));

-- Create index for faster lookups by scope
CREATE INDEX idx_claude_memory_user_scope ON public.claude_memory(user_id, scope);

-- Update comment
COMMENT ON COLUMN public.claude_memory.scope IS 'Memory scope: local (project-specific) or user (global)';
