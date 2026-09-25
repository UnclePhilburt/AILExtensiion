export const STORAGE_KEYS = {
  allowedOrigins: "impact.allowedOrigins",
  selectorConfig: "impact.selectorConfig",
  bridgeUrl: "impact.bridgeUrl",
  bridgeToken: "impact.bridgeToken",
  autoPublish: "impact.autoPublish",
  inboxQueue: "impact.inboxQueue",
  logs: "impact.logs",
  lastSnapshot: "impact.lastSnapshot",
  impactTimeZone: "impact.timeZone",
  quietHoursNoticeAt: "impact.quietHoursNoticeAt"
};

export const DEFAULT_IMPACT_TIME_ZONE = "America/New_York";
export const IMPACT_TIME_ZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"]
];

export const LOG_LIMIT = 300;
