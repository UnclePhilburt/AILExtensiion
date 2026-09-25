export const DEFAULT_SELECTOR_CONFIG = {
  version: 1,
  leadPageHints: {
    urlIncludes: ["/Lead/Inbox", "/Lead/InboxDetail"],
    titleIncludes: ["Lead Inbox", "Detail"]
  },
  fields: [
    {
      key: "leadName",
      label: "Lead name",
      selector: "",
      attribute: "text"
    },
    {
      key: "phone",
      label: "Phone",
      selector: "",
      attribute: "text"
    },
    {
      key: "address",
      label: "Address",
      selector: "",
      attribute: "text"
    },
    {
      key: "notes",
      label: "Existing notes",
      selector: "",
      attribute: "value"
    }
  ]
};

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://mobile.impact.ailife.com",
  "https://salebase.ai"
];
