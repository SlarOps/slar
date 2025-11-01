/**
 * Claude Agent API Service
 * HTTP Streaming based (SSE - Server-Sent Events)
 */

import type { ChatRequest, StreamEvent, SessionInfo, ChatResponse } from '@/types/claude-agent';

const API_BASE_URL = process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8002';

export class ClaudeAgentService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Stream chat responses using Server-Sent Events
   */
  async *streamChat(request: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event: StreamEvent = JSON.parse(data);
              yield event;
            } catch (e) {
              console.error('Failed to parse SSE data:', data, e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Non-streaming chat (waits for complete response)
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * List all active sessions
   */
  async listSessions(): Promise<SessionInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get session info by ID
   */
  async getSessionInfo(sessionId: string): Promise<SessionInfo> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  }

  /**
   * Fork an existing session
   */
  async forkSession(sessionId: string, request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; active_sessions: number }> {
    const response = await fetch(`${this.baseUrl}/api/health`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
}

export const claudeAgentService = new ClaudeAgentService();
