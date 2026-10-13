import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"

// 싱글턴 클라이언트
let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았습니다.")
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _client
}

export function isAIEnabled(): boolean {
  return process.env.AI_ENABLED === "true" && !!process.env.OPENAI_API_KEY
}

export async function chatCompletion(params: {
  systemPrompt: string
  userMessage: string
  model?: string
  temperature?: number
  responseFormat?: "text" | "json_object"
  maxTokens?: number
}): Promise<{
  content: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}> {
  if (!isAIEnabled()) {
    throw new Error("AI 기능이 비활성화되어 있습니다. AI_ENABLED=true 및 OPENAI_API_KEY를 확인하세요.")
  }

  const client = getClient()
  const model = params.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini"

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userMessage },
    ],
    temperature: params.temperature ?? 0.3,
    response_format:
      params.responseFormat === "json_object" ? { type: "json_object" } : undefined,
    max_tokens: params.maxTokens ?? 2000,
  })

  const content = response.choices[0]?.message?.content ?? ""
  const usage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  }

  return { content, usage }
}

export async function jsonCompletion<T>(params: {
  systemPrompt: string
  userMessage: string
  model?: string
}): Promise<{
  data: T
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}> {
  const result = await chatCompletion({
    ...params,
    responseFormat: "json_object",
    temperature: 0.1,
  })
  const data = JSON.parse(result.content) as T
  return { data, usage: result.usage }
}

export async function functionCall(params: {
  systemPrompt: string
  userMessage: string
  tools: ChatCompletionTool[]
  model?: string
}): Promise<{
  toolCalls: Array<{ name: string; arguments: string }> | null
  content: string | null
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}> {
  if (!isAIEnabled()) {
    throw new Error("AI 기능이 비활성화되어 있습니다.")
  }

  const client = getClient()
  const model = params.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini"

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userMessage },
    ],
    tools: params.tools,
    temperature: 0.2,
  })

  const message = response.choices[0]?.message
  const toolCalls =
    message?.tool_calls
      ?.filter((tc): tc is typeof tc & { type: "function" } => tc.type === "function")
      .map((tc) => ({
        name: tc.function.name,
        arguments: tc.function.arguments,
      })) ?? null

  return {
    toolCalls,
    content: message?.content ?? null,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  }
}
