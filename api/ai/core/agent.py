import json
import os
from typing import Any, Awaitable, Callable, Optional, Dict, TYPE_CHECKING
import aiofiles

from autogen_agentchat.agents import AssistantAgent, UserProxyAgent, CodeExecutorAgent, ApprovalRequest, ApprovalResponse
from autogen_agentchat.teams import RoundRobinGroupChat, SelectorGroupChat, Swarm
from autogen_core import CancellationToken, AgentId, MessageContext, RoutedAgent, message_handler
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_agentchat.conditions import TextMentionTermination, HandoffTermination, TokenUsageTermination, ExternalTermination
from autogen_ext.memory.chromadb import ChromaDBVectorMemory, PersistentChromaDBVectorMemoryConfig
from autogen_ext.code_executors.docker import DockerCommandLineCodeExecutor
from autogen_ext.code_executors.local import LocalCommandLineCodeExecutor
from .sre_agent import AssistantAgent as SreAssistantAgent

import logging
logger = logging.getLogger(__name__)

# Import settings for configuration
import sys
from pathlib import Path

# Add parent directory to path for imports
parent_dir = str(Path(__file__).parent.parent)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from config.settings import Settings


# Import for type checking only to avoid circular imports
if TYPE_CHECKING:
    from .tools import ToolManager


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
            settings: Application settings instance. If not provided, will be imported.
        """
        # Import settings locally to avoid circular dependency
        if settings is None:
            from config.settings import get_settings
            settings = get_settings()

        self.settings = settings
        self.data_store = data_store or settings.data_store
        self.state_path = os.path.join(self.data_store, "team_state.json")
        self.history_path = os.path.join(self.data_store, "team_history.json")

        # Initialize vector memory using settings
        self.rag_memory = ChromaDBVectorMemory(
            config=PersistentChromaDBVectorMemoryConfig(
                collection_name=settings.chroma_collection_name,
                persistence_path=settings.chromadb_path,
                k=settings.chroma_k_results,
                score_threshold=settings.chroma_score_threshold,
            )
        )

        # Initialize tool manager (will be imported locally to avoid circular deps)
        from .tools import ToolManager
        self.tool_manager = ToolManager()

        # Cache for model client
        self._model_client = None

        self._user_input_func: Optional[Callable[[str, Optional[CancellationToken]], Awaitable[str]]] = None
        self._approval_func: Optional[Callable[[ApprovalRequest], ApprovalResponse]] = None
        self._code_excutor = None
        
        # MCP workbenches caching for performance
        self._mcp_tools_cache: Optional[Dict[str, Any]] = None
        self._mcp_initialized = False

    def get_model_client(self) -> OpenAIChatCompletionClient:
        """Get or create the OpenAI model client."""

        if self._model_client is None:
            self._model_client = OpenAIChatCompletionClient(
                model=self.settings.openai_model,
                api_key=self.settings.openai_api_key,
            )
        return self._model_client

    async def initialize_mcp_tools(self, config_path: Optional[str] = None):
        """Pre-initialize MCP workbenches to avoid delay on first connection."""
        if self._mcp_initialized:
            return self._mcp_tools_cache

        if config_path is None:
            config_path = self.settings.mcp_config_path

        try:
            logger.info("Pre-initializing MCP workbenches...")
            self.tool_manager.load_mcp_config(config_path)
            workbenches = await self.tool_manager.load_mcp_workbenches()
            
            # Store workbenches, not tools
            self._mcp_tools_cache = workbenches
            self._mcp_initialized = True
            
            if not workbenches:
                logger.warning("No MCP workbenches loaded. Agent will run with limited capabilities.")
            else:
                logger.info(f"MCP workbenches pre-initialized successfully: {len(workbenches)} workbenches loaded")
            
            return workbenches
        except Exception as e:
            logger.error(f"Error pre-initializing MCP workbenches: {e}")
            self._mcp_tools_cache = {}
            self._mcp_initialized = True
            return {}

    async def load_mcp_tools(self, config_path: Optional[str] = None):
        """Load MCP workbenches using the tool manager with error handling and caching."""
        # Use cached workbenches if available
        if self._mcp_initialized and self._mcp_tools_cache is not None:
            return self._mcp_tools_cache
            
        # Otherwise initialize them
        return await self.initialize_mcp_tools(config_path)

    async def create_agent_planer(self, model_client: Optional[OpenAIChatCompletionClient] = None) -> AssistantAgent:
        """Create the agent planner."""
        if model_client is None:
            model_client = self.get_model_client()
        
        tools = await self.load_mcp_tools()

        agent = AssistantAgent(
            name="sre_agent",
            model_client=model_client,
            description="An agent for planning tasks, this agent should be the first to engage when given a new task.",
            memory=[self.rag_memory],
            system_message="""
            You are a planning agent.
            Your job is to break down complex tasks into smaller, manageable subtasks.
            
            Your team members are:
            - k8s_agent: A Kubernetes agent that can manage Kubernetes clusters.

            You only plan and delegate tasks - you do not execute them yourself.

            When assigning tasks, use this format:
            1. <agent> : <task>

            After all tasks are complete, summarize the findings and end with "TERMINATE".
            """,
                reflect_on_tool_use=False,
                model_client_stream=True,
        )
        return agent

    async def create_k8s_agent(self, model_client: Optional[OpenAIChatCompletionClient] = None) -> AssistantAgent:
        """Create the Kubernetes agent."""
        if model_client is None:
            model_client = self.get_model_client()

        workbenches = await self.load_mcp_tools()

        # Convert workbenches dict to list for AssistantAgent
        workbench_list = list(workbenches.values()) if workbenches else None

        return AssistantAgent(
            name="k8s_agent",
            model_client=model_client,
            workbench=workbench_list,  # Use workbench parameter instead of tools
            system_message="""
            You are a Kubernetes agent.
            Your job is to manage Kubernetes clusters.
            Split task to multiple steps if necessary avoid get a lot of information. example:
            - get logs from pod
            - describe logs
            """,
            reflect_on_tool_use=False,
            model_client_stream=True,
        )

    async def create_excutor(self):
        code_executor = LocalCommandLineCodeExecutor(
            work_dir=self.settings.code_executor_work_dir,
        )
        self._code_excutor = code_executor
    
    async def create_code_executor_agent(self, approval_func: Callable[[ApprovalRequest], ApprovalResponse]) -> CodeExecutorAgent:
        """Create the code executor agent."""
        
        # Ensure code executor is created first
        if self._code_excutor is None:
            await self.create_excutor()
        
        await self._code_excutor.start()

        code_executor_agent = CodeExecutorAgent(
            "code_executor",
            code_executor=self._code_excutor,
            approval_func=approval_func
        )
        return code_executor_agent
    
    def set_approval_func(self, approval_func: Callable[[ApprovalRequest], ApprovalResponse]):
        """Set the approval function for code execution."""
        self._approval_func = approval_func
    
    def set_user_input_func(self, user_input_func: Callable[[str, Optional[CancellationToken]], Awaitable[str]]):
        """Set the user input function."""
        self._user_input_func = user_input_func

    def create_user_proxy(self, user_input_func: Callable[[str, Optional[CancellationToken]], Awaitable[str]]) -> UserProxyAgent:
        """Create the user proxy agent."""
        return UserProxyAgent(
            name="user",
            input_func=user_input_func,
        )

    async def get_selector_group_chat(self, user_input_func: Callable[[str, Optional[CancellationToken]], Awaitable[str]], external_termination: Optional[ExternalTermination] = None) -> SelectorGroupChat:
        """Create the swarm team."""
        planning_agent = await self.create_agent_planer()
        agents = [planning_agent]

        if self.settings.enable_kubernetes:
            k8s_agent = await self.create_k8s_agent()
            agents.append(k8s_agent)

        if self.settings.enable_code_executor:
            code_executor_agent = await self.create_code_executor_agent(approval_func=self._approval_func)
            agents.append(code_executor_agent)

        if user_input_func is None:
            user_input_func = self._user_input_func
        user_proxy = self.create_user_proxy(user_input_func)

        selector_prompt = """Select an agent to perform task.

        {roles}

        Current conversation context:
        {history}

        Read the above conversation, then select an agent from {participants} to perform the next task.
        Make sure the planner agent has assigned tasks before other agents start working.
        Only select one agent.
        """

        team = SelectorGroupChat(
            agents + [user_proxy],
            selector_prompt=selector_prompt,
            termination_condition=TextMentionTermination("TERMINATE") | HandoffTermination(target="user") | TokenUsageTermination(max_total_token=self.settings.max_total_tokens) | external_termination,
            model_client=self.get_model_client(),
        )

        return team
    
    async def get_swarm_team(self, 
                             user_input_func: Callable[[str, Optional[CancellationToken]], Awaitable[str]], 
                             external_termination: Optional[ExternalTermination] = None,
                             approval_func: Optional[Callable[[ApprovalRequest], ApprovalResponse]] = None) -> Swarm:
        """
        Create a Swarm team with handoff-based agent collaboration.

        Swarm enables dynamic agent-to-agent handoffs, allowing agents to:
        - Transfer tasks to specialized agents based on expertise
        - Hand off to user for input or approval
        - Collaborate through natural conversation flow

        Args:
            user_input_func: Function to get user input
            external_termination: Optional external termination condition

        Returns:
            Swarm: Configured swarm team with agents and handoffs
        """
        # Build list of available agent names for handoffs
        available_agents = []

        # Create planning agent with handoffs to all other agents
        if self.settings.enable_kubernetes:
            available_agents.append("k8s_agent")
        if self.settings.enable_code_executor:
            available_agents.append("code_executor")
        available_agents.append("user")

        # Create planning agent with handoffs configured
        model_client = self.get_model_client()
        tools = await self.load_mcp_tools()

        planning_agent = AssistantAgent(
            name="sre_agent",
            model_client=model_client,
            description="An SRE planning agent that coordinates incident response and delegates to specialized agents.",
            memory=[self.rag_memory],
            handoffs=available_agents,  # Can handoff to all other agents
            system_message=f"""
            You are an SRE (Site Reliability Engineering) planning agent.
            Your role is to coordinate incident response by breaking down tasks and delegating to specialized agents.

            Available agents:
            {f"- k8s_agent: Kubernetes cluster management and diagnostics" if self.settings.enable_kubernetes else ""}
            {f"- code_executor: Execute code and scripts for analysis or remediation" if self.settings.enable_code_executor else ""}
            - user: Hand off to user for input, approval, or when task is complete

            Workflow:
            - If the task is not related to Kubernetes or code execution, hand off to user.
            - If the task is related to Kubernetes or code execution, break it down into manageable steps and delegate specific tasks to appropriate agents using handoffs.
            - Coordinate responses and synthesize findings.
            - When complete or user input needed, hand off to user.
            - Use TERMINATE when the incident is resolved or task is complete or user input is needed.

            Always explain your reasoning before handing off tasks.
            """,
            reflect_on_tool_use=False,
            model_client_stream=True,
        )

        agents = [planning_agent]

        # Create k8s agent if enabled
        if self.settings.enable_kubernetes:
            workbenches = await self.load_mcp_tools()
            workbench_list = list(workbenches.values()) if workbenches else None

            k8s_agent = SreAssistantAgent(
                name="k8s_agent",
                model_client=model_client,
                workbench=workbench_list,
                handoffs=["sre_agent", "user"],  # Can handoff back to planner or user
                system_message="""
                You are a Kubernetes specialist agent.

                Your expertise:
                - Kubernetes cluster diagnostics and management
                - Pod, deployment, and service analysis
                - Log retrieval and analysis
                - Resource monitoring and troubleshooting

                Workflow:
                1. Execute K8s operations using available tools
                2. Analyze results and provide clear findings
                3. For complex issues, break down into smaller steps
                4. Hand off to sre_agent with findings when task is complete
                5. Hand off to user if user input or approval is needed

                Always provide context with your findings before handing off.
                """,
                reflect_on_tool_use=False,
                model_client_stream=True,
                approval_func=approval_func,
            )
            agents.append(k8s_agent)

        # Create code executor agent if enabled
        if self.settings.enable_code_executor:
            if self._code_excutor is None:
                await self.create_excutor()
            await self._code_excutor.start()

            code_executor_agent = CodeExecutorAgent(
                name="code_executor",
                code_executor=self._code_excutor,
                approval_func=approval_func,
            )
            # Note: CodeExecutorAgent may not support handoffs directly
            # It will automatically return results to the calling agent
            agents.append(code_executor_agent)

        # Create user proxy
        user_proxy = self.create_user_proxy(user_input_func)
        agents.append(user_proxy)

        # Configure termination conditions
        # Swarm terminates when:
        # 1. An agent hands off to 'user'
        # 2. 'TERMINATE' is mentioned
        # 3. Token usage exceeds limit
        # 4. External termination is triggered
        termination = (
            HandoffTermination(target="user") |
            TextMentionTermination("TERMINATE") |
            TokenUsageTermination(max_total_token=self.settings.max_total_tokens)
        )

        if external_termination:
            termination = termination | external_termination

        # Create and return Swarm team
        swarm = Swarm(
            participants=agents,
            termination_condition=termination
        )

        return swarm



    async def save_team_state(self, team: RoundRobinGroupChat):
        """Save team state to file."""
        state = await team.save_state()
        async with aiofiles.open(self.state_path, "w") as file:
            await file.write(json.dumps(state, indent=2))

    async def get_history(self) -> list[dict[str, Any]]:
        """Get chat history from file."""
        if not os.path.exists(self.history_path):
            return []
        async with aiofiles.open(self.history_path, "r") as file:
            return json.loads(await file.read())

    async def save_history(self, history: list[dict[str, Any]]):
        """Save chat history to file."""
        async with aiofiles.open(self.history_path, "w") as file:
            await file.write(json.dumps(history, indent=2))

    def configure_agent_tools(self, additional_tools: list = None):
        """Configure additional tools for agents."""
        if additional_tools is None:
            additional_tools = []
        # Import get_incidents locally to avoid circular dependency
        try:
            # Try relative import first
            from ..utils.slar_tools import get_incidents
        except ImportError:
            # Fallback to looking in parent directory
            import sys
            parent_path = str(Path(__file__).parent.parent)
            if parent_path not in sys.path:
                sys.path.insert(0, parent_path)
            from utils.slar_tools import get_incidents
        # This can be extended to add more tools dynamically
        return [get_incidents] + additional_tools

    def get_rag_memory(self) -> ChromaDBVectorMemory:
        """Get the RAG memory instance."""
        return self.rag_memory

    def get_tool_manager(self) -> "ToolManager":
        """Get the tool manager instance."""
        return self.tool_manager

    def set_data_store(self, data_store: str):
        """Update the data store path and reinitialize paths."""
        self.data_store = data_store
        self.state_path = os.path.join(self.data_store, "team_state.json")
        self.history_path = os.path.join(self.data_store, "team_history.json")

        # Reinitialize RAG memory with new path
        self.rag_memory = ChromaDBVectorMemory(
            config=PersistentChromaDBVectorMemoryConfig(
                collection_name=self.settings.chroma_collection_name,
                persistence_path=os.path.join(self.data_store, ".chromadb_autogen"),
                k=self.settings.chroma_k_results,
                score_threshold=self.settings.chroma_score_threshold,
            )
        )
