/**
 * =================================================================================
 * Project: stockai-2api-bun
 * Runtime: Bun v1.0+
 * Description: High-performance OpenAI-compatible API Gateway for StockAI
 * Features: Fake IP, Env Config, Stream/Non-stream, DeepSeek/Thinking Support
 * Updated: Precision Parsing for 'reasoning-delta'
 * =================================================================================
 */

// Load environment variables
const PORT = process.env.PORT || 3000;
const API_MASTER_KEY = process.env.API_KEY || "sk-stockai-free";
const TIMEOUT_MS = 300000; // 5 minutes for thinking models

// Upstream Configuration
const UPSTREAM = {
  ORIGIN: "https://free.stockai.trade",
  API_URL: "https://free.stockai.trade/api/chat",
  BASE_HEADERS: {
    "authority": "free.stockai.trade",
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "origin": "https://free.stockai.trade",
    "referer": "https://free.stockai.trade/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "priority": "u=1, i"
  },
  MODELS: [
    "openai/gpt-4o-mini",
    "stockai/news",
    "arcee-ai/trinity-mini",
    "deepcogito/cogito-v2.1-671b",
    "deepseek/deepseek-chat-v3.1",
    "google/gemini-2.0-flash",
    "google/gemini-3-pro",
    "google/gemini-3-pro-backup",
    "z-ai/glm-4.5-air",
    "z-ai/glm-4.6",
    "moonshotai/kimi-k2",
    "moonshotai/kimi-k2-thinking",
    "meta/llama-4-scout",
    "meituan/longcat-flash-chat",
    "meituan/longcat-flash-chat-search",
    "mistral/mistral-small",
    "openai/gpt-oss-20b",
    "qwen/qwen3-coder",
    "alibaba/tongyi-deepresearch-30b-a3b"
  ],
  DEFAULT_MODEL: "openai/gpt-4o-mini"
};

// --- Helpers ---
function generateRandomIP() {
  const r = () => Math.floor(Math.random() * 255);
  return `${r()}.${r()}.${r()}.${r()}`;
}

function getUpstreamHeaders() {
  const fakeIp = generateRandomIP();
  return {
    ...UPSTREAM.BASE_HEADERS,
    "X-Forwarded-For": fakeIp,
    "X-Real-IP": fakeIp,
    "Client-IP": fakeIp,
  };
}

function generateRandomId(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// --- Main Server ---
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const authHeader = req.headers.get('Authorization');
    if (API_MASTER_KEY !== "1" && authHeader !== `Bearer ${API_MASTER_KEY}`) {
      return new Response(JSON.stringify({ error: { message: "Unauthorized", code: 401 } }), { 
        status: 401, 
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } 
      });
    }

    try {
      if (url.pathname === '/v1/models') return handleModels();
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') return await handleChatCompletions(req);
      return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: CORS_HEADERS });
    } catch (e) {
      console.error(`[Server Error] ${e.message}`);
      return new Response(JSON.stringify({ error: { message: e.message, type: "internal_error" } }), { 
        status: 500, 
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } 
      });
    }
  }
});

console.log(`🚀 StockAI-2API running on port ${PORT}`);
console.log(`🧠 Thinking Support Enabled (Parsing 'reasoning-delta')`);

// --- Handlers ---

function handleModels() {
  const data = {
    object: 'list',
    data: UPSTREAM.MODELS.map(id => ({
      id: id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'stockai-2api',
    })),
  };
  return new Response(JSON.stringify(data), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

async function handleChatCompletions(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    throw new Error("Invalid JSON body");
  }

  const model = body.model || UPSTREAM.DEFAULT_MODEL;
  const stream = body.stream === true;
  const messages = body.messages || [];

  // Sanitize Input
  const validMessages = messages
    .filter(m => m && m.role)
    .map(msg => {
        let contentStr = "";
        if (typeof msg.content === 'string') contentStr = msg.content;
        else if (Array.isArray(msg.content)) contentStr = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
        else if (msg.content) contentStr = String(msg.content);
        
        return {
            parts: [{ type: "text", text: contentStr }],
            id: generateRandomId(16),
            role: msg.role
        };
    });

  if (validMessages.length === 0) throw new Error("No valid messages provided.");

  const payload = {
    model: model,
    webSearch: false,
    id: generateRandomId(16),
    messages: validMessages,
    trigger: "submit-message"
  };

  // Setup Timeout Controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let upstreamRes;
  try {
      upstreamRes = await fetch(UPSTREAM.API_URL, {
        method: "POST",
        headers: getUpstreamHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal
      });
  } catch (err) {
      clearTimeout(timeoutId);
      throw new Error(err.name === 'AbortError' ? 'Upstream Timeout (Thinking took too long)' : err.message);
  } finally {
      clearTimeout(timeoutId);
  }

  if (!upstreamRes.ok) {
    const errText = await upstreamRes.text();
    throw new Error(`Upstream Error (${upstreamRes.status}): ${errText.substring(0, 200)}`);
  }

  const requestId = `chatcmpl-${generateRandomId()}`;
  const created = Math.floor(Date.now() / 1000);

  // --- Parser Logic based on User Logs ---
  const parseUpstreamChunk = (data) => {
    // 1. Thinking Process
    if (data.type === 'reasoning-delta' && data.delta) {
        return { type: 'reasoning', content: data.delta };
    }
    // 2. Final Answer
    if (data.type === 'text-delta' && data.delta) {
        return { type: 'content', content: data.delta };
    }
    return null;
  };

  // --- Stream Handler ---
  if (stream) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const customStream = new ReadableStream({
        async start(controller) {
            const reader = upstreamRes.body.getReader();
            let buffer = "";
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6).trim();
                            if (!dataStr || dataStr === '[DONE]') continue;

                            try {
                                const data = JSON.parse(dataStr);
                                const parsed = parseUpstreamChunk(data);
                                
                                if (parsed) {
                                    const chunkDelta = {};
                                    if (parsed.type === 'content') chunkDelta.content = parsed.content;
                                    if (parsed.type === 'reasoning') chunkDelta.reasoning_content = parsed.content;

                                    if (Object.keys(chunkDelta).length === 0) continue;

                                    const chunk = {
                                        id: requestId,
                                        object: "chat.completion.chunk",
                                        created: created,
                                        model: model,
                                        choices: [{ index: 0, delta: chunkDelta, finish_reason: null }]
                                    };
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                                }
                            } catch (e) { }
                        }
                    }
                }
                
                const endChunk = {
                    id: requestId,
                    object: "chat.completion.chunk",
                    created: created,
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (err) {
                const errChunk = { error: { message: err.message, type: "stream_error" } };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
            } finally {
                controller.close();
            }
        }
    });

    return new Response(customStream, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' }
    });
  }

  // --- Non-Stream Handler ---
  else {
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let fullReasoning = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
                const data = JSON.parse(dataStr);
                const parsed = parseUpstreamChunk(data);
                if (parsed) {
                    if (parsed.type === 'content') fullText += parsed.content;
                    if (parsed.type === 'reasoning') fullReasoning += parsed.content;
                }
            } catch (e) {}
        }
      }
    }

    // Wrap reasoning in <think> for non-stream clients
    let finalContent = fullText;
    if (fullReasoning) {
        finalContent = `<think>\n${fullReasoning}\n</think>\n\n${fullText}`;
    }

    const response = {
      id: requestId,
      object: "chat.completion",
      created: created,
      model: model,
      choices: [{
        index: 0,
        message: { 
            role: "assistant", 
            content: finalContent,
            reasoning_content: fullReasoning 
        },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };

    return new Response(JSON.stringify(response), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}
