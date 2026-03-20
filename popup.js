const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  provider: "openai",
  apiKey: "",
  tone: "blunt",
  autoTranslate: false,
  hideOriginal: false,
  removePromoted: true,
  keepMentionsLinks: false,
};

function modelForProvider(provider) {
  return LinkedOutConfig.modelForProvider(provider);
}

function rateForProvider(provider) {
  return LinkedOutConfig.rateForProvider(provider);
}

function formatUsd(value, approximate = false) {
  const num = Number.isFinite(value) ? value : 0;
  return `${approximate ? "~" : ""}$${num.toFixed(4)}`;
}

function estimatedCostFromStats(stats, provider) {
  if ((stats.estimated_cost_usd || 0) > 0) {
    return { value: stats.estimated_cost_usd, approximate: false };
  }
  const rates = rateForProvider(provider);
  const total = stats.total_tokens || 0;
  // Fallback approximation when we only have total tokens.
  const approx = (total / 2) * (rates.input + rates.output) / 1_000_000;
  return { value: approx, approximate: true };
}

let saveTimer = null;

function readSettingsFromForm() {
  return {
    provider: $("provider").value,
    apiKey: $("apiKey").value,
    tone: $("tone").value,
    autoTranslate: $("autoTranslate").checked,
    hideOriginal: $("hideOriginal").checked,
    removePromoted: $("removePromoted").checked,
    keepMentionsLinks: $("keepMentionsLinks").checked,
  };
}

function showSavedStatus(message = "Saved!") {
  const status = $("saveStatus");
  status.textContent = message;
  setTimeout(() => {
    if (status.textContent === message) {
      status.textContent = "";
    }
  }, 1200);
}

function showCreateStatus(message = "", isError = false) {
  const el = $("createStatus");
  el.textContent = message;
  el.style.color = isError ? "#ef4444" : "#22c55e";
  if (!message) return;
  setTimeout(() => {
    if (el.textContent === message) el.textContent = "";
  }, 2000);
}

async function loadSettings() {
  const result = await chrome.storage.sync.get("linkedout_settings");
  const settings = { ...DEFAULTS, ...result.linkedout_settings };

  $("provider").value = settings.provider;
  $("apiKey").value = settings.apiKey;
  $("tone").value = settings.tone;
  $("autoTranslate").checked = settings.autoTranslate;
  $("hideOriginal").checked = settings.hideOriginal;
  $("removePromoted").checked = settings.removePromoted;
  $("keepMentionsLinks").checked = !!settings.keepMentionsLinks;
  $("statModelUsed").textContent = modelForProvider(settings.provider);
}

async function saveSettings() {
  const settings = readSettingsFromForm();
  await chrome.storage.sync.set({ linkedout_settings: settings });
  $("statModelUsed").textContent = modelForProvider(settings.provider);
  await loadStats();
  showSavedStatus();
}

async function updateStatsFromUsage(provider, usage) {
  const result = await chrome.storage.local.get("linkedout_stats");
  const current = result.linkedout_stats || {};
  const input = usage.inputTokens || 0;
  const output = usage.outputTokens || 0;
  const total = usage.usageTokens || input + output;
  const rates = rateForProvider(provider);
  const cost =
    (input * rates.input + output * rates.output) / 1_000_000;

  const next = {
    translated: (current.translated || 0) + 1,
    total_tokens: (current.total_tokens || 0) + total,
    input_tokens: (current.input_tokens || 0) + input,
    output_tokens: (current.output_tokens || 0) + output,
    estimated_cost_usd: (current.estimated_cost_usd || 0) + cost,
    last_updated: Date.now(),
  };
  await chrome.storage.local.set({ linkedout_stats: next });
}

async function loadStats() {
  const settings = readSettingsFromForm();
  const result = await chrome.storage.local.get("linkedout_stats");
  const stats = result.linkedout_stats || {
    translated: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
  };
  $("statTranslated").textContent = stats.translated;
  $("statTokens").textContent = stats.total_tokens || 0;
  const estimated = estimatedCostFromStats(stats, settings.provider);
  $("statEstimatedCost").textContent = formatUsd(
    estimated.value,
    estimated.approximate
  );
}

async function createCorporatePost() {
  const settings = readSettingsFromForm();
  const input = $("createInput").value.trim();
  if (!input) {
    showCreateStatus("Add some text first.", true);
    return;
  }
  if (!settings.apiKey) {
    showCreateStatus("Set your API key first.", true);
    return;
  }

  $("createBtn").disabled = true;
  $("createBtn").textContent = "Generating...";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "TRANSLATE",
      payload: {
        provider: settings.provider,
        apiKey: settings.apiKey,
        systemPrompt: LinkedOutConfig.linkedinizePrompt,
        postText: input,
      },
    });

    if (!res?.success) {
      throw new Error(res?.error || "Request failed");
    }

    $("createOutput").value = (res.translation || "").trim();
    await updateStatsFromUsage(settings.provider, res);
    await loadStats();
    showCreateStatus("Created.");
  } catch (error) {
    showCreateStatus(error.message || "Generation failed.", true);
  } finally {
    $("createBtn").disabled = false;
    $("createBtn").textContent = "LinkedIn-ify";
  }
}

async function copyCorporatePost() {
  const value = $("createOutput").value.trim();
  if (!value) {
    showCreateStatus("Nothing to copy yet.", true);
    return;
  }
  await navigator.clipboard.writeText(value);
  showCreateStatus("Copied.");
}

function scheduleAutoSave(delayMs = 0) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettings();
  }, delayMs);
}

$("saveBtn").addEventListener("click", saveSettings);
$("createBtn").addEventListener("click", createCorporatePost);
$("copyCreateOutputBtn").addEventListener("click", copyCorporatePost);

$("toggleKeyVisibility").addEventListener("click", () => {
  const input = $("apiKey");
  input.type = input.type === "password" ? "text" : "password";
});

// Auto-save settings changes.
["provider", "tone", "autoTranslate", "hideOriginal", "removePromoted", "keepMentionsLinks"].forEach(
  (id) => {
    $(id).addEventListener("change", () => scheduleAutoSave(0));
  }
);

// Debounce API key typing.
$("apiKey").addEventListener("input", () => scheduleAutoSave(500));

loadSettings().then(loadStats);
