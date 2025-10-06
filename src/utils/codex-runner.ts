import { Thread, ThreadEvent } from "@openai/codex-sdk";
import { z } from "zod";

export interface RunOptions {
  timeout?: number;
  abortSignal?: AbortSignal;
}

export interface RunResult<T> {
  data: T;
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  } | null;
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function runWithSchema<T>(
  thread: Thread,
  prompt: string,
  schema: z.ZodSchema<T>,
  options: RunOptions = {}
): Promise<RunResult<T>> {
  const timeoutMs = options.timeout || 300000; // 5 minutes default
  const abortController = new AbortController();
  
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const { events } = await thread.runStreamed(prompt);
    
    const messages: string[] = [];
    let usage: RunResult<T>["usage"] = null;
    let errorMessage: string | null = null;

    for await (const event of events) {
      if (abortController.signal.aborted) {
        throw new Error("Request timed out");
      }
      
      if (options.abortSignal?.aborted) {
        throw new Error("Request cancelled");
      }

      if (event.type === "item.completed") {
        if (event.item.type === "agent_message") {
          messages.push(event.item.text);
        } else if (event.item.type === "error") {
          errorMessage = event.item.message;
        }
      } else if (event.type === "turn.completed") {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }
    }

    clearTimeout(timeoutId);

    if (errorMessage) {
      throw new Error(`Codex agent error: ${errorMessage}`);
    }

    // Combine all agent messages
    const finalResponse = messages.join("\n").trim();
    if (!finalResponse) {
      throw new Error("No response from Codex agent");
    }

    // Strip code fences if present
    const cleanedResponse = stripCodeFences(finalResponse);

    // Parse and validate JSON
    let parsedData: any;
    try {
      parsedData = JSON.parse(cleanedResponse);
    } catch (parseError) {
      // Try repair pass
      console.warn("Failed to parse JSON, attempting repair...");
      const repairPrompt = "Return ONLY the valid JSON from your previous response. No markdown, no code fences, no explanations. Just the raw JSON object.";
      
      const { events: repairEvents } = await thread.runStreamed(repairPrompt);
      const repairMessages: string[] = [];
      
      for await (const event of repairEvents) {
        if (event.type === "item.completed" && event.item.type === "agent_message") {
          repairMessages.push(event.item.text);
        }
      }
      
      const repairedResponse = stripCodeFences(repairMessages.join("\n").trim());
      try {
        parsedData = JSON.parse(repairedResponse);
      } catch (repairParseError) {
        throw new Error(`Failed to parse JSON even after repair. Response: ${cleanedResponse}`);
      }
    }

    // Validate with Zod
    const validationResult = schema.safeParse(parsedData);
    if (!validationResult.success) {
      const errors = validationResult.error.errors
        .map((e) => `  ${e.path.join(".")}: ${e.message}`)
        .join("\n");
      throw new Error(`Response validation failed:\n${errors}\n\nRaw data: ${JSON.stringify(parsedData, null, 2)}`);
    }

    return {
      data: validationResult.data,
      usage,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
