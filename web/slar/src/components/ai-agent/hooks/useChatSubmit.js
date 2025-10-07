import { useCallback } from 'react';

export const useChatSubmit = (
  input,
  setInput,
  isSending,
  setIsSending,
  connectionStatus,
  wsConnection,
  attachedIncident,
  setMessages
) => {
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
  }, [input, isSending, connectionStatus, wsConnection, attachedIncident, setInput, setIsSending, setMessages]);

  return { onSubmit };
};
