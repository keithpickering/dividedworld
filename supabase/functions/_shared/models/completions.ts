/**
 * Raw completion over the OpenAI-compatible `POST /v1/completions` shape that llama.cpp, vLLM and
 * text-generation-inference serve, pointed at the instance's own endpoint. One attempt: index.ts
 * retries. The bearer key is sent only if the instance set one.
 *
 * It reports the usage block it gets. Where the server reports none, the token counts are
 * estimated from the text (about four characters a token) and `gpuSeconds` is the wall time of
 * the attempt. The tier is `self-hosted` and the model is `self-hosted`, the key of the explicit
 * zero in prices.ts, whatever name the server calls its model.
 */
import type { CompletionRequest, Usage } from '../../../../engine/system/model.ts';
import { postJson } from './transport.ts';
import type { Wire } from './transport.ts';

export interface RawCompletion {
  readonly text: string;
  readonly model: string;
  readonly usage: Usage;
}

const estimate = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export async function complete(request: CompletionRequest, baseUrl: string, apiKey: string | undefined, serverModel: string, wire: Wire): Promise<RawCompletion> {
  const body = { model: serverModel, prompt: request.prompt, temperature: request.temperature, top_p: request.topP, stop: request.stop, max_tokens: request.maxTokens };
  const started = wire.now();
  const answer = (await postJson(`${baseUrl.replace(/\/+$/, '')}/v1/completions`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, body, wire)) as {
    choices?: { text?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  const text = answer?.choices?.[0]?.text ?? '';
  const reported = answer?.usage;
  return {
    text,
    model: 'self-hosted',
    usage: {
      inputTokens: reported?.prompt_tokens ?? estimate(request.prompt),
      outputTokens: reported?.completion_tokens ?? estimate(text),
      gpuSeconds: (wire.now() - started) / 1000,
      serviceTier: 'self-hosted',
    },
  };
}
