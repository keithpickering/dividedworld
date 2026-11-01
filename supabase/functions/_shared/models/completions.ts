/**
 * Raw completion over the OpenAI-compatible `POST /v1/completions` shape that llama.cpp, vLLM and
 * text-generation-inference serve, pointed at the instance's own endpoint. One attempt: index.ts
 * retries. The bearer key is sent only if the instance set one.
 *
 * It reports the counts the response itself carries: the OpenAI `usage` block, or where a server
 * names them otherwise, llama.cpp's `tokens_evaluated` / `tokens_predicted` and
 * text-generation-inference's `details.generated_tokens`. Where it carries none the count is left
 * unreported and the ledger records null, never a guess and never a zero ("Cost is a column"): the self-hosted endpoint is priced per GPU second,
 * so tokens are not the price basis. `gpuSeconds` is the wall time of the attempt. The tier is `self-hosted` and the model is `self-hosted`, the key of the explicit
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

export async function complete(request: CompletionRequest, baseUrl: string, apiKey: string | undefined, serverModel: string, wire: Wire): Promise<RawCompletion> {
  const body = { model: serverModel, prompt: request.prompt, temperature: request.temperature, top_p: request.topP, stop: request.stop, max_tokens: request.maxTokens };
  const started = wire.now();
  const answer = (await postJson(`${baseUrl.replace(/\/+$/, '')}/v1/completions`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, body, wire)) as {
    choices?: { text?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    tokens_evaluated?: number;
    tokens_predicted?: number;
    details?: { generated_tokens?: number };
  } | null;
  const text = answer?.choices?.[0]?.text ?? '';
  const reported = answer?.usage;
  return {
    text,
    model: 'self-hosted',
    usage: {
      inputTokens: reported?.prompt_tokens ?? answer?.tokens_evaluated,
      outputTokens: reported?.completion_tokens ?? answer?.tokens_predicted ?? answer?.details?.generated_tokens,
      gpuSeconds: (wire.now() - started) / 1000,
      serviceTier: 'self-hosted',
    },
  };
}
