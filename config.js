const LinkedOutConfig = {
  models: {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-latest",
  },

  rates: {
    openai: { input: 0.15, output: 0.6 },
    anthropic: { input: 1.0, output: 5.0 },
  },

  modelForProvider(provider) {
    return this.models[provider] || this.models.openai;
  },

  rateForProvider(provider) {
    return this.rates[provider] || this.rates.openai;
  },

  linkedinizePrompt: `ABSOLUTE RULE #1 — LANGUAGE: Your output MUST be in the EXACT SAME LANGUAGE as the input. If the text is in French, reply in French. If in English, reply in English. NEVER translate between languages. This overrides everything else.

Rewrite this plain text into polished LinkedIn corporate-speak. Write in first person.

Rules:
- SAME LANGUAGE AS INPUT — this is non-negotiable
- Keep the core meaning of the original text
- Sound upbeat, professional, and slightly self-promotional
- Use concise, readable language
- You may add 1-2 tasteful hashtags at the end
- Do NOT invent facts
- Return ONLY the rewritten post text`,
};
