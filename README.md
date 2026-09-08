<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-xero

Xero accounting operations including invoices, contacts, payments, reports, quotes, and more via direct API

![Version](https://img.shields.io/badge/version-2.7.0-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- **get-connections** — Get connected Xero organisations (discover tenant IDs)
- **list-tools** — List all available commands

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/bigl34/claude-code-plugin-xero.git
cd claude-code-plugin-xero
cp scripts/config.template.json scripts/config.json  # fill in your credentials
npm --prefix scripts install
```

```bash
npm --prefix scripts run cli -- get-connections
```

## Installation

1. Clone this repository
2. Copy `scripts/config.template.json` to `scripts/config.json` and fill in your credentials
3. Install dependencies:
   ```bash
   cd scripts && npm install
   ```

## Configuration

Copy `scripts/config.template.json` to `scripts/config.json` and fill in the required values:

| Field | Placeholder |
|-------|-------------|
| `xero.clientId` | `YOUR_XERO_CLIENT_ID` |
| `xero.clientSecret` | `YOUR_XERO_CLIENT_SECRET` |

## Available Commands

| Command           | Description                                            | Required Options |
| ----------------- | ------------------------------------------------------ | ---------------- |
| `get-connections` | Get connected Xero organisations (discover tenant IDs) | (none)           |
| `list-tools`      | List all available commands                            | (none)           |

### Common Options

| Option                          | Description                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--id <id>`                     | Invoice/Contact/Record ID (UUID format)                                                                                                                                                                                                                                                                                               |
| `--contact <name>`              | Contact name for invoices                                                                                                                                                                                                                                                                                                             |
| `--name <name>`                 | Contact name                                                                                                                                                                                                                                                                                                                          |
| `--email <email>`               | Contact email                                                                                                                                                                                                                                                                                                                         |
| `--first-name <name>`           | Contact first name                                                                                                                                                                                                                                                                                                                    |
| `--last-name <name>`            | Contact last name                                                                                                                                                                                                                                                                                                                     |
| `--phone <phone>`               | Contact phone                                                                                                                                                                                                                                                                                                                         |
| `--amount <number>`             | Amount                                                                                                                                                                                                                                                                                                                                |
| `--description <text>`          | Line item description                                                                                                                                                                                                                                                                                                                 |
| `--quantity <number>`           | Line item quantity (default: 1)                                                                                                                                                                                                                                                                                                       |
| `--account-code <code>`         | Account code                                                                                                                                                                                                                                                                                                                          |
| `--account-id <id>`             | Exact bank/clearing AccountID; avoids an account-code lookup                                                                                                                                                                                                                                                                          |
| `--contact-id <id>`             | Exact Xero ContactID for advanced invoice/credit creation                                                                                                                                                                                                                                                                             |
| `--credit-note-id <id>`         | Exact Xero CreditNoteID for allocation/refund operations                                                                                                                                                                                                                                                                              |
| `--credit-note-number <number>` | Caller-supplied credit-note number for advanced creation                                                                                                                                                                                                                                                                              |
| `--invoice-number <number>`     | Exact ACCREC invoice number for advanced creation                                                                                                                                                                                                                                                                                     |
| `--line-items-json <json>`      | Strict non-empty advanced line array; invoice rows may add `ItemCode` and one of `DiscountRate` / `DiscountAmount`; credit rows may add only `ItemCode`, reject all discount fields, and require already-net `UnitAmount` values (use `0` for an intentional zero line or omit that line); never include record IDs or derived totals |
| `--line-amount-types <type>`    | `Exclusive`, `Inclusive`, or `NoTax` for advanced invoice/credit creation                                                                                                                                                                                                                                                             |
| `--idempotency-key <key>`       | Caller-chosen stable Xero write key, maximum 128 characters; every write path that exposes this flag requires it, and an identical retry must reuse the byte-for-byte same key                                                                                                                                                        |
| `--type <type>`                 | Invoice type: ACCREC or ACCPAY                                                                                                                                                                                                                                                                                                        |
| `--due-date <YYYY-MM-DD>`       | Due date                                                                                                                                                                                                                                                                                                                              |
| `--reference <text>`            | Reference number                                                                                                                                                                                                                                                                                                                      |
| `--status <status>`             | Invoice status                                                                                                                                                                                                                                                                                                                        |
| `--date <YYYY-MM-DD>`           | Report date                                                                                                                                                                                                                                                                                                                           |
| `--from-date <YYYY-MM-DD>`      | Report start date                                                                                                                                                                                                                                                                                                                     |
| `--to-date <YYYY-MM-DD>`        | Report end date                                                                                                                                                                                                                                                                                                                       |
| `--periods <number>`            | Number of periods                                                                                                                                                                                                                                                                                                                     |
| `--timeframe <frame>`           | MONTH, QUARTER, or YEAR                                                                                                                                                                                                                                                                                                               |
| `--page <number>`               | Page number                                                                                                                                                                                                                                                                                                                           |
| `--where <filter>`              | Xero filter expression                                                                                                                                                                                                                                                                                                                |
| `--order <field>`               | Sort order                                                                                                                                                                                                                                                                                                                            |
| `--tenant-id <id>`              | Xero tenant ID (for multi-org accounts)                                                                                                                                                                                                                                                                                               |
| `--no-cache`                    | Bypass cache for this request                                                                                                                                                                                                                                                                                                         |

## Usage Examples

```bash
# Discover tenant IDs (run first time!)
npm --prefix "scripts" run cli -- get-connections

# List all invoices
npm --prefix "scripts" run cli -- list-invoices

# Get specific invoice
npm --prefix "scripts" run cli -- get-invoice --id "12345678-1234-1234-1234-123456789012"

# Create a legacy single-line invoice with a caller-stable key.
npm --prefix "scripts" run cli -- create-invoice \
  --contact "ACME Corp" --amount 500 --description "Product sale" \
  --idempotency-key "legacy-invoice-acme-product-sale-v1"

# Create a synthetic example sales invoice (advanced mode). Do not mix this
# mode with the legacy --contact/--amount fields, and do not copy LineItemID
# values from an older invoice into the new line JSON.
npm --prefix "scripts" run cli -- create-invoice \
  --contact-id "12345678-1234-1234-1234-123456789012" \
  --invoice-number "EXAMPLE-INVOICE-001" \
  --date "2000-01-15" --due-date "2000-01-15" \
  --status AUTHORISED --line-amount-types Inclusive \
  --line-items-json '[{"Description":"Example product","Quantity":1,"UnitAmount":100,"AccountCode":"200","TaxType":"OUTPUT2"},{"Description":"Example accessory","Quantity":1,"UnitAmount":25,"AccountCode":"200","TaxType":"OUTPUT2"}]' \
  --reference "Replacement for EXAMPLE-ORDER-001" \
  --idempotency-key "example-EXAMPLE-ORDER-001-r-invoice-v1"

# Record a payment to a bank account whose Xero Code is blank.
npm --prefix "scripts" run cli -- create-payment \
  --id "12345678-1234-1234-1234-123456789012" \
  --account-id "12345678-1234-1234-1234-123456789012" \
  --amount 125 --date "2000-01-15" \
  --reference "Shopify/manual receipt for EXAMPLE-ORDER-001" \
  --idempotency-key "example-EXAMPLE-ORDER-001-r-payment-v1"

# Create a synthetic example credit for order EXAMPLE-ORDER-002 as DRAFT. Advanced
# mode requires a stable unique credit-note number and accepts only new-line
# fields: never copy IDs, derived totals, DiscountRate, or DiscountAmount.
npm --prefix "scripts" run cli -- create-credit-note \
  --contact-id "12345678-1234-1234-1234-123456789012" \
  --credit-note-number "EXAMPLE-CREDIT-001" \
  --date "2000-01-20" --status DRAFT \
  --line-amount-types Inclusive \
  --line-items-json '[{"Description":"Full customer refund","Quantity":1,"UnitAmount":125,"AccountCode":"200","TaxType":"OUTPUT2"}]' \
  --reference "Replacement refund for EXAMPLE-ORDER-002" \
  --idempotency-key "example-EXAMPLE-ORDER-002-credit-v1"

# Read the exact DRAFT back by GUID and verify its complete LineItems before
# authorising. This read is a direct single-ID GET and is not cached.
npm --prefix "scripts" run cli -- get-credit-note \
  --id "12345678-1234-1234-1234-123456789012"

# After reviewing that DRAFT CreditNoteID/body, authorise exactly that ID. The
# command performs its own exact-ID GET before changing only Status.
npm --prefix "scripts" run cli -- authorise-credit-note \
  --credit-note-id "12345678-1234-1234-1234-123456789012" \
  --idempotency-key "example-EXAMPLE-ORDER-002-credit-authorise-v1"

# Refund that exact credit to the exact clearing account. The stable unique
# reference is required for GET-first reconciliation; no account/contact lookup
# is performed in this mode.
npm --prefix "scripts" run cli -- create-credit-note-refund \
  --credit-note-id "12345678-1234-1234-1234-123456789012" \
  --account-id "12345678-1234-1234-1234-123456789012" \
  --amount 125 --date "2000-01-20" \
  --reference "Shopify refund for EXAMPLE-ORDER-002" \
  --idempotency-key "example-EXAMPLE-ORDER-002-credit-refund-v1"

# List contacts
npm --prefix "scripts" run cli -- list-contacts

# Create contact
npm --prefix "scripts" run cli -- create-contact \
  --name "John Smith" --email "john@example.com" \
  --idempotency-key "contact-john-smith-v1"

# Create a legacy single-line credit note with a caller-stable key.
npm --prefix "scripts" run cli -- create-credit-note \
  --contact-id "12345678-1234-1234-1234-123456789012" \
  --amount 100 --description "Customer refund" \
  --idempotency-key "legacy-credit-contact-1234-v1"

# Allocate that exact credit note to an exact invoice with a caller-stable key.
npm --prefix "scripts" run cli -- allocate-credit-note \
  --credit-note-id "12345678-1234-1234-1234-123456789012" \
  --invoice-id "12345678-1234-1234-1234-123456789012" --amount 100 \
  --idempotency-key "allocation-credit-1234-invoice-1234-v1"

# Get profit and loss
npm --prefix "scripts" run cli -- get-profit-and-loss --from-date "2024-01-01" --to-date "2024-12-31"

# Get trial balance
npm --prefix "scripts" run cli -- get-trial-balance --date "2024-12-31"

# List chart of accounts (uses cache by default)
npm --prefix "scripts" run cli -- list-accounts

# List accounts bypassing cache
npm --prefix "scripts" run cli -- list-accounts --no-cache

# Get aged receivables
npm --prefix "scripts" run cli -- get-aged-receivables

# List payments
npm --prefix "scripts" run cli -- list-payments

# Clear cache
npm --prefix "scripts" run cli -- clear-cache

# List quotes
npm --prefix "scripts" run cli -- list-quotes

# List overpayments (customer prepayments)
npm --prefix "scripts" run cli -- list-overpayments
```

## How It Works

This plugin connects directly to the service's HTTP API. The CLI handles authentication, request formatting, pagination, and error handling, returning structured JSON responses.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication errors | Verify credentials in `config.json` |
| `ERR_MODULE_NOT_FOUND` | Run `cd scripts && npm install` |
| Rate limiting | The CLI handles retries automatically; wait and retry if persistent |
| Unexpected JSON output | Check API credentials haven't expired |

## Contributing

Issues and pull requests are welcome.

## License

MIT
