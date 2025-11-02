from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    TextBlock,
    ToolPermissionContext,
    ThinkingBlock,
    ToolUseBlock,
    ToolResultBlock,
    SystemMessage,
)
import json
import asyncio
import time

# Track tool usage for demonstration
tool_usage_log = []

app = FastAPI(
    title="Claude Agent API",
    description="WebSocket API for Claude Agent SDK with session management",
    version="2.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def heartbeat_task(websocket: WebSocket, interval: int = 10):
    """Send periodic ping messages to keep the connection alive."""
    try:
        while True:
            await asyncio.sleep(interval)
            try:
                await websocket.send_json({
                    "type": "ping",
                    "timestamp": time.time()
                })
                print(f"📡 Sent heartbeat ping")
            except Exception as e:
                print(f"❌ Heartbeat failed: {e}")
                break
    except asyncio.CancelledError:
        print("🛑 Heartbeat task cancelled")
        raise

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    
    # Start heartbeat task
    heartbeat = asyncio.create_task(heartbeat_task(websocket, interval=30))
    
    try:
        async def _my_permission_callback(
            tool_name: str,
            input_data: dict,
            context: ToolPermissionContext
        ) -> PermissionResultAllow | PermissionResultDeny:
            """Control tool permissions based on tool type and input."""

            # Log the tool request
            tool_usage_log.append({
                "tool": tool_name,
                "input": input_data,
                "suggestions": context.suggestions
            })

            print(f"\n🔧 Tool Permission Request: {tool_name}")
            print(f"   Input: {json.dumps(input_data, indent=2)}")

            # For all other tools, ask the user
            print(f"   ❓ Unknown tool: {tool_name}")
            print(f"      Input: {json.dumps(input_data, indent=6)}")

            print("Waiting for user input...")

            # Send permission request ONCE before loop
            await websocket.send_json({
                "type": "permission_request",
                "tool_name": tool_name,
                "input_data": input_data,
                "suggestions": context.suggestions
            })

            # Wait for approval/denial response (skip pong messages)
            while True:
                data = await websocket.receive_json()

                # Handle pong messages during permission callback
                if data.get("type") == "pong":
                    print("📡 Received pong during permission callback")
                    continue

                if data["allow"] in ("y", "yes"):
                    return PermissionResultAllow()
                else:
                    return PermissionResultDeny(
                        message="User denied permission"
                    )

        while True:
            data = await websocket.receive_json()
            
            # Handle pong messages
            if data.get("type") == "pong":
                print(f"📡 Received pong at {data.get('timestamp')}")
                continue
            
            # Get session id from data valid uuid
            session_id = data.get("session_id", "")

            options = ClaudeAgentOptions(
                can_use_tool=_my_permission_callback,
                # Use default permission mode to ensure callbacks are invoked
                permission_mode="default",
                cwd=".",  # Set working directory
                model="sonnet",
                resume=session_id
            )

            async with ClaudeSDKClient(options) as client:
                print("\n📝 Sending query to Claude...")

                await client.query(data["prompt"])

                print("\n📨 Receiving response...")
                async for message in client.receive_response():
                    print(message)
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, ThinkingBlock):
                                await websocket.send_json({
                                    "type": "thinking",
                                    "content": block.thinking
                                })
                            elif isinstance(block, TextBlock):
                                await websocket.send_json({
                                    "type": "text",
                                    "content": block.text
                                })
                            # elif isinstance(block, ToolUseBlock):
                            #     await websocket.send_json({
                            #         "type": "tool_use",
                            #         "content": {
                            #             "id": block.id,
                            #             "name": block.name,
                            #             "input": block.input
                            #         }
                            #     })  
                            elif isinstance(block, ToolResultBlock):
                                await websocket.send_json({
                                    "type": "tool_result",
                                    "tool_use_id": block.tool_use_id,
                                    "content": block.content,
                                    "is_error": block.is_error
                                })
        
                    if isinstance(message, SystemMessage):
                        if isinstance(message.data, dict):
                            if message.data.get("subtype") == "init":
                                await websocket.send_json({
                                    "type": "session_init",
                                    "session_id": message.data.get("session_id")
                                })
                    
                    if isinstance(message, ResultMessage):
                        await websocket.send_json({
                            "type": message.subtype,
                            "result": message.result
                        })
    
    except WebSocketDisconnect:
        print("🔌 WebSocket disconnected")
    except Exception as e:
        print(f"❌ Error in websocket_chat: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "error": str(e)
            })
        except:
            pass
    finally:
        # Cancel heartbeat task
        heartbeat.cancel()
        try:
            await heartbeat
        except asyncio.CancelledError:
            pass
        print("🧹 Cleaned up heartbeat task")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "claude_agent_api_v1:app",
        host="0.0.0.0",
        port=8002,
        reload=True
    )
