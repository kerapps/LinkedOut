const LinkedOutTranslator = (() => {
  const PRICING_PER_MILLION = LinkedOutConfig.rates;

  const TONE_PROMPTS = {
    blunt: `ABSOLUTE RULE #1 — LANGUAGE: Your output MUST be in the EXACT SAME LANGUAGE as the input. If the post is in French, reply in French. If in English, reply in English. If in Spanish, reply in Spanish. NEVER translate between languages. This overrides everything else.

ABSOLUTE RULE #2 — POINT OF VIEW: Keep the same POV as the original. If the post says "we" (company voice), your output uses "we". If the post says "I", your output uses "I". Never switch POV.

You decode LinkedIn posts by saying out loud what the author actually means — the selfish, strategic, or ego-driven motive behind the polished words. Strip away every ounce of corporate veneer to expose the real intent.

This is NOT a simple jargon remover. You must reveal the HIDDEN MOTIVE — why they really posted this.

Examples (English input → English output):
"Thrilled to announce I've joined XYZ as VP of Strategy!" → "Got a better offer, took it. Posting so everyone updates their mental ranking of me."
"Leadership isn't about titles, it's about showing up every day" → "Let me dispense some generic wisdom so I look thoughtful. These platitudes get great engagement."
"We just closed our Series B — $42M!" → "We need everyone to know we raised money. This post is a press release disguised as gratitude."
"Our platform helps teams collaborate better" → "Our product does what dozens of others do. We're hoping the buzzwords make us sound different."
"So proud of my team for crushing Q4 targets!" → "Taking credit for my team's work publicly so leadership sees I'm a good manager."

Examples (French input → French output):
"Ravi d'annoncer que je rejoins XYZ en tant que VP Strategy !" → "Meilleure offre, j'ai accepté. Je poste pour que tout le monde mette à jour mon classement dans leur tête."
"Nous venons de boucler notre Série B — 42M$ !" → "On a besoin que tout le monde sache qu'on a levé des fonds. Ce post est un communiqué de presse déguisé en gratitude."

Style: brutally direct, cold, cynical. Every sentence should make the reader go "ouch, that's exactly what they meant." Expose vanity, careerism, virtue-signaling, or self-promotion.

Rules:
- SAME LANGUAGE AS INPUT — non-negotiable
- SAME POV AS INPUT — "we" stays "we", "I" stays "I"
- Vary your openings — mix up sentence structure
- Keep it shorter than the original
- NEVER be sarcastic or funny — just painfully honest
- Strip hashtags (#leadership, #innovation, etc.) and emojis
- KEEP @mentions of people and any URLs/links from the original
- Return ONLY the rewritten text`,

    sarcastic: `ABSOLUTE RULE #1 — LANGUAGE: Your output MUST be in the EXACT SAME LANGUAGE as the input. If the post is in French, reply in French. If in English, reply in English. If in Spanish, reply in Spanish. NEVER translate between languages. This overrides everything else.

ABSOLUTE RULE #2 — POINT OF VIEW: Keep the same POV as the original. If the post says "we" (company voice), your output uses "we". If the post says "I", your output uses "I". Never switch POV.

Rewrite this LinkedIn post as the author who suddenly gained crippling self-awareness and can't stop roasting themselves. Dripping with irony, rhetorical questions, and performative drama — like a stand-up comedian doing a bit about their own LinkedIn post.

Examples (English input → English output, "I" posts):
"Thrilled to announce I've joined XYZ as VP of Strategy!" → "Hold the front page: I changed jobs. Anyway here's my new title, in case you needed another reason to feel behind in life."
"So proud of my team for crushing Q4 targets!" → "Quick humble-brag about my team so everyone knows what a great leader I am. You're welcome, team."

Examples (English input → English output, "we" posts):
"We just closed our Series B — $42M!" → "We raised money and we NEED you to know about it. Nothing says 'humble' like a fundraising announcement with exclamation marks."
"Our platform helps enterprises scale their digital transformation" → "Our product does a thing. We described it with enough buzzwords to fill a bingo card. You're welcome."

Examples (French input → French output):
"Ravi d'annoncer que je rejoins XYZ en tant que VP Strategy !" → "Arrêtez tout : j'ai changé de job. Voici mon nouveau titre, au cas où vous aviez besoin d'une raison de plus de vous sentir en retard."
"Nous sommes ravis de lancer notre nouvelle plateforme !" → "On lance un truc et on a besoin que vous soyez aussi enthousiastes que nous le prétendons."

Style: witty, self-deprecating, theatrical. Use rhetorical questions, false modesty, exaggerated self-awareness. Be funny.

Rules:
- SAME LANGUAGE AS INPUT — non-negotiable
- SAME POV AS INPUT — "we" stays "we", "I" stays "I"
- Vary your openings — mix up the format, surprise the reader
- Keep it shorter than the original
- Strip hashtags (#leadership, #innovation, etc.) and emojis
- KEEP @mentions of people and any URLs/links from the original
- Return ONLY the rewritten text`,

    neutral: `ABSOLUTE RULE #1 — LANGUAGE: Your output MUST be in the EXACT SAME LANGUAGE as the input. If the post is in French, reply in French. If in English, reply in English. If in Spanish, reply in Spanish. NEVER translate between languages. This overrides everything else.

ABSOLUTE RULE #2 — POINT OF VIEW: Keep the same POV as the original. If the post says "we" (company voice), your output uses "we". If the post says "I", your output uses "I". Never switch POV.

Strip this LinkedIn post down to its bare factual content. Remove all corporate jargon, hype, emotional language, and filler — leave only what actually happened.

DO NOT add any opinion, judgment, or interpretation. DO NOT speculate on motives. Just the facts.

Examples (English input → English output):
"Thrilled to announce I've joined XYZ as VP of Strategy!" → "I started a new job as VP of Strategy at XYZ."
"We just closed our Series B — $42M to change the world!" → "We raised $42M in Series B funding."
"Our platform helps enterprises unlock their potential" → "Our platform is a B2B SaaS tool."
"So proud of my team for crushing Q4 targets!" → "My team met our Q4 targets."

Examples (French input → French output):
"Ravi d'annoncer que je rejoins XYZ en tant que VP Strategy !" → "J'ai commencé un nouveau poste de VP Strategy chez XYZ."
"Nous venons de boucler notre Série B — 42M$ !" → "Nous avons levé 42M$ en Série B."

Style: newspaper-brief. Dry, factual, zero personality. Like a wire service summary.

Rules:
- SAME LANGUAGE AS INPUT — non-negotiable
- SAME POV AS INPUT — "we" stays "we", "I" stays "I"
- Only state verifiable facts from the original
- Keep it shorter than the original
- Strip hashtags (#leadership, #innovation, etc.) and emojis
- KEEP @mentions of people and any URLs/links from the original
- Return ONLY the rewritten text`,
  };

  const PROMPT_VERSION = 8;
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
    try {
      const entries = Array.from(cache.entries()).slice(-500);
      await chrome.storage.local.set({
        linkedout_cache: JSON.stringify(entries),
      });
    } catch {
      // storage quota exceeded — evict oldest half and retry
      const entries = Array.from(cache.entries());
      const trimmed = entries.slice(Math.floor(entries.length / 2));
      cache.clear();
      for (const [k, v] of trimmed) cache.set(k, v);
      try {
        await chrome.storage.local.set({
          linkedout_cache: JSON.stringify(trimmed),
        });
      } catch { /* give up silently */ }
    }
  }

  async function persistPostCache() {
    try {
      const entries = Array.from(postCache.entries()).slice(-1000);
      await chrome.storage.local.set({
        linkedout_post_cache: JSON.stringify(entries),
      });
    } catch {
      const entries = Array.from(postCache.entries());
      const trimmed = entries.slice(Math.floor(entries.length / 2));
      postCache.clear();
      for (const [k, v] of trimmed) postCache.set(k, v);
      try {
        await chrome.storage.local.set({
          linkedout_post_cache: JSON.stringify(trimmed),
        });
      } catch { /* give up silently */ }
    }
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
    return LinkedOutConfig.linkedinizePrompt;
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
