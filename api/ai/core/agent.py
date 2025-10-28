"""
Agent management for SLAR AI system.
"""

import json
import os
import logging
from typing import Any, Callable, Optional, Dict

import aiofiles
from autogen_agentchat.agents import AssistantAgent, UserProxyAgent
from autogen_agentchat.teams import RoundRobinGroupChat, SelectorGroupChat
from autogen_core import CancellationToken
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_agentchat.conditions import (
    TextMentionTermination,
    HandoffTermination,
    TokenUsageTermination,
    ExternalTermination
)
from autogen_ext.memory.chromadb import ChromaDBVectorMemory, PersistentChromaDBVectorMemoryConfig

from config import get_settings, Settings
from .tools import ToolManager

logger = logging.getLogger(__name__)


class SLARAgentManager:
    """
    Manager class for SLAR (Smart Live Alert & Response) agents.

    This class centralizes the management of SLAR agents, providing:
    - Agent creation and configuration
    - Team management with state persistence
    - RAG memory integration for knowledge retrieval
    - Tool management through ToolManager
    - History tracking and persistence

    Example usage:
        ```python
        from agent import SLARAgentManager

        # Initialize manager
        manager = SLARAgentManager()

        # Create a team
        async def user_input(prompt, cancellation_token=None):
            return input(prompt)

        team = await manager.get_team(user_input)

        # Run a task
        result = await team.run(task="Help with incident response")
        ```

    Features:
    - Automatic state persistence (team_state.json)
    - Chat history management (team_history.json)
    - ChromaDB vector memory for RAG
    - MCP tool integration
    - Environment-based configuration
    """

    def __init__(self, data_store: Optional[str] = None, settings: Optional[Settings] = None):
        """
        Initialize the SLAR Agent Manager.

        Args:
            data_store: Path to data storage directory. Defaults to settings value.
            settings: Application settings instance. If not provided, will use get_settings().
        """
        self.settings = settings or get_settings()
        self.data_store = data_store or self.settings.data_store
        self.state_path = os.path.join(self.data_store, "team_state.json")
        self.history_path = os.path.join(self.data_store, "team_history.json")

        # Initialize vector memory
        self.rag_memory = self._create_rag_memory()

        # Initialize tool manager
        self.tool_manager = ToolManager()

        # Cache for model client
        self._model_client = None

        # Callback function
        self._user_input_func: Optional[Callable] = None

        # MCP workbenches caching
        self._mcp_tools_cache: Optional[Dict[str, Any]] = None
        self._mcp_initialized = False

    def _create_rag_memory(self) -> ChromaDBVectorMemory:
        """Create ChromaDB vector memory with current settings."""
        return ChromaDBVectorMemory(
            config=PersistentChromaDBVectorMemoryConfig(
                collection_name=self.settings.chroma_collection_name,
                persistence_path=self.settings.chromadb_path,
                k=self.settings.chroma_k_results,
                score_threshold=self.settings.chroma_score_threshold,
            )
        )

    def get_model_client(self) -> OpenAIChatCompletionClient:
        """Get or create the OpenAI model client."""

        if self._model_client is None:
            self._model_client = OpenAIChatCompletionClient(
                model=self.settings.openai_model,
                api_key=self.settings.openai_api_key,
            )
        return self._model_client

    async def load_mcp_tools(self, config_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Load MCP workbenches with caching.
        Returns cached workbenches if already initialized.
        """
        # Return cached workbenches if available
        if self._mcp_initialized:
            return self._mcp_tools_cache or {}

        # Initialize workbenches
        config_path = config_path or self.settings.mcp_config_path

        try:
            logger.info("Initializing MCP workbenches...")
            self.tool_manager.load_mcp_config(config_path)
            workbenches = await self.tool_manager.load_mcp_workbenches()

            self._mcp_tools_cache = workbenches
            self._mcp_initialized = True

            if not workbenches:
                logger.warning("No MCP workbenches loaded. Agent will run with limited capabilities.")
            else:
                logger.info(f"MCP workbenches initialized: {len(workbenches)} workbenches loaded")

            return workbenches
        except Exception as e:
            logger.error(f"Error initializing MCP workbenches: {e}")
            self._mcp_tools_cache = {}
            self._mcp_initialized = True
            return {}

    async def _create_assistant_agent(
        self,
        name: str,
        description: str,
        system_message: str,
        model_client: Optional[OpenAIChatCompletionClient] = None,
        reflect_on_tool_use: bool = True,
        include_memory: bool = False,
        disable_workbench: bool = True
    ) -> AssistantAgent:
        """Helper method to create an AssistantAgent with common configuration."""
        model_client = model_client or self.get_model_client()
        workbenches = await self.load_mcp_tools() if not disable_workbench else []
        workbench_list = list(workbenches.values()) if not disable_workbench else []

        kwargs = {
            "name": name,
            "model_client": model_client,
            "description": description,
            "system_message": system_message,
            "workbench": workbench_list,
            "reflect_on_tool_use": reflect_on_tool_use,
            "model_client_stream": True,
        }

        if include_memory:
            kwargs["memory"] = [self.rag_memory]

        return AssistantAgent(**kwargs)

    async def create_agent_planer(self, model_client: Optional[OpenAIChatCompletionClient] = None) -> AssistantAgent:
        """Create the SRE planning agent."""
        return await self._create_assistant_agent(
            name="sre_agent",
            description="You are an SRE expert. Diagnose the issue, assess impact, and provide immediate action items",
            system_message="You are an SRE expert. Diagnose the issue, assess impact, and provide immediate action items.",
            model_client=model_client,
            reflect_on_tool_use=True,
            disable_workbench=False,
            include_memory=True
        )

    def set_user_input_func(self, user_input_func: Callable):
        """Set the user input function."""
        self._user_input_func = user_input_func

    def create_user_proxy(self, user_input_func: Callable) -> UserProxyAgent:
        """Create the user proxy agent."""
        return UserProxyAgent(name="user", input_func=user_input_func)

    async def get_selector_group_chat(self, user_input_func: Callable, external_termination: Optional[ExternalTermination] = None) -> RoundRobinGroupChat:
        """Create the agent team with SRE agent and user proxy."""
        # Create SRE planning agent
        sre_agent = await self.create_agent_planer()

        # Create user proxy
        if user_input_func is None:
            user_input_func = self._user_input_func
        user_proxy = self.create_user_proxy(user_input_func)

        # Simplified selector prompt
        selector_prompt = """Select an agent to perform task.

        {roles}

        Current conversation context:
        {history}

        Read the above conversation, then select an agent from {participants} to perform the next task.
        Only select one agent.
        """

        # Create team with single SRE agent
        team = RoundRobinGroupChat(
            [sre_agent, user_proxy],
            termination_condition=TextMentionTermination("TERMINATE") | HandoffTermination(target="user") | TokenUsageTermination(max_total_token=self.settings.max_total_tokens) | external_termination,
        )

        return team

    async def get_history(self) -> list[dict[str, Any]]:
        """Get chat history from file."""
        if not os.path.exists(self.history_path):
            return []
        async with aiofiles.open(self.history_path, "r") as file:
            return json.loads(await file.read())

    def get_rag_memory(self) -> ChromaDBVectorMemory:
        """Get the RAG memory instance."""
        return self.rag_memory
