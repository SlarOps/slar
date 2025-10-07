import asyncio
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_agentchat.agents import AssistantAgent, CodeExecutorAgent, ApprovalRequest, ApprovalResponse, UserProxyAgent
from autogen_core import CancellationToken
from autogen_ext.code_executors.docker import DockerCommandLineCodeExecutor
from autogen_agentchat.teams import Swarm, SelectorGroupChat
from tools import ToolManager


async def main() -> None:
    """Main function using ToolManager for MCP configuration"""
    # Initialize the tool manager
    tool_manager = ToolManager()
    
    # Load MCP server configuration
    tool_manager.load_mcp_config("mcp_config.yaml")
    
    # Show server configuration
    tool_manager.list_servers()
    
    # Load tools from all configured MCP servers
    tools = await tool_manager.load_mcp_tools()
    
    # Create an agent that can use all the tools
    agent = AssistantAgent(
        name="context7_agent",
        model_client=OpenAIChatCompletionClient(model="gpt-4o"),
        description="An agent for planning tasks, this agent should be the first to engage when given a new task.",
        tools=tools,  # type: ignore
        system_message="""
    You are a planning agent.
    Your job is to break down complex tasks into smaller, manageable subtasks.
    Your team members are:
        code_executor: executes code
        user_proxy: the user

    You only plan and delegate tasks - you do not execute them yourself.

    When assigning tasks, use this format:
    1. <agent> : <task>

    After all tasks are complete, summarize the findings and end with "TERMINATE".
    """,
        reflect_on_tool_use=True,
    )

    async def user_input_func(prompt: str, cancellation_token: CancellationToken | None) -> str:
        return input(prompt)

    user_proxy = UserProxyAgent(
        name="user",
        input_func=user_input_func,
    )

    def simple_approval_func(request: ApprovalRequest) -> ApprovalResponse:
        """Simple approval function that requests user input for code execution approval."""
        print("Code execution approval requested:")
        print("=" * 50)
        print(request.code)
        print("=" * 50)

        while True:
            user_input = input("Do you want to execute this code? (y/n): ").strip().lower()
            if user_input in ['y', 'yes']:
                return ApprovalResponse(approved=True, reason='Approved by user')
            elif user_input in ['n', 'no']:
                return ApprovalResponse(approved=False, reason='Denied by user')
            else:
                print("Please enter 'y' for yes or 'n' for no.")

    async with DockerCommandLineCodeExecutor(
        work_dir="coding",
        image="python:3.11-slim"
    ) as code_executor:

        code_executor_agent = CodeExecutorAgent(
            "code_executor",
            code_executor=code_executor,
            approval_func=simple_approval_func
        )

        from autogen_agentchat.conditions import TextMentionTermination, HandoffTermination
        from autogen_agentchat.teams import RoundRobinGroupChat

        selector_prompt = """Select an agent to perform task.

        {roles}

        Current conversation context:
        {history}

        Read the above conversation, then select an agent from {participants} to perform the next task.
        Make sure the planner agent has assigned tasks before other agents start working.
        Only select one agent.
        """

        team = SelectorGroupChat(
            [ agent, code_executor_agent, user_proxy],
            selector_prompt=selector_prompt,
            termination_condition=TextMentionTermination("TERMINATE") | HandoffTermination(target="user"),
            model_client=OpenAIChatCompletionClient(model="gpt-4o"),
        )

        # The agent can now use both Context7 and filesystem tools
        try:
            task_description = """
            Calculator 1 + 1
            """

            # result = await team.run(task=task_description, cancellation_token=CancellationToken())
            from autogen_agentchat.ui import Console

            await Console(
                team.run_stream(task=task_description, cancellation_token=CancellationToken())
            )
            
            # print("Task completed successfully!")
            # print(result)
        except Exception as e:
            print(f"Error during execution: {e}")

    # Show which tools were loaded from each server
    print("\nServer Tools Summary:")
    for server_name, tool_names in tool_manager.get_all_server_tools().items():
        print(f"  {server_name}: {len(tool_names)} tools")
        if tool_names:
            print(f"    {', '.join(tool_names[:5])}{'...' if len(tool_names) > 5 else ''}")

    # Alternative: Use run_stream with proper async iteration
    


if __name__ == "__main__":
    asyncio.run(main())
