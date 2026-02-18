/**
 * Xero API Client
 *
 * Direct client for the Xero Accounting REST API using OAuth 2.0 client credentials.
 * Replaces the MCP-based approach with direct HTTP calls.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";
import https from "https";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";
import type {
  ConfigFile,
  XeroConfig,
  TokenCache,
  TokenResponse,
  XeroConnection,
  Invoice,
  InvoicesResponse,
  Contact,
  ContactsResponse,
  Account,
  AccountsResponse,
  Payment,
  PaymentsResponse,
  CreditNote,
  CreditNotesResponse,
  BankTransaction,
  BankTransactionsResponse,
  Item,
  ItemsResponse,
  TaxRate,
  TaxRatesResponse,
  Organisation,
  OrganisationResponse,
  Report,
  ReportsResponse,
  Quote,
  QuotesResponse,
  Overpayment,
  OverpaymentsResponse,
  Prepayment,
  PrepaymentsResponse,
  ContactGroup,
  ContactGroupsResponse,
  ListOptions,
  ReportOptions,
  CreateInvoiceOptions,
  CreateContactOptions,
  CreatePaymentOptions,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API Constants
const XERO_IDENTITY_HOST = "identity.xero.com";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before actual expiry

// Scopes for Xero API access
const XERO_SCOPES = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings.read",
  "accounting.reports.read",
].join(" ");

// Initialize cache with namespace
const cache = new PluginCache({
  namespace: "xero-accounting-manager",
  defaultTTL: TTL.FIVE_MINUTES,
});

// Tenant ID stored in tmpfs for security (sensitive org identifier)
// Falls back to cache dir if tmpfs unavailable (non-sensitive degradation)
const TMPFS_CREDS_DIR = "YOUR_CREDENTIALS_PATH/xero";
const FALLBACK_DIR = join(homedir(), ".cache", "xero-accounting-manager");
const TENANT_ID_DIR = existsSync("/dev/shm") ? TMPFS_CREDS_DIR : FALLBACK_DIR;
const TENANT_ID_PATH = join(TENANT_ID_DIR, "tenant-id.txt");

export class XeroClient {
  private config: XeroConfig;
  private tokenCache: TokenCache | null = null;
  private tenantId: string | null = null;
  private cacheDisabled: boolean = false;

  constructor() {
    // Try multiple locations for config.json
    const possiblePaths = [
      join(__dirname, "config.json"),
      join(__dirname, "..", "config.json"),
    ];

    let configPath: string | null = null;
    for (const path of possiblePaths) {
      try {
        readFileSync(path, "utf-8");
        configPath = path;
        break;
      } catch {
        continue;
      }
    }

    if (!configPath) {
      throw new Error(`Config file not found. Tried: ${possiblePaths.join(", ")}`);
    }

    const configFile: ConfigFile = JSON.parse(readFileSync(configPath, "utf-8"));

    // Support both formats: direct xero.{} or mcpServer.env.XERO_*
    if (configFile.xero?.clientId && configFile.xero?.clientSecret) {
      this.config = configFile.xero;
    } else if (configFile.mcpServer?.env?.XERO_CLIENT_ID && configFile.mcpServer?.env?.XERO_CLIENT_SECRET) {
      this.config = {
        clientId: configFile.mcpServer.env.XERO_CLIENT_ID,
        clientSecret: configFile.mcpServer.env.XERO_CLIENT_SECRET,
      };
    } else {
      throw new Error(
        "Missing required config. Expected either xero.{clientId,clientSecret} or mcpServer.env.{XERO_CLIENT_ID,XERO_CLIENT_SECRET}"
      );
    }

    // Try to load cached tenant ID
    this.tenantId = this.loadTenantId();
  }

  // ============================================
  // CACHE CONTROL
  // ============================================

  /**
   * Disables caching for all subsequent requests.
   */
  disableCache(): void {
    this.cacheDisabled = true;
    cache.disable();
  }

  /**
   * Re-enables caching after it was disabled.
   */
  enableCache(): void {
    this.cacheDisabled = false;
    cache.enable();
  }

  /**
   * Returns cache statistics including hit/miss counts.
   */
  getCacheStats() {
    return cache.getStats();
  }

  /**
   * Invalidates a specific cache entry by key.
   * @param key - The cache key to invalidate
   */
  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }

  // ==================== Tenant ID Persistence ====================

  private loadTenantId(): string | null {
    try {
      if (existsSync(TENANT_ID_PATH)) {
        return readFileSync(TENANT_ID_PATH, "utf-8").trim();
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private saveTenantId(tenantId: string): void {
    try {
      if (!existsSync(TENANT_ID_DIR)) {
        mkdirSync(TENANT_ID_DIR, { recursive: true });
      }
      writeFileSync(TENANT_ID_PATH, tenantId, "utf-8");
    } catch {
      // Ignore errors
    }
  }

  private clearTenantId(): void {
    try {
      if (existsSync(TENANT_ID_PATH)) {
        rmSync(TENANT_ID_PATH);
      }
    } catch {
      // Ignore errors
    }
  }

  // ==================== Authentication ====================

  /**
   * Fetch OAuth access token from Xero
   */
  private fetchToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString("base64");

      const postData = `grant_type=client_credentials&scope=${encodeURIComponent(XERO_SCOPES)}`;

      const options = {
        hostname: XERO_IDENTITY_HOST,
        port: 443,
        path: "/connect/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const json: TokenResponse = JSON.parse(data);
            if (json.error) {
              reject(
                new Error(
                  `Xero OAuth error: ${json.error} - ${json.error_description || ""}`
                )
              );
            } else if (json.access_token) {
              // Cache the token with expiry
              this.tokenCache = {
                accessToken: json.access_token,
                expiresAt: Date.now() + (json.expires_in * 1000) - TOKEN_EXPIRY_BUFFER_MS,
              };
              resolve(json.access_token);
            } else {
              reject(new Error(`Unexpected Xero response: ${data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse Xero response: ${data}`));
          }
        });
      });

      req.on("error", (e) =>
        reject(new Error(`Xero token request failed: ${e.message}`))
      );
      req.write(postData);
      req.end();
    });
  }

  /**
   * Get access token (from cache or fetch new)
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.accessToken;
    }

    // Fetch new token
    return this.fetchToken();
  }

  /**
   * Get the tenant ID (from cache, discovery, or option)
   */
  private async getTenantId(optionTenantId?: string): Promise<string> {
    // Use option if provided
    if (optionTenantId) {
      return optionTenantId;
    }

    // Use cached tenant ID if available
    if (this.tenantId) {
      return this.tenantId;
    }

    // Auto-discover tenant ID
    const connections = await this.getConnections();
    if (connections.length === 0) {
      throw new Error("No Xero organisations connected. Please connect an organisation in the Xero Developer Portal.");
    }

    // Use the first connection
    this.tenantId = connections[0].tenantId;
    this.saveTenantId(this.tenantId);
    return this.tenantId;
  }

  // ==================== HTTP Request Handler ====================

  /**
   * Make an authenticated request to the Xero API
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>,
    queryParams?: Record<string, string>,
    options?: { tenantId?: string; skipTenant?: boolean }
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    // Build URL
    let url = endpoint.startsWith("http") ? endpoint : `${XERO_API_BASE}${endpoint}`;
    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, value);
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Add tenant ID header unless skipped (e.g., for connections endpoint)
    if (!options?.skipTenant) {
      const tenantId = await this.getTenantId(options?.tenantId);
      headers["Xero-Tenant-Id"] = tenantId;
    }

    // Make request
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Xero API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // ============================================
  // CONNECTIONS
  // ============================================

  /**
   * Gets connected Xero organisations.
   *
   * Used to discover available tenants for API calls.
   *
   * @returns Array of connected organisation objects
   *
   * @example
   * const connections = await client.getConnections();
   * // Returns: [{ tenantId, tenantName, ... }]
   */
  async getConnections(): Promise<XeroConnection[]> {
    const accessToken = await this.getAccessToken();

    const response = await fetch(XERO_CONNECTIONS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get connections (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<XeroConnection[]>;
  }

  // ============================================
  // TOOLS LIST
  // ============================================

  /**
   * Returns list of available CLI commands for this client.
   * @returns Array of tool definitions with name and description
   */
  getTools(): Array<{ name: string; description: string }> {
    return [
      // Connections
      { name: "get-connections", description: "Get connected Xero organisations" },

      // Invoices
      { name: "list-invoices", description: "List invoices with pagination and filtering" },
      { name: "get-invoice", description: "Get a specific invoice by ID" },
      { name: "create-invoice", description: "Create a new invoice" },
      { name: "update-invoice", description: "Update an existing invoice" },

      // Contacts
      { name: "list-contacts", description: "List contacts with pagination and filtering" },
      { name: "get-contact", description: "Get a specific contact by ID" },
      { name: "create-contact", description: "Create a new contact" },
      { name: "update-contact", description: "Update an existing contact" },

      // Accounts
      { name: "list-accounts", description: "List chart of accounts" },

      // Payments
      { name: "list-payments", description: "List payments with pagination" },
      { name: "create-payment", description: "Create a payment for an invoice" },

      // Bank Transactions
      { name: "list-bank-transactions", description: "List bank transactions" },

      // Credit Notes
      { name: "list-credit-notes", description: "List credit notes" },

      // Items
      { name: "list-items", description: "List inventory items" },

      // Tax Rates
      { name: "list-tax-rates", description: "List tax rates" },

      // Organisation
      { name: "get-organisation", description: "Get organisation details" },

      // Reports
      { name: "get-profit-and-loss", description: "Get Profit & Loss report" },
      { name: "get-balance-sheet", description: "Get Balance Sheet report" },
      { name: "get-trial-balance", description: "Get Trial Balance report" },
      { name: "get-aged-receivables", description: "Get Aged Receivables report" },
      { name: "get-aged-payables", description: "Get Aged Payables report" },

      // Quotes (additional)
      { name: "list-quotes", description: "List quotes" },
      { name: "get-quote", description: "Get a specific quote by ID" },

      // Overpayments/Prepayments (additional)
      { name: "list-overpayments", description: "List overpayments" },
      { name: "list-prepayments", description: "List prepayments" },

      // Contact Groups (additional)
      { name: "list-contact-groups", description: "List contact groups" },

      // Cache
      { name: "clear-cache", description: "Clear all cached data" },
      { name: "cache-stats", description: "Show cache statistics" },
      { name: "cache-invalidate", description: "Invalidate a specific cache key" },
    ];
  }

  // ============================================
  // INVOICE OPERATIONS
  // ============================================

  /**
   * Lists invoices with optional filtering and pagination.
   *
   * @param options - Filter and pagination options
   * @param options.page - Page number for pagination
   * @param options.where - Xero-style where clause (e.g., 'Status=="AUTHORISED"')
   * @param options.order - Sort order (e.g., 'Date DESC')
   * @param options.tenantId - Override tenant ID
   * @returns Array of invoice objects
   *
   * @example
   * // Get unpaid invoices
   * const invoices = await client.listInvoices({ where: 'AmountDue>0' });
   */
  async listInvoices(options?: ListOptions & { tenantId?: string }): Promise<Invoice[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const response = await this.request<InvoicesResponse>(
      "GET",
      "/Invoices",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Invoices || [];
  }

  /**
   * Retrieves a single invoice by ID.
   *
   * @param invoiceId - Xero invoice ID (GUID)
   * @param tenantId - Override tenant ID
   * @returns Invoice object or null if not found
   */
  async getInvoice(invoiceId: string, tenantId?: string): Promise<Invoice | null> {
    const response = await this.request<InvoicesResponse>(
      "GET",
      `/Invoices/${invoiceId}`,
      undefined,
      undefined,
      { tenantId }
    );
    return response.Invoices?.[0] || null;
  }

  /**
   * Creates a new invoice.
   *
   * Automatically creates the contact if it doesn't exist.
   *
   * @param options - Invoice creation options
   * @param options.contactName - Contact/customer name (required)
   * @param options.type - Invoice type: "ACCREC" (sales) or "ACCPAY" (purchase)
   * @param options.lineItems - Array of line items
   * @param options.dueDate - Due date (YYYY-MM-DD)
   * @param options.reference - Invoice reference
   * @param options.tenantId - Override tenant ID
   * @returns Created invoice object
   *
   * @invalidates contacts/*
   *
   * @example
   * const invoice = await client.createInvoice({
   *   contactName: "Customer Name",
   *   lineItems: [{ description: "Item", quantity: 1, unitAmount: 100 }],
   *   dueDate: "2024-02-01"
   * });
   */
  async createInvoice(options: CreateInvoiceOptions & { tenantId?: string }): Promise<Invoice> {
    // First, look up the contact by name
    const contacts = await this.listContacts({
      where: `Name=="${options.contactName}"`,
      tenantId: options.tenantId,
    });

    let contactId: string;
    if (contacts.length > 0) {
      contactId = contacts[0].ContactID;
    } else {
      // Create the contact if it doesn't exist
      const newContact = await this.createContact({
        name: options.contactName,
        tenantId: options.tenantId,
      });
      contactId = newContact.ContactID;
    }

    const invoiceBody = {
      Type: options.type || "ACCREC",
      Contact: { ContactID: contactId },
      LineItems: options.lineItems.map((item) => ({
        Description: item.description,
        Quantity: item.quantity,
        UnitAmount: item.unitAmount,
        AccountCode: item.accountCode || "200", // Default to Sales account
      })),
      DueDate: options.dueDate,
      Reference: options.reference,
      Status: "DRAFT",
    };

    const response = await this.request<InvoicesResponse>(
      "POST",
      "/Invoices",
      { Invoices: [invoiceBody] },
      undefined,
      { tenantId: options.tenantId }
    );

    if (!response.Invoices?.[0]) {
      throw new Error("Failed to create invoice - no invoice returned");
    }

    return response.Invoices[0];
  }

  /**
   * Updates an existing invoice.
   *
   * @param invoiceId - Xero invoice ID (GUID)
   * @param updates - Fields to update
   * @param updates.status - New status (e.g., "AUTHORISED", "VOIDED")
   * @param updates.reference - New reference
   * @param updates.dueDate - New due date (YYYY-MM-DD)
   * @param updates.tenantId - Override tenant ID
   * @returns Updated invoice object
   */
  async updateInvoice(
    invoiceId: string,
    updates: { status?: string; reference?: string; dueDate?: string; tenantId?: string }
  ): Promise<Invoice> {
    const invoiceBody: Record<string, any> = { InvoiceID: invoiceId };
    if (updates.status) invoiceBody.Status = updates.status;
    if (updates.reference) invoiceBody.Reference = updates.reference;
    if (updates.dueDate) invoiceBody.DueDate = updates.dueDate;

    const response = await this.request<InvoicesResponse>(
      "POST",
      `/Invoices/${invoiceId}`,
      { Invoices: [invoiceBody] },
      undefined,
      { tenantId: updates.tenantId }
    );

    if (!response.Invoices?.[0]) {
      throw new Error("Failed to update invoice - no invoice returned");
    }

    return response.Invoices[0];
  }

  // ============================================
  // CONTACT OPERATIONS
  // ============================================

  /**
   * Lists contacts with optional filtering and pagination.
   *
   * @param options - Filter and pagination options
   * @param options.page - Page number for pagination
   * @param options.where - Xero-style where clause (e.g., 'Name.Contains("Smith")')
   * @param options.order - Sort order
   * @param options.tenantId - Override tenant ID
   * @returns Array of contact objects
   *
   * @cached TTL: 1 hour
   */
  async listContacts(options?: ListOptions & { tenantId?: string }): Promise<Contact[]> {
    const cacheKey = createCacheKey("contacts", {
      page: options?.page,
      where: options?.where,
      order: options?.order,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const queryParams: Record<string, string> = {};
        if (options?.page) queryParams.page = options.page.toString();
        if (options?.where) queryParams.where = options.where;
        if (options?.order) queryParams.order = options.order;

        const response = await this.request<ContactsResponse>(
          "GET",
          "/Contacts",
          undefined,
          queryParams,
          { tenantId: options?.tenantId }
        );
        return response.Contacts || [];
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Retrieves a single contact by ID.
   *
   * @param contactId - Xero contact ID (GUID)
   * @param tenantId - Override tenant ID
   * @returns Contact object or null if not found
   */
  async getContact(contactId: string, tenantId?: string): Promise<Contact | null> {
    const response = await this.request<ContactsResponse>(
      "GET",
      `/Contacts/${contactId}`,
      undefined,
      undefined,
      { tenantId }
    );
    return response.Contacts?.[0] || null;
  }

  /**
   * Creates a new contact.
   *
   * @param options - Contact creation options
   * @param options.name - Contact name (required)
   * @param options.email - Email address
   * @param options.firstName - First name
   * @param options.lastName - Last name
   * @param options.phone - Phone number
   * @param options.tenantId - Override tenant ID
   * @returns Created contact object
   *
   * @invalidates contacts/*
   */
  async createContact(options: CreateContactOptions & { tenantId?: string }): Promise<Contact> {
    const contactBody: Record<string, any> = {
      Name: options.name,
    };
    if (options.email) contactBody.EmailAddress = options.email;
    if (options.firstName) contactBody.FirstName = options.firstName;
    if (options.lastName) contactBody.LastName = options.lastName;
    if (options.phone) {
      contactBody.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: options.phone }];
    }

    const response = await this.request<ContactsResponse>(
      "POST",
      "/Contacts",
      { Contacts: [contactBody] },
      undefined,
      { tenantId: options.tenantId }
    );

    if (!response.Contacts?.[0]) {
      throw new Error("Failed to create contact - no contact returned");
    }

    // Invalidate contacts cache
    cache.invalidatePattern(/^contacts/);

    return response.Contacts[0];
  }

  /**
   * Updates an existing contact.
   *
   * @param contactId - Xero contact ID (GUID)
   * @param updates - Fields to update
   * @returns Updated contact object
   *
   * @invalidates contacts/*
   */
  async updateContact(
    contactId: string,
    updates: {
      name?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      tenantId?: string;
    }
  ): Promise<Contact> {
    const contactBody: Record<string, any> = { ContactID: contactId };
    if (updates.name) contactBody.Name = updates.name;
    if (updates.email) contactBody.EmailAddress = updates.email;
    if (updates.firstName) contactBody.FirstName = updates.firstName;
    if (updates.lastName) contactBody.LastName = updates.lastName;
    if (updates.phone) {
      contactBody.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: updates.phone }];
    }

    const response = await this.request<ContactsResponse>(
      "POST",
      `/Contacts/${contactId}`,
      { Contacts: [contactBody] },
      undefined,
      { tenantId: updates.tenantId }
    );

    if (!response.Contacts?.[0]) {
      throw new Error("Failed to update contact - no contact returned");
    }

    // Invalidate contacts cache
    cache.invalidatePattern(/^contacts/);

    return response.Contacts[0];
  }

  // ============================================
  // ACCOUNT OPERATIONS
  // ============================================

  /**
   * Lists chart of accounts.
   *
   * @param options - Filter options
   * @param options.where - Xero-style where clause
   * @param options.order - Sort order
   * @param options.tenantId - Override tenant ID
   * @returns Array of account objects
   *
   * @cached TTL: 1 day
   */
  async listAccounts(options?: { where?: string; order?: string; tenantId?: string }): Promise<Account[]> {
    const cacheKey = createCacheKey("accounts", {
      where: options?.where,
      order: options?.order,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const queryParams: Record<string, string> = {};
        if (options?.where) queryParams.where = options.where;
        if (options?.order) queryParams.order = options.order;

        const response = await this.request<AccountsResponse>(
          "GET",
          "/Accounts",
          undefined,
          queryParams,
          { tenantId: options?.tenantId }
        );
        return response.Accounts || [];
      },
      { ttl: TTL.DAY, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // PAYMENT OPERATIONS
  // ============================================

  /**
   * Lists payments with optional filtering and pagination.
   *
   * @param options - Filter and pagination options
   * @returns Array of payment objects
   */
  async listPayments(options?: ListOptions & { tenantId?: string }): Promise<Payment[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const response = await this.request<PaymentsResponse>(
      "GET",
      "/Payments",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Payments || [];
  }

  /**
   * Creates a payment for an invoice.
   *
   * @param options - Payment creation options
   * @param options.invoiceId - Invoice ID to apply payment to
   * @param options.accountCode - Bank account code (e.g., "090")
   * @param options.amount - Payment amount
   * @param options.date - Payment date (YYYY-MM-DD)
   * @param options.reference - Payment reference
   * @param options.tenantId - Override tenant ID
   * @returns Created payment object
   */
  async createPayment(options: CreatePaymentOptions & { tenantId?: string }): Promise<Payment> {
    // Look up account by code
    const accounts = await this.listAccounts({ tenantId: options.tenantId });
    const account = accounts.find((a) => a.Code === options.accountCode);
    if (!account) {
      throw new Error(`Account with code ${options.accountCode} not found`);
    }

    const paymentBody = {
      Invoice: { InvoiceID: options.invoiceId },
      Account: { AccountID: account.AccountID },
      Amount: options.amount,
      Date: options.date || new Date().toISOString().split("T")[0],
      Reference: options.reference,
      ...(options.currencyRate !== undefined ? { CurrencyRate: options.currencyRate } : {}),
    };

    const response = await this.request<PaymentsResponse>(
      "PUT",
      "/Payments",
      { Payments: [paymentBody] },
      undefined,
      { tenantId: options.tenantId }
    );

    if (!response.Payments?.[0]) {
      throw new Error("Failed to create payment - no payment returned");
    }

    return response.Payments[0];
  }

  // ============================================
  // BANK TRANSACTION OPERATIONS
  // ============================================

  /**
   * Lists bank transactions with optional filtering.
   *
   * @param options - Filter and pagination options
   * @returns Array of bank transaction objects
   */
  async listBankTransactions(options?: ListOptions & { tenantId?: string }): Promise<BankTransaction[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const response = await this.request<BankTransactionsResponse>(
      "GET",
      "/BankTransactions",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.BankTransactions || [];
  }

  // ============================================
  // CREDIT NOTE OPERATIONS
  // ============================================

  /**
   * Lists credit notes with optional filtering.
   *
   * @param options - Filter and pagination options
   * @returns Array of credit note objects
   */
  async listCreditNotes(options?: ListOptions & { tenantId?: string }): Promise<CreditNote[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const response = await this.request<CreditNotesResponse>(
      "GET",
      "/CreditNotes",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.CreditNotes || [];
  }

  // ============================================
  // ITEM OPERATIONS
  // ============================================

  /**
   * Lists inventory items.
   *
   * @param tenantId - Override tenant ID
   * @returns Array of item objects
   */
  async listItems(tenantId?: string): Promise<Item[]> {
    const response = await this.request<ItemsResponse>(
      "GET",
      "/Items",
      undefined,
      undefined,
      { tenantId }
    );
    return response.Items || [];
  }

  // ============================================
  // TAX RATE OPERATIONS
  // ============================================

  /**
   * Lists tax rates.
   *
   * @param tenantId - Override tenant ID
   * @returns Array of tax rate objects
   *
   * @cached TTL: 1 day
   */
  async listTaxRates(tenantId?: string): Promise<TaxRate[]> {
    return cache.getOrFetch(
      "tax_rates",
      async () => {
        const response = await this.request<TaxRatesResponse>(
          "GET",
          "/TaxRates",
          undefined,
          undefined,
          { tenantId }
        );
        return response.TaxRates || [];
      },
      { ttl: TTL.DAY, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // ORGANISATION OPERATIONS
  // ============================================

  /**
   * Gets organisation details.
   *
   * @param tenantId - Override tenant ID
   * @returns Organisation object or null
   *
   * @cached TTL: 1 day
   */
  async getOrganisation(tenantId?: string): Promise<Organisation | null> {
    return cache.getOrFetch(
      "organisation",
      async () => {
        const response = await this.request<OrganisationResponse>(
          "GET",
          "/Organisation",
          undefined,
          undefined,
          { tenantId }
        );
        return response.Organisations?.[0] || null;
      },
      { ttl: TTL.DAY, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // REPORT OPERATIONS
  // ============================================

  /**
   * Gets Profit & Loss report.
   *
   * @param options - Report options
   * @param options.fromDate - Start date (YYYY-MM-DD)
   * @param options.toDate - End date (YYYY-MM-DD)
   * @param options.periods - Number of comparison periods
   * @param options.timeframe - Timeframe: "MONTH", "QUARTER", "YEAR"
   * @param options.tenantId - Override tenant ID
   * @returns Profit & Loss report or null
   */
  async getProfitAndLoss(options?: ReportOptions & { tenantId?: string }): Promise<Report | null> {
    const queryParams: Record<string, string> = {};
    if (options?.fromDate) queryParams.fromDate = options.fromDate;
    if (options?.toDate) queryParams.toDate = options.toDate;
    if (options?.periods) queryParams.periods = options.periods.toString();
    if (options?.timeframe) queryParams.timeframe = options.timeframe;

    const response = await this.request<ReportsResponse>(
      "GET",
      "/Reports/ProfitAndLoss",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Reports?.[0] || null;
  }

  /**
   * Gets Balance Sheet report.
   *
   * @param options - Report options
   * @param options.date - As-at date (YYYY-MM-DD)
   * @param options.periods - Number of comparison periods
   * @param options.timeframe - Timeframe: "MONTH", "QUARTER", "YEAR"
   * @param options.tenantId - Override tenant ID
   * @returns Balance Sheet report or null
   */
  async getBalanceSheet(options?: ReportOptions & { tenantId?: string }): Promise<Report | null> {
    const queryParams: Record<string, string> = {};
    if (options?.date) queryParams.date = options.date;
    if (options?.periods) queryParams.periods = options.periods.toString();
    if (options?.timeframe) queryParams.timeframe = options.timeframe;

    const response = await this.request<ReportsResponse>(
      "GET",
      "/Reports/BalanceSheet",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Reports?.[0] || null;
  }

  /**
   * Gets Trial Balance report.
   *
   * @param options - Report options
   * @param options.date - As-at date (YYYY-MM-DD)
   * @param options.paymentsOnly - Only show payments
   * @param options.tenantId - Override tenant ID
   * @returns Trial Balance report or null
   */
  async getTrialBalance(options?: ReportOptions & { tenantId?: string }): Promise<Report | null> {
    const queryParams: Record<string, string> = {};
    if (options?.date) queryParams.date = options.date;
    if (options?.paymentsOnly) queryParams.paymentsOnly = "true";

    const response = await this.request<ReportsResponse>(
      "GET",
      "/Reports/TrialBalance",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Reports?.[0] || null;
  }

  /**
   * Gets Aged Receivables report.
   *
   * @param options - Report options
   * @param options.contactId - Filter by contact ID
   * @param options.date - As-at date (YYYY-MM-DD)
   * @param options.fromDate - From date
   * @param options.toDate - To date
   * @param options.tenantId - Override tenant ID
   * @returns Aged Receivables report or null
   */
  async getAgedReceivables(options?: ReportOptions & { tenantId?: string }): Promise<Report | null> {
    const queryParams: Record<string, string> = {};
    if (options?.contactId) queryParams.contactId = options.contactId;
    if (options?.date) queryParams.date = options.date;
    if (options?.fromDate) queryParams.fromDate = options.fromDate;
    if (options?.toDate) queryParams.toDate = options.toDate;

    const response = await this.request<ReportsResponse>(
      "GET",
      "/Reports/AgedReceivablesByContact",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Reports?.[0] || null;
  }

  /**
   * Gets Aged Payables report.
   *
   * @param options - Report options
   * @param options.contactId - Filter by contact ID
   * @param options.date - As-at date (YYYY-MM-DD)
   * @param options.fromDate - From date
   * @param options.toDate - To date
   * @param options.tenantId - Override tenant ID
   * @returns Aged Payables report or null
   */
  async getAgedPayables(options?: ReportOptions & { tenantId?: string }): Promise<Report | null> {
    const queryParams: Record<string, string> = {};
    if (options?.contactId) queryParams.contactId = options.contactId;
    if (options?.date) queryParams.date = options.date;
    if (options?.fromDate) queryParams.fromDate = options.fromDate;
    if (options?.toDate) queryParams.toDate = options.toDate;

    const response = await this.request<ReportsResponse>(
      "GET",
      "/Reports/AgedPayablesByContact",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Reports?.[0] || null;
  }

  // ============================================
  // QUOTE OPERATIONS
  // ============================================

  /**
   * Lists quotes with optional filtering.
   *
   * @param options - Filter and pagination options
   * @returns Array of quote objects
   */
  async listQuotes(options?: ListOptions & { tenantId?: string }): Promise<Quote[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const response = await this.request<QuotesResponse>(
      "GET",
      "/Quotes",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Quotes || [];
  }

  /**
   * Retrieves a single quote by ID.
   *
   * @param quoteId - Xero quote ID (GUID)
   * @param tenantId - Override tenant ID
   * @returns Quote object or null if not found
   */
  async getQuote(quoteId: string, tenantId?: string): Promise<Quote | null> {
    const response = await this.request<QuotesResponse>(
      "GET",
      `/Quotes/${quoteId}`,
      undefined,
      undefined,
      { tenantId }
    );
    return response.Quotes?.[0] || null;
  }

  // ============================================
  // OVERPAYMENT/PREPAYMENT OPERATIONS
  // ============================================

  /**
   * Lists overpayments.
   *
   * @param options - Filter and pagination options
   * @returns Array of overpayment objects
   */
  async listOverpayments(options?: ListOptions & { tenantId?: string }): Promise<Overpayment[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const response = await this.request<OverpaymentsResponse>(
      "GET",
      "/Overpayments",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Overpayments || [];
  }

  /**
   * Lists prepayments.
   *
   * @param options - Filter and pagination options
   * @returns Array of prepayment objects
   */
  async listPrepayments(options?: ListOptions & { tenantId?: string }): Promise<Prepayment[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const response = await this.request<PrepaymentsResponse>(
      "GET",
      "/Prepayments",
      undefined,
      queryParams,
      { tenantId: options?.tenantId }
    );
    return response.Prepayments || [];
  }

  // ============================================
  // CONTACT GROUP OPERATIONS
  // ============================================

  /**
   * Lists contact groups.
   *
   * @param tenantId - Override tenant ID
   * @returns Array of contact group objects
   */
  async listContactGroups(tenantId?: string): Promise<ContactGroup[]> {
    const response = await this.request<ContactGroupsResponse>(
      "GET",
      "/ContactGroups",
      undefined,
      undefined,
      { tenantId }
    );
    return response.ContactGroups || [];
  }

  // ============================================
  // CACHE OPERATIONS
  // ============================================

  /**
   * Clears all cached data including tenant ID.
   *
   * @returns Number of cache entries cleared
   */
  clearCache(): number {
    this.clearTenantId();
    this.tenantId = null;
    return cache.clear();
  }
}

export default XeroClient;
