(function impactDiagnostic() {
  if (window.__impactCompanionDiagnosticLoaded) {
    return;
  }

  window.__impactCompanionDiagnosticLoaded = true;

  const STORAGE_KEYS = {
    allowedOrigins: "impact.allowedOrigins",
    selectorConfig: "impact.selectorConfig",
    autoPublish: "impact.autoPublish",
    inboxQueue: "impact.inboxQueue",
    lastSnapshot: "impact.lastSnapshot",
    quietHoursNoticeAt: "impact.quietHoursNoticeAt"
  };

  let pickerState = null;
  let lastAutoPublishFingerprint = "";
  let lastAutoPublishAt = 0;
  let autoPublishTimer = null;
  let commandPollBusy = false;
  let nextLeadCache = null;
  let nextLeadRequest = null;
  let autoPublishBusy = false;
  let autoPublishAgain = false;
  // A lead whose name or phones IMPACT shows in an unexpected format still
  // goes to the phone once it has been on screen this long.
  const INCOMPLETE_LEAD_SETTLE_MS = 2000;
  let incompleteLead = { leadId: "", since: 0, logged: false };
  let lastAppointmentOptionsFingerprint = "";
  let resultDialogsBeforeSubmit = new WeakSet();
  const dismissedQuietHoursDialogs = new WeakSet();
  const recordedQuietHoursDialogs = new WeakSet();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['impact.connectionMode']) lastAutoPublishFingerprint = '';
    if (changes['impact.supabase.session']) {
      lastAutoPublishFingerprint = '';
      nextLeadCache = null;
      const change = changes['impact.supabase.session'];
      const accountId = (value) => { try { return (typeof value === 'string' ? JSON.parse(value) : value)?.user?.id; } catch { return null; } };
      if (!change.newValue || accountId(change.oldValue) !== accountId(change.newValue)) {
        sessionStorage.removeItem('impact.phoneCallContext');
        sessionStorage.removeItem('impact.virtualAppointmentContext');
        sessionStorage.removeItem('impact.pendingResultAdvance');
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { lastAutoPublishFingerprint = ''; void runAutoPublishCheck(); }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "impact/getSnapshot") {
      getSnapshot({ includeNextLead: message.includeNextLead !== false })
        .then((snapshot) => sendResponse({ ok: true, snapshot }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "impact/readCurrentLead") {
      // The service worker asks after a phone result/Previous/Next, to publish
      // the lead IMPACT moved to without waiting for this page's own check.
      readCurrentLeadForPhone()
        .then((lead) => sendResponse({ ok: true, lead }))
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
  startPhoneCommandWatcher();
  window.setInterval(finishResultAdvance, 150);
  startQuietHoursDialogWatcher();

  // IMPACT shows this notice for Union / Association leads after 8 PM. It is
  // informational, but the modal blocks every Companion command until closed.
  // Dismiss only this exact notice; appointment and call-result dialogs stay
  // under the rep's control.
  function startQuietHoursDialogWatcher() {
    const check = () => dismissQuietHoursDialogs();
    check();
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
  }

  function dismissQuietHoursDialogs() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .bootbox, .modal, .ui-dialog'))
      .filter((dialog) => dialog.getClientRects().length && !dismissedQuietHoursDialogs.has(dialog));
    for (const dialog of dialogs) {
      const text = sanitizeText(dialog.innerText || dialog.textContent || "");
      if (!/do\s+not\s+(?:knock|visit).{0,100}\b8\s*(?::\s*00)?\s*(?:p\.?m\.?|pm)\b/i.test(text)) continue;
      if (!recordedQuietHoursDialogs.has(dialog)) {
        recordedQuietHoursDialogs.add(dialog);
        void recordQuietHoursNotice();
      }
      const close = Array.from(dialog.querySelectorAll('button, input[type="button"], input[type="submit"], .close'))
        .find((button) => /^(ok|close|×)$/i.test(sanitizeText(button.value || button.innerText || button.textContent || "")));
      if (!close || close.disabled || close.getAttribute("aria-disabled") === "true") continue;
      dismissedQuietHoursDialogs.add(dialog);
      close.click();
      void log("info", "quietHoursNotice.dismissed", {});
    }
  }

  // IMPACT showing its own after-8 PM notice is the most reliable sign that
  // its quiet hours have started, whatever time zone IMPACT runs on. The
  // phone uses this timestamp to show its warning for the rest of the evening.
  async function recordQuietHoursNotice() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.quietHoursNoticeAt]: new Date().toISOString() });
      lastAutoPublishFingerprint = "";
      window.setTimeout(runAutoPublishCheck, 0);
    } catch (_error) {
      // Recording the notice must never interrupt the IMPACT page.
    }
  }

  async function addQuietHoursContext(lead) {
    if (!lead?.available) return lead;
    const stored = await chrome.storage.local.get([STORAGE_KEYS.quietHoursNoticeAt]);
    if (stored[STORAGE_KEYS.quietHoursNoticeAt]) lead.quietHoursNoticeAt = stored[STORAGE_KEYS.quietHoursNoticeAt];
    return lead;
  }

  async function getSnapshot({ includeNextLead = true } = {}) {
    if (!(await chrome.runtime.sendMessage({ type: 'impact/authStatus' }))?.ok) throw new Error('Sign in through extension Options first.');
    const config = await getSelectorConfig();
    const allowed = await isOriginAllowed();
    const inboxQueue = allowed ? await syncInboxQueueFromPage() : null;
    const localLeadPreview = allowed ? collectLocalLeadPreview() : null;
    const cachedNextLead = nextLeadCache?.pageUrl === location.href && Date.now() < nextLeadCache.expiresAt
      ? nextLeadCache.lead : null;
    const prefetchedNextLead = localLeadPreview?.available
      ? (includeNextLead ? await prefetchNextLead() : cachedNextLead) : null;
    if (localLeadPreview?.available) await addQuietHoursContext(localLeadPreview);
    if (localLeadPreview?.available && prefetchedNextLead) {
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
      inboxQueue,
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
      inboxQueue: collectInboxQueueSummary(),
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
      leadId: root === document ? getCurrentLeadId() : "",
      requestType: collectRequestType(panel),
      callHistory: collectCallHistory(panel),
      comments: collectLeadComments(panel),
      language: extractSimpleLabel(text, "Language"),
      email: extractEmail(text),
      address: extractAddress(text),
      phones: collectPhoneEntries(panel, text),
      source
    };
  }

  function collectRequestType(panel) {
    // Scope the picker-provided location to the active lead's detail panel.
    // Read the actual value: request types are not a fixed list.
    const cell = panel.querySelector("#myTabContentJust div:nth-of-type(4) > table.table-bordered > tbody > tr:nth-of-type(2) > td");
    return sanitizeText(cell?.innerText || cell?.textContent || "");
  }

  function collectCallHistory(panel) {
    const sections = Array.from(panel.querySelectorAll("#myTabContentJust .inner-schedule"));
    const entries = [];
    for (const section of sections) {
      // textContent also includes older entries hidden by IMPACT's Show More control.
      const text = sanitizeText(section.textContent || "")
        .replace(/Show (?:Less|More)\s*\.{0,3}/gi, "").trim();
      if (/^Status\b/i.test(text)) {
        const statuses = text.replace(/^Status\s*:?[\s]*/i, "").trim();
        entries.push(...statuses.split(/(?<=\bby [^.]{1,100}\.)\s+(?=[A-Z])/).map(value => value.trim()).filter(Boolean));
      }
    }
    return entries;
  }

  function collectLeadComments(panel) {
    return Array.from(panel.querySelectorAll("#myTabContentJust .inner-schedule"))
      .map(section => sanitizeText(section.textContent || "").replace(/Show (?:Less|More)\s*\.{0,3}/gi, "").trim())
      .filter(text => /^Comment(?=\s|\d|:|$)/i.test(text))
      // IMPACT sometimes runs the Comment heading and timestamp together.
      .map(text => text.replace(/^Comment\s*/i, "Comment · "));
  }

  async function prefetchNextLead() {
    const pageUrl = location.href;
    if (nextLeadCache?.pageUrl === pageUrl && Date.now() < nextLeadCache.expiresAt) {
      return nextLeadCache.lead;
    }
    if (nextLeadRequest?.pageUrl === pageUrl) return nextLeadRequest.promise;
    const request = { pageUrl };
    request.promise = fetchNextLead().then((lead) => {
      if (location.href === pageUrl) {
        nextLeadCache = { pageUrl, lead, expiresAt: Date.now() + (lead?.available ? 60000 : 5000) };
      }
      return lead;
    }).finally(() => {
      if (nextLeadRequest === request) nextLeadRequest = null;
    });
    nextLeadRequest = request;
    return request.promise;
  }

  async function fetchNextLead() {
    const queueCandidate = await getNextInboxQueueCandidate();
    const candidates = [queueCandidate, ...collectNextLeadCandidates()].filter(Boolean);
    const candidate = candidates.find((nextCandidate) => nextCandidate.url && nextCandidate.canPrefetch && nextCandidate.confidence >= 100);
    if (!candidate?.url) {
      return {
        available: false,
        error: "No safe direct next lead URL found. IMPACT next button is stateful, so background prefetch is disabled.",
        candidates
      };
    }

    try {
      const response = await fetch(candidate.url, {
        credentials: "include",
        signal: AbortSignal.timeout(5000),
        cache: "default"
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
      if (!lead.available) {
        return {
          available: false,
          error: "Fetched next route but could not find #primaryPanel.",
          candidate,
          responseUrl: scrubFetchedUrl(response.url),
          htmlTitle: sanitizeText(doc.title || "")
        };
      }

      return {
        ...lead,
        leadId: new URL(candidate.url).searchParams.get("LeadId") || "",
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
          canPrefetch: Boolean(url && isSafePrefetchPath(url.pathname)),
          prefetchNote: getPrefetchNote(url),
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

  async function syncInboxQueueFromPage() {
    if (location.pathname.replace(/\/$/, "") !== "/Lead/Inbox") {
      return null;
    }

    const queue = collectInboxLeadQueue();
    if (queue.length) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.inboxQueue]: {
          capturedAt: new Date().toISOString(),
          url: scrubCurrentUrl(),
          leads: queue
        }
      });
    }

    return {
      capturedAt: new Date().toISOString(),
      count: queue.length,
      first: queue[0]?.safePath || "",
      second: queue[1]?.safePath || ""
    };
  }

  function collectInboxLeadQueue() {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href*="/Lead/InboxDetail?LeadId="]'))
      .map((element, index) => {
        const url = toSameOriginUrl(element.getAttribute("href") || "");
        if (!url || !url.pathname.includes("/Lead/InboxDetail")) {
          return null;
        }

        const leadId = url.searchParams.get("LeadId") || "";
        if (!leadId || seen.has(leadId)) {
          return null;
        }

        seen.add(leadId);
        return {
          order: index,
          leadId,
          url: url.href,
          safePath: `${url.pathname}?LeadId=[redacted]`,
          text: redactCustomerText(element.innerText || element.textContent || "").slice(0, 80),
          selector: buildSelector(element)
        };
      })
      .filter(Boolean);
  }

  function collectInboxQueueSummary() {
    const queue = collectInboxLeadQueue();
    return {
      count: queue.length,
      first: queue[0]?.safePath || "",
      second: queue[1]?.safePath || ""
    };
  }

  async function getNextInboxQueueCandidate() {
    const currentLeadId = getCurrentLeadId();
    if (!currentLeadId) {
      return null;
    }

    const result = await chrome.storage.local.get(STORAGE_KEYS.inboxQueue);
    const queue = result[STORAGE_KEYS.inboxQueue]?.leads || [];
    const currentIndex = queue.findIndex((lead) => lead.leadId === currentLeadId);
    if (currentIndex === -1 || currentIndex >= queue.length - 1) {
      return null;
    }

    const nextLead = queue[currentIndex + 1];
    return {
      url: nextLead.url,
      safePath: nextLead.safePath,
      canPrefetch: true,
      prefetchNote: "Safe direct detail URL from saved inbox queue.",
      selector: nextLead.selector,
      text: nextLead.text,
      confidence: 120,
      action: {
        source: "savedInboxQueue",
        order: String(nextLead.order)
      }
    };
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
    window.setTimeout(runAutoPublishCheck, 0);
    window.setInterval(runAutoPublishCheck, 2500);
    window.setTimeout(syncInboxQueueFromPage, 1000);
    window.setInterval(syncInboxQueueFromPage, 5000);

    const observer = new MutationObserver(() => {
      window.clearTimeout(autoPublishTimer);
      autoPublishTimer = window.setTimeout(runAutoPublishCheck, 80);
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

  function startPhoneCommandWatcher() {
    const poll = async () => {
      await pollPhoneCommand();
      window.setTimeout(poll, 100);
    };
    poll();
  }

  async function pollPhoneCommand() {
    if (commandPollBusy || document.visibilityState !== "visible" ||
        location.origin !== "https://mobile.impact.ailife.com" ||
        !["/Lead/InboxDetail", "/Lead/WhatHappend", "/Lead/SetAppointment"].includes(location.pathname)) {
      return;
    }

    commandPollBusy = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "impact/getPhoneCommand" });
      const command = response?.result?.command;
      if (!command?.type) {
        return;
      }
      if (command.leadId && ["next", "previous"].includes(command.type) && command.leadId !== getCurrentLeadId()) {
        await chrome.runtime.sendMessage({ type: "impact/commandResult", message: "Navigation skipped because the lead changed. Try again on the current lead." });
        return;
      }

      if (["virtual-appointment-day", "virtual-appointment-slot"].includes(command.type)) {
        let message;
        try {
          if (command.type === "virtual-appointment-day") {
            clickVirtualAppointmentDay(command);
            message = "Virtual appointment day selected. Choose a time on your phone.";
          } else {
            await clickVirtualAppointmentSlot(command);
            message = "Virtual appointment time selected in IMPACT.";
          }
        } catch (error) {
          message = error.message;
        }
        await chrome.runtime.sendMessage({ type: "impact/commandResult", message });
        return;
      }

      if (["no-answer", "refused-appointment", "virtual-appointment"].includes(command.type)) {
        let message;
        try {
          if (command.type === "virtual-appointment") {
            clickVirtualAppointment(command);
            message = "Virtual Appointment opened in IMPACT. Available days and times will appear on your phone.";
          } else if (command.type === "refused-appointment") {
            const pr = await clickRefusedAppointment(command);
            message = pr === "answered"
              ? "Refused Appointment submitted (PR flag: No). Waiting for IMPACT, then moving to the next lead..."
              : "Refused Appointment submitted. Waiting for IMPACT, then moving to the next lead...";
          } else {
            clickNoAnswer(command);
            message = "No Answer submitted. Waiting for IMPACT, then moving to the next lead...";
          }
        } catch (error) {
          message = error.message;
        }
        await chrome.runtime.sendMessage({ type: "impact/commandResult", message });
        return;
      }

      if (command.type === "call") {
        try {
          clickLeadCallButton(command);
          await log("info", "phone.callControlClicked", { phoneType: command.phoneType });
        } catch (error) {
          await log("warn", "phone.callControlFailed", { reason: error.message });
          await chrome.runtime.sendMessage({ type: "impact/commandResult", message: error.message });
        }
        return;
      }

      if (command.type === "next") {
        await clickLeadNavigationButton("down");
      }

      if (command.type === "previous") {
        await clickLeadNavigationButton("up");
      }
    } catch (_error) {
      // Command polling must never interrupt IMPACT.
    } finally {
      commandPollBusy = false;
    }
  }

  async function clickLeadNavigationButton(direction, waitMs = 3000) {
    // Commands are polled right after a page load, sometimes before IMPACT has
    // rendered its arrow buttons. Wait briefly instead of dropping the command.
    const deadline = Date.now() + waitMs;
    let button = findLeadNavigationButton(direction);
    while (!button && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      button = findLeadNavigationButton(direction);
    }
    if (button) button.click();
    else await chrome.runtime.sendMessage({ type: "impact/commandResult", message: `IMPACT's ${direction === "up" ? "Previous" : "Next"} button is unavailable. Open the lead on your computer and try again.` });
  }

  function clickLeadCallButton(command) {
    if (!command.leadId || command.leadId !== getCurrentLeadId()) throw new Error("Call skipped: the IMPACT lead changed.");
    if (!Number.isFinite(Date.parse(command.requestedAt)) || Date.now() - Date.parse(command.requestedAt) > 15000) throw new Error("Call skipped: request expired.");
    if (!["Mobile", "Home"].includes(command.phoneType)) throw new Error("Call skipped: phone type is unknown.");
    const panel = document.querySelector("#primaryPanel");
    if (!panel) throw new Error("Call skipped: lead panel is unavailable.");
    const number = extractLabeledPhone(sanitizeText(panel.innerText || panel.textContent || ""), command.phoneType);
    if (!number || toDialablePhone(number) !== toDialablePhone(command.phoneNumber)) throw new Error("Call skipped: phone number no longer matches.");
    const controls = Array.from(panel.querySelectorAll(".row.text-center .col-xs-3"))
      .filter((element) => new RegExp(`\\bCall\\s+${command.phoneType}\\b`, "i").test(sanitizeText(element.innerText || element.textContent || "")))
      .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
    if (controls.length !== 1) throw new Error("Call skipped: matching IMPACT call control was not found uniquely.");
    const control = controls[0];
    const target = control.querySelector("button, a, [role='button'], [onclick]") || control;
    if (target.disabled || target.getAttribute("aria-disabled") === "true") throw new Error("Call skipped: IMPACT call control is disabled.");
    sessionStorage.setItem("impact.phoneCallContext", JSON.stringify({ leadId: command.leadId, startedAt: Date.now() }));
    clickWithoutDesktopDialer(target);
  }

  function validateCallResult(command) {
    if (location.pathname !== "/Lead/WhatHappend") throw new Error("Open Call - What Happened? in IMPACT, then choose the result.");
    const requestedAt = Date.parse(command.requestedAt);
    if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > 15000) throw new Error("Call result expired. Press it again on the phone.");
    const context = JSON.parse(sessionStorage.getItem("impact.phoneCallContext") || "null");
    const pageLeadId = getCurrentLeadId();
    if (!command.leadId || (pageLeadId ? pageLeadId !== command.leadId :
        !context || context.leadId !== command.leadId || Date.now() - context.startedAt > 30 * 60 * 1000)) {
      throw new Error("Could not match this call to the phone lead. Start the call from the phone first.");
    }
  }

  async function clickRefusedAppointment(command, prTimings) {
    validateCallResult(command);
    const choices = Array.from(document.querySelectorAll('#statuscontainer #collapseFour a[href="#panelRefused"]'))
      .filter((element) => /^Refused Appointment\s*:/i.test(sanitizeText(element.innerText || element.textContent || "")));
    if (choices.length !== 1) throw new Error("Refused Appointment option was not found uniquely in IMPACT.");
    if (choices[0].getAttribute("aria-disabled") === "true") throw new Error("Refused Appointment is disabled in IMPACT.");
    choices[0].click();
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      validateCallResult(command);
      const panel = document.querySelector("#statuscontainer #panelRefused");
      const submits = panel ? Array.from(panel.querySelectorAll('input[type="button"], button'))
        .filter((element) => /^(Submit)$/i.test(sanitizeText(element.value || element.textContent || "")))
        .filter((element) => /^\s*MarkResolveRefused\s*\([^,]+,[^,]+,\s*8\s*\)/.test(element.getAttribute("onclick") || "")) : [];
      if (submits.length > 1) throw new Error("Refused Appointment Submit was not found uniquely.");
      const submit = submits[0];
      if (submit && submit.getClientRects().length && !submit.disabled && submit.getAttribute("aria-disabled") !== "true") {
        const invalidField = Array.from(panel.querySelectorAll("input, select, textarea"))
          .find((field) => field.willValidate && !field.checkValidity());
        if (invalidField) throw new Error("Refused Appointment needs additional details. Complete the box on your computer.");
        submitCallResult(command, submit);
        return await answerPrOptionDialog(prTimings);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    throw new Error("Refused Appointment Submit is not ready. Check the box on your computer.");
  }

  // After the Refused Appointment Submit, IMPACT asks "Flag for PR?" in
  // div#prOptionDialog (choices No / Great Experience / Poor Experience, a
  // Comment box, and a footer Submit that runs onPROption(...)). The rep's
  // standing answer is "No" with no comment. Returns "answered", or
  // "not-shown" if IMPACT never opened the question.
  const PR_QUESTION_ERROR = "IMPACT's PR question couldn't be answered automatically. Pick No and Submit on your computer.";

  async function answerPrOptionDialog({ appearMs = 6000, readyMs = 3000, closeMs = 5000, stepMs = 100 } = {}) {
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const dialogShown = () => {
      const dialog = document.querySelector("#prOptionDialog");
      return dialog && isShownModal(dialog) ? dialog : null;
    };
    let deadline = Date.now() + appearMs;
    let dialog = dialogShown();
    while (!dialog && Date.now() < deadline) { await wait(stepMs); dialog = dialogShown(); }
    if (!dialog) {
      void log("warn", "refused.prOptionDialogNotShown", {}).catch(() => {});
      return "not-shown";
    }
    try {
      // IMPACT may fill the question in just after the box opens.
      deadline = Date.now() + readyMs;
      let choices = findPrNoChoices(dialog);
      while (choices.length !== 1 && Date.now() < deadline) { await wait(stepMs); choices = findPrNoChoices(dialog); }
      if (choices.length !== 1) throw new Error(PR_QUESTION_ERROR);
      const choice = choices[0];
      choice.apply();
      if (!choice.verify()) throw new Error(PR_QUESTION_ERROR);
      const submits = Array.from(dialog.querySelectorAll(".modal-footer a"))
        .filter((link) => sanitizeText(link.innerText || link.textContent || "") === "Submit")
        .filter((link) => /^\s*onPROption\s*\(/.test(link.getAttribute("onclick") || ""))
        .filter((link) => link.getClientRects().length && link.getAttribute("aria-disabled") !== "true" && !link.classList?.contains("disabled"));
      if (submits.length !== 1) throw new Error(PR_QUESTION_ERROR);
      submits[0].click();
      void log("info", "refused.prOptionAnswered", { choice: "No", control: choice.kind }).catch(() => {});
      // Restart the result-advance clock: the PR step took part of its window.
      const pending = JSON.parse(sessionStorage.getItem("impact.pendingResultAdvance") || "null");
      if (pending) sessionStorage.setItem("impact.pendingResultAdvance", JSON.stringify({ ...pending, requestedAt: Date.now() }));
      deadline = Date.now() + closeMs;
      while (dialogShown() && Date.now() < deadline) await wait(stepMs);
      if (dialogShown()) throw new Error("IMPACT's PR box is still open after Submit. Check it on your computer.");
      return "answered";
    } catch (error) {
      // Stop the automatic OK / Next steps; the rep finishes this on the computer.
      sessionStorage.removeItem("impact.pendingResultAdvance");
      void log("warn", "refused.prOptionFailed", { reason: error.message }).catch(() => {});
      throw error;
    }
  }

  function isShownModal(element) {
    if (!element.getClientRects().length) return false;
    const classes = element.classList;
    return !classes?.contains("fade") || classes.contains("in") || classes.contains("show");
  }

  // Every control in the PR question whose text is exactly "No", whatever kind
  // of control IMPACT uses. Each entry knows how to choose it and verify it.
  function findPrNoChoices(dialog) {
    const body = dialog.querySelector(".modal-body");
    if (!body) return [];
    const isNo = (text) => /^no$/i.test(sanitizeText(text));
    const enabled = (element) => !element.disabled && element.getAttribute("aria-disabled") !== "true";
    const found = [];
    const labels = Array.from(body.querySelectorAll("label"));
    for (const input of body.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
      const forLabel = input.id ? labels.find((label) => label.getAttribute("for") === input.id) : null;
      const wrapping = input.closest?.("label");
      let text = forLabel ? forLabel.innerText || forLabel.textContent : wrapping ? wrapping.innerText || wrapping.textContent : "";
      if (!forLabel && !wrapping) {
        const next = input.nextSibling;
        text = next?.nodeType === 3 && sanitizeText(next.textContent) ? next.textContent
          : input.nextElementSibling && !/^(INPUT|SELECT|TEXTAREA|BR)$/.test(input.nextElementSibling.tagName) ? input.nextElementSibling.innerText || input.nextElementSibling.textContent : "";
      }
      if (!isNo(text) || !enabled(input)) continue;
      const others = () => input.type === "checkbox"
        ? Array.from(body.querySelectorAll('input[type="checkbox"]')).filter((box) => box !== input && box.checked) : [];
      found.push({
        kind: input.type,
        apply: () => { if (!(input.type === "checkbox" && input.checked)) input.click(); },
        verify: () => input.checked === true && others().length === 0
      });
    }
    for (const select of body.querySelectorAll("select")) {
      for (const option of Array.from(select.options || select.querySelectorAll("option"))) {
        if (!isNo(option.innerText || option.textContent || option.label) || !enabled(select) || option.disabled) continue;
        found.push({
          kind: "select",
          apply: () => {
            select.value = option.value;
            option.selected = true;
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
          },
          verify: () => select.value === option.value && option.selected === true
        });
      }
    }
    const clickables = body.querySelectorAll('button, a, [role="button"], [role="radio"], [role="option"], input[type="button"], input[type="submit"]');
    for (const element of clickables) {
      const text = element.tagName === "INPUT" ? element.value : element.innerText || element.textContent;
      if (!isNo(text) || !enabled(element) || !element.getClientRects().length) continue;
      found.push({
        kind: "button",
        apply: () => element.click(),
        verify: () => element.getAttribute("aria-checked") !== "false" && element.getAttribute("aria-pressed") !== "false"
      });
    }
    return found;
  }

  function clickNoAnswer(command) {
    validateCallResult(command);
    const choices = Array.from(document.querySelectorAll('#statuscontainer #collapseThree a[name="search"]'))
      .filter((element) => /^No Answer\s*:/i.test(sanitizeText(element.innerText || element.textContent || "")))
      .filter((element) => /^\s*UpdateCallStatus\s*\(/.test(element.getAttribute("onclick") || ""));
    if (choices.length !== 1) throw new Error("No Answer option was not found uniquely in IMPACT.");
    const choice = choices[0];
    if (choice.getAttribute("aria-disabled") === "true") throw new Error("No Answer is disabled in IMPACT.");
    submitCallResult(command, choice);
  }

  function clickVirtualAppointment(command) {
    validateCallResult(command);
    const choices = Array.from(document.querySelectorAll('#statuscontainer #collapseThree a[name="search"]'))
      .filter((element) => /^Set Virtual Appointment\s*:/i.test(sanitizeText(element.innerText || element.textContent || "")))
      .filter((element) => /appointmenttype=VirtualAppt/i.test(element.getAttribute("href") || ""))
      .filter((element) => /^\s*ResolveAppointment\s*\(/.test(element.getAttribute("onclick") || ""));
    if (choices.length !== 1) throw new Error("Set Virtual Appointment was not found uniquely in IMPACT.");
    if (choices[0].getAttribute("aria-disabled") === "true") throw new Error("Set Virtual Appointment is disabled in IMPACT.");
    sessionStorage.setItem("impact.virtualAppointmentContext", JSON.stringify({ leadId: command.leadId, startedAt: Date.now() }));
    choices[0].click();
  }

  function getVirtualAppointmentContext() {
    try {
      const context = JSON.parse(sessionStorage.getItem("impact.virtualAppointmentContext") || "null");
      if (!context?.leadId || !Number.isFinite(context.startedAt) || Date.now() - context.startedAt > 30 * 60 * 1000) return null;
      return context;
    } catch (_error) {
      return null;
    }
  }

  function validateVirtualAppointmentCommand(command) {
    if (location.pathname !== "/Lead/SetAppointment") throw new Error("Open Set Virtual Appointment in IMPACT, then choose a day and time.");
    const requestedAt = Date.parse(command.requestedAt);
    if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > 15000) throw new Error("Appointment selection expired. Press it again on the phone.");
    const context = getVirtualAppointmentContext();
    if (!context || context.leadId !== command.leadId) throw new Error("This appointment no longer matches the phone lead. Start the call from the phone again.");
    return context;
  }

  function collectVirtualAppointmentOptions() {
    if (location.pathname !== "/Lead/SetAppointment") return null;
    const context = getVirtualAppointmentContext();
    const root = document.querySelector(".setappoinment");
    if (!context || !root) return null;
    const days = [];
    for (const header of Array.from(root.querySelectorAll('a[href^="#"]')).slice(0, 14)) {
      const id = (header.getAttribute("href") || "").slice(1);
      const panel = id ? document.getElementById(id) : null;
      const label = sanitizeText(header.innerText || header.textContent || "");
      if (!id || !panel || !label) continue;
      const slots = Array.from(panel.querySelectorAll(".appointmentslot")).slice(0, 80)
        .map((slot) => appointmentSlotLabel(sanitizeText(slot.innerText || slot.textContent || "")))
        .filter(Boolean);
      if (slots.length) days.push({ id, label, slots, selected: /\bin\b/.test(panel.className || "") || panel.getClientRects().length > 0 });
    }
    if (!days.length) return null;
    const selectedDayId = days.find((day) => day.selected)?.id || days[0].id;
    return { leadId: context.leadId, days, selectedDayId };
  }

  function appointmentSlotLabel(value) {
    return /^No Time Preference\b/i.test(value) ? "Right Now" : value;
  }

  function clickVirtualAppointmentDay(command) {
    validateVirtualAppointmentCommand(command);
    const dayId = String(command.dayId || "");
    const headers = Array.from(document.querySelectorAll('.setappoinment a[href^="#"]'))
      .filter((element) => (element.getAttribute("href") || "").slice(1) === dayId)
      .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
    if (headers.length !== 1 || !document.getElementById(dayId)) throw new Error("That appointment day is no longer available. Refresh the phone.");
    headers[0].click();
  }

  async function clickVirtualAppointmentSlot(command) {
    validateVirtualAppointmentCommand(command);
    const panel = document.getElementById(String(command.dayId || ""));
    const time = sanitizeText(command.time || "");
    if (!panel || !time) throw new Error("That appointment time is no longer available. Refresh the phone.");
    if (!/\bin\b/.test(panel.className || "")) {
      const headers = Array.from(document.querySelectorAll('.setappoinment a[href^="#"]'))
        .filter((element) => (element.getAttribute("href") || "").slice(1) === panel.id)
        .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
      if (headers.length !== 1) throw new Error("That appointment day is no longer available. Refresh the phone.");
      headers[0].click();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    const slots = Array.from(panel.querySelectorAll(".appointmentslot"))
      .filter((element) => appointmentSlotLabel(sanitizeText(element.innerText || element.textContent || "")) === time)
      .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
    if (slots.length !== 1) throw new Error("That appointment time is no longer available. Refresh the phone.");
    const target = slots[0].querySelector("a, button, input, [role='button'], [onclick]") || slots[0];
    if (target.disabled || target.getAttribute("aria-disabled") === "true") throw new Error("That appointment time is unavailable in IMPACT.");
    target.click();
    await submitVirtualAppointmentEmail();
    // The next phone call belongs to the next lead, not this appointment page.
    sessionStorage.removeItem("impact.virtualAppointmentContext");
  }

  async function submitVirtualAppointmentEmail() {
    const deadline = Date.now() + 4000;
    let dialog;
    while (Date.now() < deadline) {
      dialog = document.querySelector("#emailOptionDialog");
      if (dialog?.getClientRects().length) break;
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    if (!dialog?.getClientRects().length) throw new Error("IMPACT did not open the email confirmation. Complete it on your computer.");
    const accountEmail = await getAccountEmail();
    if (!accountEmail) throw new Error("Could not find your Companion account email for CC. Complete the email dialog on your computer.");
    const inputs = Array.from(dialog.querySelectorAll('input:not([type="hidden"]'))
      .filter((element) => !element.disabled && !element.readOnly);
    const ccCandidates = inputs.filter((element) => /\bcc\b/i.test([
      element.name, element.id, element.placeholder, element.getAttribute("aria-label"),
      element.previousElementSibling?.textContent, element.parentElement?.previousElementSibling?.textContent
    ].filter(Boolean).join(" ")));
    const ccInput = ccCandidates.length === 1 ? ccCandidates[0] : inputs.length === 2 ? inputs[1] : null;
    if (!ccInput) throw new Error("Could not identify IMPACT's CC field. Complete the email dialog on your computer.");
    setInputValue(ccInput, accountEmail);
    const submits = Array.from(dialog.querySelectorAll('button, input[type="submit"], input[type="button"]'))
      .filter((element) => /^(Submit)$/i.test(sanitizeText(element.value || element.innerText || element.textContent || "")))
      .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true" && element.getClientRects().length);
    if (submits.length !== 1) throw new Error("Could not find the email confirmation Submit button. Complete the dialog on your computer.");
    submits[0].click();
  }

  async function getAccountEmail() {
    try {
      const stored = await chrome.storage.local.get("impact.supabase.session");
      const session = typeof stored["impact.supabase.session"] === "string"
        ? JSON.parse(stored["impact.supabase.session"]) : stored["impact.supabase.session"];
      const email = String(session?.user?.email || "").trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
    } catch (_error) {
      return "";
    }
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter ? setter.call(input, value) : input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function submitCallResult(command, choice) {
    resultDialogsBeforeSubmit = new WeakSet(document.querySelectorAll(".bootbox.bootbox-alert"));
    sessionStorage.setItem("impact.pendingResultAdvance", JSON.stringify({
      leadId: command.leadId,
      requestedAt: Date.now(),
      awaitingOK: command.type === "refused-appointment"
    }));
    try {
      choice.click();
    } catch (error) {
      sessionStorage.removeItem("impact.pendingResultAdvance");
      throw error;
    }
    sessionStorage.removeItem("impact.phoneCallContext");
  }

  function finishResultAdvance() {
    const key = "impact.pendingResultAdvance";
    const pending = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!pending) return;
    if (Date.now() - pending.requestedAt > 20000) {
      sessionStorage.removeItem(key);
      void chrome.runtime.sendMessage({ type: "impact/commandResult", message: "IMPACT did not return to the lead page. Check the result on your computer before moving on." }).catch(() => {});
      return;
    }
    if (pending.awaitingOK && location.pathname === "/Lead/WhatHappend" && document.visibilityState === "visible") {
      const dialogs = Array.from(document.querySelectorAll('.bootbox.bootbox-alert[role="dialog"]'))
        .filter((dialog) => !resultDialogsBeforeSubmit.has(dialog) && dialog.getClientRects().length);
      if (dialogs.length === 1) {
        const buttons = Array.from(dialogs[0].querySelectorAll(".modal-footer button"))
          .filter((button) => sanitizeText(button.innerText || button.textContent || "") === "OK" &&
            !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length);
        if (buttons.length === 1) {
          pending.awaitingOK = false;
          sessionStorage.setItem(key, JSON.stringify(pending));
          buttons[0].click();
          return;
        }
      }
    }
    // Do not navigate away from a result form while IMPACT may still be saving.
    // This marker survives a full-page redirect back to the lead details.
    if (location.pathname !== "/Lead/InboxDetail" || document.visibilityState !== "visible") return;
    const currentId = getCurrentLeadId();
    if (!currentId) return;
    if (currentId !== pending.leadId) {
      // IMPACT already advanced. Never click Next again and skip a lead.
      sessionStorage.removeItem(key);
      return;
    }
    const next = findLeadNavigationButton("down");
    if (!next) return;
    sessionStorage.removeItem(key);
    next.click();
  }

  function clickWithoutDesktopDialer(target) {
    // Keep IMPACT's click handlers running, but cancel the browser's default
    // protocol-link action during this one phone-initiated click. Also catches
    // a tel: anchor synchronously clicked by IMPACT's handler.
    const preventDialer = (event) => {
      const link = event.target?.closest?.("a[href]");
      const href = link?.getAttribute("href") || "";
      if (event.target === target || target.contains(event.target) || /^(tel|callto|sip|sips):/i.test(href.trim())) {
        event.preventDefault();
      }
    };
    window.addEventListener("click", preventDialer, true);
    try {
      target.click();
    } finally {
      window.removeEventListener("click", preventDialer, true);
    }
  }

  function findLeadNavigationButton(direction) {
    const iconName = direction === "down" ? "keyboard_arrow_down" : "keyboard_arrow_up";
    const route = direction === "down" ? "/Lead/MoveNext" : "/Lead/MovePrevious";
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length > 0);
    // Match IMPACT's existing navigation action even when its icon markup changes.
    return buttons.find((button) => (button.getAttribute("onclick") || "").includes(`${route}?`))
      || buttons.find((button) => sanitizeText(button.innerText || button.textContent || "") === iconName);
  }

  async function readCurrentLeadForPhone() {
    if (location.pathname !== "/Lead/InboxDetail" || !(await isOriginAllowed())) return null;
    const lead = collectLocalLeadPreview();
    if (!lead.available || !lead.leadId || !leadReadyForPhone(lead)) return null;
    await addQuietHoursContext(lead);
    if (nextLeadCache?.pageUrl === location.href && Date.now() < nextLeadCache.expiresAt) lead.nextLead = nextLeadCache.lead;
    lead.scriptDetails = collectScriptDetails(document.querySelector("#primaryPanel"), lead.requestType, lead.leadName);
    logGroupRead(lead);
    return lead;
  }

  // Name and phones normally arrive together. If IMPACT shows one in a format
  // this page does not recognise, still publish once the lead has settled, so
  // the phone never stays on the previous lead.
  function leadReadyForPhone(lead) {
    if (lead.leadName && lead.phones?.length) return true;
    if (!lead.leadId) return false;
    if (incompleteLead.leadId !== lead.leadId) incompleteLead = { leadId: lead.leadId, since: Date.now(), logged: false };
    if (Date.now() - incompleteLead.since < INCOMPLETE_LEAD_SETTLE_MS) return false;
    if (!incompleteLead.logged) {
      incompleteLead.logged = true;
      void log("warn", "phoneSync.incompleteLead", { hasName: Boolean(lead.leadName), phoneCount: lead.phones?.length || 0 }).catch(() => {});
    }
    return true;
  }

  async function runAutoPublishCheck() {
    // A check requested while one is running (e.g. the new lead finished
    // rendering) runs right after it instead of being dropped.
    if (autoPublishBusy) { autoPublishAgain = true; return; }
    autoPublishBusy = true;
    autoPublishAgain = false;
    try {
      if (!(await chrome.runtime.sendMessage({ type: 'impact/authStatus' }))?.ok) return;
      const allowed = await isOriginAllowed();
      if (!allowed) {
        return;
      }

      const autoPublish = await isAutoPublishEnabled();
      if (!autoPublish) {
        return;
      }

      if (location.pathname === "/Lead/SetAppointment") {
        const appointmentOptions = collectVirtualAppointmentOptions();
        if (!appointmentOptions) return;
        const fingerprint = JSON.stringify(appointmentOptions);
        if (fingerprint === lastAppointmentOptionsFingerprint) return;
        const response = await chrome.runtime.sendMessage({ type: "impact/publishAppointmentOptions", appointmentOptions });
        if (response?.ok) lastAppointmentOptionsFingerprint = fingerprint;
        return;
      }

      if (location.pathname !== "/Lead/InboxDetail") return;

      const lead = collectLocalLeadPreview();
      if (!lead.available || !leadReadyForPhone(lead)) {
        return;
      }

      const pageUrl = location.href;
      if (nextLeadCache?.pageUrl === pageUrl && Date.now() < nextLeadCache.expiresAt) {
        lead.nextLead = nextLeadCache.lead;
      }
      await addQuietHoursContext(lead);
      // Script-only values (DOB, group, ...) for the Salebase phone script. The
      // service worker removes them before anything is sent to the phone/cloud.
      lead.scriptDetails = collectScriptDetails(document.querySelector("#primaryPanel"), lead.requestType, lead.leadName);
      logGroupRead(lead);
      await publishCurrentLead(lead);
      if (!lead.nextLead) {
        // Preloading must not lock out publication of a newly opened lead.
        prefetchNextLead().then(() => {
          if (location.href === pageUrl) window.setTimeout(runAutoPublishCheck, 0);
        }).catch(() => {});
      }
    } catch (_error) {
      // Auto-publish should never interrupt the IMPACT page.
    } finally {
      autoPublishBusy = false;
      if (autoPublishAgain) { autoPublishAgain = false; window.setTimeout(runAutoPublishCheck, 0); }
    }
  }

  async function publishCurrentLead(lead) {
      const fingerprint = JSON.stringify({
        url: location.href,
        leadName: lead.leadName,
        leadId: lead.leadId,
        requestType: lead.requestType,
        callHistory: lead.callHistory,
        comments: lead.comments,
        language: lead.language,
        email: lead.email,
        address: lead.address,
        phones: lead.phones,
        quietHoursNoticeAt: lead.quietHoursNoticeAt || "",
        nextLeadName: lead.nextLead?.leadName || "",
        nextLeadRequestType: lead.nextLead?.requestType || "",
        nextLeadError: lead.nextLead?.error || "",
        nextLeadCandidate: lead.nextLead?.candidate?.safePath || ""
      });

      if (fingerprint === lastAutoPublishFingerprint && Date.now() - lastAutoPublishAt < 30000) {
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "impact/autoPublishLead",
        lead
      });
      if (response?.ok && (!response.result?.skipped || response.result.reason === "duplicate lead payload")) {
        lastAutoPublishFingerprint = fingerprint;
        lastAutoPublishAt = Date.now();
      }
  }

  async function isAutoPublishEnabled() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.autoPublish);
    return result[STORAGE_KEYS.autoPublish] !== false;
  }

  function extractLeadName(text) {
    // "CARTER, JAMES", also "CARTER JR., JAMES" (a suffix with a period).
    const match = text.match(/\b([A-Z][A-Z'\-]+(?:\s+(?:JR|SR|II|III|IV)\.?)?,\s+[A-Z][A-Z'\-]+)\b/);
    return sanitizeText(match?.[1] || "");
  }

  // Optional "Label: value" pairs on the lead panel that the Salebase script
  // has placeholders for. Only read when IMPACT shows such a label; unknown
  // or odd-looking values are left out so the script keeps its placeholder.
  const SCRIPT_DETAIL_LABELS = {
    dob: ["Date of Birth", "Birth Date", "Birthdate", "DOB"],
    group: ["Group Name", "Group", "Union Name", "Union Local", "Union", "Local", "Association Name", "Association", "Organization", "Employer Group"],
    beneficiary: ["Beneficiary Name", "Beneficiary"],
    spouse: ["Spouse Name", "Spouse"],
    kits: ["Number of Kits", "# of Kits", "Kits Requested", "Kits", "Number of Children", "# of Children", "Children"]
  };
  // Labels that sometimes carry the group; used only when the value looks like one.
  const GROUP_HINT_LABELS = ["Account Name", "Account", "Case Name", "Case", "Lead Source", "Source", "Campaign", "Sub Group", "Plan"];

  function readLabelledValue(text, label) {
    const match = text.match(new RegExp(`(?:^|[^A-Za-z#])${escapeRegExp(label)}\\s*:\\s*([^:]{1,80}?)(?=\\s+(?:[A-Z#][a-z']*(?: [A-Za-z#][a-z']*){0,4}|[A-Z]{2,5})\\s*:|$)`));
    const value = sanitizeText(match?.[1] || "");
    return value.length <= 60 ? value : "";
  }

  // A union/association group as IMPACT writes it: a name and number followed
  // by bracketed codes, e.g. "IUOE 148 (SGK2Q) (AD&D)" or "Local 150 (ABC12)".
  // The codes must contain a letter, so phone numbers "(555) ..." never match.
  const GROUP_CODE = /(?:^|[\s,;:|\-\u2013\u2014])((?:(?:[A-Z][A-Z&.'\/-]*[A-Z&.]|Local|Lodge|District|Council|Chapter)\s+){1,4}#?\d{1,5}[A-Z]?)((?:\s*\((?=[^()]*[A-Za-z])[A-Za-z0-9&\/.' -]{1,20}\))+)/g;
  // Words that come before a number in addresses/phones, never a group.
  const NOT_GROUP_WORDS = new Set(["APT", "UNIT", "STE", "SUITE", "LOT", "BLDG", "RM", "FL", "BOX", "PO", "HWY", "RTE", "ROUTE", "CR", "SR", "US", "RR", "HC", "EXT", "ST", "AVE", "RD", "DR", "LN", "CT", "HOME", "MOBILE", "WORK", "CELL", "FAX", "PHONE"]);
  // Heading words that may run into the group in flattened text.
  const GROUP_LEAD_IN = new Set(["REQUEST", "TYPE", "MEMBER", "RESPONSE", "REPLY", "CARD", "CARDS", "LEAD", "GROUP", "NAME", "SOURCE", "UNION", "ASSOCIATION", "THE", "OF", "AND", "FOR"]);

  function findGroupCode(text) {
    for (const match of String(text || "").matchAll(GROUP_CODE)) {
      const words = match[1].trim().split(/\s+/);
      const number = words.pop();
      while (words.length > 1 && GROUP_LEAD_IN.has(words[0].toUpperCase())) words.shift();
      const last = words[words.length - 1].toUpperCase().replace(/\./g, "");
      if (NOT_GROUP_WORDS.has(last) || GROUP_LEAD_IN.has(last)) continue;
      if (/^\d{5}$/.test(number) && /^[A-Z]{2}$/.test(last)) continue; // "IL 62704 (...)": a ZIP code
      return sanitizeText(`${words.join(" ")} ${number} ${match[2].trim()}`);
    }
    return "";
  }

  // The request table's cells (the one the request type is read from; on
  // Response Card leads its 2nd-row cell holds the group, e.g.
  // "IBT 610 (SGCOY) (AD&D)"). headers: the row above; label: any heading
  // just before the table.
  function collectRequestTable(panel) {
    const table = panel?.querySelector?.("#myTabContentJust div:nth-of-type(4) > table.table-bordered");
    const rows = table ? Array.from(table.querySelectorAll("tr")) : [];
    const cellsOf = (row) => Array.from(row?.querySelectorAll("th, td") || []).map((cell) => sanitizeText(cell.innerText || cell.textContent || ""));
    const headers = cellsOf(rows[0]);
    const values = cellsOf(rows[1]);
    const label = sanitizeText(table?.previousElementSibling?.innerText || table?.previousElementSibling?.textContent || "").slice(0, 40);
    return { headers, values, cells: rows.flatMap(cellsOf), label };
  }

  // Where the group came from ("label:Group", "table:Group", "request type",
  // "pattern", ...) is kept for the impact.groupRead log only.
  function readGroup(panel, text, requestType, leadName) {
    for (const label of SCRIPT_DETAIL_LABELS.group) {
      const value = readLabelledValue(text, label);
      if (value) return { group: value, source: `label:${label}` };
    }
    const table = collectRequestTable(panel);
    // A group heading takes its value as written; a weaker one ("Account",
    // "Source", ...) only when the value looks like a group code.
    const labelKind = (text) => {
      const key = String(text || "").replace(/:$/, "").trim().toLowerCase();
      if (SCRIPT_DETAIL_LABELS.group.some((label) => label.toLowerCase() === key)) return "group";
      return GROUP_HINT_LABELS.some((label) => label.toLowerCase() === key) ? "hint" : "";
    };
    const accept = (heading, value) => {
      const kind = labelKind(heading);
      if (!value || !kind) return "";
      return kind === "group" ? value.slice(0, 60) : findGroupCode(value);
    };
    for (const [index, header] of table.headers.entries()) {
      const value = accept(header, table.values[index]);
      if (value) return { group: value, source: `table:${header}`, table };
    }
    const underLabel = accept(table.label, table.values[0]);
    if (underLabel) return { group: underLabel, source: `table:${table.label}`, table };
    const fromType = findGroupCode(String(requestType || "").replace(/response\s*cards?|reply\s*cards?|(?:union|association)?\s*member\s*request/gi, " "));
    if (fromType) return { group: fromType, source: "request type", table };
    for (const cell of table.cells) {
      const found = findGroupCode(cell);
      if (found) return { group: found, source: "request table", table };
    }
    for (const label of GROUP_HINT_LABELS) {
      const found = findGroupCode(readLabelledValue(text, label));
      if (found) return { group: found, source: `label:${label}`, table };
    }
    const found = findGroupCode(leadName ? text.split(leadName).join(" ") : text);
    if (found) return { group: found, source: "pattern", table };
    return { group: "", source: "none", table };
  }

  function collectScriptDetails(panel, requestType = "", leadName = "") {
    const text = sanitizeText(panel?.innerText || panel?.textContent || "");
    const details = {};
    for (const [field, labels] of Object.entries(SCRIPT_DETAIL_LABELS)) {
      if (field === "group") continue;
      for (const label of labels) {
        const value = readLabelledValue(text, label);
        if (value) { details[field] = value; break; }
      }
    }
    const group = readGroup(panel, text, requestType, leadName);
    if (group.group) details.group = group.group;
    details.groupSource = group.source;
    // Headings only (no cell values), for the impact.groupRead log.
    if (group.table) details.groupTableHeaders = [group.table.label, ...group.table.headers].filter(Boolean).slice(0, 12);
    return details;
  }

  // One impact.groupRead log per lead: what was found and where.
  let lastGroupReadLead = "";
  function logGroupRead(lead) {
    const key = lead?.leadId || lead?.leadName || "";
    if (!key || key === lastGroupReadLead) return;
    lastGroupReadLead = key;
    const details = lead.scriptDetails || {};
    void log(details.group ? "info" : "warn", "impact.groupRead", {
      requestType: lead.requestType || "", group: details.group || "", source: details.groupSource || "none",
      tableHeaders: details.groupTableHeaders || []
    }).catch(() => {});
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

  function scrubFetchedUrl(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}${url.search ? "?..." : ""}`;
    } catch (_error) {
      return "";
    }
  }

  function getCurrentLeadId() {
    try {
      // IMPACT uses both LeadId= and leadid= in its URLs.
      const params = new URL(location.href).searchParams;
      for (const [name, value] of params) if (name.toLowerCase() === "leadid" && value) return value;
      return "";
    } catch (_error) {
      return "";
    }
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
    const attributes = [
      ["href", element.getAttribute("href")],
      ["formaction", element.getAttribute("formaction")],
      ["data-href", element.getAttribute("data-href")],
      ["data-url", element.getAttribute("data-url")],
      ["data-link", element.getAttribute("data-link")],
      ["onclick", element.getAttribute("onclick")]
    ].filter(([, value]) => value);

    for (const [name, value] of attributes) {
      if (name !== "onclick") {
        const directUrl = toSameOriginUrl(value);
        if (isLeadNavigationPath(directUrl?.pathname || "")) {
          return directUrl;
        }
      }

      const embeddedPath = String(value).match(/\/Lead\/(?:InboxDetail|MoveNext)[^'")\s;]*/i)?.[0];
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

  function isSafePrefetchPath(pathname) {
    return pathname.includes("/Lead/InboxDetail") && !pathname.includes("/Lead/MoveNext");
  }

  function getPrefetchNote(url) {
    if (!url) {
      return "No URL found on this control.";
    }

    if (url.pathname.includes("/Lead/MoveNext")) {
      return "Unsafe to prefetch: MoveNext changes IMPACT navigation state.";
    }

    return isSafePrefetchPath(url.pathname) ? "Safe direct detail URL." : "Unsupported lead navigation URL.";
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
