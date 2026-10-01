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
  let windowSlot = "";
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

  installPlanImport();
  startAutoPublishWatcher();
  startPhoneCommandWatcher();
  chrome.runtime.sendMessage({ type: "impact/windowSlot" }, (response) => paintPhoneWindowBadge(response?.slot));
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
      leadName: extractContactName(panel, text),
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
    // Read the actual value: request types are not a fixed list. Older IMPACT
    // pages put it in one fixed table position, but other lead types move the
    // same labelled row into a different table or section.
    const value = (element) => sanitizeText(element?.innerText || element?.textContent || "");
    const original = panel.querySelector("#myTabContentJust div:nth-of-type(4) > table.table-bordered > tbody > tr:nth-of-type(2) > td");
    if (value(original)) return value(original);

    const isTypeLabel = (text) => /^(?:request|lead)\s*type\s*:?(?:\s*\/\s*(?:request|lead)\s*type)?$/i.test(sanitizeText(text));
    for (const row of Array.from(panel.querySelectorAll("tr"))) {
      const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"));
      for (let index = 0; index < cells.length - 1; index += 1) {
        if (!isTypeLabel(value(cells[index]))) continue;
        const type = value(cells[index + 1]);
        if (type) return type;
      }
    }

    // Some newer cards use a label/value layout instead of a table.
    for (const label of Array.from(panel.querySelectorAll("label, dt, .label, .control-label"))) {
      if (!isTypeLabel(value(label))) continue;
      const targetId = label.getAttribute("for");
      const target = targetId ? panel.querySelector(`#${CSS.escape(targetId)}`) : null;
      const sibling = label.nextElementSibling;
      const type = value(target) || value(sibling);
      if (type) return type;
    }

    // Final fallback for a plain-text card such as "Lead Type: Referral".
    const match = value(panel).match(/(?:^|\n)\s*(?:request|lead)\s*type\s*:\s*([^\n]+)/i);
    return sanitizeText(match?.[1] || "");
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

    // inbox-page-size.js asks IMPACT for 100 rows before this reads them.
    // Skip a 10-row first paint so Next is not stuck on page one.
    if (!inboxListReady()) {
      return { capturedAt: new Date().toISOString(), count: 0, expanding: true };
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

  function leadFromInboxAnchor(element, order) {
    const url = toSameOriginUrl(element?.getAttribute?.("href") || "");
    if (!url || !url.pathname.includes("/Lead/InboxDetail")) return null;
    const leadId = url.searchParams.get("LeadId") || "";
    if (!leadId) return null;
    return {
      order,
      leadId,
      url: url.href,
      safePath: `${url.pathname}?LeadId=[redacted]`,
      text: redactCustomerText(element.innerText || element.textContent || "").slice(0, 80),
      activity: inboxRowActivity(element),
      selector: buildSelector(element)
    };
  }

  // The row under a name is IMPACT's latest activity ("No Answer on Sep 25...").
  // Another lead row is not activity.
  function inboxRowActivity(element) {
    const row = element?.closest?.("tr");
    const next = row?.nextElementSibling;
    if (!next || next.querySelector?.('a[href*="/Lead/InboxDetail?LeadId="]')) return "";
    return String(next.innerText || next.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);
  }

  // The Inbox grid's current sort. Links elsewhere on the page (recent leads,
  // duplicates from the scrolling table) must not reorder Next / Best next.
  function collectGridInboxQueue() {
    const grid = globalThis.dtLeadGrid;
    if (typeof grid?.rows !== "function") return [];
    const seen = new Set();
    const leads = [];
    try {
      grid.rows({ search: "applied", order: "current" }).every(function () {
        const node = typeof this.node === "function" ? this.node() : null;
        const link = node?.querySelector?.('a[href*="/Lead/InboxDetail?LeadId="]');
        const lead = leadFromInboxAnchor(link, leads.length);
        if (!lead || seen.has(lead.leadId)) return;
        seen.add(lead.leadId);
        leads.push(lead);
      });
    } catch (_error) {
      return [];
    }
    return leads;
  }

  // "Showing 1 to 10 of 86" is still the first page. Ready once the table
  // shows every lead, or 100 of them when the Inbox is longer than that.
  function inboxListReady() {
    const info = document.querySelector('#LeadTable_info')?.textContent || '';
    const match = info.match(/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i);
    if (!match) return false;
    const shown = Number(match[2]) - Number(match[1]) + 1;
    const total = Number(match[3]);
    if (!total) return false;
    return shown >= Math.min(100, total);
  }

  function collectInboxLeadQueue() {
    const fromGrid = collectGridInboxQueue();
    if (fromGrid.length) return fromGrid;
    const seen = new Set();
    const leads = [];
    const links = document.querySelectorAll('#LeadTable a[href*="/Lead/InboxDetail?LeadId="]');
    for (const element of (links.length ? links : document.querySelectorAll('a[href*="/Lead/InboxDetail?LeadId="]'))) {
      const lead = leadFromInboxAnchor(element, leads.length);
      if (!lead || seen.has(lead.leadId)) continue;
      seen.add(lead.leadId);
      leads.push(lead);
    }
    return leads;
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

  function installPlanImport() {
    if (!/^\/Lead\/Inbox\/?$/.test(location.pathname)) return;
    let importing=false, owner='', autoStarted=false;
    const panel=document.createElement('section'); panel.id='impactPlanImport';
    panel.style.cssText='position:relative;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px;margin:10px 0;background:#eef5ed;border:1px solid #a5bfa8;border-radius:8px;color:#163c30;font:14px system-ui';
    const button=document.createElement('button');button.type='button';button.textContent='Import inbox';
    const status=document.createElement('span');status.style.cssText='flex:1;min-width:160px;overflow-wrap:anywhere';panel.append(button,status);
    button.style.cssText='background:#173e32;color:white;border:0;border-radius:8px;padding:12px 20px;font:bold 15px system-ui;cursor:pointer';
    // Keep the bar in the inbox content, below IMPACT's fixed navigation.
    // The table may arrive after this content script runs.
    const mountImportPanel=()=>{
      const table=document.querySelector('#LeadTable');
      if(!table)return false;
      (table.closest('.dataTables_wrapper')||table).before(panel);
      return true;
    };
    if(!mountImportPanel()){
      const observer=new MutationObserver(()=>{if(mountImportPanel())observer.disconnect();});
      observer.observe(document.body,{childList:true,subtree:true});
    }
    const request=message=>chrome.runtime.sendMessage(message).then(result=>{if(!result?.ok)throw new Error(result?.error||'Could not reach Companion.');return result;});
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const pageKey=()=>Array.from(document.querySelectorAll('#LeadTable a[href*="/Lead/InboxDetail?LeadId="]')).map(a=>a.getAttribute('href')).join('|');
    async function changePage(control) {
      const before=pageKey();control.click();
      for(let i=0;i<80;i++){await pause(150);if(pageKey()&&pageKey()!==before)return;}
      throw new Error('The inbox page did not finish loading. Import again to resume safely.');
    }
    async function run() {
      if(importing)return;importing=true;button.disabled=true;let added=0,read=0;const skipped=[];
      try {
        const ready=await request({type:'impact/planStatus'});owner=ready.userId;
        if(!ready.enabled)throw new Error('Open Follow-up plan on the Companion website once, then try Import inbox again.');
        for(let i=0;i<40&&!inboxListReady();i++)await pause(250);
        if(!inboxListReady())throw new Error('Wait for the inbox to load, then import again.');
        const first=document.querySelector('#LeadTable_first');
        if(first&&!first.classList.contains('disabled')&&!first.closest('.disabled'))await changePage(first);
        const info=()=>{const m=(document.querySelector('#LeadTable_info')?.textContent||'').replace(/,/g,'').match(/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i);return m?{start:+m[1],end:+m[2],total:+m[3]}:null;};
        let range=info();
        for(let n=0;range&&range.start>1&&n<100;n++){const prev=document.querySelector('#LeadTable_previous');if(!prev)throw new Error('Go to the first inbox page, then import again.');await changePage(prev);range=info();}
        if(!range||range.start>1)throw new Error('Could not verify inbox page totals. Use the standard IMPACT inbox table and try again.');
        const expected=range.total;
        const seen=new Set();let pages=0;
        while(true) {
          if(++pages>100)throw new Error('Import paused after 100 pages. Narrow your inbox filter and import the remaining leads.');
          const links=collectInboxLeadQueue();
          if(!links.length)throw new Error('No inbox leads found. Check your inbox filters.');
          let fresh=0;
          for(const item of links) {
            if(seen.has(item.leadId))continue;seen.add(item.leadId);fresh++;
            status.textContent='Reading lead '+(read+1)+' · '+added+' new leads saved. Keep this inbox open.';
            const url=toSameOriginUrl(item.url);if(!url||url.pathname!=='/Lead/InboxDetail')throw new Error('Unexpected lead link; import stopped.');
            const response=await fetch(url.href,{credentials:'include',signal:AbortSignal.timeout(12000)});
            if(!response.ok)throw new Error('Could not read a lead. Import again to resume.');
            const doc=new DOMParser().parseFromString(await response.text(),'text/html');
            const lead=collectLocalLeadPreview(doc,'follow-up-import');lead.leadId=item.leadId;
            if(!lead.available)throw new Error('IMPACT did not return the contact panel for lead '+item.leadId+'. Your session may have expired. Refresh IMPACT, sign in if needed, then retry.');
            if(!lead.leadName||!lead.phones?.length){
              skipped.push({id:item.leadId,reason:!lead.leadName?'name not recognized':'phone field not recognized'});read++;
              status.textContent='Continuing import · lead '+item.leadId+': '+skipped[skipped.length-1].reason;
              continue;
            }
            const result=await request({type:'impact/planImport',expectedUser:owner,leads:[{leadId:lead.leadId,leadName:lead.leadName,requestType:lead.requestType,phones:lead.phones,callHistory:lead.callHistory}],note:'Import in progress: '+(read+1)+' read'});
            added+=result.added;read++;await pause(200);
          }
          const next=document.querySelector('#LeadTable_next');
          if(!next||next.classList.contains('disabled')||next.closest('.disabled')||next.getAttribute('aria-disabled')==='true')break;
          if(!fresh)throw new Error('Inbox pagination repeated a page. Import stopped; saved leads are safe.');
          await changePage(next);
        }
        if(read!==expected)throw new Error('Imported '+read+' of '+expected+' leads. The inbox changed or pagination stopped; import again to finish.');
        await request({type:'impact/planImport',expectedUser:owner,leads:[],note:'Import checked '+read+' leads, '+added+' new leads added.'+(skipped.length?' '+skipped.length+' need review: '+skipped.map(x=>x.id+' ('+x.reason+')').join(', '):'')});
        status.textContent='Done: '+read+' leads checked · '+added+' new leads added.';
        if(skipped.length){status.append(document.createTextNode(' '+skipped.length+' need review: '));for(const item of skipped){const link=document.createElement('a');link.href='/Lead/InboxDetail?LeadId='+encodeURIComponent(item.id);link.textContent='Lead '+item.id+' — '+item.reason;link.style.display='block';link.target='_blank';link.rel='noopener';status.append(link);}}else status.append(document.createTextNode(' Open Follow-up plan on your phone.'));
      }catch(error){status.textContent=error.message+' Saved leads will not be duplicated.';}
      finally{importing=false;button.disabled=false;}
    }
    button.addEventListener('click',()=>void run());
    async function autoCheck(){
      if(autoStarted||importing)return;
      const sunday=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short'}).format(new Date())==='Sun';
      if(!sunday)return;
      try{const ready=await request({type:'impact/planStatus'});if(ready.enabled&&inboxListReady()){autoStarted=true;void run();}}catch{}
    }
    setTimeout(autoCheck,4000);setInterval(autoCheck,30000);
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

  function paintPhoneWindowBadge(slot) {
    const nextSlot = slot === "1" || slot === "2" ? slot : "";
    const changed = windowSlot !== nextSlot;
    windowSlot = nextSlot;
    if (changed) {
      lastAutoPublishFingerprint = "";
      lastAppointmentOptionsFingerprint = "";
      window.setTimeout(runAutoPublishCheck, 0);
    }
    if (!["/Lead/InboxDetail", "/Lead/WhatHappend", "/Lead/SetAppointment"].includes(location.pathname)) return;
    const label = slot === '2' ? 'Phone 2' : slot === '1' ? 'Phone 1' : 'Extra window';
    let badge = document.getElementById('impact-companion-phone-slot');
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'impact-companion-phone-slot';
      badge.type = 'button';
      badge.title = 'Click to switch which phone controls this window';
      Object.assign(badge.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483646',
        padding: '8px 12px', borderRadius: '999px', border: '0', cursor: 'pointer',
        background: '#123b3a', color: '#f4fff8', font: '700 13px/1 system-ui, sans-serif',
        boxShadow: '0 8px 24px #123b3a44'
      });
      badge.addEventListener('click', () => {
        const next = badge.textContent === 'Phone 1' ? '2' : '1';
        chrome.runtime.sendMessage({ type: 'impact/setWindowSlot', slot: next }, (result) => {
          if (result?.ok) paintPhoneWindowBadge(result.slot);
        });
      });
      document.documentElement.append(badge);
    }
    badge.textContent = label;
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
      if (response?.result && Object.prototype.hasOwnProperty.call(response.result, 'slot')) paintPhoneWindowBadge(response.result.slot);
      const command = response?.result?.command;
      if (!command?.type) {
        return;
      }
      if (command.leadId && ["next", "previous", "best-next"].includes(command.type) && command.leadId !== getCurrentLeadId()) {
        await chrome.runtime.sendMessage({ type: "impact/commandResult", message: "Navigation skipped because the lead changed. Try again on the current lead." });
        return;
      }

      if (["virtual-appointment-day", "virtual-appointment-slot"].includes(command.type)) {
        let message;
        try {
          const callback = command.appointmentType === "callback";
          if (command.type === "virtual-appointment-day") {
            if (callback) clickCallbackAppointmentDay(command);
            else clickVirtualAppointmentDay(command);
            message = `${callback ? "Callback" : "Virtual appointment"} day selected. Choose a time on your phone.`;
          } else {
            if (callback) await clickCallbackAppointmentSlot(command);
            else await clickVirtualAppointmentSlot(command);
            void rememberWindowLead(getCurrentLeadId(), true);
            message = `${callback ? "Callback" : "Virtual appointment"} time selected in IMPACT.`;
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
          if (command.type !== "virtual-appointment") void rememberWindowLead(getCurrentLeadId(), true);
        } catch (error) {
          message = error.message;
        }
        await chrome.runtime.sendMessage({ type: "impact/commandResult", message });
        return;
      }

      if (command.type === "open-lead") {
        const target = String(command.targetLeadId || "");
        if (!/^\d{1,20}$/.test(target)) {
          await chrome.runtime.sendMessage({ type: "impact/commandResult", message: "That appointment could not be opened." });
          return;
        }
        if (target === getCurrentLeadId()) {
          await chrome.runtime.sendMessage({ type: "impact/commandResult", message: "That appointment is already on screen." });
          return;
        }
        location.assign(new URL(`/Lead/InboxDetail?LeadId=${encodeURIComponent(target)}`, location.origin).href);
        return;
      }

      if (["pres-done", "reschedule", "no-show", "send-text", "dropped-by", "add-comments", "in-home", "call-back", "left-message", "dropby-appointment"].includes(command.type)) {
        const labels = {
          "pres-done": "Pres Done", reschedule: "Reschedule", "no-show": "No Show", "send-text": "Send Text", "dropped-by": "Dropped By", "add-comments": "Add Comments",
          "in-home": "Set In - Home Appointment", "call-back": "Set Call Back Appointment", "left-message": "Left Message", "dropby-appointment": "Bad Number/Set Dropby Appointment"
        };
        try {
          if (command.type === "call-back") sessionStorage.setItem("impact.callbackAppointmentContext", JSON.stringify({ leadId: command.leadId, startedAt: Date.now() }));
          if (["in-home", "call-back", "left-message", "dropby-appointment"].includes(command.type)) openWhatHappened(labels[command.type]);
          else openDetailAction(labels[command.type]);
          if (command.type === "left-message") void rememberWindowLead(getCurrentLeadId(), true);
          await chrome.runtime.sendMessage({ type: "impact/commandResult", message: `${labels[command.type]} opened in IMPACT.` });
        } catch (error) {
          await chrome.runtime.sendMessage({ type: "impact/commandResult", message: error.message });
        }
        return;
      }

      if (command.type === "call") {
        try {
          void rememberWindowLead(getCurrentLeadId(), true);
          clickLeadCallButton(command);
          await log("info", "phone.callControlClicked", { phoneType: command.phoneType });
        } catch (error) {
          await log("warn", "phone.callControlFailed", { reason: error.message });
          await chrome.runtime.sendMessage({ type: "impact/commandResult", message: error.message });
        }
        return;
      }

      if (command.type === "next") {
        await openInboxNeighbor("next");
      }

      if (command.type === "previous") {
        await openInboxNeighbor("previous");
      }

      if (command.type === "best-next") {
        try {
          await openBestNextLead(command);
        } catch (error) {
          await chrome.runtime.sendMessage({ type: "impact/commandResult", message: error.message });
        }
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

  // Next / Previous follow the saved Inbox list. IMPACT's own arrows use a
  // separate cursor, so after a direct open they can jump back to an earlier lead.
  function neighborInQueue(queue, currentLeadId, direction, blockedIds) {
    const leads = (Array.isArray(queue) ? queue : []).filter((lead) => lead?.url && lead.leadId);
    const index = leads.findIndex((lead) => lead.leadId === currentLeadId);
    if (index === -1) return { status: "unknown" };
    const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : []).map((id) => String(id)));
    const step = direction === "previous" ? -1 : 1;
    let skipped = false;
    for (let cursor = index + step; cursor >= 0 && cursor < leads.length; cursor += step) {
      if (blocked.has(String(leads[cursor].leadId))) { skipped = true; continue; }
      return { status: "open", lead: leads[cursor] };
    }
    return { status: skipped ? "blocked" : "end" };
  }

  // The lead after the one just worked, even if IMPACT's cursor already moved.
  function leadAfterWorked(queue, finishedLeadId, currentLeadId, blockedIds) {
    const choice = neighborInQueue(queue, finishedLeadId, "next", blockedIds);
    if (choice.status === "open" && choice.lead.leadId === currentLeadId) return { status: "already", lead: choice.lead };
    return choice;
  }

  // Best next walks the Inbox once before it may offer someone again.
  // blockedIds is only the lead the other phone is on right now.
  function bestNextPool(queue, currentLeadId, seenIds, blockedIds) {
    const leads = (Array.isArray(queue) ? queue : []).filter((lead) => lead?.url && lead.leadId && lead.leadId !== currentLeadId);
    const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : []).map((id) => String(id)));
    const seen = new Set((Array.isArray(seenIds) ? seenIds : []).map((id) => String(id)).filter(Boolean));
    if (currentLeadId) seen.add(String(currentLeadId));
    const waiting = (lead) => !seen.has(String(lead.leadId)) && !blocked.has(String(lead.leadId));
    let pool = leads.filter(waiting);
    let freshPass = false;
    if (!pool.length && leads.some((lead) => !blocked.has(String(lead.leadId)))) {
      freshPass = true;
      seen.clear();
      if (currentLeadId) seen.add(String(currentLeadId));
      pool = leads.filter(waiting);
    }
    return { pool, seen: [...seen], freshPass };
  }

  function otherPhoneBlockedIds(record, mySlot) {
    const mine = String(mySlot || "");
    const blocked = [];
    for (const [slot, leadId] of Object.entries(record?.slots || {})) {
      if (slot !== mine && leadId) blocked.push(String(leadId));
    }
    // A lead that the other phone just completed should stay in that phone's
    // lane for a while. Otherwise, as soon as it advances, Best next on this
    // phone can pull the just-worked person back into the other workflow.
    for (const item of Array.isArray(record?.recent) ? record.recent : []) {
      if (String(item?.slot || "") !== mine && item?.leadId && Date.now() - Number(item.at) < OTHER_PHONE_RECENT_MS) {
        blocked.push(String(item.leadId));
      }
    }
    return [...new Set(blocked)];
  }

  const OTHER_PHONE_KEY = "impact.otherPhoneLeads";
  const OTHER_PHONE_RECENT_MS = 30 * 60 * 1000;
  const BEST_NEXT_SEEN_KEY = "impact.bestNextSeen";
  const BEST_NEXT_CACHE_KEY = "impact.bestNextDetails";
  const RECENT_ATTEMPT_MS = 4 * 60 * 60 * 1000;
  const DETAIL_CACHE_MS = 30 * 60 * 1000;
  const ACTIVITY_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

  function inboxActivityKind(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return "none";
    if (/\b(do not call|bad (phone|number)|wrong number|disconnected)\b/i.test(value)) return "bad-number";
    if (/\b(not interested|refused|declined)\b/i.test(value)) return "refused";
    if (/\bcall[- ]?back\b/i.test(value)) return "callback";
    if (/\b(appointment|appt)\b/i.test(value)) return "appointment";
    if (/\b(no answer|voice ?mail|left (a )?message|busy)\b/i.test(value)) return "no-answer";
    return "other";
  }

  function impactInstant(year, monthIndex, day, hour, minute) {
    const zone = "America/Chicago";
    const partsOf = (ms) => {
      const parts = {};
      for (const part of new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms))) parts[part.type] = Number(part.value);
      return parts;
    };
    const offsetAt = (ms) => {
      const parts = partsOf(ms);
      return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute) - Math.floor(ms / 60000) * 60000;
    };
    const wanted = Date.UTC(year, monthIndex, day, hour, minute);
    let instant = wanted - offsetAt(wanted);
    return wanted - offsetAt(instant);
  }

  function parseInboxActivityTime(text) {
    const match = String(text || "").match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(?:at\s+|-+\s*)?(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)?/i);
    if (!match) return null;
    const month = ACTIVITY_MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    const hasTime = Boolean(match[4]);
    const hour = hasTime ? Number(match[4]) % 12 + (/p/i.test(match[6]) ? 12 : 0) : 0;
    const minute = hasTime ? Number(match[5]) : 0;
    const check = new Date(Date.UTC(year, month, day));
    if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
    const at = impactInstant(year, month, day, hour, minute);
    return Number.isFinite(at) ? at : null;
  }

  // Lower tiers are called first. Missing activity (an older saved list) stays
  // in the scored group instead of being treated as never called.
  function bestLeadTier(activity, now) {
    if (activity == null) return 2;
    const kind = inboxActivityKind(activity);
    const at = parseInboxActivityTime(activity);
    if (kind === "callback") return at == null || at <= now ? 0 : 3;
    if (kind === "none") return 1;
    if (kind === "bad-number") return 4;
    if (kind === "appointment") return at != null && at <= now ? 2 : 4;
    if (kind === "refused") return 3;
    if (kind === "no-answer" && (at == null || now - at < RECENT_ATTEMPT_MS)) return 3;
    return 2;
  }

  function bestCallingGroup(leads, now) {
    const tagged = (Array.isArray(leads) ? leads : []).map((lead) => ({ lead, tier: bestLeadTier(lead?.activity, now) }));
    if (!tagged.length) return { tier: 2, leads: [] };
    const tier = Math.min(...tagged.map((item) => item.tier));
    return { tier, leads: tagged.filter((item) => item.tier === tier).map((item) => item.lead) };
  }

  function bestLeadScore(detail, typeScores, order) {
    const type = String(detail?.requestType || "").trim().toLowerCase();
    const notes = Number(detail?.historyCount) || 0;
    const freshness = Number.isInteger(order) ? Math.max(0, 0.35 - order * 0.01) : 0;
    return Number(typeScores?.[type] || 0) - 0.15 * notes + freshness;
  }

  function reviewingMessage(tier, count) {
    const who = { 0: "callbacks that are due", 1: "leads you have not called", 2: "leads ready to call", 3: "leads that were just tried", 4: "remaining Inbox leads" }[tier] || "Inbox leads";
    return `Reviewing ${count} ${who}...`;
  }

  function readBestNextSeen() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(BEST_NEXT_SEEN_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }

  function writeBestNextSeen(ids) {
    const unique = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))].slice(-200);
    sessionStorage.setItem(BEST_NEXT_SEEN_KEY, JSON.stringify(unique));
  }

  function readDetailCache() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(BEST_NEXT_CACHE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function writeDetailCache(cache) {
    const fresh = Object.entries(cache || {}).filter(([, detail]) => detail && Date.now() - Number(detail.at) < DETAIL_CACHE_MS).slice(-200);
    sessionStorage.setItem(BEST_NEXT_CACHE_KEY, JSON.stringify(Object.fromEntries(fresh)));
  }

  function detailCacheFresh(detail, now) {
    return Boolean(detail?.requestType != null && now - Number(detail.at) < DETAIL_CACHE_MS);
  }

  async function readInboxQueue() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.inboxQueue);
    const leads = stored[STORAGE_KEYS.inboxQueue]?.leads;
    return Array.isArray(leads) ? leads : [];
  }

  async function openInboxNeighbor(direction) {

    const blocked = await otherPhoneBlocked();
    const choice = neighborInQueue(await readInboxQueue(), getCurrentLeadId(), direction, blocked);
    if (choice.status === "open") {
      if (direction === "next") writeBestNextSeen([...readBestNextSeen(), getCurrentLeadId()]);
      location.assign(choice.lead.url);
      return;
    }
    if (choice.status === "blocked") {
      await chrome.runtime.sendMessage({ type: "impact/commandResult", message: "The other phone is on that lead." });
      return;
    }
    if (choice.status === "end") {
      await chrome.runtime.sendMessage({
        type: "impact/commandResult",
        message: direction === "previous" ? "This is the first lead in your Inbox." : "This is the last lead in your Inbox."
      });
      return;
    }
    await clickLeadNavigationButton(direction === "previous" ? "up" : "down");
  }

  async function openLeadAfterWorked(finishedLeadId, currentId) {
    const blocked = await otherPhoneBlocked();
    const choice = leadAfterWorked(await readInboxQueue(), finishedLeadId, currentId, blocked);
    if (choice.status === "already") return;
    if (choice.status === "blocked") {
      await chrome.runtime.sendMessage({ type: "impact/commandResult", message: "The other phone is on the next lead. Staying on this one." });
      return;
    }
    if (choice.status === "open") {
      writeBestNextSeen([...readBestNextSeen(), finishedLeadId]);
      location.assign(choice.lead.url);
      return;
    }
    if (currentId === finishedLeadId) await clickLeadNavigationButton("down");
  }

  async function openBestNextLead(command) {

    const queue = await readInboxQueue();
    const currentLeadId = getCurrentLeadId();
    const blocked = await otherPhoneBlocked();
    const choice = bestNextPool(queue, currentLeadId, readBestNextSeen(), blocked);
    if (!choice.pool.length) throw new Error(blocked.length ? "The other phone is on the only lead left in this pass." : "Open the IMPACT Inbox on your computer so the phone can see the list, then try again.");
    const now = Date.now();
    const group = bestCallingGroup(choice.pool, now);
    const cache = readDetailCache();
    const missing = group.leads.filter((lead) => !detailCacheFresh(cache[lead.leadId], now));
    if (missing.length) {
      await chrome.runtime.sendMessage({ type: "impact/commandResult", message: reviewingMessage(group.tier, missing.length) });
      const details = await mapWithLimit(missing, 4, async (candidate) => {
        const response = await fetch(candidate.url, { credentials: "include", signal: AbortSignal.timeout(6000), cache: "default" });
        if (!response.ok) return { candidate };
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        return { candidate, preview: collectLocalLeadPreview(doc, candidate.safePath) };
      });
      for (const item of details) {
        if (!item.preview?.available) continue;
        cache[item.candidate.leadId] = {
          requestType: String(item.preview.requestType || "").trim(),
          historyCount: item.preview.callHistory?.length || 0,
          at: now
        };
      }
      writeDetailCache(cache);
    }
    const ranked = group.leads
      .filter((lead) => detailCacheFresh(cache[lead.leadId], now))
      .map((lead) => ({ lead, detail: cache[lead.leadId], score: bestLeadScore(cache[lead.leadId], command.requestTypeScores, lead.order) }));
    if (!ranked.length) throw new Error("Companion could not read the Inbox lead details. Refresh IMPACT and try again.");
    ranked.sort((a, b) => b.score - a.score || a.lead.order - b.lead.order);
    const best = ranked[0];
    writeBestNextSeen([...choice.seen, best.lead.leadId]);
    const again = choice.freshPass ? " Starting over through the Inbox." : "";
    const type = best.detail.requestType;
    await chrome.runtime.sendMessage({ type: "impact/commandResult", message: `Opening your best next lead${type ? ` · ${type}` : ""}.${again}` });
    location.assign(best.lead.url);
  }

  async function automaticallyOpenBestNextLead() {
    const result = await chrome.runtime.sendMessage({ type: "impact/getBestNextScores" });
    await openBestNextLead({ requestTypeScores: result?.scores || {} });
  }

  // Only the phone's Best next lead switch may search the Inbox. Off means
  // the next row, even if this computer used to save "best" lead order.
  function resultAdvanceMode(pending) {
    return pending?.advance === "best" ? "best" : "next";
  }

  async function mapWithLimit(items, limit, task) {
    const results = new Array(items.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
    }));
    return results;
  }

  function openWhatHappened(heading) {
    const wanted = heading.toLowerCase();
    const link = [...document.querySelectorAll('#collapseThree a[name="search"]')].find((anchor) => {
      const title = (anchor.querySelector("h4")?.innerText || anchor.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      return title.startsWith(wanted);
    });
    if (!link) throw new Error(`${heading} is not on this page. Open Call - What Happened in IMPACT first.`);
    link.click();
  }

  function openDetailAction(label) {
    const wanted = label.toLowerCase();
    const link = [...document.querySelectorAll("a")].find((anchor) => {
      const text = (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return text === wanted || text.endsWith(` ${wanted}`);
    });
    if (!link) throw new Error(`${label} is not on this lead.`);
    const href = link.getAttribute("href") || "";
    if (href.startsWith("javascript:") || href.startsWith("#") || !href) {
      link.click();
      return;
    }
    location.assign(new URL(href, location.origin).href);
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
    // IMPACT sometimes emits a full URL before the #panelRefused fragment,
    // rather than the short href used by the older page. Use the fragment so
    // the phone action works with either version.
    const choices = Array.from(document.querySelectorAll('#statuscontainer #collapseFour a[href]'))
      .filter((element) => appointmentPanelId(element) === "panelRefused")
      .filter((element) => /^Refused Appointment\s*:/i.test(sanitizeText(element.innerText || element.textContent || "")));
    if (choices.length !== 1) throw new Error("Refused Appointment option was not found uniquely in IMPACT.");
    if (choices[0].getAttribute("aria-disabled") === "true") throw new Error("Refused Appointment is disabled in IMPACT.");
    choices[0].click();
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      validateCallResult(command);
      const panel = document.querySelector("#statuscontainer #panelRefused");
      const submits = panel ? Array.from(panel.querySelectorAll('input[type="button"], input[type="submit"], button, a[onclick]'))
        .filter((element) => /^(Submit)$/i.test(sanitizeText(element.value || element.textContent || "")))
        // The final numeric argument varies across IMPACT releases. The
        // function name is the stable, refusal-specific safety check.
        .filter((element) => /^\s*MarkResolveRefused\s*\(/.test(element.getAttribute("onclick") || "")) : [];
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

  function getCallbackAppointmentContext() {
    try {
      const context = JSON.parse(sessionStorage.getItem("impact.callbackAppointmentContext") || "null");
      if (!context?.leadId || !Number.isFinite(context.startedAt) || Date.now() - context.startedAt > 30 * 60 * 1000) return null;
      return context;
    } catch (_error) { return null; }
  }

  function validateCallbackAppointmentCommand(command) {
    if (location.pathname !== "/Lead/SetAppointment") throw new Error("Open Set Call Back Appointment in IMPACT, then choose a day and time.");
    const requestedAt = Date.parse(command.requestedAt);
    if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > 15000) throw new Error("Callback selection expired. Press it again on the phone.");
    const context = getCallbackAppointmentContext();
    if (!context || context.leadId !== command.leadId) throw new Error("This callback no longer matches the phone lead. Start the call from the phone again.");
    return context;
  }

  function collectVirtualAppointmentOptions() {
    if (location.pathname !== "/Lead/SetAppointment") return null;
    const context = getVirtualAppointmentContext();
    const root = document.querySelector(".setappoinment");
    if (!context || !root) return null;
    const days = [];
    for (const header of Array.from(root.querySelectorAll('a[href]')).slice(0, 40)) {
      const id = appointmentPanelId(header);
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

  function collectCallbackAppointmentOptions() {
    if (location.pathname !== "/Lead/SetAppointment" || String(document.querySelector("#appointmenttype")?.value || "").toLowerCase() !== "callback") return null;
    const context = getCallbackAppointmentContext();
    const root = document.querySelector(".setappoinment");
    if (!context || !root) return null;
    const days = [];
    for (const header of Array.from(root.querySelectorAll('a[href]')).slice(0, 40)) {
      const id = appointmentPanelId(header);
      const panel = id ? document.getElementById(id) : null;
      const label = sanitizeText(header.innerText || header.textContent || "");
      if (!id || !panel || !label) continue;
      const slots = Array.from(panel.querySelectorAll(".appointmentslot")).slice(0, 80)
        .map((slot) => callbackSlotLabel(sanitizeText(slot.innerText || slot.textContent || "")))
        .filter(Boolean);
      if (slots.length) days.push({ id, label, slots, selected: /\bin\b/.test(panel.className || "") || panel.getClientRects().length > 0 });
    }
    if (!days.length) return null;
    const selectedDayId = days.find((day) => day.selected)?.id || days[0].id;
    return { leadId: context.leadId, kind: "callback", days, selectedDayId };
  }

  function appointmentSlotLabel(value) {
    return /^No Time Preference\b/i.test(value) ? "Right Now" : value;
  }

  function callbackSlotLabel(value) {
    return /^No Time Preference\b/i.test(value) ? "No time preference" : value;
  }

  function appointmentPanelId(element) {
    const href = element.getAttribute("href") || "";
    const marker = href.lastIndexOf("#");
    return marker >= 0 ? href.slice(marker + 1) : "";
  }

  function clickVirtualAppointmentDay(command) {
    validateVirtualAppointmentCommand(command);
    const dayId = String(command.dayId || "");
    const headers = Array.from(document.querySelectorAll('.setappoinment a[href]'))
      .filter((element) => appointmentPanelId(element) === dayId)
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
      const headers = Array.from(document.querySelectorAll('.setappoinment a[href]'))
        .filter((element) => appointmentPanelId(element) === panel.id)
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

  function clickCallbackAppointmentDay(command) {
    validateCallbackAppointmentCommand(command);
    const dayId = String(command.dayId || "");
    const headers = Array.from(document.querySelectorAll('.setappoinment a[href]'))
      .filter((element) => appointmentPanelId(element) === dayId)
      .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
    if (headers.length !== 1 || !document.getElementById(dayId)) throw new Error("That callback day is no longer available. Refresh the phone.");
    headers[0].click();
  }

  async function clickCallbackAppointmentSlot(command) {
    validateCallbackAppointmentCommand(command);
    const panel = document.getElementById(String(command.dayId || ""));
    const time = sanitizeText(command.time || "");
    if (!panel || !time) throw new Error("That callback time is no longer available. Refresh the phone.");
    if (!/\bin\b/.test(panel.className || "")) {
      const headers = Array.from(document.querySelectorAll('.setappoinment a[href]'))
        .filter((element) => appointmentPanelId(element) === panel.id)
        .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
      if (headers.length !== 1) throw new Error("That callback day is no longer available. Refresh the phone.");
      headers[0].click(); await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    const slots = Array.from(panel.querySelectorAll(".appointmentslot"))
      .filter((element) => callbackSlotLabel(sanitizeText(element.innerText || element.textContent || "")) === time)
      .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
    if (slots.length !== 1) throw new Error("That callback time is no longer available. Refresh the phone.");
    (slots[0].querySelector("a, button, input, [role='button'], [onclick]") || slots[0]).click();
    sessionStorage.removeItem("impact.callbackAppointmentContext");
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
      awaitingOK: command.type === "refused-appointment",
      ...(command.advance === "best" || command.advance === "next" ? { advance: command.advance } : {})
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
    sessionStorage.removeItem(key);
    void (async () => {
      if (await resultAdvanceMode(pending) === "best") {
        if (currentId !== pending.leadId) return;
        try {
          await automaticallyOpenBestNextLead();
        } catch (_error) {
          await openInboxNeighbor("next");
        }
        return;
      }
      await openLeadAfterWorked(pending.leadId, currentId);
    })();
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
        const appointmentOptions = collectCallbackAppointmentOptions() || collectVirtualAppointmentOptions();
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

  async function windowPhoneSlot() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "impact/windowSlot" });
      if (response?.ok) paintPhoneWindowBadge(response.slot);
    } catch (_error) { /* the window can still show the lead */ }
    return windowSlot;
  }

  async function rememberWindowLead(leadId, called) {
    const id = String(leadId || "");
    const slot = await windowPhoneSlot();
    if (!id || (slot !== "1" && slot !== "2")) return;
    const stored = await chrome.storage.local.get(OTHER_PHONE_KEY).catch(() => ({}));
    const record = stored[OTHER_PHONE_KEY] && typeof stored[OTHER_PHONE_KEY] === "object" ? stored[OTHER_PHONE_KEY] : {};
    const recent = (Array.isArray(record.recent) ? record.recent : [])
      .filter((item) => Date.now() - Number(item.at) < OTHER_PHONE_RECENT_MS);
    if (called) recent.push({ leadId: id, slot, at: Date.now() });
    await chrome.storage.local.set({
      [OTHER_PHONE_KEY]: { slots: { ...(record.slots || {}), [slot]: id }, recent: recent.slice(-40) }
    }).catch(() => {});
  }

  async function otherPhoneBlocked() {
    const slot = await windowPhoneSlot();
    if (slot !== "1" && slot !== "2") return [];
    const stored = await chrome.storage.local.get(OTHER_PHONE_KEY).catch(() => ({}));
    return otherPhoneBlockedIds(stored[OTHER_PHONE_KEY], slot);
  }

  async function publishCurrentLead(lead) {
      void rememberWindowLead(lead?.leadId, false);
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

  function extractContactName(panel, text) {
    const contact=panel.querySelector('a[href*="EditRefferralLead"], a[href*="EditReferralLead"], a[href*="EditLead"]') || panel.querySelector('p.list-group-item-text')?.closest('a');
    const name=contact?.querySelector('span');
    return sanitizeText(name?.innerText || name?.textContent || '') || extractLeadName(text);
  }

  function collectPhoneEntries(panel, text) {
    const entries = [];
    for(const field of panel.querySelectorAll('span, label, dt')) {
      const labelText=sanitizeText(field.innerText||field.textContent||'');
      if(!/^(Mobile|Cell(?:ular)?|Home)(?:\s*(Phone|Number))?\s*:?$/i.test(labelText))continue;
      const value=field.nextElementSibling;
      const number=extractFirstPhone(value?.innerText||value?.textContent||'');
      if(number)entries.push({label:/home/i.test(labelText)?'Home':'Mobile',number,dialHref:'tel:'+toDialablePhone(number),source:'contact-field'});
    }

    for(const row of panel.querySelectorAll('p.list-group-item-text, .form-group, tr')) {
      const value=sanitizeText(row.innerText || row.textContent || '');
      for(const label of ['Mobile','Home']) {
        const phone=extractLabeledPhone(value,label);
        if(phone)entries.push({label,number:phone,dialHref:'tel:'+toDialablePhone(phone),source:'contact-row'});
      }
    }
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
      const textValue = sanitizeText((element.innerText || element.textContent || "")+" "+(element.getAttribute("aria-label")||"")+" "+(element.getAttribute("title")||""));
      const phone = extractFirstPhone(`${href} ${textValue}`);
      if (!phone) {
        continue;
      }

      entries.push({
        label: /mobile|cell/i.test(textValue) ? "Mobile" : "Home",
        number: phone,
        dialHref: `tel:${toDialablePhone(phone)}`,
        source: "call-link"
      });
    }

    return dedupePhones(entries);
  }

  function extractLabeledPhone(text, label) {
    const aliases=label==='Mobile'?'(?:Mobile|Cell(?:ular)?)':'Home';
    const match=text.match(new RegExp(aliases+'(?:\\s*(?:Phone|Number))?\\s*:?\\s*('+PHONE_PATTERN.source+')','i'));
    return normalizeDisplayPhone(match?.[1] || '');
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
