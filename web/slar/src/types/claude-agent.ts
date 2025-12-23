/**
 * Types for Claude Agent API (HTTP Streaming)
 * No autogen dependencies - pure HTTP SSE based
 */

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'error' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'permission_request' | 'interrupted';
  content: string;
  timestamp: number;
  raw?: string;
  // Extended fields from WebSocket
  role?: 'user' | 'assistant' | 'system';
  source?: string;
  isStreaming?: boolean;
  thought?: string;
  request_id?: string | number;
  tool_name?: string;
  tool_input?: any;
  approved?: boolean;
  denied?: boolean;
  isHistory?: boolean;
}

export interface StreamEvent {
  type: 'session_id' | 'message' | 'complete' | 'error' | 'content' | 'unknown';
  content?: string;
  session_id?: string;
  error?: string;
  raw?: string;
}

export interface ChatRequest {
  prompt: string;
  session_id?: string | null;
  fork_session?: boolean;
  system_prompt?: string;
  permission_mode?: 'acceptEdits' | 'approveOnly' | 'denyEdits';
  model?: 'sonnet' | 'opus' | 'haiku';
  org_id?: string;  // Organization ID for ReBAC tenant isolation (MANDATORY)
  project_id?: string;  // Project ID for ReBAC project filtering (OPTIONAL)
  auth_token?: string;  // JWT auth token
}

export interface SessionInfo {
  session_id: string;
  message_count: number;
  created_at?: string;
  last_updated?: string;
  messages?: ChatMessage[];
}

export interface ChatResponse {
  session_id: string;
  messages: any[];
  status: string;
}

export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant specialized in software engineering and DevOps.";

export const DEFAULT_PERMISSION_MODE = "acceptEdits";
export const DEFAULT_MODEL = "sonnet";
