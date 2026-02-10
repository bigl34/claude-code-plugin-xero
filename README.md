<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-xero

Xero accounting operations including invoices, contacts, payments, reports, quotes, and more via direct API

![Version](https://img.shields.io/badge/version-2.1.9-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- **get-connections** — Get connected Xero organisations (discover tenant IDs)
- **list-tools** — List all available commands

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/YOUR_GITHUB_USER/claude-code-plugin-xero.git
cd claude-code-plugin-xero
cp scripts/config.template.json scripts/config.json  # fill in your credentials
cd scripts && npm install
```

```bash
node scripts/dist/cli.js get-connections
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

| Option                     | Description                             |
| -------------------------- | --------------------------------------- |
| `--id <id>`                | Invoice/Contact/Record ID (UUID format) |
| `--contact <name>`         | Contact name for invoices               |
| `--name <name>`            | Contact name                            |
| `--email <email>`          | Contact email                           |
| `--first-name <name>`      | Contact first name                      |
| `--last-name <name>`       | Contact last name                       |
| `--phone <phone>`          | Contact phone                           |
| `--amount <number>`        | Amount                                  |
| `--description <text>`     | Line item description                   |
| `--quantity <number>`      | Line item quantity (default: 1)         |
| `--account-code <code>`    | Account code                            |
| `--type <type>`            | Invoice type: ACCREC or ACCPAY          |
| `--due-date <YYYY-MM-DD>`  | Due date                                |
| `--reference <text>`       | Reference number                        |
| `--status <status>`        | Invoice status                          |
| `--date <YYYY-MM-DD>`      | Report date                             |
| `--from-date <YYYY-MM-DD>` | Report start date                       |
| `--to-date <YYYY-MM-DD>`   | Report end date                         |
| `--periods <number>`       | Number of periods                       |
| `--timeframe <frame>`      | MONTH, QUARTER, or YEAR                 |
| `--page <number>`          | Page number                             |
| `--where <filter>`         | Xero filter expression                  |
| `--order <field>`          | Sort order                              |
| `--tenant-id <id>`         | Xero tenant ID (for multi-org accounts) |
| `--no-cache`               | Bypass cache for this request           |

## Usage Examples

```bash
# Discover tenant IDs (run first time!)
node scripts/dist/cli.js get-connections

# List all invoices
node scripts/dist/cli.js list-invoices

# Get specific invoice
node scripts/dist/cli.js get-invoice --id "12345678-1234-1234-1234-123456789012"

# Create an invoice
node scripts/dist/cli.js create-invoice --contact "ACME Corp" --amount 500 --description "Product sale"

# List contacts
node scripts/dist/cli.js list-contacts

# Create contact
node scripts/dist/cli.js create-contact --name "John Smith" --email "john@example.com"

# Get profit and loss
node scripts/dist/cli.js get-profit-and-loss --from-date "2024-01-01" --to-date "2024-12-31"

# Get trial balance
node scripts/dist/cli.js get-trial-balance --date "2024-12-31"

# List chart of accounts (uses cache by default)
node scripts/dist/cli.js list-accounts

# List accounts bypassing cache
node scripts/dist/cli.js list-accounts --no-cache

# Get aged receivables
node scripts/dist/cli.js get-aged-receivables

# List payments
node scripts/dist/cli.js list-payments

# Clear cache
node scripts/dist/cli.js clear-cache

# List quotes
node scripts/dist/cli.js list-quotes

# List overpayments (customer prepayments)
node scripts/dist/cli.js list-overpayments
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
