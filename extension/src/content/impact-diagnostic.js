(function impactDiagnostic() {
  if (window.__impactCompanionDiagnosticLoaded) {
    return;
  }

  window.__impactCompanionDiagnosticLoaded = true;

  const STORAGE_KEYS = {
    allowedOrigins: "impact.allowedOrigins",
    selectorConfig: "impact.selectorConfig",
    autoPublish: "impact.autoPublish",
    lastSnapshot: "impact.lastSnapshot"
  };

  let pickerState = null;
  let lastAutoPublishFingerprint = "";
  let autoPublishTimer = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "impact/getSnapshot") {
      getSnapshot()
        .then((snapshot) => sendResponse({ ok: true, snapshot }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "impact/startPicker") {
      startPicker()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "impact/stopPicker") {
      stopPicker();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  startAutoPublishWatcher();

  async function getSnapshot() {
    const config = await getSelectorConfig();
    const allowed = await isOriginAllowed();
    const localLeadPreview = allowed ? collectLocalLeadPreview() : null;
    const prefetchedNextLead = localLeadPreview?.available ? await prefetchNextLead() : null;
    if (localLeadPreview?.available && prefetchedNextLead?.available) {
      localLeadPreview.nextLead = prefetchedNextLead;
    }
    const snapshot = {
      capturedAt: new Date().toISOString(),
      url: scrubCurrentUrl(),
      origin: location.origin,
      title: document.title,
      readyState: document.readyState,
      allowedOrigin: allowed,
      leadPageDetected: allowed && matchesLeadPageHints(config),
      localLeadPreview,
      prefetchedNextLead,
      fields: allowed ? readConfiguredFields(config) : [],
      pageSignals: allowed ? collectPageSignals() : collectMinimalPageSignals(),
      warnings: []
    };

    if (!allowed) {
      snapshot.warnings.push("This origin is not in the extension allowlist. Add it in Options before collecting field data.");
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.lastSnapshot]: snapshot });
    await log("info", "snapshot.captured", {
      allowedOrigin: snapshot.allowedOrigin,
      leadPageDetected: snapshot.leadPageDetected,
      fieldCount: snapshot.fields.length
    });
    return snapshot;
  }

  async function getSelectorConfig() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.selectorConfig);
    return result[STORAGE_KEYS.selectorConfig] || window.IMPACT_DEFAULT_SELECTOR_CONFIG;
  }

  async function isOriginAllowed() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.allowedOrigins);
    const allowedOrigins = result[STORAGE_KEYS.allowedOrigins] || window.IMPACT_DEFAULT_ALLOWED_ORIGINS || [];
    return allowedOrigins.includes(location.origin);
  }

  function matchesLeadPageHints(config) {
    const urlHints = config?.leadPageHints?.urlIncludes || [];
    const titleHints = config?.leadPageHints?.titleIncludes || [];
    const hasHints = urlHints.length > 0 || titleHints.length > 0;
    if (!hasHints) {
      return false;
    }

    const urlMatch = urlHints.some((hint) => hint && location.href.includes(hint));
    const titleMatch = titleHints.some((hint) => hint && document.title.includes(hint));
    return urlMatch || titleMatch;
  }

  function readConfiguredFields(config) {
    return (config?.fields || [])
      .filter((field) => field.selector)
      .map((field) => readField(field));
  }

  function readField(field) {
    try {
      const element = document.querySelector(field.selector);
      if (!element) {
        return {
          key: field.key,
          label: field.label,
          selector: field.selector,
          status: "missing",
          value: ""
        };
      }

      return {
        key: field.key,
        label: field.label,
        selector: field.selector,
        status: "found",
        value: readElementValue(element, field.attribute),
        tagName: element.tagName.toLowerCase(),
        elementType: element.getAttribute("type") || ""
      };
    } catch (error) {
      return {
        key: field.key,
        label: field.label,
        selector: field.selector,
        status: "error",
        value: "",
        error: error.message
      };
    }
  }

  function readElementValue(element, attribute) {
    if (isSensitiveInput(element)) {
      return "[redacted sensitive input]";
    }

    if (attribute === "value" && "value" in element) {
      return sanitizeText(element.value);
    }

    if (attribute && attribute !== "text") {
      return sanitizeText(element.getAttribute(attribute) || "");
    }

    return sanitizeText(element.innerText || element.textContent || "");
  }

  function collectPageSignals() {
    return {
      forms: document.forms.length,
      buttons: document.querySelectorAll("button, input[type='button'], input[type='submit']").length,
      inputs: document.querySelectorAll("input, textarea, select").length,
      headings: Array.from(document.querySelectorAll("h1, h2, h3"))
        .slice(0, 10)
        .map((element) => sanitizeText(element.innerText || element.textContent || "")),
      detailCandidates: collectDetailCandidates(),
      nextLeadCandidates: collectNextLeadCandidates()
    };
  }

  function collectLocalLeadPreview(root = document, source = "#primaryPanel") {
    const panel = root.querySelector("#primaryPanel");
    if (!panel) {
      return {
        available: false,
        phones: []
      };
    }

    const text = sanitizeText(panel.innerText || panel.textContent || "");
    return {
      available: true,
      leadName: extractLeadName(text),
      language: extractSimpleLabel(text, "Language"),
      email: extractEmail(text),
      address: extractAddress(text),
      phones: collectPhoneEntries(panel, text),
      source
    };
  }

  async function prefetchNextLead() {
    const candidate = collectNextLeadCandidates().find((nextCandidate) => nextCandidate.url);
    if (!candidate?.url) {
      return null;
    }

    try {
      const response = await fetch(candidate.url, {
        credentials: "include",
        cache: "no-store"
      });

      if (!response.ok) {
        return {
          available: false,
          error: `HTTP ${response.status}`,
          candidate
        };
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const lead = collectLocalLeadPreview(doc, candidate.safePath);
      return {
        ...lead,
        prefetchedAt: new Date().toISOString(),
        candidate
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        candidate
      };
    }
  }

  function collectNextLeadCandidates() {
    const currentUrl = new URL(location.href);
    const candidates = Array.from(document.querySelectorAll("a[href], button, input[type='button'], input[type='submit']"))
      .map((element) => {
        const url = findCandidateUrl(element);
        const text = sanitizeText(element.innerText || element.textContent || element.value || element.getAttribute("aria-label") || element.getAttribute("title") || "");

        if (url && isSameLeadPageUrl(url, currentUrl)) {
          return null;
        }

        const action = collectActionAttributes(element);
        if (!url && !getNextCandidateConfidence(text, element)) {
          return null;
        }

        return {
          url: url?.href || "",
          safePath: url ? `${url.pathname}${url.search ? "?..." : ""}` : "",
          selector: buildSelector(element),
          text: redactControlText(text).slice(0, 80),
          confidence: getNextCandidateConfidence(text, element),
          action
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    return dedupeCandidates(candidates);
  }

  function getNextCandidateConfidence(text, element) {
    const combined = `${text} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`.toLowerCase();
    if (combined.includes("next") || combined.includes("down") || combined.includes("keyboard_arrow_down")) {
      return 100;
    }
    if (combined.includes("up") || combined.includes("previous") || combined.includes("keyboard_arrow_up")) {
      return 40;
    }
    return 0;
  }

  function dedupeCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }
      seen.add(candidate.url);
      return true;
    });
  }

  function startAutoPublishWatcher() {
    window.setTimeout(runAutoPublishCheck, 1000);
    window.setInterval(runAutoPublishCheck, 2500);

    const observer = new MutationObserver(() => {
      window.clearTimeout(autoPublishTimer);
      autoPublishTimer = window.setTimeout(runAutoPublishCheck, 600);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    let lastHref = location.href;
    window.setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        lastAutoPublishFingerprint = "";
        runAutoPublishCheck();
      }
    }, 1000);
  }

  async function runAutoPublishCheck() {
    try {
      if (!location.href.includes("/Lead/InboxDetail")) {
        return;
      }

      const allowed = await isOriginAllowed();
      if (!allowed) {
        return;
      }

      const autoPublish = await isAutoPublishEnabled();
      if (!autoPublish) {
        return;
      }

      const lead = collectLocalLeadPreview();
      if (!lead.available || !lead.leadName || !lead.phones?.length) {
        return;
      }

      const nextLead = await prefetchNextLead();
      if (nextLead?.available) {
        lead.nextLead = nextLead;
      }

      const fingerprint = JSON.stringify({
        url: location.href,
        leadName: lead.leadName,
        language: lead.language,
        email: lead.email,
        address: lead.address,
        phones: lead.phones,
        nextLeadName: lead.nextLead?.leadName || ""
      });

      if (fingerprint === lastAutoPublishFingerprint) {
        return;
      }

      lastAutoPublishFingerprint = fingerprint;
      await chrome.runtime.sendMessage({
        type: "impact/autoPublishLead",
        lead
      });
    } catch (_error) {
      // Auto-publish should never interrupt the IMPACT page.
    }
  }

  async function isAutoPublishEnabled() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.autoPublish);
    return result[STORAGE_KEYS.autoPublish] !== false;
  }

  function extractLeadName(text) {
    const match = text.match(/\b([A-Z][A-Z'\-]+,\s+[A-Z][A-Z'\-]+)\b/);
    return sanitizeText(match?.[1] || "");
  }

  function extractSimpleLabel(text, label) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}:\\s*([^:]+?)(?=\\s+[A-Z][A-Za-z ]+:|$)`, "i"));
    return sanitizeText(match?.[1] || "");
  }

  function extractEmail(text) {
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return sanitizeText(match?.[0] || "");
  }

  function extractAddress(text) {
    const email = extractEmail(text);
    if (!email) {
      return "";
    }

    const afterEmail = text.slice(text.indexOf(email) + email.length);
    const beforeMap = afterEmail.split(/\bMap It\b/i)[0] || "";
    return sanitizeText(beforeMap.replace(/editpublic/gi, " ").replace(/\bplace\b/gi, " "));
  }

  function collectPhoneEntries(panel, text) {
    const entries = [];

    for (const label of ["Mobile", "Home"]) {
      const labeledPhone = extractLabeledPhone(text, label);
      if (labeledPhone) {
        entries.push({
          label,
          number: labeledPhone,
          dialHref: `tel:${toDialablePhone(labeledPhone)}`,
          source: "label"
        });
      }
    }

    for (const element of panel.querySelectorAll("a[href^='tel:'], a[id*='phone' i], a[href*='Call' i]")) {
      const href = element.getAttribute("href") || "";
      const textValue = sanitizeText(element.innerText || element.textContent || "");
      const phone = extractFirstPhone(`${href} ${textValue}`);
      if (!phone) {
        continue;
      }

      entries.push({
        label: /mobile/i.test(textValue) ? "Mobile" : /home/i.test(textValue) ? "Home" : "Phone",
        number: phone,
        dialHref: `tel:${toDialablePhone(phone)}`,
        source: "call-link"
      });
    }

    return dedupePhones(entries);
  }

  function extractLabeledPhone(text, label) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}:\\s*(${PHONE_PATTERN.source})`, "i"));
    return normalizeDisplayPhone(match?.[1] || "");
  }

  function extractFirstPhone(value) {
    const match = sanitizeText(value).match(PHONE_PATTERN);
    return normalizeDisplayPhone(match?.[0] || "");
  }

  function normalizeDisplayPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (normalized.length !== 10) {
      return "";
    }

    return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }

  function toDialablePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 10 ? `+1${digits}` : digits;
  }

  function dedupePhones(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
      const key = toDialablePhone(entry.number);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function collectDetailCandidates() {
    const panel = document.querySelector("#primaryPanel");
    if (!panel) {
      return {
        panelFound: false,
        fields: [],
        controls: []
      };
    }

    return {
      panelFound: true,
      fields: collectLabeledTextCandidates(panel),
      controls: collectControlCandidates(panel)
    };
  }

  function collectLabeledTextCandidates(panel) {
    const text = sanitizeText(panel.innerText || panel.textContent || "");
    const labels = ["Language", "Mobile", "Home", "Email"];

    return labels
      .map((label) => {
        const value = extractValueAfterLabel(text, label, labels);
        if (!value) {
          return null;
        }

        return {
          label,
          hasValue: Boolean(value),
          redactedValue: redactCustomerText(value).slice(0, 120)
        };
      })
      .filter(Boolean);
  }

  function collectControlCandidates(panel) {
    return Array.from(panel.querySelectorAll("a, button, input[type='button'], input[type='submit']"))
      .map((element) => {
        const text = sanitizeText(element.innerText || element.textContent || element.value || element.getAttribute("aria-label") || "");
        if (!text) {
          return null;
        }

        return {
          selector: buildSelector(element),
          tagName: element.tagName.toLowerCase(),
          text: redactControlText(text).slice(0, 80),
          hrefPath: getSafeHrefPath(element)
        };
      })
      .filter(Boolean)
      .slice(0, 30);
  }

  function extractValueAfterLabel(text, label, allLabels) {
    const labelPattern = `${escapeRegExp(label)}:`;
    const nextLabels = allLabels
      .filter((candidate) => candidate !== label)
      .map((candidate) => `${escapeRegExp(candidate)}:`);
    const boundaryPattern = nextLabels.length ? `(?=${nextLabels.join("|")}|$)` : "$";
    const match = text.match(new RegExp(`${labelPattern}\\s*(.*?)\\s*${boundaryPattern}`, "i"));
    return sanitizeText(match?.[1] || "");
  }

  function collectMinimalPageSignals() {
    return {
      forms: document.forms.length,
      buttons: document.querySelectorAll("button, input[type='button'], input[type='submit']").length,
      inputs: document.querySelectorAll("input, textarea, select").length
    };
  }

  async function startPicker() {
    const allowed = await isOriginAllowed();
    if (!allowed) {
      throw new Error("Add this IMPACT origin in Options before using the element picker.");
    }

    stopPicker();

    const overlay = document.createElement("div");
    overlay.id = "impact-companion-picker-outline";
    Object.assign(overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      border: "3px solid #1d4ed8",
      background: "rgba(29, 78, 216, 0.08)",
      display: "none"
    });
    document.documentElement.appendChild(overlay);

    const onMouseMove = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target === overlay) {
        return;
      }
      const rect = target.getBoundingClientRect();
      Object.assign(overlay.style, {
        display: "block",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      });
    };

    const onClick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const info = describeElement(target);
      await log("info", "picker.elementSelected", info);
      await chrome.storage.local.set({ "impact.lastPickedElement": info });
      stopPicker();
      alert("Element captured. Open the extension popup or Options page to copy the selector.");
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        stopPicker();
      }
    };

    pickerState = { overlay, onMouseMove, onClick, onKeyDown };
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    await log("info", "picker.started", {});
  }

  function stopPicker() {
    if (!pickerState) {
      return;
    }

    document.removeEventListener("mousemove", pickerState.onMouseMove, true);
    document.removeEventListener("click", pickerState.onClick, true);
    document.removeEventListener("keydown", pickerState.onKeyDown, true);
    pickerState.overlay.remove();
    pickerState = null;
  }

  function describeElement(element) {
    return {
      selector: buildSelector(element),
      tagName: element.tagName.toLowerCase(),
      id: element.id || "",
      name: element.getAttribute("name") || "",
      type: element.getAttribute("type") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      role: element.getAttribute("role") || "",
      labelText: findLabelText(element),
      textSample: isSensitiveInput(element) ? "[redacted sensitive input]" : redactCustomerText(element.innerText || element.textContent || element.value || "").slice(0, 200),
      clickableAncestor: describeClickableAncestor(element),
      nearbyStableAttributes: collectNearbyStableAttributes(element),
      url: scrubCurrentUrl(),
      capturedAt: new Date().toISOString()
    };
  }

  function buildSelector(element) {
    if (element.id && isReasonableCssIdentifier(element.id)) {
      return `#${CSS.escape(element.id)}`;
    }

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const name = current.getAttribute("name");
      const dataTestId = current.getAttribute("data-testid") || current.getAttribute("data-test-id");

      if (dataTestId) {
        part += `[data-testid="${cssAttributeEscape(dataTestId)}"]`;
      } else if (name) {
        part += `[name="${cssAttributeEscape(name)}"]`;
      } else {
        const siblings = Array.from(current.parentElement?.children || []).filter((sibling) => sibling.tagName === current.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function findLabelText(element) {
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label) {
        return sanitizeText(label.innerText || label.textContent || "");
      }
    }

    const wrappingLabel = element.closest("label");
    return wrappingLabel ? sanitizeText(wrappingLabel.innerText || wrappingLabel.textContent || "") : "";
  }

  function collectNearbyStableAttributes(element) {
    const attributes = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && attributes.length < 6) {
      const entry = {
        tagName: current.tagName.toLowerCase(),
        id: current.id || "",
        name: current.getAttribute("name") || "",
        className: sanitizeClassName(current.getAttribute("class") || ""),
        dataTestId: current.getAttribute("data-testid") || current.getAttribute("data-test-id") || "",
        ariaLabel: current.getAttribute("aria-label") || "",
        role: current.getAttribute("role") || ""
      };

      if (entry.id || entry.name || entry.className || entry.dataTestId || entry.ariaLabel || entry.role) {
        attributes.push(entry);
      }

      current = current.parentElement;
    }

    return attributes;
  }

  function describeClickableAncestor(element) {
    const clickable = element.closest("a, button, input[type='button'], input[type='submit']");
    if (!clickable) {
      return null;
    }

    return {
      selector: buildSelector(clickable),
      tagName: clickable.tagName.toLowerCase(),
      text: redactControlText(clickable.innerText || clickable.textContent || clickable.value || "").slice(0, 120),
      action: collectActionAttributes(clickable)
    };
  }

  function isReasonableCssIdentifier(value) {
    return typeof value === "string" && value.length > 0 && value.length < 80;
  }

  function cssAttributeEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isSensitiveInput(element) {
    return element instanceof HTMLInputElement && ["password", "hidden"].includes(element.type);
  }

  const PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

  function sanitizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function redactCustomerText(value) {
    return sanitizeText(value)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone]")
      .replace(/\b\d{5}(?:-\d{4})?\b/g, "[zip]")
      .replace(/\b[A-Z][A-Z'\-]+,\s+[A-Z][A-Z'\-]+\b/g, "[name]");
  }

  function redactControlText(value) {
    return redactCustomerText(value)
      .replace(/\[name\]\s+edit\s+Language:.*$/i, "[lead contact edit link]")
      .replace(/^.*\bCall\s+(Mobile|Home)\b.*$/i, "Call $1")
      .replace(/^.*\bSend Text\b.*$/i, "Send Text")
      .replace(/^.*\bDropped By\b.*$/i, "Dropped By")
      .replace(/^.*\bAdd Comments\b.*$/i, "Add Comments")
      .replace(/^.*\bShow More\b.*$/i, "Show More")
      .replace(/^.*\bDocument\b.*$/i, "Document");
  }

  function sanitizeClassName(value) {
    return String(value || "")
      .split(/\s+/)
      .filter((part) => part && !/\d{4,}/.test(part))
      .slice(0, 8)
      .join(" ");
  }

  function scrubCurrentUrl() {
    return `${location.origin}${location.pathname}`;
  }

  function toSameOriginUrl(href) {
    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin ? url : null;
    } catch (_error) {
      return null;
    }
  }

  function findCandidateUrl(element) {
    const rawValues = [
      element.getAttribute("href"),
      element.getAttribute("formaction"),
      element.getAttribute("data-href"),
      element.getAttribute("data-url"),
      element.getAttribute("data-link"),
      element.getAttribute("onclick")
    ].filter(Boolean);

    for (const value of rawValues) {
      const directUrl = toSameOriginUrl(value);
      if (isLeadNavigationPath(directUrl?.pathname || "")) {
        return directUrl;
      }

      const embeddedPath = String(value).match(/\/Lead\/(?:InboxDetail|MoveNext)[^'" )]*/i)?.[0];
      if (embeddedPath) {
        const embeddedUrl = toSameOriginUrl(embeddedPath);
        if (embeddedUrl && isLeadNavigationPath(embeddedUrl.pathname)) {
          return embeddedUrl;
        }
      }
    }

    return null;
  }

  function isLeadNavigationPath(pathname) {
    return pathname.includes("/Lead/InboxDetail") || pathname.includes("/Lead/MoveNext");
  }

  function isSameLeadPageUrl(candidateUrl, currentUrl) {
    return candidateUrl.origin === currentUrl.origin
      && candidateUrl.pathname === currentUrl.pathname
      && candidateUrl.search === currentUrl.search;
  }

  function collectActionAttributes(element) {
    const attributeNames = [
      "href",
      "onclick",
      "formaction",
      "type",
      "value",
      "data-href",
      "data-url",
      "data-link",
      "data-id",
      "data-leadid",
      "data-lead-id"
    ];

    return Object.fromEntries(
      attributeNames
        .map((name) => [name, element.getAttribute(name)])
        .filter(([, value]) => value)
        .map(([name, value]) => [name, scrubActionText(value)])
    );
  }

  function scrubActionText(value) {
    return String(value)
      .replace(/\bLeadId=\d+\b/g, "LeadId=[redacted]")
      .replace(/\b\d{5,}\b/g, "[id]")
      .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone]");
  }

  function getSafeHrefPath(element) {
    const href = element.getAttribute("href");
    if (!href) {
      return "";
    }

    try {
      const url = new URL(href, location.href);
      if (url.protocol === "tel:") {
        return "tel:[phone]";
      }

      if (url.protocol === "mailto:") {
        return "mailto:[email]";
      }

      if (!["http:", "https:"].includes(url.protocol)) {
        return `${url.protocol}[redacted]`;
      }

      return `${url.pathname}`;
    } catch (_error) {
      return href.startsWith("javascript:") ? "javascript:[redacted]" : "";
    }
  }

  async function log(level, event, details) {
    await chrome.runtime.sendMessage({
      type: "impact/log",
      entry: {
        level,
        event,
        details,
        url: scrubCurrentUrl()
      }
    });
  }
})();
