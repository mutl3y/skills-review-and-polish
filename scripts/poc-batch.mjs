#!/usr/bin/env node
/** POC: OpenRouter batch endpoint with JSON schema response. */
import { OpenRouterProvider } from '../src/providers/externalProvider.ts';
console.log('POC: submit 2-request batch, verify response schema matches LLM_RESPONSE_JSON_SCHEMA_BODY');
