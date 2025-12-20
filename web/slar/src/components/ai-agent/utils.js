// Utility functions for AI Agent components

/**
 * Format tool call in a simple, readable format like Claude Code
 * Examples:
 *   Bash(kubectl get pods -n slar)
 *   Read(/path/to/file)
 *   Grep(pattern, path:/src)
 *   Edit(/path/to/file)
 */
export const formatToolCall = (toolName, toolInput) => {
  if (!toolName) return 'Unknown Tool';

  const input = toolInput || {};

  // Tool-specific formatters
  switch (toolName) {
    case 'Bash': {
      const cmd = input.command || '';
      // Truncate very long commands
      const displayCmd = cmd.length > 80 ? cmd.substring(0, 77) + '...' : cmd;
      return `Bash(${displayCmd})`;
    }

    case 'Read': {
      const path = input.file_path || input.path || '';
      const shortPath = shortenPath(path);
      if (input.offset || input.limit) {
        return `Read(${shortPath}:${input.offset || 0}-${(input.offset || 0) + (input.limit || 0)})`;
      }
      return `Read(${shortPath})`;
    }

    case 'Write': {
      const path = input.file_path || input.path || '';
      return `Write(${shortenPath(path)})`;
    }

    case 'Edit': {
      const path = input.file_path || input.path || '';
      return `Edit(${shortenPath(path)})`;
    }

    case 'Glob': {
      const pattern = input.pattern || '*';
      const path = input.path ? `, path:${shortenPath(input.path)}` : '';
      return `Glob(${pattern}${path})`;
    }

    case 'Grep': {
      const pattern = input.pattern || '';
      const truncatedPattern = pattern.length > 30 ? pattern.substring(0, 27) + '...' : pattern;
      const path = input.path ? `:${shortenPath(input.path)}` : '';
      return `Grep(${truncatedPattern}${path})`;
    }

    case 'Task': {
      const desc = input.description || input.prompt?.substring(0, 30) || '';
      return `Task(${desc})`;
    }

    case 'WebFetch': {
      const url = input.url || '';
      // Extract domain from URL
      try {
        const domain = new URL(url).hostname;
        return `WebFetch(${domain})`;
      } catch {
        return `WebFetch(${url.substring(0, 40)})`;
      }
    }

    case 'TodoWrite': {
      const count = input.todos?.length || 0;
      return `TodoWrite(${count} items)`;
    }

    // MCP tools often have format like mcp__server__tool
    default: {
      // Handle MCP tool format: mcp__servername__toolname
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        const server = parts[1] || '';
        const tool = parts[2] || '';
        const displayName = `${server}:${tool}`;
        return formatMCPTool(displayName, input);
      }

      // Generic format: show first key-value pair if exists
      const keys = Object.keys(input);
      if (keys.length === 0) {
        return `${toolName}()`;
      }

      // Show primary argument
      const primaryKey = keys[0];
      const primaryValue = input[primaryKey];
      const displayValue = typeof primaryValue === 'string'
        ? (primaryValue.length > 50 ? primaryValue.substring(0, 47) + '...' : primaryValue)
        : JSON.stringify(primaryValue).substring(0, 50);

      return `${toolName}(${displayValue})`;
    }
  }
};

/**
 * Format MCP tool calls
 */
const formatMCPTool = (displayName, input) => {
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return `${displayName}()`;
  }

  // Show first meaningful argument
  const primaryValue = input[keys[0]];
  const displayValue = typeof primaryValue === 'string'
    ? (primaryValue.length > 40 ? primaryValue.substring(0, 37) + '...' : primaryValue)
    : JSON.stringify(primaryValue).substring(0, 40);

  return `${displayName}(${displayValue})`;
};

/**
 * Shorten file path for display
 * /very/long/path/to/some/file.js -> .../to/some/file.js
 */
const shortenPath = (path, maxLength = 50) => {
  if (!path || path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 3) return path;

  // Keep last 3 parts
  const shortened = '...' + '/' + parts.slice(-3).join('/');
  return shortened.length <= maxLength ? shortened : '...' + '/' + parts.slice(-2).join('/');
};

/**
 * Generate a permission pattern for "Always Allow"
 * Similar to Claude Code permission format with wildcards
 * Examples:
 *   Bash(kubectl get pods:*) - Allow kubectl get pods with any args
 *   Bash(kubectl:*) - Allow any kubectl commands
 *   Read(/path/to/project/*) - Allow reading any file in project
 */
export const generatePermissionPattern = (toolName, toolInput) => {
  if (!toolName) return 'Unknown Tool';

  const input = toolInput || {};

  switch (toolName) {
    case 'Bash': {
      const cmd = input.command || '';
      // Extract base command (first word or first two words for common patterns)
      const parts = cmd.trim().split(/\s+/);
      if (parts.length === 0) return 'Bash(*)';

      // Common multi-word commands
      const baseCmd = parts[0];

      // For kubectl, docker, git etc - use first two parts as pattern
      const commonPrefixes = ['kubectl', 'docker', 'git', 'npm', 'yarn', 'pnpm', 'go', 'cargo', 'pip', 'python', 'node'];
      if (commonPrefixes.includes(baseCmd) && parts.length >= 2) {
        return `Bash(${baseCmd} ${parts[1]}:*)`;
      }

      // For other commands, use just the base command
      return `Bash(${baseCmd}:*)`;
    }

    case 'Read': {
      const path = input.file_path || input.path || '';
      // Allow reading files in same directory
      const dir = path.substring(0, path.lastIndexOf('/'));
      return dir ? `Read(${dir}/*)` : `Read(${path})`;
    }

    case 'Write': {
      const path = input.file_path || input.path || '';
      const dir = path.substring(0, path.lastIndexOf('/'));
      return dir ? `Write(${dir}/*)` : `Write(${path})`;
    }

    case 'Edit': {
      const path = input.file_path || input.path || '';
      const dir = path.substring(0, path.lastIndexOf('/'));
      return dir ? `Edit(${dir}/*)` : `Edit(${path})`;
    }

    case 'Glob': {
      const pattern = input.pattern || '*';
      return `Glob(${pattern})`;
    }

    case 'Grep': {
      // Allow grep with any pattern in same path
      const path = input.path || '';
      return path ? `Grep(*:${shortenPath(path)})` : `Grep(*)`;
    }

    case 'WebFetch': {
      const url = input.url || '';
      try {
        const domain = new URL(url).hostname;
        return `WebFetch(${domain})`;
      } catch {
        return `WebFetch(*)`;
      }
    }

    // MCP tools
    default: {
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        const server = parts[1] || '';
        const tool = parts[2] || '';
        return `${server}:${tool}(*)`;
      }
      return `${toolName}(*)`;
    }
  }
};

export const statusColor = (status) => {
  switch ((status || "").toLowerCase()) {
    case "open":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "acknowledged":
    case "assigned":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "investigating":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "mitigated":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "resolved":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "closed":
      return "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
};

export const severityColor = (sev) => {
  switch ((sev || "").toLowerCase()) {
    case "critical":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    case "medium":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "low":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
};
