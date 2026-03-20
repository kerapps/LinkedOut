(() => {
  const DEBUG = false;
  const SOURCE_URL = "https://github.com/kerapps/LinkedOut";
  const PRIVACY_URL =
    "https://github.com/kerapps/LinkedOut/blob/main/PRIVACY_POLICY.md";
  const PROCESSED_ATTR = "data-linkedout";
  const RESCAN_INTERVAL_MS = 2500;
  const LOG = (...args) => {
    if (DEBUG) console.log("[LinkedOut]", ...args);
  };
  const MIN_TEXT_LEN = 80;
  const MAX_TEXT_LEN = 5000;
  const MIN_FEED_CARD_WIDTH = 300;

  let autoTranslate = false;
  let hideOriginal = false;
  let removePromoted = true;
  let scanCount = 0;
  let hudMounted = false;

  function getMainFeed() {
    return document.querySelector("main");
  }

  let keepMentionsLinks = false;

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function extractRichText(el) {
    const parts = [];
    const linkMap = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (isInjectedElement(node)) return;

      const tag = node.tagName;
      if (tag === "A") {
        const href = node.getAttribute("href") || "";
        const text = (node.innerText || "").trim();
        if (href.includes("/in/") && text) {
          const marker = `@${text}`;
          parts.push(marker);
          linkMap.push({ marker, href: href.split("?")[0], label: text, type: "mention" });
          return;
        }
        if (href && text && (href.startsWith("http") || href.startsWith("/"))) {
          parts.push(text);
          linkMap.push({ marker: text, href, label: text, type: "link" });
          return;
        }
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(el);
    return { text: normalizeText(parts.join(" ")), linkMap };
  }

  function linkifyTranslation(translation, linkMap) {
    if (!linkMap || linkMap.length === 0) return escapeHtml(translation);

    let html = escapeHtml(translation);
    for (const { marker, href, label, type } of linkMap) {
      const escapedMarker = escapeHtml(marker);
      const fullHref = href.startsWith("/") ? `https://www.linkedin.com${href}` : href;
      const linkHtml = `<a href="${escapeAttr(fullHref)}" target="_blank" rel="noopener noreferrer" class="linkedout-link ${type === "mention" ? "linkedout-mention" : ""}">${escapedMarker}</a>`;
      html = html.replace(escapedMarker, linkHtml);
    }
    return html;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function isInjectedElement(el) {
    return !!el.closest(
      ".linkedout-wrapper, .linkedout-card, .linkedout-btn, .linkedout-banner, .linkedout-loading"
    );
  }

  function findCardContainer(startEl) {
    const main = getMainFeed();
    let node = startEl;
    let bestUrn = null;
    let bestSize = null;

    for (let i = 0; i < 14 && node && node !== main; i++) {
      if (!(node instanceof HTMLElement)) { node = node.parentElement; continue; }

      const hasUrn = node.hasAttribute("data-urn");
      const rect = node.getBoundingClientRect();
      const sizeOk =
        rect.width >= 300 && rect.width <= 980 &&
        rect.height >= 120 && rect.height <= 2600;

      if (hasUrn && sizeOk && !bestUrn) bestUrn = node;
      if (sizeOk && !bestSize) bestSize = node;
      node = node.parentElement;
    }

    return bestUrn || bestSize || startEl.closest("[data-urn]") || startEl.parentElement || startEl;
  }

  function extractPostId(container) {
    const urn = container.getAttribute("data-urn");
    if (urn && urn.trim()) return urn.trim();

    const updateLink = container.querySelector("a[href*='/feed/update/']");
    if (updateLink) {
      const href = updateLink.getAttribute("href") || "";
      const urnMatch = href.match(/urn:li:activity:\d+/);
      if (urnMatch) return urnMatch[0];
      const updateMatch = href.match(/\/feed\/update\/([^/?#]+)/);
      if (updateMatch) return `feedUpdate:${updateMatch[1]}`;
    }

    const postLink = container.querySelector("a[href*='/posts/']");
    if (postLink) {
      const href = postLink.getAttribute("href") || "";
      const postMatch = href.match(/\/posts\/([^/?#]+)/);
      if (postMatch) return `post:${postMatch[1]}`;
    }

    return null;
  }

  function isLikelyFeedColumnCard(container) {
    if (!(container instanceof HTMLElement)) return false;
    const rect = container.getBoundingClientRect();
    if (rect.width < MIN_FEED_CARD_WIDTH) return false;
    if (rect.width > 980) return false;
    if (rect.height < 120) return false;
    if (rect.height > 3200) return false;

    const centerX = rect.left + rect.width / 2;
    const minCenter = window.innerWidth * 0.22;
    const maxCenter = window.innerWidth * 0.72;
    if (centerX < minCenter || centerX > maxCenter) return false;

    return true;
  }

  function isPromotedPost(container) {
    const preview = normalizeText(container.innerText || "")
      .slice(0, 420)
      .toLowerCase();
    return /\bpromoted\b|\bsponsored\b/.test(preview);
  }

  function hidePromotedPosts() {
    if (!removePromoted) return;
    const main = getMainFeed();
    if (!main) return;

    const candidates = main.querySelectorAll("div, article, section");
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.offsetParent === null) continue;

      const text = normalizeText(el.innerText || "").slice(0, 420).toLowerCase();
      if (!/\bpromoted\b|\bsponsored\b/.test(text)) continue;

      const card = findCardContainer(el);
      if (!isLikelyFeedColumnCard(card)) continue;
      card.style.display = "none";
      card.setAttribute("data-linkedout-promoted-removed", "1");
    }
  }

  function isLikelyCommentOrMetaText(el, text) {
    const lower = text.toLowerCase();

    if (el.closest("aside, nav, header, footer")) return true;
    if (el.closest("[contenteditable='true']")) return true;
    if (el.closest("form")) return true;

    if (text.length < 200) {
      if (
        /\b(see all comments|add a comment|reply|replies|respond|response)\b/.test(
          lower
        )
      ) {
        return true;
      }
    }

    if (text.length < 140 && el.querySelectorAll("a").length >= 2) {
      return true;
    }

    return false;
  }

  function collectCandidateTextElements() {
    const main = getMainFeed();
    if (!main) return [];

    const pool = main.querySelectorAll("div, span, p");
    const byContainer = new Map();

    for (const el of pool) {
      if (!(el instanceof HTMLElement)) continue;
      if (isInjectedElement(el)) continue;
      if (el.offsetParent === null) continue;
      if (el.childElementCount > 30) continue;
      if (el.querySelector("input, textarea")) continue;

      const raw = el.innerText || "";
      const text = normalizeText(raw);
      if (text.length < MIN_TEXT_LEN || text.length > MAX_TEXT_LEN) continue;

      const preview = text.slice(0, 80);

      if (isLikelyCommentOrMetaText(el, text)) {
        LOG("REJECT comment/meta:", preview);
        continue;
      }

      const buttonsNearby = el.querySelectorAll("button").length;
      if (buttonsNearby > 3) {
        LOG("REJECT buttons>3:", buttonsNearby, preview);
        continue;
      }

      const container = findCardContainer(el);
      if (!isLikelyFeedColumnCard(container)) {
        const r = container.getBoundingClientRect();
        LOG("REJECT card size:", Math.round(r.width) + "x" + Math.round(r.height), preview);
        continue;
      }
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (containerRect.height <= 0) continue;

      const relativeTop = (elRect.top - containerRect.top) / containerRect.height;
      const relativeBottom =
        (containerRect.bottom - elRect.bottom) / containerRect.height;

      if (relativeTop < 0.02 || relativeTop > 0.72) {
        LOG("REJECT relTop:", relativeTop.toFixed(3), preview);
        continue;
      }
      if (relativeBottom < 0.04) {
        LOG("REJECT relBot:", relativeBottom.toFixed(3), preview);
        continue;
      }

      const score =
        text.length -
        el.childElementCount * 3 -
        Math.abs(relativeTop - 0.28) * 180;
      const existing = byContainer.get(container);

      LOG("ACCEPT score:", score.toFixed(1), "relTop:", relativeTop.toFixed(3), preview);

      if (!existing || score > existing.score) {
        let finalText = text;
        let linkMap = [];
        if (keepMentionsLinks) {
          const rich = extractRichText(el);
          finalText = rich.text;
          linkMap = rich.linkMap;
        }
        byContainer.set(container, { container, textEl: el, text: finalText, linkMap, score });
      }
    }

    return Array.from(byContainer.values());
  }

  // --- UI Components ---

  function createTranslateButton() {
    const btn = document.createElement("button");
    btn.className = "linkedout-btn";
    btn.textContent = "Translate to Human";
    return btn;
  }

  function createTranslationCard(translation, linkMap) {
    const card = document.createElement("div");
    card.className = "linkedout-card";

    const header = document.createElement("div");
    header.className = "linkedout-card-header";
    header.innerHTML = `<span class="linkedout-label">LinkedOut</span>`;

    const toggle = document.createElement("button");
    toggle.className = "linkedout-toggle";
    toggle.textContent = "Show original";
    header.appendChild(toggle);

    const body = document.createElement("div");
    body.className = "linkedout-card-body";
    if (keepMentionsLinks && linkMap && linkMap.length > 0) {
      body.innerHTML = linkifyTranslation(translation, linkMap);
    } else {
      body.textContent = translation;
    }

    card.appendChild(header);
    card.appendChild(body);
    return { card, toggle };
  }

  function showLoading(container) {
    const spinner = document.createElement("div");
    spinner.className = "linkedout-loading";
    spinner.innerHTML =
      '<div class="linkedout-spinner"></div><span>Translating...</span>';
    container.appendChild(spinner);
    return spinner;
  }

  async function readStats() {
    const result = await chrome.storage.local.get("linkedout_stats");
    return result.linkedout_stats || { translated: 0, total_tokens: 0 };
  }

  async function refreshHudValues() {
    const hud = document.querySelector(".linkedout-hud");
    if (!hud) return;

    const settings = await LinkedOutTranslator.getSettings();
    const stats = await readStats();

    const provider = hud.querySelector("#loHudProvider");
    const tone = hud.querySelector("#loHudTone");
    const auto = hud.querySelector("#loHudAuto");
    const hide = hud.querySelector("#loHudHide");
    const promoted = hud.querySelector("#loHudPromoted");
    const keepMentions = hud.querySelector("#loHudKeepMentions");
    const key = hud.querySelector("#loHudApiKey");
    const tokens = hud.querySelector("#loHudTokens");
    const model = hud.querySelector("#loHudModel");
    const cost = hud.querySelector("#loHudCost");

    if (provider) provider.value = settings.provider;
    if (tone) tone.value = settings.tone;
    if (auto) auto.checked = !!settings.autoTranslate;
    if (hide) hide.checked = !!settings.hideOriginal;
    if (promoted) promoted.checked = settings.removePromoted !== false;
    if (keepMentions) keepMentions.checked = !!settings.keepMentionsLinks;
    if (key) key.value = settings.apiKey || "";
    if (tokens) tokens.textContent = String(stats.total_tokens || 0);
    if (model)
      model.textContent = LinkedOutConfig.modelForProvider(settings.provider);
    if (cost) {
      const rates = LinkedOutConfig.rateForProvider(settings.provider);
      const exact = Number(stats.estimated_cost_usd || 0);
      if (exact > 0) {
        cost.textContent = `$${exact.toFixed(4)}`;
      } else {
        const total = Number(stats.total_tokens || 0);
        const approx = (total / 2) * (rates.input + rates.output) / 1_000_000;
        cost.textContent = `~$${approx.toFixed(4)}`;
      }
    }
  }


  function mountHud() {
    if (hudMounted || document.querySelector(".linkedout-hud")) return;
    hudMounted = true;

    const hud = document.createElement("div");
    hud.className = "linkedout-hud";
    hud.innerHTML = `
      <button class="linkedout-hud-fab" title="LinkedOut">out</button>
      <div class="linkedout-hud-panel" aria-hidden="true">
        <div class="linkedout-hud-header">
          <strong>LinkedOut</strong>
          <span class="linkedout-hud-sub">enabled</span>
        </div>

        <div class="linkedout-hud-tabs" role="tablist" aria-label="LinkedOut panel tabs">
          <button id="loTabSettings" class="linkedout-hud-tab is-active" role="tab" aria-selected="true">Settings</button>
          <button id="loTabCompose" class="linkedout-hud-tab" role="tab" aria-selected="false">Create post</button>
        </div>

        <div id="loPanelSettings" class="linkedout-hud-tab-panel is-active" role="tabpanel">

        <div class="linkedout-hud-group">
          <label>Provider</label>
          <select id="loHudProvider">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div class="linkedout-hud-group">
          <label>Tone</label>
          <select id="loHudTone">
            <option value="blunt">Blunt</option>
            <option value="sarcastic">Sarcastic</option>
            <option value="neutral">Neutral</option>
          </select>
        </div>

        <div class="linkedout-hud-group">
          <label>API Key</label>
          <input id="loHudApiKey" type="password" placeholder="sk-..." />
        </div>

        <label class="linkedout-hud-toggle-row">
          <span class="linkedout-hud-toggle-label">Auto-translate feed</span>
          <div class="linkedout-hud-switch">
            <input id="loHudAuto" type="checkbox" />
            <span class="linkedout-hud-slider"></span>
          </div>
        </label>
        <label class="linkedout-hud-toggle-row">
          <span class="linkedout-hud-toggle-label">Hide original content</span>
          <div class="linkedout-hud-switch">
            <input id="loHudHide" type="checkbox" />
            <span class="linkedout-hud-slider"></span>
          </div>
        </label>
        <label class="linkedout-hud-toggle-row">
          <span class="linkedout-hud-toggle-label">Remove promoted posts</span>
          <div class="linkedout-hud-switch">
            <input id="loHudPromoted" type="checkbox" />
            <span class="linkedout-hud-slider"></span>
          </div>
        </label>
        <label class="linkedout-hud-toggle-row">
          <span class="linkedout-hud-toggle-label">Keep @mentions and links</span>
          <div class="linkedout-hud-switch">
            <input id="loHudKeepMentions" type="checkbox" />
            <span class="linkedout-hud-slider"></span>
          </div>
        </label>

        <div class="linkedout-hud-stats">
          <span>Tokens used:</span>
          <strong id="loHudTokens">0</strong>
        </div>
        <div class="linkedout-hud-stats">
          <span>Model used:</span>
          <strong id="loHudModel">—</strong>
        </div>
        <div class="linkedout-hud-stats">
          <span>Estimated cost:</span>
          <strong id="loHudCost">$0.0000</strong>
        </div>

        <button class="linkedout-hud-save" id="loHudSave">Save settings</button>
        <div class="linkedout-hud-save-status" id="loHudSaveStatus"></div>
        <div class="linkedout-hud-links">
          <a id="loHudSource" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">Source</a>
          <a id="loHudPrivacy" href="${PRIVACY_URL}" target="_blank" rel="noopener noreferrer">Privacy</a>
        </div>
        </div>

        <div id="loPanelCompose" class="linkedout-hud-tab-panel" role="tabpanel">
        <div class="linkedout-hud-group">
          <label>Create a post (Corpo mode)</label>
          <textarea id="loHudComposeInput" placeholder="Write your plain message..."></textarea>
        </div>
        <button class="linkedout-hud-create" id="loHudCreate">LinkedIn-ify</button>
        <div class="linkedout-hud-group">
          <textarea id="loHudComposeOutput" readonly placeholder="Corporate version appears here..."></textarea>
        </div>
        <button class="linkedout-hud-copy" id="loHudCopy">Copy output</button>
        </div>
      </div>
    `;

    document.body.appendChild(hud);

    const fab = hud.querySelector(".linkedout-hud-fab");
    const panel = hud.querySelector(".linkedout-hud-panel");
    const saveBtn = hud.querySelector("#loHudSave");
    const saveStatus = hud.querySelector("#loHudSaveStatus");
    const createBtn = hud.querySelector("#loHudCreate");
    const copyBtn = hud.querySelector("#loHudCopy");
    const outputEl = hud.querySelector("#loHudComposeOutput");
    const inputEl = hud.querySelector("#loHudComposeInput");
    const tabSettings = hud.querySelector("#loTabSettings");
    const tabCompose = hud.querySelector("#loTabCompose");
    const panelSettings = hud.querySelector("#loPanelSettings");
    const panelCompose = hud.querySelector("#loPanelCompose");
    let hudSaveTimer = null;

    const setActiveTab = (tab) => {
      const isSettings = tab === "settings";
      tabSettings.classList.toggle("is-active", isSettings);
      tabCompose.classList.toggle("is-active", !isSettings);
      tabSettings.setAttribute("aria-selected", isSettings ? "true" : "false");
      tabCompose.setAttribute("aria-selected", isSettings ? "false" : "true");
      panelSettings.classList.toggle("is-active", isSettings);
      panelCompose.classList.toggle("is-active", !isSettings);
    };

    const getHudSettings = () => ({
      provider: hud.querySelector("#loHudProvider").value,
      apiKey: hud.querySelector("#loHudApiKey").value.trim(),
      tone: hud.querySelector("#loHudTone").value,
      autoTranslate: hud.querySelector("#loHudAuto").checked,
      hideOriginal: hud.querySelector("#loHudHide").checked,
      removePromoted: hud.querySelector("#loHudPromoted").checked,
      keepMentionsLinks: hud.querySelector("#loHudKeepMentions").checked,
    });

    const saveHudSettings = async (message = "Saved") => {
      await chrome.storage.sync.set({ linkedout_settings: getHudSettings() });
      saveStatus.textContent = message;
      setTimeout(() => {
        if (saveStatus.textContent === message) saveStatus.textContent = "";
      }, 1200);
    };

    const scheduleHudAutoSave = (delayMs = 0) => {
      if (hudSaveTimer) clearTimeout(hudSaveTimer);
      hudSaveTimer = setTimeout(() => {
        saveHudSettings();
      }, delayMs);
    };

    fab.addEventListener("click", async () => {
      const open = panel.classList.toggle("is-open");
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      if (open) {
        setActiveTab("settings");
        await refreshHudValues();
      }
    });

    tabSettings.addEventListener("click", () => setActiveTab("settings"));
    tabCompose.addEventListener("click", () => setActiveTab("compose"));

    saveBtn.addEventListener("click", () => saveHudSettings("Saved"));

    ["loHudProvider", "loHudTone", "loHudAuto", "loHudHide", "loHudPromoted", "loHudKeepMentions"].forEach(
      (id) => {
        hud.querySelector(`#${id}`).addEventListener("change", () => {
          scheduleHudAutoSave(0);
        });
      }
    );
    hud.querySelector("#loHudApiKey").addEventListener("input", () => {
      scheduleHudAutoSave(500);
    });

    createBtn.addEventListener("click", async () => {
      const plainText = inputEl.value.trim();
      if (!plainText) return;

      createBtn.disabled = true;
      createBtn.textContent = "Generating...";
      try {
        const corp = await LinkedOutTranslator.linkedinize(plainText);
        outputEl.value = corp;
        await refreshHudValues();
      } catch (err) {
        outputEl.value = err.message || "Failed to generate post.";
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = "LinkedIn-ify";
      }
    });

    copyBtn.addEventListener("click", async () => {
      const text = outputEl.value.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy output";
        }, 1200);
      } catch {
        copyBtn.textContent = "Copy failed";
        setTimeout(() => {
          copyBtn.textContent = "Copy output";
        }, 1200);
      }
    });

  }

  // --- Core logic ---

  async function translatePost(postEl, textEl, text, linkMap) {
    const wrapper =
      postEl.querySelector(".linkedout-wrapper") ||
      createWrapper(postEl, textEl);

    if (wrapper.querySelector(".linkedout-card")) return;

    const existingBtn = wrapper.querySelector(".linkedout-btn");
    if (existingBtn) existingBtn.remove();

    const loading = showLoading(wrapper);

    try {
      const postId = extractPostId(postEl);
      const translation = await LinkedOutTranslator.translate(text, { postId });
      loading.remove();

      const { card, toggle } = createTranslationCard(translation, linkMap);
      wrapper.appendChild(card);

      if (hideOriginal) {
        textEl.style.display = "none";

        let showingOriginal = false;
        toggle.addEventListener("click", () => {
          showingOriginal = !showingOriginal;
          if (showingOriginal) {
            textEl.style.display = "";
            card.querySelector(".linkedout-card-body").style.display = "none";
            toggle.textContent = "Show translation";
          } else {
            textEl.style.display = "none";
            card.querySelector(".linkedout-card-body").style.display = "";
            toggle.textContent = "Show original";
          }
        });
      } else {
        toggle.style.display = "none";
      }
    } catch (err) {
      loading.remove();
      const errorEl = document.createElement("div");
      errorEl.className = "linkedout-error";
      errorEl.textContent = err.message;
      wrapper.appendChild(errorEl);
      setTimeout(() => errorEl.remove(), 5000);
    }
  }

  function createWrapper(postEl, textEl) {
    const wrapper = document.createElement("div");
    wrapper.className = "linkedout-wrapper";
    textEl.parentNode.insertBefore(wrapper, textEl.nextSibling);
    return wrapper;
  }

  function isProcessed(postEl) {
    return !!postEl.getAttribute(PROCESSED_ATTR);
  }

  function markProcessed(postEl) {
    postEl.setAttribute(PROCESSED_ATTR, "true");
  }

  function scanPosts() {
    scanCount += 1;
    hidePromotedPosts();
    const candidates = collectCandidateTextElements();
    const filteredCandidates = candidates.filter(
      (candidate) =>
        !candidates.some(
          (other) =>
            other !== candidate && other.container.contains(candidate.container)
        )
    );

    if (scanCount <= 5 || scanCount % 10 === 0) {
      LOG(
        `scan #${scanCount}: ${candidates.length} candidates, ${filteredCandidates.length} top-level`
      );
    }

    filteredCandidates.forEach(({ container, textEl, text, linkMap }) => {
      if (isProcessed(container)) return;
      if (container.querySelector(".linkedout-wrapper")) return;

      if (removePromoted && isPromotedPost(container)) {
        container.style.display = "none";
        container.setAttribute("data-linkedout-promoted-removed", "1");
        markProcessed(container);
        return;
      }

      markProcessed(container);

      if (autoTranslate) {
        translatePost(container, textEl, text, linkMap);
        return;
      }

      const wrapper = createWrapper(container, textEl);
      const btn = createTranslateButton();
      btn.addEventListener("click", () => {
        btn.remove();
        translatePost(container, textEl, text, linkMap);
      });
      wrapper.appendChild(btn);
    });
  }

  function initObserver() {
    let mutationTimer = null;
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan && !mutationTimer) {
        mutationTimer = setTimeout(() => {
          mutationTimer = null;
          scanPosts();
        }, 500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  function injectBanner() {
    if (document.querySelector(".linkedout-banner")) return;

    const banner = document.createElement("div");
    banner.className = "linkedout-banner";
    banner.innerHTML =
      '<span class="linkedout-banner-text">LinkedOut is active &mdash; auto-translating</span>';

    const dismiss = document.createElement("button");
    dismiss.className = "linkedout-banner-dismiss";
    dismiss.textContent = "\u00d7";
    dismiss.addEventListener("click", () => banner.remove());
    banner.appendChild(dismiss);

    const feed = getMainFeed() || document.body;
    feed.prepend(banner);
  }


  // --- Init ---

  async function init() {
    LOG("Initializing on", window.location.href);

    const settings = await LinkedOutTranslator.getSettings();
    autoTranslate = settings.autoTranslate;
    hideOriginal = settings.hideOriginal;
    removePromoted = settings.removePromoted !== false;
    keepMentionsLinks = !!settings.keepMentionsLinks;

    LOG("Settings:", {
      autoTranslate,
      hideOriginal,
      removePromoted,
      tone: settings.tone,
      provider: settings.provider,
      hasKey: !!settings.apiKey,
    });

    if (autoTranslate) injectBanner();
    mountHud();
    await refreshHudValues();

    // LinkedIn SDUI renders progressively — stagger initial scans
    setTimeout(scanPosts, 1500);
    setTimeout(scanPosts, 4000);
    setTimeout(scanPosts, 8000);

    initObserver();
    setInterval(scanPosts, RESCAN_INTERVAL_MS);

    let scrollTimer = null;
    window.addEventListener(
      "scroll",
      () => {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(scanPosts, 300);
      },
      { passive: true }
    );

    let reloadTimer = null;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.linkedout_settings) {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => window.location.reload(), 800);
        return;
      }

      if (area === "local" && changes.linkedout_stats) {
        refreshHudValues();
      }
    });

    LOG("Ready. Monitoring feed.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
