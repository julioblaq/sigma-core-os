# Sigma Voice Agent

Owner: Jerry Hicks Jr.
Date: 2026-06-06
Status: First implementation plan and configuration reference.

## Purpose

Add voice input to the Sigma Core OS dashboard before Hermes integration.

The voice layer is an operator interface, not an execution engine. Voice commands create transcripts and pending approval drafts. They do not execute trades, write files, or invoke Hermes directly.

## Cloud Role

The first Railway version runs through:

- `sigma-dashboard` for browser microphone capture
- `sigma-api` for provider calls and approval draft creation
- Railway variables for voice provider secrets

Hermes remains separate until its default gateway is deployed and explicitly wired into Sigma.

## Supported Providers

### OpenRouter Microsoft MAI

Default models:

```text
VOICE_PROVIDER=openrouter
VOICE_STT_MODEL=microsoft/mai-transcribe-1.5
VOICE_TTS_MODEL=microsoft/mai-voice-2
VOICE_TTS_VOICE=nova
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
```

`/v1/voice/draft-task` queues a `sigma-voice` approval with action `voice_task_draft`.

## Dashboard Surface

The dashboard has a `/voice` page with:

- microphone recording
- transcription
- task type selection
- approval draft queueing
- optional speech playback

## Safety Rules

- Voice never bypasses approvals.
- Voice never executes broker actions.
- Voice never connects to OpenD.
- Voice never invokes Hermes until Hermes is explicitly integrated.
- Voice provider API keys live only in Railway variables or local `.env` files.

## Railway Variables

Recommended first pass:

```text
VOICE_PROVIDER=openrouter
OPENROUTER_API_KEY=<secret>
VOICE_STT_MODEL=microsoft/mai-transcribe-1.5
VOICE_TTS_MODEL=microsoft/mai-voice-2
VOICE_TTS_VOICE=nova
VOICE_TTS_FORMAT=mp3
VOICE_TIMEOUT_MS=30000
```
