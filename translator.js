const LinkedOutTranslator = (() => {
  const PRICING_PER_MILLION = {
    openai: { input: 0.15, output: 0.6 }, // gpt-4o-mini
    anthropic: { input: 1.0, output: 5.0 }, // claude haiku tier
  };

  const TONE_PROMPTS = {
    blunt: `You rewrite LinkedIn posts as if the author suddenly became brutally honest about their real motivation. Write in FIRST PERSON — you are rewriting the post as the same person, just without the filter.

Example:
Original: "Thrilled to announce I've joined XYZ as VP of Strategy!"
Rewrite: "I got a new job and I need everyone to know how important I am now."

Rules:
- Always write in first person, as the author being honest
- Expose the real intent: self-promotion, humble-bragging, selling, clout-chasing, virtue signaling
- Be ruthlessly direct — say the quiet part out loud
- Strip all buzzwords, jargon, and hollow enthusiasm
- Keep it shorter than the original
- Never add hashtags or emojis
- Reply in the SAME language as the input (EN→EN, FR→FR, ES→ES — never switch)
- Return ONLY the rewritten text`,

    sarcastic: `You rewrite LinkedIn posts as if the author had a sarcastic inner voice that couldn't help slipping out. Write in FIRST PERSON with dry wit and irony — the author is saying what they really mean, but dripping with self-aware sarcasm.

Example:
Original: "Thrilled to announce I've joined XYZ as VP of Strategy!"
Rewrite: "I changed jobs and obviously the world needed to know. Please clap."

Rules:
- Always write in first person, as the author with a sarcastic inner voice
- Use irony, deadpan humor, and self-aware commentary
- Make it funny — expose the absurdity of corporate LinkedIn culture
- Keep it shorter than the original
- Never add hashtags or emojis
- Reply in the SAME language as the input (EN→EN, FR→FR, ES→ES — never switch)
- Return ONLY the rewritten text`,

    neutral: `You rewrite LinkedIn posts in plain, clear language without any corporate jargon. Write in FIRST PERSON — same author, same message, just stated simply and directly.

Example:
Original: "Thrilled to announce I've joined XYZ as VP of Strategy!"
Rewrite: "I started a new job as VP of Strategy at XYZ."

Rules:
- Always write in first person, as the author speaking plainly
- Replace all corporate speak with straightforward language
- Keep the facts, remove the hype
- Neutral, matter-of-fact tone — no judgment, no snark
- Keep it shorter than the original
- Never add hashtags or emojis
- Reply in the SAME language as the input (EN→EN, FR→FR, ES→ES — never switch)
- Return ONLY the rewritten text`,
  };

  const PROMPT_VERSION = 3;
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
