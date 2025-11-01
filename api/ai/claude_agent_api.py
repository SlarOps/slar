"""
FastAPI application for Claude Agent SDK
Simple HTTP-based interaction with session management
"""
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, AsyncIterator
import json
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, ClaudeSDKClient, AssistantMessage, TextBlock, ResultMessage, ThinkingBlock, ToolUseBlock, ToolResultBlock

app = FastAPI(
    title="Claude Agent API",
    description="Simple HTTP API for Claude Agent SDK with session management",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session storage (for production, use Redis or database)
active_sessions = {}


class ChatRequest(BaseModel):
    """Request model for chat endpoint"""
    prompt: str = Field(..., description="User's message/prompt")
    session_id: Optional[str] = Field(None, description="Session ID to resume (optional)")
    fork_session: bool = Field(False, description="Create a new session branch")
    system_prompt: Optional[str] = Field(
        "You are a helpful AI assistant specialized in software engineering and DevOps.",
        description="System prompt for the agent"
    )
    permission_mode: str = Field(
        "acceptEdits",
        description="Permission mode: acceptEdits, approveOnly, or denyEdits"
    )
    model: str = Field("sonnet", description="Model to use: sonnet, opus, or haiku")


class SessionInfo(BaseModel):
    """Session information model"""
    session_id: str
    message_count: int
    created_at: Optional[str] = None
    last_updated: Optional[str] = None


class ChatResponse(BaseModel):
    """Response model for chat endpoint"""
    session_id: str
    messages: list
    status: str


async def stream_agent_response(
    prompt: str,
    options: ClaudeAgentOptions,
    session_id: Optional[str] = None,
    fork_session: bool = False
) -> AsyncIterator[str]:
    """
    Stream agent responses as Server-Sent Events

    Args:
        prompt: User's message
        options: Claude agent options
        session_id: Optional session ID to resume
        fork_session: Whether to fork the session

    Yields:
        SSE formatted messages
    """
    current_session_id = session_id
    message_buffer = []

    async def can_use_tool(tool_name: str, input_params: dict) -> bool:
        yield f"data: {json.dumps({'type': 'can_use_tool', 'content': tool_name, 'input_parameters': input_params})}\n\n"

    try:
        # Build query options
        query_options = {
            "model": options.model,
            "can_use_tool": can_use_tool,
        }

        if session_id:
            query_options["resume"] = session_id

        if fork_session:
            query_options["forkSession"] = True

        # Convert options to dict using vars() or __dict__, merge, then recreate
        try:
            # Try different methods to convert to dict
            if hasattr(options, 'dict'):
                options_dict = options.dict()
            elif hasattr(options, '__dict__'):
                options_dict = options.__dict__.copy()
            else:
                options_dict = vars(options)

            merged_options = {**options_dict, **query_options}
            options = ClaudeAgentOptions(**merged_options)
        except Exception:
            # Fallback: just update attributes directly
            for key, value in query_options.items():
                if hasattr(options, key):
                    setattr(options, key, value)


        
        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt=prompt)
            # Stream messages from agent
            async for message in client.receive_response():
                # Extract session ID from init message
                if hasattr(message, 'subtype') and message.subtype == 'init':
                    if hasattr(message, 'data') and isinstance(message.data, dict):
                        current_session_id = message.data.get('session_id') 

                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, ThinkingBlock):
                            yield f"data: {json.dumps({'type': 'thinking', 'content': block.thinking})}\n\n"
                        elif isinstance(block, TextBlock):
                            yield f"data: {json.dumps({'type': 'text', 'content': block.text})}\n\n"
                        elif isinstance(block, ToolUseBlock):
                            yield f"data: {json.dumps({'type': 'tool_use', 'content': block.input})}\n\n"
                        elif isinstance(block, ToolResultBlock):
                            yield f"data: {json.dumps({'type': 'tool_result', 'content': block.content})}\n\n"
                
            # Store session info
            if current_session_id:
                active_sessions[current_session_id] = {
                    'session_id': current_session_id,
                    'message_count': len(message_buffer),
                    'messages': message_buffer
                }

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete', 'session_id': current_session_id})}\n\n"

    except Exception as e:
        error_msg = {
            'type': 'error',
            'error': str(e),
            'session_id': current_session_id
        }
        yield f"data: {json.dumps(error_msg)}\n\n"


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "name": "Claude Agent API",
        "version": "1.0.0",
        "endpoints": {
            "chat": "/api/chat",
            "chat_stream": "/api/chat/stream",
            "sessions": "/api/sessions",
            "session_info": "/api/sessions/{session_id}",
            "health": "/api/health"
        }
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "active_sessions": len(active_sessions)
    }


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Chat with Claude Agent (streaming response via SSE)

    This endpoint streams responses using Server-Sent Events (SSE).
    The client should handle the event stream.

    Example usage:
    ```javascript
    const eventSource = new EventSource('/api/chat/stream');
    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(data);
    };
    ```
    """
    options = ClaudeAgentOptions(
        system_prompt=request.system_prompt,
        permission_mode=request.permission_mode,
        model=request.model
    )

    return StreamingResponse(
        stream_agent_response(
            prompt=request.prompt,
            options=options,
            session_id=request.session_id,
            fork_session=request.fork_session
        ),
        media_type="text/event-stream"
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Chat with Claude Agent (non-streaming)

    This endpoint collects all responses and returns them at once.
    For real-time interaction, use /api/chat/stream instead.
    """
    options = ClaudeAgentOptions(
        system_prompt=request.system_prompt,
        permission_mode=request.permission_mode,
        model=request.model
    )

    session_id = request.session_id
    messages = []

    try:
        # Build query options
        query_options = {"model": request.model}

        if request.session_id:
            query_options["resume"] = request.session_id

        if request.fork_session:
            query_options["forkSession"] = True

        # Collect all messages
        async for message in query(prompt=request.prompt, options=options):
            # Extract session ID
            if hasattr(message, 'type') and message.type == 'system':
                if hasattr(message, 'subtype') and message.subtype == 'init':
                    session_id = message.session_id

            messages.append({
                'type': getattr(message, 'type', 'unknown'),
                'content': str(message)
            })

        # Store session
        if session_id:
            active_sessions[session_id] = {
                'session_id': session_id,
                'message_count': len(messages),
                'messages': messages
            }

        return ChatResponse(
            session_id=session_id or "unknown",
            messages=messages,
            status="completed"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions", response_model=list[SessionInfo])
async def list_sessions():
    """
    List all active sessions
    """
    return [
        SessionInfo(
            session_id=session_id,
            message_count=info['message_count']
        )
        for session_id, info in active_sessions.items()
    ]


@app.get("/api/sessions/{session_id}")
async def get_session_info(session_id: str):
    """
    Get information about a specific session
    """
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    return active_sessions[session_id]


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """
    Delete a session
    """
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    del active_sessions[session_id]
    return {"status": "deleted", "session_id": session_id}


@app.post("/api/sessions/{session_id}/fork")
async def fork_session(session_id: str, request: ChatRequest):
    """
    Fork an existing session and send a new message
    """
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    # Force fork_session to True
    request.session_id = session_id
    request.fork_session = True

    return await chat(request)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "claude_agent_api:app",
        host="0.0.0.0",
        port=8002,
        reload=True
    )
