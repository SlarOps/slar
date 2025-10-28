from __future__ import annotations

import asyncio
import json
import logging
import uuid
import warnings
from inspect import iscoroutinefunction
from typing import (
    Any,
    AsyncGenerator,
    Awaitable,
    Callable,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    TypeVar,
    Union,
    cast,
)

from autogen_core import CancellationToken, Component, ComponentModel, FunctionCall
from autogen_core.memory import Memory
from autogen_core.model_context import (
    ChatCompletionContext,
    UnboundedChatCompletionContext,
)
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    SystemMessage,
    UserMessage,
)
from autogen_core.tools import BaseTool, FunctionTool, StaticStreamWorkbench, ToolResult, Workbench
from pydantic import BaseModel, Field
from typing_extensions import Self

from autogen_agentchat.base import Handoff as HandoffBase
from autogen_agentchat.base import Response
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    HandoffMessage,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    StructuredMessage,
    StructuredMessageFactory,
    TextMessage,
    ThoughtEvent,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
)
from autogen_agentchat.state import AssistantAgentState
from autogen_agentchat.utils import remove_images
from autogen_agentchat.agents import BaseChatAgent

event_logger = logging.getLogger(__name__)

# Add type variables for more specific typing
T = TypeVar("T", bound=BaseModel)
R = TypeVar("R", bound=BaseModel)


# Tool Approval Types
class ToolApprovalRequest(BaseModel):
    """Request for approval of tool execution.

    Attributes:
        tool_name: Name of the tool to be executed
        tool_arguments: Dictionary of arguments to be passed to the tool
        context: List of recent messages from the conversation for context
        tool_description: Description of what the tool does
    """

    tool_name: str
    tool_arguments: dict
    context: List[LLMMessage]
    tool_description: str = ""


class ToolApprovalResponse(BaseModel):
    """Response to tool approval request.

    Attributes:
        approved: Whether the tool execution is approved
        reason: Explanation for the approval/denial decision
    """

    approved: bool
    reason: str


# Type aliases for approval functions
SyncToolApprovalFunc = Callable[[ToolApprovalRequest], ToolApprovalResponse]
AsyncToolApprovalFunc = Callable[[ToolApprovalRequest], Awaitable[ToolApprovalResponse]]
ToolApprovalFuncType = Union[SyncToolApprovalFunc, AsyncToolApprovalFunc]


class AssistantAgentConfig(BaseModel):
    """The declarative configuration for the assistant agent."""

    name: str
    model_client: ComponentModel
    tools: List[ComponentModel] | None = None
    workbench: List[ComponentModel] | None = None
    handoffs: List[HandoffBase | str] | None = None
    model_context: ComponentModel | None = None
    memory: List[ComponentModel] | None = None
    description: str
    system_message: str | None = None
    model_client_stream: bool = False
    reflect_on_tool_use: bool
    tool_call_summary_format: str
    max_tool_iterations: int = Field(default=1, ge=1)
    metadata: Dict[str, str] | None = None
    structured_message_factory: ComponentModel | None = None


class AssistantAgent(BaseChatAgent, Component[AssistantAgentConfig]):
    """An agent that provides assistance with tool use.
    """

    component_version = 2
    component_config_schema = AssistantAgentConfig
    component_provider_override = "autogen_agentchat.agents.AssistantAgent"

    def __init__(
        self,
        name: str,
        model_client: ChatCompletionClient,
        *,
        tools: List[BaseTool[Any, Any] | Callable[..., Any] | Callable[..., Awaitable[Any]]] | None = None,
        workbench: Workbench | Sequence[Workbench] | None = None,
        handoffs: List[HandoffBase | str] | None = None,
        model_context: ChatCompletionContext | None = None,
        description: str = "An agent that provides assistance with ability to use tools.",
        system_message: (
            str | None
        ) = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed.",
        model_client_stream: bool = False,
        reflect_on_tool_use: bool | None = None,
        max_tool_iterations: int = 1,
        tool_call_summary_format: str = "{result}",
        tool_call_summary_formatter: Callable[[FunctionCall, FunctionExecutionResult], str] | None = None,
        output_content_type: type[BaseModel] | None = None,
        output_content_type_format: str | None = None,
        memory: Sequence[Memory] | None = None,
        metadata: Dict[str, str] | None = None,
        # NEW: Tool approval parameters
        approval_func: Optional[ToolApprovalFuncType] = None,
        auto_approve_tools: List[str] | None = None,
        always_deny_tools: List[str] | None = None,
    ):
        super().__init__(name=name, description=description)
        self._metadata = metadata or {}
        self._model_client = model_client
        self._model_client_stream = model_client_stream
        self._output_content_type: type[BaseModel] | None = output_content_type
        self._output_content_type_format = output_content_type_format
        self._structured_message_factory: StructuredMessageFactory | None = None
        if output_content_type is not None:
            self._structured_message_factory = StructuredMessageFactory(
                input_model=output_content_type, format_string=output_content_type_format
            )

        self._memory = None
        if memory is not None:
            if isinstance(memory, list):
                self._memory = memory
            else:
                raise TypeError(f"Expected Memory, List[Memory], or None, got {type(memory)}")

        self._system_messages: List[SystemMessage] = []
        if system_message is None:
            self._system_messages = []
        else:
            self._system_messages = [SystemMessage(content=system_message)]
        self._tools: List[BaseTool[Any, Any]] = []
        if tools is not None:
            if model_client.model_info["function_calling"] is False:
                raise ValueError("The model does not support function calling.")
            for tool in tools:
                if isinstance(tool, BaseTool):
                    self._tools.append(tool)
                elif callable(tool):
                    if hasattr(tool, "__doc__") and tool.__doc__ is not None:
                        description = tool.__doc__
                    else:
                        description = ""
                    self._tools.append(FunctionTool(tool, description=description))
                else:
                    raise ValueError(f"Unsupported tool type: {type(tool)}")
        # Check if tool names are unique.
        tool_names = [tool.name for tool in self._tools]
        if len(tool_names) != len(set(tool_names)):
            raise ValueError(f"Tool names must be unique: {tool_names}")

        # Handoff tools.
        self._handoff_tools: List[BaseTool[Any, Any]] = []
        self._handoffs: Dict[str, HandoffBase] = {}
        if handoffs is not None:
            if model_client.model_info["function_calling"] is False:
                raise ValueError("The model does not support function calling, which is needed for handoffs.")
            for handoff in handoffs:
                if isinstance(handoff, str):
                    handoff = HandoffBase(target=handoff)
                if isinstance(handoff, HandoffBase):
                    self._handoff_tools.append(handoff.handoff_tool)
                    self._handoffs[handoff.name] = handoff
                else:
                    raise ValueError(f"Unsupported handoff type: {type(handoff)}")
        # Check if handoff tool names are unique.
        handoff_tool_names = [tool.name for tool in self._handoff_tools]
        if len(handoff_tool_names) != len(set(handoff_tool_names)):
            raise ValueError(f"Handoff names must be unique: {handoff_tool_names}")
        # Create sets for faster lookup
        tool_names_set = set(tool_names)
        handoff_tool_names_set = set(handoff_tool_names)

        # Check if there's any overlap between handoff tool names and tool names
        overlap = tool_names_set.intersection(handoff_tool_names_set)

        # Also check if any handoff target name matches a tool name
        # This handles the case where a handoff is specified directly with a string that matches a tool name
        for handoff in handoffs or []:
            if isinstance(handoff, str) and handoff in tool_names_set:
                raise ValueError("Handoff names must be unique from tool names")
            elif isinstance(handoff, HandoffBase) and handoff.target in tool_names_set:
                raise ValueError("Handoff names must be unique from tool names")

        if overlap:
            raise ValueError("Handoff names must be unique from tool names")

        if workbench is not None:
            if self._tools:
                raise ValueError("Tools cannot be used with a workbench.")
            if isinstance(workbench, Sequence):
                self._workbench = workbench
            else:
                self._workbench = [workbench]
        else:
            self._workbench = [StaticStreamWorkbench(self._tools)]

        if model_context is not None:
            self._model_context = model_context
        else:
            self._model_context = UnboundedChatCompletionContext()

        if self._output_content_type is not None and reflect_on_tool_use is None:
            # If output_content_type is set, we need to reflect on tool use by default.
            self._reflect_on_tool_use = True
        elif reflect_on_tool_use is None:
            self._reflect_on_tool_use = False
        else:
            self._reflect_on_tool_use = reflect_on_tool_use

        # Tool call loop
        self._max_tool_iterations = max_tool_iterations
        if self._max_tool_iterations < 1:
            raise ValueError(
                f"Maximum number of tool iterations must be greater than or equal to 1, got {max_tool_iterations}"
            )

        self._tool_call_summary_format = tool_call_summary_format
        self._tool_call_summary_formatter = tool_call_summary_formatter
        self._is_running = False

        # NEW: Store approval configuration
        self._approval_func = approval_func
        self._approval_func_is_async = approval_func is not None and iscoroutinefunction(approval_func)
        self._auto_approve_tools = set(auto_approve_tools or [])
        self._always_deny_tools = set(always_deny_tools or [])

        # Validate that auto_approve and always_deny don't overlap
        overlap = self._auto_approve_tools.intersection(self._always_deny_tools)
        if overlap:
            raise ValueError(
                f"Tools cannot be in both auto_approve_tools and always_deny_tools: {overlap}"
            )

        # Issue warning if no approval function is set
        if approval_func is None and tools and not self._auto_approve_tools:
            warnings.warn(
                "No approval function set for AssistantAgent. Tools will execute automatically without oversight. "
                "For security, consider setting an approval_func to review and approve tool calls before execution.",
                UserWarning,
                stacklevel=2,
            )

    @property
    def produced_message_types(self) -> Sequence[type[BaseChatMessage]]:
        """Get the types of messages this agent can produce.

        Returns:
            Sequence of message types this agent can generate
        """
        types: List[type[BaseChatMessage]] = [TextMessage, ToolCallSummaryMessage, HandoffMessage]
        if self._structured_message_factory is not None:
            types.append(StructuredMessage)
        return types

    @property
    def model_context(self) -> ChatCompletionContext:
        """Get the model context used by this agent.

        Returns:
            The chat completion context for this agent
        """
        return self._model_context

    async def on_messages(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> Response:
        """Process incoming messages and generate a response.

        Args:
            messages: Sequence of messages to process
            cancellation_token: Token for cancelling operation

        Returns:
            Response containing the agent's reply
        """
        async for message in self.on_messages_stream(messages, cancellation_token):
            if isinstance(message, Response):
                return message
        raise AssertionError("The stream should have returned the final result.")

    async def on_messages_stream(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[Union[BaseAgentEvent, BaseChatMessage, Response], None]:
        """Process messages and stream the response.

        Args:
            messages: Sequence of messages to process
            cancellation_token: Token for cancelling operation

        Yields:
            Events, messages and final response during processing
        """

        # Gather all relevant state here
        agent_name = self.name
        model_context = self._model_context
        memory = self._memory
        system_messages = self._system_messages
        workbench = self._workbench
        handoff_tools = self._handoff_tools
        handoffs = self._handoffs
        model_client = self._model_client
        model_client_stream = self._model_client_stream
        reflect_on_tool_use = self._reflect_on_tool_use
        max_tool_iterations = self._max_tool_iterations
        tool_call_summary_format = self._tool_call_summary_format
        tool_call_summary_formatter = self._tool_call_summary_formatter
        output_content_type = self._output_content_type

        # STEP 1: Add new user/handoff messages to the model context
        await self._add_messages_to_context(
            model_context=model_context,
            messages=messages,
        )

        # STEP 2: Update model context with any relevant memory
        inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
        for event_msg in await self._update_model_context_with_memory(
            memory=memory,
            model_context=model_context,
            agent_name=agent_name,
        ):
            inner_messages.append(event_msg)
            yield event_msg

        # STEP 3: Generate a message ID for correlation between streaming chunks and final message
        message_id = str(uuid.uuid4())

        # STEP 4: Run the first inference
        model_result = None
        async for inference_output in self._call_llm(
            model_client=model_client,
            model_client_stream=model_client_stream,
            system_messages=system_messages,
            model_context=model_context,
            workbench=workbench,
            handoff_tools=handoff_tools,
            agent_name=agent_name,
            cancellation_token=cancellation_token,
            output_content_type=output_content_type,
            message_id=message_id,
        ):
            if isinstance(inference_output, CreateResult):
                model_result = inference_output
            else:
                # Streaming chunk event
                yield inference_output

        assert model_result is not None, "No model result was produced."

        # --- NEW: If the model produced a hidden "thought," yield it as an event ---
        if model_result.thought:
            thought_event = ThoughtEvent(content=model_result.thought, source=agent_name, id=message_id)
            yield thought_event
            inner_messages.append(thought_event)
            # Regenerate the message ID for correlation between streaming chunks and final message
            message_id = str(uuid.uuid4())

        # Add the assistant message to the model context (including thought if present)
        await model_context.add_message(
            AssistantMessage(
                content=model_result.content,
                source=agent_name,
                thought=getattr(model_result, "thought", None),
            )
        )

        # STEP 5: Process the model output
        async for output_event in self._process_model_result(
            model_result=model_result,
            inner_messages=inner_messages,
            cancellation_token=cancellation_token,
            agent_name=agent_name,
            system_messages=system_messages,
            model_context=model_context,
            workbench=workbench,
            handoff_tools=handoff_tools,
            handoffs=handoffs,
            model_client=model_client,
            model_client_stream=model_client_stream,
            reflect_on_tool_use=reflect_on_tool_use,
            max_tool_iterations=max_tool_iterations,
            tool_call_summary_format=tool_call_summary_format,
            tool_call_summary_formatter=tool_call_summary_formatter,
            output_content_type=output_content_type,
            message_id=message_id,
            format_string=self._output_content_type_format,
            # NEW: Pass approval parameters
            approval_func=self._approval_func,
            approval_func_is_async=self._approval_func_is_async,
            auto_approve_tools=self._auto_approve_tools,
            always_deny_tools=self._always_deny_tools,
        ):
            yield output_event

    @staticmethod
    async def _add_messages_to_context(
        model_context: ChatCompletionContext,
        messages: Sequence[BaseChatMessage],
    ) -> None:
        """
        Add incoming messages to the model context.
        """
        for msg in messages:
            if isinstance(msg, HandoffMessage):
                for llm_msg in msg.context:
                    await model_context.add_message(llm_msg)
            await model_context.add_message(msg.to_model_message())

    @staticmethod
    async def _update_model_context_with_memory(
        memory: Optional[Sequence[Memory]],
        model_context: ChatCompletionContext,
        agent_name: str,
    ) -> List[MemoryQueryEvent]:
        """Update model context with memory content.

        Args:
            memory: Optional sequence of memory stores to query
            model_context: Context to update with memory content
            agent_name: Name of the agent for event tracking

        Returns:
            List of memory query events generated during update
        """
        events: List[MemoryQueryEvent] = []
        if memory:
            for mem in memory:
                update_context_result = await mem.update_context(model_context)
                if update_context_result and len(update_context_result.memories.results) > 0:
                    memory_query_event_msg = MemoryQueryEvent(
                        content=update_context_result.memories.results,
                        source=agent_name,
                    )
                    events.append(memory_query_event_msg)
        return events

    @classmethod
    async def _call_llm(
        cls,
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        system_messages: List[SystemMessage],
        model_context: ChatCompletionContext,
        workbench: Sequence[Workbench],
        handoff_tools: List[BaseTool[Any, Any]],
        agent_name: str,
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
        message_id: str,
    ) -> AsyncGenerator[Union[CreateResult, ModelClientStreamingChunkEvent], None]:
        """Call the language model with given context and configuration.

        Args:
            model_client: Client for model inference
            model_client_stream: Whether to stream responses
            system_messages: System messages to include
            model_context: Context containing message history
            workbench: Available workbenches
            handoff_tools: Tools for handling handoffs
            agent_name: Name of the agent
            cancellation_token: Token for cancelling operation
            output_content_type: Optional type for structured output

        Returns:
            Generator yielding model results or streaming chunks
        """
        all_messages = await model_context.get_messages()
        llm_messages = cls._get_compatible_context(model_client=model_client, messages=system_messages + all_messages)

        tools = [tool for wb in workbench for tool in await wb.list_tools()] + handoff_tools

        if model_client_stream:
            model_result: Optional[CreateResult] = None

            async for chunk in model_client.create_stream(
                llm_messages,
                tools=tools,
                json_output=output_content_type,
                cancellation_token=cancellation_token,
            ):
                if isinstance(chunk, CreateResult):
                    model_result = chunk
                elif isinstance(chunk, str):
                    yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name, full_message_id=message_id)
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
            if model_result is None:
                raise RuntimeError("No final model result in streaming mode.")
            yield model_result
        else:
            model_result = await model_client.create(
                llm_messages,
                tools=tools,
                cancellation_token=cancellation_token,
                json_output=output_content_type,
            )
            yield model_result

    @classmethod
    async def _process_model_result(
        cls,
        model_result: CreateResult,
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        cancellation_token: CancellationToken,
        agent_name: str,
        system_messages: List[SystemMessage],
        model_context: ChatCompletionContext,
        workbench: Sequence[Workbench],
        handoff_tools: List[BaseTool[Any, Any]],
        handoffs: Dict[str, HandoffBase],
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        reflect_on_tool_use: bool,
        tool_call_summary_format: str,
        tool_call_summary_formatter: Callable[[FunctionCall, FunctionExecutionResult], str] | None,
        max_tool_iterations: int,
        output_content_type: type[BaseModel] | None,
        message_id: str,
        format_string: str | None = None,
        # NEW: Approval parameters
        approval_func: Optional[ToolApprovalFuncType] = None,
        approval_func_is_async: bool = False,
        auto_approve_tools: Optional[set[str]] = None,
        always_deny_tools: Optional[set[str]] = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Handle final or partial responses from model_result, including tool calls, handoffs,
        and reflection if needed. Supports tool call loops when enabled.
        """

        # Tool call loop implementation with streaming support
        current_model_result = model_result
        # This variable is needed for the final summary/reflection step
        executed_calls_and_results: List[Tuple[FunctionCall, FunctionExecutionResult]] = []

        for loop_iteration in range(max_tool_iterations):
            # If direct text response (string), we're done
            if isinstance(current_model_result.content, str):
                # Use the passed message ID for the final message
                if output_content_type:
                    content = output_content_type.model_validate_json(current_model_result.content)
                    yield Response(
                        chat_message=StructuredMessage[output_content_type](  # type: ignore[valid-type]
                            content=content,
                            source=agent_name,
                            models_usage=current_model_result.usage,
                            format_string=format_string,
                            id=message_id,
                        ),
                        inner_messages=inner_messages,
                    )
                else:
                    yield Response(
                        chat_message=TextMessage(
                            content=current_model_result.content,
                            source=agent_name,
                            models_usage=current_model_result.usage,
                            id=message_id,
                        ),
                        inner_messages=inner_messages,
                    )
                return

            # Otherwise, we have function calls
            assert isinstance(current_model_result.content, list) and all(
                isinstance(item, FunctionCall) for item in current_model_result.content
            )

            # STEP 4A: Yield ToolCallRequestEvent
            tool_call_msg = ToolCallRequestEvent(
                content=current_model_result.content,
                source=agent_name,
                models_usage=current_model_result.usage,
            )
            event_logger.debug(tool_call_msg)
            inner_messages.append(tool_call_msg)
            yield tool_call_msg

            # STEP 4B: Execute tool calls with streaming support
            # Use a queue to handle streaming results from tool calls.
            stream = asyncio.Queue[BaseAgentEvent | BaseChatMessage | None]()

            async def _execute_tool_calls(
                function_calls: List[FunctionCall],
                stream_queue: asyncio.Queue[BaseAgentEvent | BaseChatMessage | None],
            ) -> List[Tuple[FunctionCall, FunctionExecutionResult]]:
                results = await asyncio.gather(
                    *[
                        cls._execute_tool_call(
                            tool_call=call,
                            workbench=workbench,
                            handoff_tools=handoff_tools,
                            agent_name=agent_name,
                            cancellation_token=cancellation_token,
                            stream=stream_queue,
                            # NEW: Pass approval parameters
                            approval_func=approval_func,
                            approval_func_is_async=approval_func_is_async,
                            auto_approve_tools=auto_approve_tools,
                            always_deny_tools=always_deny_tools,
                            model_context=model_context,
                        )
                        for call in function_calls
                    ]
                )
                # Signal the end of streaming by putting None in the queue.
                stream_queue.put_nowait(None)
                return results

            task = asyncio.create_task(_execute_tool_calls(current_model_result.content, stream))

            while True:
                event = await stream.get()
                if event is None:
                    # End of streaming, break the loop.
                    break
                if isinstance(event, BaseAgentEvent) or isinstance(event, BaseChatMessage):
                    yield event
                    inner_messages.append(event)
                else:
                    raise RuntimeError(f"Unexpected event type: {type(event)}")

            # Wait for all tool calls to complete.
            executed_calls_and_results = await task
            exec_results = [result for _, result in executed_calls_and_results]

            # Yield ToolCallExecutionEvent
            tool_call_result_msg = ToolCallExecutionEvent(
                content=exec_results,
                source=agent_name,
            )
            event_logger.debug(tool_call_result_msg)
            await model_context.add_message(FunctionExecutionResultMessage(content=exec_results))
            inner_messages.append(tool_call_result_msg)
            yield tool_call_result_msg

            # STEP 4C: Check for handoff
            handoff_output = cls._check_and_handle_handoff(
                model_result=current_model_result,
                executed_calls_and_results=executed_calls_and_results,
                inner_messages=inner_messages,
                handoffs=handoffs,
                agent_name=agent_name,
            )
            if handoff_output:
                yield handoff_output
                return

            # STEP 4D: Check if we should continue the loop.
            # If we are on the last iteration, break to the summary/reflection step.
            if loop_iteration == max_tool_iterations - 1:
                break

            # Continue the loop: make another model call using _call_llm
            next_model_result: Optional[CreateResult] = None
            async for llm_output in cls._call_llm(
                model_client=model_client,
                model_client_stream=model_client_stream,
                system_messages=system_messages,
                model_context=model_context,
                workbench=workbench,
                handoff_tools=handoff_tools,
                agent_name=agent_name,
                cancellation_token=cancellation_token,
                output_content_type=output_content_type,
                message_id=message_id,  # Use same message ID for consistency
            ):
                if isinstance(llm_output, CreateResult):
                    next_model_result = llm_output
                else:
                    # Streaming chunk event
                    yield llm_output

            assert next_model_result is not None, "No model result was produced in tool call loop."
            current_model_result = next_model_result

            # Yield thought event if present
            if current_model_result.thought:
                thought_event = ThoughtEvent(content=current_model_result.thought, source=agent_name, id=message_id)
                yield thought_event
                inner_messages.append(thought_event)
                # Regenerate the message ID for correlation between streaming chunks and final message
                message_id = str(uuid.uuid4())

            # Add the assistant message to the model context (including thought if present)
            await model_context.add_message(
                AssistantMessage(
                    content=current_model_result.content,
                    source=agent_name,
                    thought=getattr(current_model_result, "thought", None),
                )
            )

        # After the loop, reflect or summarize tool results
        if reflect_on_tool_use:
            async for reflection_response in cls._reflect_on_tool_use_flow(
                system_messages=system_messages,
                model_client=model_client,
                model_client_stream=model_client_stream,
                model_context=model_context,
                workbench=workbench,
                handoff_tools=handoff_tools,
                agent_name=agent_name,
                inner_messages=inner_messages,
                output_content_type=output_content_type,
                cancellation_token=cancellation_token,
            ):
                yield reflection_response
        else:
            yield cls._summarize_tool_use(
                executed_calls_and_results=executed_calls_and_results,
                inner_messages=inner_messages,
                handoffs=handoffs,
                tool_call_summary_format=tool_call_summary_format,
                tool_call_summary_formatter=tool_call_summary_formatter,
                agent_name=agent_name,
            )
        return

    @staticmethod
    def _check_and_handle_handoff(
        model_result: CreateResult,
        executed_calls_and_results: List[Tuple[FunctionCall, FunctionExecutionResult]],
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        handoffs: Dict[str, HandoffBase],
        agent_name: str,
    ) -> Optional[Response]:
        """Check for and handle any handoff requests in the model result.

        Args:
            model_result: Result from model inference
            executed_calls_and_results: List of executed tool calls and their results
            inner_messages: List of messages generated during processing
            handoffs: Dictionary of available handoff configurations
            agent_name: Name of the agent

        Returns:
            Optional response containing handoff message if handoff detected
        """
        handoff_reqs = [
            call for call in model_result.content if isinstance(call, FunctionCall) and call.name in handoffs
        ]
        if len(handoff_reqs) > 0:
            # We have at least one handoff function call
            selected_handoff = handoffs[handoff_reqs[0].name]

            if len(handoff_reqs) > 1:
                warnings.warn(
                    (
                        f"Multiple handoffs detected. Only the first is executed: "
                        f"{[handoffs[c.name].name for c in handoff_reqs]}. "
                        "Disable parallel tool calls in the model client to avoid this warning."
                    ),
                    stacklevel=2,
                )

            # Collect normal tool calls (not handoff) into the handoff context
            tool_calls: List[FunctionCall] = []
            tool_call_results: List[FunctionExecutionResult] = []
            # Collect the results returned by handoff_tool. By default, the message attribute will returned.
            selected_handoff_message = selected_handoff.message
            for exec_call, exec_result in executed_calls_and_results:
                if exec_call.name not in handoffs:
                    tool_calls.append(exec_call)
                    tool_call_results.append(exec_result)
                elif exec_call.name == selected_handoff.name:
                    selected_handoff_message = exec_result.content

            handoff_context: List[LLMMessage] = []
            if len(tool_calls) > 0:
                # Include the thought in the AssistantMessage if model_result has it
                handoff_context.append(
                    AssistantMessage(
                        content=tool_calls,
                        source=agent_name,
                        thought=getattr(model_result, "thought", None),
                    )
                )
                handoff_context.append(FunctionExecutionResultMessage(content=tool_call_results))
            elif model_result.thought:
                # If no tool calls, but a thought exists, include it in the context
                handoff_context.append(
                    AssistantMessage(
                        content=model_result.thought,
                        source=agent_name,
                    )
                )

            # Return response for the first handoff
            return Response(
                chat_message=HandoffMessage(
                    content=selected_handoff_message,
                    target=selected_handoff.target,
                    source=agent_name,
                    context=handoff_context,
                ),
                inner_messages=inner_messages,
            )
        return None

    @classmethod
    async def _reflect_on_tool_use_flow(
        cls,
        system_messages: List[SystemMessage],
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        model_context: ChatCompletionContext,
        workbench: Sequence[Workbench],
        handoff_tools: List[BaseTool[Any, Any]],
        agent_name: str,
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        output_content_type: type[BaseModel] | None,
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[Response | ModelClientStreamingChunkEvent | ThoughtEvent, None]:
        """
        If reflect_on_tool_use=True, we do another inference based on tool results
        and yield the final text response (or streaming chunks).
        """
        all_messages = system_messages + await model_context.get_messages()
        llm_messages = cls._get_compatible_context(model_client=model_client, messages=all_messages)

        reflection_result: Optional[CreateResult] = None

        # Generate a message ID for correlation between chunks and final message in reflection flow
        reflection_message_id = str(uuid.uuid4())

        if model_client_stream:
            async for chunk in model_client.create_stream(
                llm_messages,
                json_output=output_content_type,
                cancellation_token=cancellation_token,
                tool_choice="none",  # Do not use tools in reflection flow.
            ):
                if isinstance(chunk, CreateResult):
                    reflection_result = chunk
                elif isinstance(chunk, str):
                    yield ModelClientStreamingChunkEvent(
                        content=chunk, source=agent_name, full_message_id=reflection_message_id
                    )
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
        else:
            reflection_result = await model_client.create(
                llm_messages,
                json_output=output_content_type,
                cancellation_token=cancellation_token,
                tool_choice="none",  # Do not use tools in reflection flow.
            )

        if not reflection_result or not isinstance(reflection_result.content, str):
            raise RuntimeError("Reflect on tool use produced no valid text response.")

        # --- NEW: If the reflection produced a thought, yield it ---
        if reflection_result.thought:
            thought_event = ThoughtEvent(content=reflection_result.thought, source=agent_name)
            yield thought_event
            inner_messages.append(thought_event)

        # Add to context (including thought if present)
        await model_context.add_message(
            AssistantMessage(
                content=reflection_result.content,
                source=agent_name,
                thought=getattr(reflection_result, "thought", None),
            )
        )

        if output_content_type:
            content = output_content_type.model_validate_json(reflection_result.content)
            yield Response(
                chat_message=StructuredMessage[output_content_type](  # type: ignore[valid-type]
                    content=content,
                    source=agent_name,
                    models_usage=reflection_result.usage,
                    id=reflection_message_id,
                ),
                inner_messages=inner_messages,
            )
        else:
            yield Response(
                chat_message=TextMessage(
                    content=reflection_result.content,
                    source=agent_name,
                    models_usage=reflection_result.usage,
                    id=reflection_message_id,
                ),
                inner_messages=inner_messages,
            )

    @staticmethod
    def _summarize_tool_use(
        executed_calls_and_results: List[Tuple[FunctionCall, FunctionExecutionResult]],
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        handoffs: Dict[str, HandoffBase],
        tool_call_summary_format: str,
        tool_call_summary_formatter: Callable[[FunctionCall, FunctionExecutionResult], str] | None,
        agent_name: str,
    ) -> Response:
        """
        If reflect_on_tool_use=False, create a summary message of all tool calls.
        """
        # Filter out calls which were actually handoffs
        normal_tool_calls = [(call, result) for call, result in executed_calls_and_results if call.name not in handoffs]

        def default_tool_call_summary_formatter(call: FunctionCall, result: FunctionExecutionResult) -> str:
            return tool_call_summary_format.format(
                tool_name=call.name,
                arguments=call.arguments,
                result=result.content,
                is_error=result.is_error,
            )

        summary_formatter = tool_call_summary_formatter or default_tool_call_summary_formatter

        tool_call_summaries = [summary_formatter(call, result) for call, result in normal_tool_calls]

        tool_call_summary = "\n".join(tool_call_summaries)
        return Response(
            chat_message=ToolCallSummaryMessage(
                content=tool_call_summary,
                source=agent_name,
                tool_calls=[call for call, _ in normal_tool_calls],
                results=[result for _, result in normal_tool_calls],
            ),
            inner_messages=inner_messages,
        )

    @staticmethod
    async def _execute_tool_call(
        tool_call: FunctionCall,
        workbench: Sequence[Workbench],
        handoff_tools: List[BaseTool[Any, Any]],
        agent_name: str,
        cancellation_token: CancellationToken,
        stream: asyncio.Queue[BaseAgentEvent | BaseChatMessage | None],
        # NEW: Approval parameters
        approval_func: Optional[ToolApprovalFuncType] = None,
        approval_func_is_async: bool = False,
        auto_approve_tools: Optional[set[str]] = None,
        always_deny_tools: Optional[set[str]] = None,
        model_context: Optional[ChatCompletionContext] = None,
    ) -> Tuple[FunctionCall, FunctionExecutionResult]:
        """Execute a single tool call and return the result."""
        # Load the arguments from the tool call.
        try:
            arguments = json.loads(tool_call.arguments)
        except json.JSONDecodeError as e:
            return (
                tool_call,
                FunctionExecutionResult(
                    content=f"Error: {e}",
                    call_id=tool_call.id,
                    is_error=True,
                    name=tool_call.name,
                ),
            )

        # NEW: Check deny list
        if always_deny_tools and tool_call.name in always_deny_tools:
            event_logger.warning(f"Tool '{tool_call.name}' is in deny list, blocking execution")
            return (
                tool_call,
                FunctionExecutionResult(
                    content=f"Tool '{tool_call.name}' is in the deny list and cannot be executed.",
                    call_id=tool_call.id,
                    is_error=True,
                    name=tool_call.name,
                ),
            )

        # NEW: Check if needs approval (not in auto-approve list)
        if approval_func and (not auto_approve_tools or tool_call.name not in auto_approve_tools):
            # Get tool description
            tool_description = ""
            for wb in workbench:
                tools_list = await wb.list_tools()
                for tool_info in tools_list:
                    if tool_info["name"] == tool_call.name:
                        tool_description = tool_info.get("description", "")
                        break
                if tool_description:
                    break

            # Check handoff tools too
            if not tool_description:
                for handoff_tool in handoff_tools:
                    if handoff_tool.name == tool_call.name:
                        tool_description = getattr(handoff_tool, "description", "")
                        break

            # Get conversation context
            try:
                context_messages = await model_context.get_messages() if model_context else []
            except Exception as e:
                event_logger.error(f"Failed to get conversation context: {e}")
                context_messages = []

            # Create approval request
            approval_request = ToolApprovalRequest(
                tool_name=tool_call.name,
                tool_arguments=arguments,
                context=context_messages,
                tool_description=tool_description,
            )

            # Get approval (handle both sync and async)
            try:
                if approval_func_is_async:
                    async_func = cast(AsyncToolApprovalFunc, approval_func)
                    approval_response = await async_func(approval_request)
                else:
                    sync_func = cast(SyncToolApprovalFunc, approval_func)
                    approval_response = sync_func(approval_request)
            except Exception as e:
                event_logger.error(f"Approval function failed: {e}")
                return (
                    tool_call,
                    FunctionExecutionResult(
                        content=f"Tool approval process failed: {str(e)}",
                        call_id=tool_call.id,
                        is_error=True,
                        name=tool_call.name,
                    ),
                )

            # Check approval
            if not approval_response.approved:
                event_logger.info(f"Tool '{tool_call.name}' execution denied: {approval_response.reason}")
                return (
                    tool_call,
                    FunctionExecutionResult(
                        content=f"Tool execution was not approved. Reason: {approval_response.reason}",
                        call_id=tool_call.id,
                        is_error=True,
                        name=tool_call.name,
                    ),
                )

            event_logger.info(f"Tool '{tool_call.name}' execution approved: {approval_response.reason}")
        elif auto_approve_tools and tool_call.name in auto_approve_tools:
            event_logger.debug(f"Tool '{tool_call.name}' is in auto-approve list, skipping approval")

        # Check if the tool call is a handoff.
        # TODO: consider creating a combined workbench to handle both handoff and normal tools.
        for handoff_tool in handoff_tools:
            if tool_call.name == handoff_tool.name:
                # Run handoff tool call.
                result = await handoff_tool.run_json(arguments, cancellation_token, call_id=tool_call.id)
                result_as_str = handoff_tool.return_value_as_string(result)
                return (
                    tool_call,
                    FunctionExecutionResult(
                        content=result_as_str,
                        call_id=tool_call.id,
                        is_error=False,
                        name=tool_call.name,
                    ),
                )

        # Handle normal tool call using workbench.
        for wb in workbench:
            tools = await wb.list_tools()
            if any(t["name"] == tool_call.name for t in tools):
                if isinstance(wb, StaticStreamWorkbench):
                    tool_result: ToolResult | None = None
                    async for event in wb.call_tool_stream(
                        name=tool_call.name,
                        arguments=arguments,
                        cancellation_token=cancellation_token,
                        call_id=tool_call.id,
                    ):
                        if isinstance(event, ToolResult):
                            tool_result = event
                        elif isinstance(event, BaseAgentEvent) or isinstance(event, BaseChatMessage):
                            await stream.put(event)
                        else:
                            warnings.warn(
                                f"Unexpected event type: {type(event)} in tool call streaming.",
                                UserWarning,
                                stacklevel=2,
                            )
                    assert isinstance(tool_result, ToolResult), "Tool result should not be None in streaming mode."
                else:
                    tool_result = await wb.call_tool(
                        name=tool_call.name,
                        arguments=arguments,
                        cancellation_token=cancellation_token,
                        call_id=tool_call.id,
                    )
                return (
                    tool_call,
                    FunctionExecutionResult(
                        content=tool_result.to_text(),
                        call_id=tool_call.id,
                        is_error=tool_result.is_error,
                        name=tool_call.name,
                    ),
                )

        return (
            tool_call,
            FunctionExecutionResult(
                content=f"Error: tool '{tool_call.name}' not found in any workbench",
                call_id=tool_call.id,
                is_error=True,
                name=tool_call.name,
            ),
        )

    async def on_reset(self, cancellation_token: CancellationToken) -> None:
        """Reset the assistant agent to its initialization state."""
        await self._model_context.clear()

    async def save_state(self) -> Mapping[str, Any]:
        """Save the current state of the assistant agent."""
        model_context_state = await self._model_context.save_state()
        return AssistantAgentState(llm_context=model_context_state).model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load the state of the assistant agent"""
        assistant_agent_state = AssistantAgentState.model_validate(state)
        # Load the model context state.
        await self._model_context.load_state(assistant_agent_state.llm_context)

    @staticmethod
    def _get_compatible_context(model_client: ChatCompletionClient, messages: List[LLMMessage]) -> Sequence[LLMMessage]:
        """Ensure that the messages are compatible with the underlying client, by removing images if needed."""
        if model_client.model_info["vision"]:
            return messages
        else:
            return remove_images(messages)

    def _to_config(self) -> AssistantAgentConfig:
        """Convert the assistant agent to a declarative config."""

        return AssistantAgentConfig(
            name=self.name,
            model_client=self._model_client.dump_component(),
            tools=None,  # versionchanged:: v0.5.5  Now tools are not serialized, Cause they are part of the workbench.
            workbench=[wb.dump_component() for wb in self._workbench] if self._workbench else None,
            handoffs=list(self._handoffs.values()) if self._handoffs else None,
            model_context=self._model_context.dump_component(),
            memory=[memory.dump_component() for memory in self._memory] if self._memory else None,
            description=self.description,
            system_message=self._system_messages[0].content
            if self._system_messages and isinstance(self._system_messages[0].content, str)
            else None,
            model_client_stream=self._model_client_stream,
            reflect_on_tool_use=self._reflect_on_tool_use,
            max_tool_iterations=self._max_tool_iterations,
            tool_call_summary_format=self._tool_call_summary_format,
            structured_message_factory=self._structured_message_factory.dump_component()
            if self._structured_message_factory
            else None,
            metadata=self._metadata,
        )

    @classmethod
    def _from_config(cls, config: AssistantAgentConfig) -> Self:
        """Create an assistant agent from a declarative config."""
        if config.structured_message_factory:
            structured_message_factory = StructuredMessageFactory.load_component(config.structured_message_factory)
            format_string = structured_message_factory.format_string
            output_content_type = structured_message_factory.ContentModel

        else:
            format_string = None
            output_content_type = None

        return cls(
            name=config.name,
            model_client=ChatCompletionClient.load_component(config.model_client),
            workbench=[Workbench.load_component(wb) for wb in config.workbench] if config.workbench else None,
            handoffs=config.handoffs,
            model_context=ChatCompletionContext.load_component(config.model_context) if config.model_context else None,
            tools=[BaseTool.load_component(tool) for tool in config.tools] if config.tools else None,
            memory=[Memory.load_component(memory) for memory in config.memory] if config.memory else None,
            description=config.description,
            system_message=config.system_message,
            model_client_stream=config.model_client_stream,
            reflect_on_tool_use=config.reflect_on_tool_use,
            max_tool_iterations=config.max_tool_iterations,
            tool_call_summary_format=config.tool_call_summary_format,
            output_content_type=output_content_type,
            output_content_type_format=format_string,
            metadata=config.metadata,
        )


# Helper functions for creating common approval patterns


def create_human_approval_func(verbose: bool = True) -> SyncToolApprovalFunc:
    """Create a human-in-the-loop approval function.

    Args:
        verbose: If True, print detailed information about the tool call

    Returns:
        Approval function that prompts user for approval

    Example:
        >>> from api.ai.core.sre_agent import AssistantAgent, create_human_approval_func
        >>> agent = AssistantAgent(
        ...     name="assistant",
        ...     model_client=model_client,
        ...     tools=[my_tool],
        ...     approval_func=create_human_approval_func(verbose=True)
        ... )
    """

    def human_approval(request: ToolApprovalRequest) -> ToolApprovalResponse:
        print(f"\n{'=' * 60}")
        print(f"Tool Approval Request")
        print(f"{'=' * 60}")
        print(f"Tool: {request.tool_name}")
        if verbose:
            print(f"Description: {request.tool_description}")
            print(f"Arguments: {request.tool_arguments}")
        print(f"{'=' * 60}")

        while True:
            answer = input("Approve this tool execution? (y/n): ").strip().lower()
            if answer in ["y", "yes"]:
                return ToolApprovalResponse(approved=True, reason="Approved by user")
            elif answer in ["n", "no"]:
                return ToolApprovalResponse(approved=False, reason="Denied by user")
            else:
                print("Please enter 'y' for yes or 'n' for no.")

    return human_approval


def create_rule_based_approval_func(
    allow_read_only: bool = True,
    deny_destructive: bool = True,
    deny_production: bool = True,
) -> SyncToolApprovalFunc:
    """Create a rule-based approval function.

    Args:
        allow_read_only: If True, auto-approve tools starting with get_, list_, check_, view_
        deny_destructive: If True, deny tools containing delete, drop, remove, destroy
        deny_production: If True, deny operations on production environments

    Returns:
        Approval function that applies predefined rules

    Example:
        >>> from api.ai.core.sre_agent import AssistantAgent, create_rule_based_approval_func
        >>> agent = AssistantAgent(
        ...     name="assistant",
        ...     model_client=model_client,
        ...     tools=[my_tool],
        ...     approval_func=create_rule_based_approval_func(
        ...         allow_read_only=True,
        ...         deny_destructive=True,
        ...         deny_production=True
        ...     )
        ... )
    """

    def rule_based_approval(request: ToolApprovalRequest) -> ToolApprovalResponse:
        tool_name_lower = request.tool_name.lower()
        args_str = str(request.tool_arguments).lower()

        # Allow read-only operations
        if allow_read_only:
            read_only_prefixes = ["get_", "list_", "check_", "view_", "show_", "describe_"]
            if any(request.tool_name.startswith(prefix) for prefix in read_only_prefixes):
                return ToolApprovalResponse(approved=True, reason="Read-only operation")

        # Deny destructive operations
        if deny_destructive:
            destructive_keywords = ["delete", "drop", "remove", "destroy", "terminate", "kill"]
            if any(keyword in tool_name_lower for keyword in destructive_keywords):
                return ToolApprovalResponse(approved=False, reason="Destructive operation blocked")

        # Deny production operations
        if deny_production:
            production_keywords = ["production", "prod", "live"]
            if any(keyword in args_str for keyword in production_keywords):
                return ToolApprovalResponse(
                    approved=False, reason="Production environment operations require manual approval"
                )

        # Default: approve
        return ToolApprovalResponse(approved=True, reason="Passed safety checks")

    return rule_based_approval


def create_llm_approval_func(
    safety_model_client: ChatCompletionClient,
    instruction: str | None = None,
) -> AsyncToolApprovalFunc:
    """Create an LLM-based approval function.

    Args:
        safety_model_client: Model client to use for safety review
        instruction: Custom instruction for the safety model. If None, uses default.

    Returns:
        Async approval function that uses an LLM to review tool calls

    Example:
        >>> from api.ai.core.sre_agent import AssistantAgent, create_llm_approval_func
        >>> from autogen_ext.models.openai import OpenAIChatCompletionClient
        >>>
        >>> safety_client = OpenAIChatCompletionClient(model="gpt-4o")
        >>> agent = AssistantAgent(
        ...     name="assistant",
        ...     model_client=model_client,
        ...     tools=[my_tool],
        ...     approval_func=create_llm_approval_func(safety_client)
        ... )
    """

    if instruction is None:
        instruction = """Review this tool execution request and determine if it's safe to execute.
Consider:
- Is this a destructive operation?
- Could it cause service interruption?
- Does it access sensitive data?
- Is it appropriate given the conversation context?

Respond with JSON: {"approved": true/false, "reason": "explanation"}"""

    async def llm_approval(request: ToolApprovalRequest) -> ToolApprovalResponse:
        context_summary = "\n".join(
            [f"{msg.source}: {str(msg.content)[:100]}..." for msg in request.context[-5:]]  # Last 5 messages
        )

        prompt = f"""
Tool: {request.tool_name}
Description: {request.tool_description}
Arguments: {request.tool_arguments}

Recent conversation:
{context_summary}
"""

        response = await safety_model_client.create(
            messages=[SystemMessage(content=instruction), UserMessage(content=prompt)],
            json_output=ToolApprovalResponse,
        )

        return ToolApprovalResponse.model_validate_json(response.content)

    return llm_approval


# Usage Examples:
#
# 1. Human-in-the-loop approval:
#    agent = AssistantAgent(
#        name="assistant",
#        model_client=model_client,
#        tools=[restart_service, check_logs],
#        approval_func=create_human_approval_func(verbose=True)
#    )
#
# 2. Rule-based approval:
#    agent = AssistantAgent(
#        name="assistant",
#        model_client=model_client,
#        tools=[restart_service, check_logs],
#        approval_func=create_rule_based_approval_func(
#            allow_read_only=True,
#            deny_destructive=True,
#            deny_production=True
#        )
#    )
#
# 3. With allowlist/denylist:
#    agent = AssistantAgent(
#        name="assistant",
#        model_client=model_client,
#        tools=[restart_service, check_logs, send_alert, delete_database],
#        approval_func=create_human_approval_func(),
#        auto_approve_tools=["check_logs", "get_metrics"],  # Always allowed
#        always_deny_tools=["delete_database"]  # Never allowed
#    )
#
# 4. LLM-based approval:
#    safety_client = OpenAIChatCompletionClient(model="gpt-4o")
#    agent = AssistantAgent(
#        name="assistant",
#        model_client=model_client,
#        tools=[restart_service, check_logs],
#        approval_func=create_llm_approval_func(safety_client)
#    )


