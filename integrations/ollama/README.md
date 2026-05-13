# integrations/ollama

Ollama integration for Sigma Core OS.

Enables local LLM inference via Ollama, allowing agents to run models
without sending data to external APIs.

## Status

Phase 1 stub. Implementation planned for Phase 2.

## Planned Features

- Local model inference (Llama 3, Mistral, CodeLlama, etc.)
- Privacy-first option for sensitive data processing
- Fallback from LiteLLM when offline or for cost reduction

## Setup

```bash
# Install Ollama: https://ollama.ai
brew install ollama
ollama pull llama3
```

## Usage (planned)

```python
from integrations.ollama import local_llm_call

response = local_llm_call(model="llama3", prompt="Hello")
```
