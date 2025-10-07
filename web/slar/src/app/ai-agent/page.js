"use client";

import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';
import { ChatInput } from '../../components/ui';

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';


// Small badge helpers
const Badge = ({ children, color }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{children}</span>
);

const statusColor = (status) => {
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

const severityColor = (sev) => {
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

// Memoized Message Component để tránh re-render không cần thiết
const MessageComponent = memo(({ message }) => {
  const markdownComponents = useMemo(() => ({
    p: ({ node, ...props }) => (
      <p className="my-3 leading-relaxed" {...props} />
    ),
    ul: ({ node, ...props }) => (
      <ul className="my-2 list-disc" {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="my-2 list-decimal pl-5" {...props} />
    ),
    li: ({ node, ...props }) => (
      <li className="my-1" {...props} />
    ),
    a: ({ node, ...props }) => (
      <a className="underline hover:no-underline" {...props} />
    ),
    pre: ({ node, ...props }) => (
      <pre className="my-3 rounded bg-gray-100 dark:bg-gray-900 overflow-x-auto" {...props} />
    ),
    h1: ({ node, ...props }) => (
      <h1 className="text-lg font-semibold mt-3 mb-2" {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-base font-semibold mt-3 mb-2" {...props} />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote className="border-l-4 border-gray-300 dark:border-gray-700 pl-3 my-3 text-gray-600 dark:text-gray-300" {...props} />
    ),
    table: ({ node, ...props }) => (
      <table className="my-3 w-full border-collapse" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th className="border px-2 py-1 text-left bg-gray-50 dark:bg-gray-800" {...props} />
    ),
    td: ({ node, ...props }) => (
      <td className="border px-2 py-1 align-top" {...props} />
    ),
  }), []);

  return (
    <div className={`mb-6 ${message.role === "user" ? "text-right" : "text-left"}`}>
      <div
        className={`inline-block max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          message.role === "user"
            ? "bg-gray-200 text-gray-800"
            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        }`}
      >
        <div className="mb-2">
          {message.role !== "user" ? (
            <Badge color="bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
              {message.source}
            </Badge>
          ) : null}
          {message.type === 'MemoryQueryEvent' && (
            <div className="mt-1">
              <Badge color="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
                🔍 Memory Query
              </Badge>
            </div>
          )}
        </div>
        {message.type === 'MemoryQueryEvent' && (
          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Knowledge Sources {message.originalContent && Array.isArray(message.originalContent) ? `(${message.originalContent.filter(item => item.metadata).length})` : ''}
              </span>
            </div>

            {message.originalContent && Array.isArray(message.originalContent) && (
              <div className="space-y-2">
                {message.originalContent.filter(item => item.metadata).map((item, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm p-2 bg-white dark:bg-gray-800 rounded border">
                      {item.metadata.github_url ? (
                        <>
                          <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                          </svg>
                          <div className="flex-1 min-w-0">
                            <a
                              href={item.metadata.github_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline font-medium truncate block"
                              title={item.metadata.github_url}
                            >
                              📄 {item.metadata.path || item.metadata.github_url.split('/').pop()}
                            </a>
                            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {item.metadata.chunk_index !== undefined && (
                                <span>Chunk #{item.metadata.chunk_index}</span>
                              )}
                              {item.metadata.score !== undefined && (
                                <span>Relevance: {(item.metadata.score * 100).toFixed(1)}%</span>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <span className="text-gray-700 dark:text-gray-300 font-medium truncate block">
                              📄 {item.metadata.path || item.metadata.source}
                            </span>
                            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {item.metadata.chunk_index !== undefined && (
                                <span>Chunk #{item.metadata.chunk_index}</span>
                              )}
                              {item.metadata.score !== undefined && (
                                <span>Relevance: {(item.metadata.score * 100).toFixed(1)}%</span>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                ))}
              </div>
            )}
          </div>
        )}
        {message.type !== 'MemoryQueryEvent' && (
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {message.content}
        </Markdown>)}
      </div>

      {Array.isArray(message.incidents) && message.incidents.length > 0 && (
        <div className="mt-3 space-y-3">
          {message.incidents.map((inc) => (
            <div key={inc.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:bg-gray-50/60 dark:hover:bg-gray-800/60 cursor-pointer transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                    {inc.title || inc.name || `Incident ${inc.id}`}
                  </div>
                  {inc.description && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                      {inc.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge color={statusColor(inc.status)}>{inc.status || "unknown"}</Badge>
                  {(inc.severity || inc.urgency) && (
                    <Badge color={severityColor(inc.severity || inc.urgency)}>
                      {inc.severity || inc.urgency}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
                {inc.id && <span className="font-mono">#{inc.id.slice(0, 8)}</span>}
                {(inc.service_name || inc.service) && (
                  <span>Service: {inc.service_name || inc.service}</span>
                )}
                {inc.group && <span>Group: {inc.group}</span>}
                {(inc.assigned_to_name || inc.assignee) && (
                  <span>Assignee: {inc.assigned_to_name || inc.assignee}</span>
                )}
                {(inc.created_at || inc.updated_at || inc.updatedAt) && (
                  <span>
                    {inc.created_at ? `Created: ${new Date(inc.created_at).toLocaleDateString()}` :
                     inc.updated_at ? `Updated: ${new Date(inc.updated_at).toLocaleDateString()}` :
                     `Updated: ${inc.updatedAt}`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {message.role !== "user" && (
        <div className="mt-2 flex items-center gap-3 text-gray-400">
          <button title="Like" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 00-3-3l-1 5-4 4v9h11l2-8-5-3z"/></svg>
          </button>
          <button title="Dislike" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 003 3l1-5 4-4V4H7L5 12l5 3z"/></svg>
          </button>
          <button title="Copy" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button title="Regenerate" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 10-3.51 7.06"/><path d="M21 12h-4"/></svg>
          </button>
          <button title="More" className="hover:text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>
      )}
    </div>
  );
});

export default function AIAgentPage() {
  const { session } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [attachedIncident, setAttachedIncident] = useState(null);
  const [wsConnection, setWsConnection] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected"); // "connecting", "connected", "disconnected", "error"
  const endRef = useRef(null);
  const wsRef = useRef(null);

  // Tối ưu hóa: chỉ render một số lượng messages nhất định để tránh lag
  const MAX_VISIBLE_MESSAGES = 50;
  const visibleMessages = useMemo(() => {
    if (messages.length <= MAX_VISIBLE_MESSAGES) {
      return messages;
    }
    // Giữ lại một vài messages đầu và hiển thị messages gần đây nhất
    const recentMessages = messages.slice(-MAX_VISIBLE_MESSAGES + 5);
    const firstFewMessages = messages.slice(0, 5);

    return [
      ...firstFewMessages,
      {
        role: "assistant",
        content: `... (${messages.length - MAX_VISIBLE_MESSAGES} messages cũ hơn đã được ẩn để tối ưu hiệu suất) ...`,
        type: "system_info"
      },
      ...recentMessages
    ];
  }, [messages]);

  // Tối ưu hóa auto-scroll - chỉ scroll khi có message mới
  const prevMessagesLength = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      // Sử dụng requestAnimationFrame để tối ưu hóa scroll
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      prevMessagesLength.current = messages.length;
    }
  }, [messages.length]);

  // WebSocket connection setup
  useEffect(() => {
    const connectWebSocket = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      var wsUrl = `${scheme}://${window.location.host}/ws/chat?token=${session?.access_token}`;
      wsUrl = process.env.NEXT_PUBLIC_AI_WS_URL? process.env.NEXT_PUBLIC_AI_WS_URL : wsUrl;
      
      setConnectionStatus("connecting");

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket connected");
          setConnectionStatus("connected");
          setWsConnection(ws);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log("WebSocket message received:", data);

            // Handle different message types based on the example
            if (data.type === 'UserInputRequestedEvent') {
              // Re-enable input when user input is requested
              setIsSending(false);
            } else if (data.type === 'error') {
              // Display error message
              setMessages((prev) => [...prev, {
                role: "assistant",
                content: `Error: ${data.content}`
              }]);
              setIsSending(false);
            } else if (data.content && data.source) {
              // Handle regular messages with content and source
              // Handle content based on message type
              let processedContent;
              let originalContent = null;

              if (data.type === 'MemoryQueryEvent') {
                // For MemoryQueryEvent, preserve original content structure
                originalContent = data.content;
                processedContent = typeof data.content === 'string'
                  ? data.content
                  : JSON.stringify(data.content);
              } else {
                // For other messages, ensure content is a string
                processedContent = typeof data.content === 'string'
                  ? data.content
                  : JSON.stringify(data.content);
              }

              setMessages((prev) => [...prev, {
                role: "assistant",
                content: processedContent,
                originalContent: originalContent, // Store original for MemoryQueryEvent
                source: data.source,
                type: data.type,
                metadata: data.metadata,
                results: data.results,
                incidents: data.incidents || null
              }]);

              // Only disable sending if this is an assistant message
              if (data.source !== 'user') {
                setIsSending(false);
              }
            } else {
              // Fallback for other message types
              console.log("Received message:", data);
              setIsSending(false);
            }
          } catch (error) {
            console.error("Error parsing WebSocket message:", error);
            setIsSending(false);
          }
        };

        ws.onclose = (event) => {
          console.log("WebSocket disconnected:", event.code, event.reason);
          setConnectionStatus("disconnected");
          setWsConnection(null);
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: "Connection closed. Please refresh the page."
          }]);

          // Attempt to reconnect after 3 seconds if not a normal closure
          // if (event.code !== 1000) {
          //   setTimeout(() => {
          //     if (wsRef.current?.readyState === WebSocket.CLOSED) {
          //       connectWebSocket();
          //     }
          //   }, 3000);
          // }
        };

      } catch (error) {
        console.error("Failed to create WebSocket connection:", error);
        setConnectionStatus("error");
      }
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
        wsRef.current = null;
      }
    };
  }, []);

  // Check for attached incident from sessionStorage
  useEffect(() => {
    const attachedIncidentData = sessionStorage.getItem('attachedIncident');
    if (attachedIncidentData) {
      try {
        const incident = JSON.parse(attachedIncidentData);
        setAttachedIncident(incident);
        // Clear from sessionStorage after loading
        sessionStorage.removeItem('attachedIncident');
      } catch (error) {
        console.error('Error parsing attached incident:', error);
      }
    }
  }, []);

  // Load chat history when component mounts
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await apiClient.getChatHistory();
        const historyMessages = history.map(msg => {
          let processedContent;
          let originalContent = null;

          if (msg.type === 'MemoryQueryEvent') {
            // For MemoryQueryEvent, preserve original content structure
            originalContent = msg.content;
            processedContent = typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
          } else {
            // For other messages, ensure content is a string
            processedContent = typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
          }

          return {
            role: msg.source === 'user' ? 'user' : 'assistant',
            content: processedContent,
            originalContent: originalContent,
            type: msg.type,
            source: msg.source,
            incidents: msg.incidents || null
          };
        });
        setMessages(historyMessages);
        return; // Exit early if history loaded successfully
      } catch (error) {
        console.error('Error loading chat history:', error);
        // Fallback to welcome message if no history
        const welcomeMessage = "Xin chào! Mình là AI Agent của SLAR. Hãy nhập câu hỏi ở dưới để bắt đầu.";
        setMessages([{ role: "assistant", content: welcomeMessage }]);
      }
    };

    loadHistory();
  }, []);

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    // Push user message
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsSending(true);

    // Check WebSocket connection
    if (connectionStatus !== "connected" || !wsConnection) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Connection to AI agent is not available. Please wait for reconnection..."
      }]);
      setIsSending(false);
      return;
    }

    try {
      // Prepare message content with incident context if attached
      let messageContent = text;
      if (attachedIncident) {
        const incidentContext = `[INCIDENT CONTEXT]
Incident ID: ${attachedIncident.id}
Title: ${attachedIncident.title}
Description: ${attachedIncident.description || 'No description'}
Status: ${attachedIncident.status}
Severity: ${attachedIncident.severity || 'Unknown'}
Urgency: ${attachedIncident.urgency || 'Unknown'}
Service: ${attachedIncident.service_name || 'Unknown'}
Assigned to: ${attachedIncident.assigned_to_name || 'Unassigned'}
Created: ${attachedIncident.created_at}
${attachedIncident.acknowledged_at ? `Acknowledged: ${attachedIncident.acknowledged_at}` : ''}
${attachedIncident.resolved_at ? `Resolved: ${attachedIncident.resolved_at}` : ''}

[USER QUESTION]
${text}`;
        messageContent = incidentContext;
      }

      // Send message via WebSocket using the same format as the example
      const message = {
        content: messageContent,
        source: "user"
      };

      wsConnection.send(JSON.stringify(message));
      console.log("Message sent via WebSocket:", message);

      // Response will be handled by WebSocket onmessage event
      // No need to wait for response here as it's handled asynchronously

    } catch (err) {
      console.error("Error sending WebSocket message:", err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error sending message: ${err?.message || String(err)}` },
      ]);
      setIsSending(false);
    }
  }, [input, isSending, connectionStatus, wsConnection, attachedIncident]);


  return (
    <div className="flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-100 dark:bg-purple-900/20">
                <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                  SLAR AI Agent
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Smart assistant with incident management tools
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Connection Status */}
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' :
                  connectionStatus === 'connecting' ? 'bg-yellow-500' :
                  connectionStatus === 'error' ? 'bg-red-500' :
                  'bg-gray-400'
                }`}></div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {connectionStatus === 'connected' ? 'Connected' :
                   connectionStatus === 'connecting' ? 'Connecting...' :
                   connectionStatus === 'error' ? 'Connection Error' :
                   'Disconnected'}
                </span>
              </div>

              <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
                AI Agent Mode
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-3xl mx-auto px-4 py-8">
          {visibleMessages.map((message, idx) => (
            <MessageComponent
              key={`${message.role}-${idx}-${message.content?.slice(0, 50) || ''}`}
              message={message}
              index={idx}
            />
          ))}

          {/* Typing indicator when AI is responding */}
          {isSending && (
            <div className="mb-6 text-left">
              <div className="inline-block max-w-[85%] rounded-2xl px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800">
                <div className="flex items-center gap-2 text-gray-500">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="text-xs">SLAR đang suy nghĩ...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </main>

      {/* Chat Input Component */}
      <ChatInput
        value={input}
        onChange={useCallback((e) => setInput(e.target.value), [])}
        onSubmit={onSubmit}
        isLoading={isSending}
        placeholder="Ask anything about incidents..."
        loadingText="Đang xử lý..."
        attachedIncident={attachedIncident}
        onRemoveAttachment={useCallback(() => setAttachedIncident(null), [])}
        statusColor={statusColor}
        severityColor={severityColor}
        showModeSelector={false}
      />
    </div>
  );
}

