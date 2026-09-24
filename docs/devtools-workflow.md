# DevTools Workflow for IMPACT Element Discovery

Use this process to identify the IMPACT page elements the extension needs. Do not share passwords, full customer records, policy numbers, SSNs, payment details, or anything you would not want in a local development log.

## Identify Page Type

1. Open the IMPACT page in Chrome.
2. Confirm you are viewing a lead page you are allowed to access.
3. Copy only the non-sensitive parts of the URL pattern, such as the domain and route shape.
4. Add the exact origin in the extension Options page, for example `https://impact.example.com`.
5. Add a `leadPageHints.urlIncludes` value only when it is generic enough to avoid customer identifiers.

Example:

```json
"leadPageHints": {
  "urlIncludes": ["/lead", "/crm"],
  "titleIncludes": ["Lead"]
}
```

## Inspect A Field

1. Right-click the visible field in IMPACT.
2. Click **Inspect**.
3. In the Elements panel, confirm Chrome selected the element that actually contains the visible value.
4. Look for stable attributes:
   - `id`
   - `name`
   - `data-testid`
   - `aria-label`
   - nearby `<label for="...">`
5. Avoid selectors that include a customer name, phone number, database ID, or changing row number.

Good selector examples:

```css
#leadName
input[name="phone"]
[data-testid="lead-phone"]
textarea[name="notes"]
```

Risky selector examples:

```css
div:nth-child(7) > span:nth-child(2)
[href="/lead/123456789"]
span[title="Jane Customer"]
```

## Copy A Selector Safely

Chrome can generate a selector:

1. Right-click the highlighted element in DevTools.
2. Choose **Copy > Copy selector**.
3. Paste it into a scratch note.
4. Remove customer-specific or fragile pieces before adding it to extension Options.

You can also use the extension's **Pick Element** button. It records:

- selector
- tag name
- id/name/type
- label text
- small text sample
- page URL

It does not write to IMPACT.

## Test A Selector

In DevTools Console, test:

```js
document.querySelector("YOUR_SELECTOR_HERE")
```

To test the value:

```js
document.querySelector("YOUR_SELECTOR_HERE")?.innerText
document.querySelector("YOUR_SELECTOR_HERE")?.value
```

If the field appears only after waiting, scrolling, or opening a panel, document that behavior. That timing matters before we automate anything.

## Add To Extension Config

Open the extension Options page and update one field at a time:

```json
{
  "key": "leadName",
  "label": "Lead name",
  "selector": "#leadName",
  "attribute": "text"
}
```

Use `"attribute": "value"` for inputs and textareas. Use `"attribute": "text"` for normal visible text.

## What To Send Me

Send non-sensitive diagnostic info like:

- The generic URL shape.
- A screenshot with customer info blurred.
- The sanitized HTML for a single field.
- The picked element JSON from the Options page.
- Whether the value is plain text, input value, dropdown selection, or inside an iframe.
- What happens after clicking Save or Next, described without customer data.

## What Not To Send

- IMPACT username/password.
- Full customer names, phone numbers, addresses, policy numbers, SSNs, DOBs, or payment info.
- Raw HTML for an entire page if it contains customer records.
- Cookies, localStorage, sessionStorage, authorization headers, or network tokens.

