import json
import os
from typing import Any, Awaitable, Callable, Optional
import aiofiles
import venv

from autogen_agentchat.agents import AssistantAgent, UserProxyAgent
from autogen_agentchat.teams import RoundRobinGroupChat, SelectorGroupChat
from autogen_agentchat.agents import AssistantAgent, CodeExecutorAgent, ApprovalRequest, ApprovalResponse, UserProxyAgent
from autogen_core import CancellationToken
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_agentchat.conditions import TextMentionTermination, HandoffTermination
from autogen_ext.memory.chromadb import ChromaDBVectorMemory, PersistentChromaDBVectorMemoryConfig
from autogen_core import AgentId, MessageContext, RoutedAgent, message_handler
from autogen_ext.code_executors.docker import DockerCommandLineCodeExecutor

from tools_slar import get_incidents
from tools import ToolManager

from dataclasses import dataclass


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

    def __init__(self, data_store: Optional[str] = None):
        """
        Initialize the SLAR Agent Manager.

        Args:
            data_store: Path to data storage directory. Defaults to current file directory.
        """
        self.data_store = data_store or os.path.dirname(__file__)
        self.state_path = os.path.join(self.data_store, "team_state.json")
        self.history_path = os.path.join(self.data_store, "team_history.json")

        # Initialize vector memory
        self.rag_memory = ChromaDBVectorMemory(
            config=PersistentChromaDBVectorMemoryConfig(
                collection_name="autogen_docs",
                persistence_path=os.path.join(self.data_store, ".chromadb_autogen"),
                k=3,  # Return top 3 results
                score_threshold=0.4,  # Minimum similarity score
            )
        )

        # Initialize tool manager
        self.tool_manager = ToolManager()

        # Cache for model client
        self._model_client = None

        self._user_input_func: Optional[Callable[[str, Optional[CancellationToken]], Awaitable[str]]] = None
        self._approval_func: Optional[Callable[[ApprovalRequest], ApprovalResponse]] = None
        self._code_excutor = None

    def get_model_client(self) -> OpenAIChatCompletionClient:
        """Get or create the OpenAI model client."""
        if self._model_client is None:
            self._model_client = OpenAIChatCompletionClient(
                model=os.getenv("OPENAI_MODEL", "gpt-5"),
                api_key=os.getenv("OPENAI_API_KEY"),
            )
        return self._model_client

    async def load_mcp_tools(self, config_path: str = "mcp_config.yaml"):
        """Load MCP tools using the tool manager with error handling."""
        try:
            self.tool_manager.load_mcp_config(config_path)
            tools = await self.tool_manager.load_mcp_tools()
            if not tools:
                print("⚠️  Warning: No MCP tools loaded. Agent will run with limited capabilities.")
            return tools
        except Exception as e:
            print(f"❌ Error loading MCP tools: {e}")
            print("🔄 Falling back to basic tools only")
            return []  # Return empty list to allow agent to continue with basic functionality

    async def create_sre_agent(self, model_client: Optional[OpenAIChatCompletionClient] = None) -> AssistantAgent:
        """Create the SRE planning agent."""
        if model_client is None:
            model_client = self.get_model_client()
        
        tools = await self.load_mcp_tools()

        return AssistantAgent(
            "SREAgent",
            description="An agent for planning tasks, this agent should be the first to engage when given a new task.",
            model_client=model_client,
            memory=[self.rag_memory],
            tools=tools,
            reflect_on_tool_use=True,
            system_message="""
            You are an expert SRE (Site Reliability Engineering) planning agent for the SLAR (Smart Live Alert & Response) system.

            Your primary responsibilities:
            1. **Incident Analysis**: Analyze incoming incidents and alerts to understand their scope and impact
            2. **Task Decomposition**: Break down complex incident response tasks into smaller, actionable subtasks
            3. **Knowledge Retrieval**: Use your RAG memory to find relevant runbooks, procedures, and historical solutions
            4. **Context7 Integration**: Leverage Context7 tools to gather additional knowledge and best practices
            5. **Coordination**: Plan the sequence of actions needed for effective incident resolution

            When handling incidents:
            - Always start by gathering context using available tools
            - Reference relevant runbooks and documentation from your memory
            - Consider the severity and urgency of the incident
            - Plan step-by-step remediation approaches
            - Suggest monitoring and verification steps

            Available tools include:
            - Context7 for external knowledge and best practices
            - RAG memory for internal runbooks and procedures
            - Incident management tools for real-time data

            Always be thorough, methodical, and prioritize system stability and user impact.
            """,
        )

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
                code_executor: excutes code defined by you
                k8s_agent: manage kubernetes cluster
                user_proxy: handoff to user if need
            
            executes_code is a agent that can execute code, need write code before send to executes_code
            executes format:
                ```python
                # This is a simple calculator script to add two numbers
                print("hello world")
                ``` 

            You only plan and delegate tasks - you do not execute them yourself.

            When assigning tasks, use this format:
            1. <agent> : <task>

            After all tasks are complete, summarize the findings and end with "TERMINATE".
            """,
                reflect_on_tool_use=True,
        )
        return agent

    async def create_k8s_agent(self, model_client: Optional[OpenAIChatCompletionClient] = None) -> AssistantAgent:
        """Create the Kubernetes agent."""
        if model_client is None:
            model_client = self.get_model_client()

        tools = await self.load_mcp_tools()
        return AssistantAgent(
            name="k8s_agent",
            model_client=model_client,
            tools=tools,  # type: ignore
            system_message="""
            You are a Kubernetes agent.
            Your job is to manage Kubernetes clusters.
            Split task to multiple steps if necessary avoid get a lot of information. example:
            - get logs from pod
            - describe logs
            """,
            reflect_on_tool_use=True,
        )
    
    async def create_excutor(self):
        code_executor = DockerCommandLineCodeExecutor(
            work_dir="coding",
            image="python:3.11-slim"
        )
        self._code_excutor = code_executor
    
    async def create_code_executor_agent(self, approval_func: Callable[[ApprovalRequest], ApprovalResponse]) -> CodeExecutorAgent:
        """Create the code executor agent."""
        

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

    async def get_selector_group_chat(self, user_input_func: Callable[[str, Optional[CancellationToken]], Awaitable[str]]) -> SelectorGroupChat:
        """Create the swarm team."""
        planning_agent = await self.create_agent_planer()
        k8s_agent = await self.create_k8s_agent()

        code_executor_agent = await self.create_code_executor_agent(approval_func=self._approval_func)
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
            [ planning_agent, code_executor_agent, k8s_agent, user_proxy],
            selector_prompt=selector_prompt,
            termination_condition=TextMentionTermination("TERMINATE") | HandoffTermination(target="user"),
            model_client=self.get_model_client(),
        )

        return team

    async def get_team(self, user_input_func: Callable[[str, Optional[CancellationToken]], Awaitable[str]]) -> RoundRobinGroupChat:
        """
        Create and configure the SLAR agent team.

        Args:
            user_input_func: Function to handle user input requests

        Returns:
            RoundRobinGroupChat: Configured team ready for use
        """
        # Create agents
        planning_agent = await self.create_sre_agent()
        user_proxy = self.create_user_proxy(user_input_func)

        # Set up termination conditions
        termination = TextMentionTermination("TERMINATE")
        handoff_termination = HandoffTermination(target="user")

        # Create the team
        team = RoundRobinGroupChat(
            [planning_agent, user_proxy],
            termination_condition=termination | handoff_termination,
        )

        # Load state from file if it exists
        if os.path.exists(self.state_path):
            async with aiofiles.open(self.state_path, "r") as file:
                state = json.loads(await file.read())
            await team.load_state(state)

        return team

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
        # This can be extended to add more tools dynamically
        return [get_incidents] + additional_tools

    def get_rag_memory(self) -> ChromaDBVectorMemory:
        """Get the RAG memory instance."""
        return self.rag_memory

    def get_tool_manager(self) -> ToolManager:
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
                collection_name="autogen_docs",
                persistence_path=os.path.join(self.data_store, ".chromadb_autogen"),
                k=3,
                score_threshold=0.4,
            )
        )

@dataclass
class SlarMessageType:
    content: str

from autogen_agentchat.messages import TextMessage
class SlarAgent(RoutedAgent):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        model_client = OpenAIChatCompletionClient(model="gpt-4o")
        self._delegate = AssistantAgent(name, model_client=model_client)
    
    @message_handler
    async def handle_slar_message_type(self, message: SlarMessageType, ctx: MessageContext) -> None:
        print(f"{self.id.type} received message: {message.content}")
        response = await self._delegate.on_messages(
            [TextMessage(content=message.content, source="user")], ctx.cancellation_token
        )
        print(f"{self.id.type} responded: {response.chat_message}")
