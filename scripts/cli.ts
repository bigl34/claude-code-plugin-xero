#!/usr/bin/env npx tsx
/**
 * Xero Accounting CLI
 *
 * Zod-validated CLI for Xero Accounting API operations.
 */

import { z, createCommand, runCli, cacheCommands, cliTypes } from "@local/cli-utils";
import { XeroClient } from "./xero-client.js";

// Define commands with Zod schemas
const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: XeroClient) => client.getTools(),
    "List all available commands"
  ),

  // ==================== Connections ====================
  "get-connections": createCommand(
    z.object({}),
    async (_args, client: XeroClient) => client.getConnections(),
    "Get connected Xero organisations (discover tenant IDs)"
  ),

  // ==================== Invoices ====================
  "list-invoices": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listInvoices({ page, where, order, tenantId });
    },
    "List invoices"
  ),

  "get-invoice": createCommand(
    z.object({
      id: z.string().min(1).describe("Invoice ID (UUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      return client.getInvoice(id, tenantId);
    },
    "Get specific invoice details"
  ),

  "create-invoice": createCommand(
    z.object({
      contact: z.string().min(1).describe("Contact name"),
      amount: cliTypes.float(0).describe("Line item amount"),
      description: z.string().optional().describe("Line item description"),
      quantity: cliTypes.float(0.01).optional().describe("Line item quantity"),
      accountCode: z.string().optional().describe("Account code"),
      type: z.enum(["ACCREC", "ACCPAY"]).optional().describe("Invoice type"),
      dueDate: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      reference: z.string().optional().describe("Reference number"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { contact, amount, description, quantity, accountCode, type, dueDate, reference, tenantId } = args as {
        contact: string; amount: number; description?: string; quantity?: number;
        accountCode?: string; type?: "ACCREC" | "ACCPAY"; dueDate?: string;
        reference?: string; tenantId?: string;
      };
      return client.createInvoice({
        contactName: contact,
        lineItems: [{
          description: description || "Invoice item",
          quantity: quantity || 1,
          unitAmount: amount,
          accountCode,
        }],
        type,
        dueDate,
        reference,
        tenantId,
      });
    },
    "Create a new invoice"
  ),

  "update-invoice": createCommand(
    z.object({
      id: z.string().min(1).describe("Invoice ID (UUID)"),
      status: z.string().optional().describe("Invoice status"),
      reference: z.string().optional().describe("Reference number"),
      dueDate: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, status, reference, dueDate, tenantId } = args as {
        id: string; status?: string; reference?: string; dueDate?: string; tenantId?: string;
      };
      return client.updateInvoice(id, { status, reference, dueDate, tenantId });
    },
    "Update an existing invoice"
  ),

  // ==================== Contacts ====================
  "list-contacts": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listContacts({ page, where, order, tenantId });
    },
    "List contacts/customers"
  ),

  "get-contact": createCommand(
    z.object({
      id: z.string().min(1).describe("Contact ID (UUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      return client.getContact(id, tenantId);
    },
    "Get specific contact details"
  ),

  "create-contact": createCommand(
    z.object({
      name: z.string().min(1).describe("Contact name"),
      email: z.string().optional().describe("Email address"),
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      phone: z.string().optional().describe("Phone number"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { name, email, firstName, lastName, phone, tenantId } = args as {
        name: string; email?: string; firstName?: string; lastName?: string;
        phone?: string; tenantId?: string;
      };
      return client.createContact({ name, email, firstName, lastName, phone, tenantId });
    },
    "Create a new contact"
  ),

  "update-contact": createCommand(
    z.object({
      id: z.string().min(1).describe("Contact ID (UUID)"),
      name: z.string().optional().describe("Contact name"),
      email: z.string().optional().describe("Email address"),
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      phone: z.string().optional().describe("Phone number"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, name, email, firstName, lastName, phone, tenantId } = args as {
        id: string; name?: string; email?: string; firstName?: string;
        lastName?: string; phone?: string; tenantId?: string;
      };
      return client.updateContact(id, { name, email, firstName, lastName, phone, tenantId });
    },
    "Update an existing contact"
  ),

  // ==================== Accounts ====================
  "list-accounts": createCommand(
    z.object({
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { where, order, tenantId } = args as {
        where?: string; order?: string; tenantId?: string;
      };
      return client.listAccounts({ where, order, tenantId });
    },
    "List chart of accounts"
  ),

  // ==================== Payments ====================
  "list-payments": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listPayments({ page, where, order, tenantId });
    },
    "List payment records"
  ),

  "create-payment": createCommand(
    z.object({
      id: z.string().min(1).describe("Invoice ID (UUID)"),
      accountCode: z.string().min(1).describe("Account code"),
      amount: cliTypes.float(0.01).describe("Payment amount"),
      date: z.string().optional().describe("Payment date (YYYY-MM-DD)"),
      reference: z.string().optional().describe("Reference number"),
      currencyRate: cliTypes.float(0.000001).optional().describe("Exchange rate override"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, accountCode, amount, date, reference, currencyRate, tenantId } = args as {
        id: string; accountCode: string; amount: number;
        date?: string; reference?: string; currencyRate?: number; tenantId?: string;
      };
      return client.createPayment({ invoiceId: id, accountCode, amount, date, reference, currencyRate, tenantId });
    },
    "Create a payment for an invoice"
  ),

  // ==================== Reports ====================
  "get-profit-and-loss": createCommand(
    z.object({
      fromDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      toDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
      periods: cliTypes.int(1).optional().describe("Number of periods"),
      timeframe: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().describe("Report timeframe"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { fromDate, toDate, periods, timeframe, tenantId } = args as {
        fromDate?: string; toDate?: string; periods?: number;
        timeframe?: "MONTH" | "QUARTER" | "YEAR"; tenantId?: string;
      };
      return client.getProfitAndLoss({ fromDate, toDate, periods, timeframe, tenantId });
    },
    "Profit & Loss report"
  ),

  "get-trial-balance": createCommand(
    z.object({
      date: z.string().optional().describe("Report date (YYYY-MM-DD)"),
      paymentsOnly: cliTypes.bool().optional().describe("Payments only"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { date, paymentsOnly, tenantId } = args as {
        date?: string; paymentsOnly?: boolean; tenantId?: string;
      };
      return client.getTrialBalance({ date, paymentsOnly, tenantId });
    },
    "Trial Balance report"
  ),

  "get-balance-sheet": createCommand(
    z.object({
      date: z.string().optional().describe("Report date (YYYY-MM-DD)"),
      periods: cliTypes.int(1).optional().describe("Number of periods"),
      timeframe: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().describe("Report timeframe"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { date, periods, timeframe, tenantId } = args as {
        date?: string; periods?: number;
        timeframe?: "MONTH" | "QUARTER" | "YEAR"; tenantId?: string;
      };
      return client.getBalanceSheet({ date, periods, timeframe, tenantId });
    },
    "Balance Sheet report"
  ),

  "get-aged-receivables": createCommand(
    z.object({
      id: z.string().optional().describe("Contact ID"),
      date: z.string().optional().describe("Report date (YYYY-MM-DD)"),
      fromDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      toDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, date, fromDate, toDate, tenantId } = args as {
        id?: string; date?: string; fromDate?: string; toDate?: string; tenantId?: string;
      };
      return client.getAgedReceivables({ contactId: id, date, fromDate, toDate, tenantId });
    },
    "Aged Receivables by contact"
  ),

  "get-aged-payables": createCommand(
    z.object({
      id: z.string().optional().describe("Contact ID"),
      date: z.string().optional().describe("Report date (YYYY-MM-DD)"),
      fromDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      toDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, date, fromDate, toDate, tenantId } = args as {
        id?: string; date?: string; fromDate?: string; toDate?: string; tenantId?: string;
      };
      return client.getAgedPayables({ contactId: id, date, fromDate, toDate, tenantId });
    },
    "Aged Payables by contact"
  ),

  // ==================== Other ====================
  "get-organisation": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      return client.getOrganisation(tenantId);
    },
    "Organisation details"
  ),

  "list-items": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      return client.listItems(tenantId);
    },
    "List inventory items"
  ),

  "list-tax-rates": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      return client.listTaxRates(tenantId);
    },
    "List tax rates"
  ),

  "list-credit-notes": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listCreditNotes({ page, where, order, tenantId });
    },
    "List credit notes"
  ),

  "list-bank-transactions": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listBankTransactions({ page, where, order, tenantId });
    },
    "List bank transactions"
  ),

  "list-quotes": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listQuotes({ page, where, order, tenantId });
    },
    "List quotes"
  ),

  "get-quote": createCommand(
    z.object({
      id: z.string().min(1).describe("Quote ID (UUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      return client.getQuote(id, tenantId);
    },
    "Get specific quote details"
  ),

  "list-overpayments": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listOverpayments({ page, where, order, tenantId });
    },
    "List overpayments"
  ),

  "list-prepayments": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, tenantId } = args as {
        page?: number; where?: string; order?: string; tenantId?: string;
      };
      return client.listPrepayments({ page, where, order, tenantId });
    },
    "List prepayments"
  ),

  "list-contact-groups": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      return client.listContactGroups(tenantId);
    },
    "List contact groups"
  ),

  // Pre-built cache commands
  ...cacheCommands<XeroClient>(),
};

// Run CLI
runCli(commands, XeroClient, {
  programName: "xero-cli",
  description: "Xero accounting operations",
});
