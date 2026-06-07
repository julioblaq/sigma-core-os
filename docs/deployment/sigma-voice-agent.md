# Sigma Voice Agent

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Status: Implemented with server-side Hermes connectivity status.

## Purpose

Add voice input to the Sigma Core OS dashboard and show Hermes cloud connectivity after the secured Hermes API server is available.

The voice layer is an operator interface, not an execution engine. Voice commands create transcripts and pending approval drafts. They do not execute trades, write files, or send execution commands to Hermes directly.

## Cloud Role

The first Railway version runs through:

- `sigma-dashboard` for browser microphone capture
- `sigma-api` for provider calls, Hermes status checks, and approval draft creation
- Railway variables for voice provider secrets

Hermes remains a separate Railway service. Sigma connects to it server-side with `HERMES_API_URL` and `HERMES_API_KEY`; the browser never receives the Hermes API key.

## Supported Providers

### OpenRouter Microsoft MAI

Default models:

```text
VOICE_PROVIDER=openrouter
VOICE_STT_MODEL=microsoft/mai-transcribe-1.5
VOICE_TTS_MODEL=microsoft/mai-voice-2
VOICE_TTS_VOICE=en-US-Harper:MAI-Voice-2
```

Required secret:

```text
OPENROUTER_API_KEY=<set in Railway>
```

### OpenAI Alternative

```text
VOICE_PROVIDER=openai
VOICE_STT_MODEL=gpt-4o-mini-transcribe
VOICE_TTS_MODEL=gpt-4o-mini-tts
VOICE_TTS_VOICE=nova
```

Required secret:

```text
OPENAI_API_KEY=<set in Railway>
```

## API Surface

```text
GET  /v1/voice/config
POST /v1/voice/transcribe
POST /v1/voice/speech
POST /v1/voice/draft-task
GET  /v1/hermes/config
GET  /v1/hermes/status
GET  /v1/hermes/models
```

`/v1/voice/draft-task` queues a `sigma-voice` approval with action `voice_task_draft`.

## Dashboard Surface

The dashboard has a `/voice` page with:

- microphone recording
- transcription
- task type selection
- approval draft queueing
- optional speech playback
- Hermes status, model, and server-side auth state

## Safety Rules

- Voice never bypasses approvals.
- Voice never executes broker actions.
- Voice never connects to OpenD.
- Voice never sends broker or shell commands to Hermes.
- Voice provider API keys live only in Railway variables or local `.env` files.
- Hermes API keys live only in Railway variables or local `.env` files.

## Railway Variables

Recommended first pass:

```text
VOICE_PROVIDER=openrouter
OPENROUTER_API_KEY=<secret>
VOICE_STT_MODEL=microsoft/mai-transcribe-1.5
VOICE_TTS_MODEL=microsoft/mai-voice-2
VOICE_TTS_VOICE=en-US-Harper:MAI-Voice-2
VOICE_TTS_FORMAT=mp3
VOICE_TIMEOUT_MS=30000
HERMES_API_URL=https://hermes-agent-production-62ee.up.railway.app
HERMES_API_KEY=<secret>
HERMES_MODEL=hermes-agent
HERMES_TIMEOUT_MS=30000
```
