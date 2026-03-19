const LinkedOutTranslator = (() => {
  const PRICING_PER_MILLION = {
    openai: { input: 0.15, output: 0.6 }, // gpt-4o-mini
    anthropic: { input: 1.0, output: 5.0 }, // claude haiku tier
  };

  const TONE_PROMPTS = {
    blunt: `Rewrite this LinkedIn post in first person as the author dropping all pretense. Flat, cold, zero humor — just the uncomfortable truth stated plainly, like someone with no social filter.

Examples:
"Thrilled to announce I've joined XYZ as VP of Strategy!" → "New job. Here's my title so you know I'm important."
"Our adversaries adopt technology faster than industry" → "We're losing and our product might help, so buy it."
"So proud of my team for crushing Q4 targets!" → "My team hit their numbers. I'm posting so leadership sees this."

Style: short, blunt, factual. No snark, no jokes, no sarcasm. Just the raw truth.

Rules:
- First person always — you ARE the author
- Vary your openings — don't always start with "I"
- Keep it shorter than the original
- No hashtags or emojis
- Same language as input (EN→EN, FR→FR, ES→ES — never switch)
- Return ONLY the rewritten text`,

    sarcastic: `Rewrite this LinkedIn post in first person as the author who suddenly gained crippling self-awareness and can't stop roasting themselves. Dripping with irony, rhetorical questions, and performative drama — like a stand-up comedian doing a bit about their own LinkedIn post.

Examples:
"Thrilled to announce I've joined XYZ as VP of Strategy!" → "Hold the front page: I changed jobs. Anyway here's my new title, in case you needed another reason to feel behind in life."
"Our adversaries adopt technology faster than industry" → "Scary stat time! Our competitors are faster than us, which is totally not a sales pitch for the product I'm about to mention."
"So proud of my team for crushing Q4 targets!" → "Quick humble-brag about my team so everyone knows what a great leader I am. You're welcome, team."

Style: witty, self-deprecating, theatrical. Use rhetorical questions, false modesty, exaggerated self-awareness. Be funny.

Rules:
- First person always — you ARE the author roasting yourself
- Vary your openings — mix up the format, surprise the reader
- Keep it shorter than the original
- No hashtags or emojis
- Same language as input (EN→EN, FR→FR, ES→ES — never switch)
- Return ONLY the rewritten text`,

    neutral: `Rewrite this LinkedIn post in first person as the same author, just stating the facts plainly without any corporate jargon or hype.

Examples:
"Thrilled to announce I've joined XYZ as VP of Strategy!" → "I started a new job as VP of Strategy at XYZ."
"Our adversaries adopt technology faster than industry" → "Cyber threats are evolving fast. Our product automates SOC detection and response."
"So proud of my team for crushing Q4 targets!" → "My team exceeded our Q4 goals."

Style: factual, calm, concise. No judgment, no snark, no flair.

Rules:
- First person always — you ARE the author
- Keep facts, remove hype
- Keep it shorter than the original
- No hashtags or emojis
- Same language as input (EN→EN, FR→FR, ES→ES — never switch)
- Return ONLY the rewritten text`,
  };

  const PROMPT_VERSION = 4;
  const cache = new Map();
  const postCache = new Map();

  async function hashText(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function loadCache() {
    try {
      const result = await chrome.storage.local.get("linkedout_cache");
      if (result.linkedout_cache) {
        const entries = JSON.parse(result.linkedout_cache);
        for (const [k, v] of entries) {
          cache.set(k, v);
        }
      }
    } catch {
      // cache miss is fine
    }
  }

  async function loadPostCache() {
    try {
      const result = await chrome.storage.local.get("linkedout_post_cache");
      if (result.linkedout_post_cache) {
        const entries = JSON.parse(result.linkedout_post_cache);
        for (const [k, v] of entries) {
          postCache.set(k, v);
        }
      }
    } catch {
      // post cache miss is fine
    }
  }

  async function persistCache() {
    const entries = Array.from(cache.entries()).slice(-500); // keep last 500
    await chrome.storage.local.set({
      linkedout_cache: JSON.stringify(entries),
    });
  }

  async function persistPostCache() {
    const entries = Array.from(postCache.entries()).slice(-1000);
    await chrome.storage.local.set({
      linkedout_post_cache: JSON.stringify(entries),
    });
  }

  async function getSettings() {
    const defaults = {
      provider: "openai",
      apiKey: "",
      tone: "blunt",
      autoTranslate: false,
      hideOriginal: false,
      removePromoted: true,
    };
    const result = await chrome.storage.sync.get("linkedout_settings");
    return { ...defaults, ...result.linkedout_settings };
  }

  function linkedinSpeakPrompt() {
    return `You are a LinkedIn corporate messaging assistant. Transform plain, honest text into polished LinkedIn-style corporate speak.

CRITICAL LANGUAGE RULE — you MUST follow this:
Your output MUST be in the EXACT SAME language as the input. English in → English out. French in → French out. NEVER switch languages.

Other rules:
- Keep the core meaning of the original text
- Sound upbeat, professional, and slightly self-promotional
- Use concise, readable language
- You may add 1-2 tasteful hashtags at the end
- Do NOT invent facts
- Return ONLY the rewritten post text`;
  }

  function humanTranslatePrompt(tone) {
    return TONE_PROMPTS[tone] || TONE_PROMPTS.blunt;
  }

  async function sendToProvider({
    provider,
    apiKey,
    systemPrompt,
    postText,
  }) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "TRANSLATE",
          payload: {
            provider,
            apiKey,
            systemPrompt,
            postText,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.success) {
            reject(new Error(response?.error || "Translation failed"));
            return;
          }

          resolve({
            text: response.translation,
            usageTokens: response.usageTokens || 0,
            inputTokens: response.inputTokens || 0,
            outputTokens: response.outputTokens || 0,
          });
        }
      );
    });
  }

  function calculateCostUSD(provider, inputTokens, outputTokens) {
    const rates = PRICING_PER_MILLION[provider] || PRICING_PER_MILLION.openai;
    return (
      (inputTokens * rates.input) / 1_000_000 +
      (outputTokens * rates.output) / 1_000_000
    );
  }

  async function translate(postText, options = {}) {
    const settings = await getSettings();

    if (!settings.apiKey) {
      throw new Error(
        "No API key configured. Click the LinkedOut icon to set one up."
      );
    }

    const tone = settings.tone || "blunt";
    const textHash = await hashText(postText);
    const cacheKey = await hashText(`v${PROMPT_VERSION}:${tone}:${postText}`);
    const postId = options.postId || null;

    if (postId) {
      const postCacheKey = `v${PROMPT_VERSION}:${tone}:${postId}`;
      const postEntry = postCache.get(postCacheKey);
      if (postEntry && postEntry.textHash === textHash) {
        return postEntry.translation;
      }
    }

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const systemPrompt = humanTranslatePrompt(tone);
    const result = await sendToProvider({
      provider: settings.provider,
      apiKey: settings.apiKey,
      systemPrompt,
      postText,
    });

    cache.set(cacheKey, result.text);
    persistCache();

    if (postId) {
      const postCacheKey = `v${PROMPT_VERSION}:${tone}:${postId}`;
      postCache.set(postCacheKey, {
        translation: result.text,
        textHash,
        updatedAt: Date.now(),
      });
      persistPostCache();
    }

    updateStats({
      translatedInc: 1,
      tokensInc: result.usageTokens,
      inputTokensInc: result.inputTokens,
      outputTokensInc: result.outputTokens,
      costIncUSD: calculateCostUSD(
        settings.provider,
        result.inputTokens,
        result.outputTokens
      ),
    });
    return result.text;
  }

  async function linkedinize(text) {
    const settings = await getSettings();
    if (!settings.apiKey) {
      throw new Error(
        "No API key configured. Click the LinkedOut icon to set one up."
      );
    }

    const cacheKey = await hashText(`v${PROMPT_VERSION}:linkedinize:${text}`);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const result = await sendToProvider({
      provider: settings.provider,
      apiKey: settings.apiKey,
      systemPrompt: linkedinSpeakPrompt(),
      postText: text,
    });

    cache.set(cacheKey, result.text);
    persistCache();
    updateStats({
      tokensInc: result.usageTokens,
      inputTokensInc: result.inputTokens,
      outputTokensInc: result.outputTokens,
      costIncUSD: calculateCostUSD(
        settings.provider,
        result.inputTokens,
        result.outputTokens
      ),
    });
    return result.text;
  }

  async function updateStats({
    translatedInc = 0,
    tokensInc = 0,
    inputTokensInc = 0,
    outputTokensInc = 0,
    costIncUSD = 0,
  } = {}) {
    const result = await chrome.storage.local.get("linkedout_stats");
    const stats = result.linkedout_stats || {
      translated: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      session_start: Date.now(),
    };
    stats.translated += translatedInc;
    stats.total_tokens = (stats.total_tokens || 0) + tokensInc;
    stats.input_tokens = (stats.input_tokens || 0) + inputTokensInc;
    stats.output_tokens = (stats.output_tokens || 0) + outputTokensInc;
    stats.estimated_cost_usd = (stats.estimated_cost_usd || 0) + costIncUSD;
    await chrome.storage.local.set({ linkedout_stats: stats });
  }

  loadCache();
  loadPostCache();

  return { translate, linkedinize, getSettings, TONE_PROMPTS };
})();
