# integrations/litellm

LiteLLM integration for Sigma Core OS.

Provides a unified LLM proxy that routes model calls to OpenAI, Anthropic, Google, and other providers.
All agents use this integration to make LLM calls — never call provider APIs directly.

## Status

Phase 1 stub. Implementation planned for Phase 2.

## Planned Features

- Model routing (GPT-4, Claude, Gemini, Mistral)
- Fallback logic (if primary model fails, try secondary)
- Cost tracking per agent
- Rate limiting

## Setup

```bash
pip install litellm
```

Set environment variables:

```
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

## Usage (planned)

```python
from integrations.litellm import llm_call

response = llm_call(model="gpt-4", prompt="Hello")
```
