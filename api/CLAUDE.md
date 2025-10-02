# SLAR - Smart Live Alert & Response

./ai this is the AI agent
    - this use autogent framework to chat with OpenAI

./workers this is the background workers to send message to Slack from PGMQ
    - golang worker which make a scalate the incident
    - python worker which send message to Slack

