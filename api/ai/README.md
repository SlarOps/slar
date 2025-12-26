```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export SLAR_CONFIG_PATH=../cmd/server/dev.config.yaml
python claude_agent_api_v1.py
```