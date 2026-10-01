
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "path";
import { homedir } from "os";
import https from "https";
import {
  loadServiceConfig,
  normalizeLegacyMcpConfig,
  z,
} from "@local/cli-utils";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";
import type {
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
  Allocation,
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
  CreateCreditNoteOptions,
  AllocateCreditNoteOptions,
  CreateCreditNoteRefundOptions,
  AuthoriseCreditNoteOptions,
} from "./types.js";
import {
  FilePaidInvoiceEditStore,
  PaidInvoiceEditManualReviewError,
  PaidInvoiceEditWorkflow,
  hasNonPaymentSettlementActivity,
  hasStructuralInvoiceUpdate,
  hasSettlementActivity,
  type InvoiceStructuralUpdate,
  type PaidInvoiceEditPreview,
  type PaidInvoiceEditState,
  type PaidInvoiceEditStore,
  type PaidInvoicePaymentSnapshot,
} from "./paid-invoice-edit.js";

const XERO_TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const XeroConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  tenantId: z.string().trim().regex(
    XERO_TENANT_ID_PATTERN,
    "Xero tenant ID must be a GUID in 8-4-4-4-12 format",
  ).optional(),
});

const XeroConfigFileSchema = z.object({
  xero: XeroConfigSchema,
});

const XERO_IDENTITY_HOST = "identity.xero.com";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const XERO_SCOPES = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings.read",
  "accounting.reports.read",
].join(" ");

const cache = new PluginCache({
  namespace: "xero-accounting-manager",
  defaultTTL: TTL.FIVE_MINUTES,
});

type ReconciliationState = "unknown" | "absent" | "multiple" | "mismatch";

type ReconciliationResult<T> =
  | { state: "match"; value: T }
  | { state: ReconciliationState; detail: string };

export function resolveTenantIdPaths(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): {
  directory: string;
  path: string;
  clearedMarkerPath: string;
  legacyPaths: string[];
} {
  const directory = env.XERO_ACCOUNTING_STATE_DIR
    || join(env.BIZ_ROOT || join(home, "biz"), "var", "xero-accounting-manager"); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return {
    directory,
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    path: join(directory, "tenant-id.txt"),
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    clearedMarkerPath: join(directory, "tenant-id-cleared"),
    legacyPaths: [
      "YOUR_CREDENTIALS_PATH/xero/tenant-id.txt",
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      join(home, ".cache", "xero-accounting-manager", "tenant-id.txt"),
    ],
  };
}

const TENANT_ID_PATHS = resolveTenantIdPaths();

type TenantIdPaths = ReturnType<typeof resolveTenantIdPaths>;

function ensurePrivateTenantDirectory(paths: TenantIdPaths = TENANT_ID_PATHS): void {
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  chmodSync(paths.directory, 0o700);
}

export function migrateLegacyTenantId(paths: TenantIdPaths = TENANT_ID_PATHS): void {
  if (
    existsSync(paths.clearedMarkerPath)
    || existsSync(paths.path)
  ) return;
  const legacyPath = paths.legacyPaths.find((path) => existsSync(path));
  if (!legacyPath) return;
  ensurePrivateTenantDirectory(paths);
  const temporaryPath = `${paths.path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    copyFileSync(legacyPath, temporaryPath, constants.COPYFILE_EXCL);
    chmodSync(temporaryPath, 0o600);
    const tenantId = readFileSync(temporaryPath, "utf8").trim();
    if (!XERO_TENANT_ID_PATTERN.test(tenantId)) {
      throw new TypeError("Legacy Xero tenant ID has an invalid format");
    }
    const fileDescriptor = openSync(temporaryPath, "r");
    try {
      fsyncSync(fileDescriptor);
    } finally {
      closeSync(fileDescriptor);
    }
    try {
      linkSync(temporaryPath, paths.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export class XeroClient {
  private config: XeroConfig;
  private tokenCache: TokenCache | null = null;
  private tenantId: string | null = null;
  private tenantIdValidated: boolean = false;
  private fetchImpl: typeof fetch;
  private paidInvoiceEditStore: PaidInvoiceEditStore;

  constructor(opts?: {
    fetchImpl?: typeof fetch;
    config?: XeroConfig;
    paidInvoiceEditStore?: PaidInvoiceEditStore;
  }) {
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.paidInvoiceEditStore =
      opts?.paidInvoiceEditStore ?? new FilePaidInvoiceEditStore();

    if (opts?.config) {
      if (!opts.config.clientId || !opts.config.clientSecret) {
        throw new Error(
          "Missing required config: opts.config needs { clientId, clientSecret }"
        );
      }
      const parsed = XeroConfigSchema.parse(opts.config);
      this.config = parsed;
      this.tenantId = this.loadTenantId();
      return;
    }

    const raw = loadServiceConfig("xero-accounting-manager");
    const normalized = normalizeLegacyMcpConfig(raw, {
      "xero.clientId": "XERO_CLIENT_ID",
      "xero.clientSecret": "XERO_CLIENT_SECRET",
      "xero.tenantId": "XERO_TENANT_ID",
    });
    const parsed = XeroConfigFileSchema.parse(normalized);
    this.config = parsed.xero;

    this.tenantId = this.loadTenantId();
  }


  disableCache(): void {
    cache.disable();
  }

  enableCache(): void {
    cache.enable();
  }

  getCacheStats() {
    return cache.getStats();
  }

  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }


  private loadTenantId(): string | null {
    try {
      migrateLegacyTenantId();
      if (existsSync(TENANT_ID_PATHS.clearedMarkerPath)) return null;
      if (existsSync(TENANT_ID_PATHS.path)) {
        return readFileSync(TENANT_ID_PATHS.path, "utf-8").trim();
      }
    } catch {
    }
    return null;
  }

  private saveTenantId(tenantId: string): void {
    try {
      ensurePrivateTenantDirectory();
      writeFileSync(TENANT_ID_PATHS.path, tenantId, {
        encoding: "utf8",
        mode: 0o600,
      });
      chmodSync(TENANT_ID_PATHS.path, 0o600);
      rmSync(TENANT_ID_PATHS.clearedMarkerPath, { force: true });
    } catch {
    }
  }

  private clearTenantId(): void {
    try {
      ensurePrivateTenantDirectory();
      writeFileSync(TENANT_ID_PATHS.clearedMarkerPath, "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      chmodSync(TENANT_ID_PATHS.clearedMarkerPath, 0o600);
      rmSync(TENANT_ID_PATHS.path, { force: true });
    } catch {
    }
  }


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

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.accessToken;
    }

    return this.fetchToken();
  }

  private async getTenantId(optionTenantId?: string): Promise<string> {
    if (optionTenantId) {
      return optionTenantId;
    }

    if (this.config.tenantId) {
      if (this.tenantId !== this.config.tenantId || !this.tenantIdValidated) {
        this.tenantId = this.config.tenantId;
        this.tenantIdValidated = true;
        this.saveTenantId(this.tenantId);
      }
      return this.tenantId;
    }

    if (this.tenantIdValidated && this.tenantId) {
      return this.tenantId;
    }

    const connections = await this.getConnections();
    if (connections.length === 0) {
      throw new Error("No Xero organisations connected. Please connect an organisation in the Xero Developer Portal.");
    }

    if (connections.length > 1) {
      const availableConnections = connections
        .map((connection) =>
          `${JSON.stringify(connection.tenantName || "<unnamed>")} (${connection.tenantId})`
        )
        .join(", ");
      throw new Error(
        "Multiple Xero organisations are connected; specify tenantId/--tenant-id "
        + "or configure xero.tenantId (XERO_TENANT_ID). "
        + `Connected organisations: ${availableConnections}`,
      );
    }

    this.tenantId = connections[0].tenantId;
    this.tenantIdValidated = true;
    this.saveTenantId(this.tenantId);
    return this.tenantId;
  }

  async resolveTenantId(tenantId?: string): Promise<string> {
    return this.getTenantId(tenantId);
  }


  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>,
    queryParams?: Record<string, string>,
    options?: { tenantId?: string; skipTenant?: boolean; extraHeaders?: Record<string, string> }
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

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

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (!options?.skipTenant) {
      const tenantId = await this.getTenantId(options?.tenantId);
      headers["Xero-Tenant-Id"] = tenantId;
    }

    if (options?.extraHeaders) {
      for (const [headerKey, headerValue] of Object.entries(options.extraHeaders)) {
        if (headerValue !== undefined && headerValue !== null && headerValue !== "") {
          headers[headerKey] = headerValue;
        }
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Xero API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }


  async getConnections(): Promise<XeroConnection[]> {
    const accessToken = await this.getAccessToken();

    const response = await this.fetchImpl(XERO_CONNECTIONS_URL, {
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


  getTools(): Array<{ name: string; description: string }> {
    return [
      { name: "get-connections", description: "Get connected Xero organisations" },
      { name: "get-tenant-id", description: "Resolve the configured or unambiguous active tenant ID" },

      { name: "list-invoices", description: "List invoices with pagination and filtering" },
      { name: "get-invoice", description: "Get a specific invoice by ID" },
      { name: "create-invoice", description: "Create a new invoice" },
      { name: "update-invoice", description: "Update an existing invoice" },
      {
        name: "preview-paid-invoice-edit",
        description: "Build a durable preview for a paid-invoice structural edit",
      },
      {
        name: "confirm-paid-invoice-edit",
        description: "Confirm or resume an exact paid-invoice structural edit plan",
      },
      {
        name: "get-paid-invoice-edit-state",
        description: "Inspect durable paid-invoice edit recovery state",
      },

      { name: "list-contacts", description: "List contacts with pagination and filtering" },
      { name: "get-contact", description: "Get a specific contact by ID" },
      { name: "create-contact", description: "Create a new contact" },
      { name: "update-contact", description: "Update an existing contact" },

      { name: "list-accounts", description: "List chart of accounts" },

      { name: "list-payments", description: "List payments with pagination" },
      { name: "create-payment", description: "Create a payment for an invoice" },
      { name: "delete-payment", description: "Delete (reverse) a payment" },

      { name: "list-bank-transactions", description: "List bank transactions" },

      { name: "list-credit-notes", description: "List credit notes" },
      { name: "get-credit-note", description: "Get one exact credit note by ID" },
      { name: "create-credit-note", description: "Create a credit note" },
      { name: "authorise-credit-note", description: "Authorise one exact draft credit note" },
      { name: "create-credit-note-refund", description: "Refund a credit note to an exact account" },
      { name: "allocate-credit-note", description: "Allocate a credit note to an invoice" },

      { name: "list-items", description: "List inventory items" },

      { name: "list-tax-rates", description: "List tax rates" },

      { name: "get-organisation", description: "Get organisation details" },

      { name: "get-profit-and-loss", description: "Get Profit & Loss report" },
      { name: "get-balance-sheet", description: "Get Balance Sheet report" },
      { name: "get-trial-balance", description: "Get Trial Balance report" },
      { name: "get-aged-receivables", description: "Get Aged Receivables report" },
      { name: "get-aged-payables", description: "Get Aged Payables report" },

      { name: "list-quotes", description: "List quotes" },
      { name: "get-quote", description: "Get a specific quote by ID" },

      { name: "list-overpayments", description: "List overpayments" },
      { name: "list-prepayments", description: "List prepayments" },

      { name: "list-contact-groups", description: "List contact groups" },

      { name: "clear-cache", description: "Clear all cached data" },
      { name: "cache-stats", description: "Show cache statistics" },
      { name: "cache-invalidate", description: "Invalidate a specific cache key" },
    ];
  }


  async listInvoices(options?: ListOptions & { tenantId?: string }): Promise<Invoice[]> {
    const queryParams: Record<string, string> = {};
    if (options?.page) queryParams.page = options.page.toString();
    if (options?.where) queryParams.where = options.where;
    if (options?.order) queryParams.order = options.order;

    const extraHeaders: Record<string, string> = {};
    if (options?.ifModifiedSince) {
      extraHeaders["If-Modified-Since"] = options.ifModifiedSince;
    }

    const response = await this.request<InvoicesResponse>(
      "GET",
      "/Invoices",
      undefined,
      queryParams,
      { tenantId: options?.tenantId, extraHeaders }
    );
    return response.Invoices || [];
  }

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

  async createInvoice(options: CreateInvoiceOptions & { tenantId?: string }): Promise<Invoice> {
    const rawOptions = options as unknown as Record<string, unknown>;
    const hasContactName = rawOptions.contactName !== undefined;
    const hasContactId = rawOptions.contactId !== undefined;
    if (hasContactName === hasContactId) {
      throw new Error(
        "createInvoice requires exactly one contact selector: contactName (legacy) or contactId (advanced)",
      );
    }
    this.validateIdempotencyKey(rawOptions.idempotencyKey);
    if (rawOptions.idempotencyKey === undefined) {
      throw new Error("idempotencyKey is required to create an invoice");
    }
    const idempotencyKey = rawOptions.idempotencyKey as string;
    const dueDate = this.optionalCalendarDate(rawOptions.dueDate, "dueDate");

    let contactId: string;
    let lineItems: Array<Record<string, unknown>>;
    let invoiceNumber: string | undefined;
    let date: string | undefined;
    let status: "DRAFT" | "SUBMITTED" | "AUTHORISED" = "DRAFT";
    let lineAmountTypes: "Exclusive" | "Inclusive" | "NoTax" | undefined;

    if (hasContactId) {
      contactId = this.requireNonEmptyString(rawOptions.contactId, "contactId");
      lineItems = this.validateAdvancedTransactionLineItems(rawOptions.lineItems);
      invoiceNumber = this.optionalNonEmptyString(rawOptions.invoiceNumber, "invoiceNumber");
      date = this.optionalCalendarDate(rawOptions.date, "date");
      const requestedStatus = rawOptions.status;
      if (
        requestedStatus !== undefined
        && !["DRAFT", "SUBMITTED", "AUTHORISED"].includes(String(requestedStatus))
      ) {
        throw new Error("status must be DRAFT, SUBMITTED, or AUTHORISED");
      }
      status = (requestedStatus as typeof status | undefined) ?? "DRAFT";
      const requestedLineAmountTypes = rawOptions.lineAmountTypes;
      if (
        requestedLineAmountTypes !== undefined
        && !["Exclusive", "Inclusive", "NoTax"].includes(String(requestedLineAmountTypes))
      ) {
        throw new Error("lineAmountTypes must be Exclusive, Inclusive, or NoTax");
      }
      lineAmountTypes = requestedLineAmountTypes as typeof lineAmountTypes;
    } else {
      for (const field of ["contactId", "invoiceNumber", "date", "status", "lineAmountTypes"]) {
        if (rawOptions[field] !== undefined) {
          throw new Error(`createInvoice cannot use advanced field ${field} in legacy contactName mode`);
        }
      }
      const contactName = this.requireNonEmptyString(rawOptions.contactName, "contactName");
      const legacyLineItems = this.validateLegacyInvoiceLineItems(rawOptions.lineItems);
      const contacts = await this.listContacts({
        where: `Name=="${contactName}"`,
        tenantId: options.tenantId,
      });
      if (contacts.length > 0) {
        contactId = contacts[0].ContactID;
      } else {
        const newContact = await this.createContact({
          name: contactName,
          tenantId: options.tenantId,
          idempotencyKey: this.deriveSubWriteIdempotencyKey(
            idempotencyKey,
            "invoice-contact",
          ),
        });
        contactId = newContact.ContactID;
      }
      lineItems = legacyLineItems.map((item) => ({
        Description: item.description,
        Quantity: item.quantity,
        UnitAmount: item.unitAmount,
        AccountCode: item.accountCode || "200",
      }));
    }

    const invoiceBody = {
      Type: options.type || "ACCREC",
      Contact: { ContactID: contactId },
      LineItems: lineItems,
      InvoiceNumber: invoiceNumber,
      Date: date,
      DueDate: dueDate,
      Reference: options.reference,
      Status: status,
      LineAmountTypes: lineAmountTypes,
    };

    const response = await this.request<InvoicesResponse>(
      "POST",
      "/Invoices",
      { Invoices: [invoiceBody] },
      undefined,
      {
        tenantId: options.tenantId,
        extraHeaders: { "Idempotency-Key": idempotencyKey },
      }
    );

    if (!response.Invoices?.[0]) {
      throw new Error("Failed to create invoice - no invoice returned");
    }

    return response.Invoices[0];
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${field} must be a non-empty string`);
    }
    return value;
  }

  private requireGuid(value: unknown, field: string): string {
    const candidate = this.requireNonEmptyString(value, field);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(candidate)) {
      throw new Error(`${field} must be a GUID in 8-4-4-4-12 format`);
    }
    return candidate;
  }

  private optionalNonEmptyString(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : this.requireNonEmptyString(value, field);
  }

  private validateIdempotencyKey(value: unknown): void {
    if (value === undefined) return;
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
      throw new Error("idempotencyKey must be between 1 and 128 characters");
    }
    if (value.trim().length === 0) {
      throw new Error("idempotencyKey must include a non-whitespace character");
    }
  }

  private deriveSubWriteIdempotencyKey(parentKey: string, operation: string): string {
    const digest = createHash("sha256")
      .update(`${operation}\0${parentKey}`, "utf8")
      .digest("hex");
    return `xero-${operation}-${digest}`;
  }

  private optionalCalendarDate(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    const candidate = this.requireNonEmptyString(value, field);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(candidate);
    if (!match) {
      throw new Error(`${field} must be a real calendar date in YYYY-MM-DD format`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
      throw new Error(`${field} must be a real calendar date in YYYY-MM-DD format`);
    }
    return candidate;
  }

  private validateLegacyInvoiceLineItems(value: unknown): Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
  }> {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("lineItems must be a non-empty array");
    }
    return value.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new Error(`lineItems[${index}] must be an object`);
      }
      const item = rawItem as Record<string, unknown>;
      const quantity = item.quantity;
      const unitAmount = item.unitAmount;
      if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
        throw new Error(`lineItems[${index}].quantity must be a finite number`);
      }
      if (typeof unitAmount !== "number" || !Number.isFinite(unitAmount)) {
        throw new Error(`lineItems[${index}].unitAmount must be a finite number`);
      }
      return {
        description: this.requireNonEmptyString(item.description, `lineItems[${index}].description`),
        quantity,
        unitAmount,
        accountCode: this.optionalNonEmptyString(item.accountCode, `lineItems[${index}].accountCode`),
      };
    });
  }

  private validateAdvancedTransactionLineItems(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("advanced lineItems must be a non-empty array");
    }
    const allowedKeys = new Set([
      "Description",
      "Quantity",
      "UnitAmount",
      "AccountCode",
      "TaxType",
      "ItemCode",
      "DiscountRate",
      "DiscountAmount",
    ]);
    return value.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new Error(`lineItems[${index}] must be an object`);
      }
      const item = rawItem as Record<string, unknown>;
      if ("LineItemID" in item) {
        throw new Error(`lineItems[${index}] must not include LineItemID`);
      }
      const unknownKey = Object.keys(item).find((key) => !allowedKeys.has(key));
      if (unknownKey) {
        throw new Error(`lineItems[${index}] contains unsupported field ${unknownKey}`);
      }
      if (typeof item.Quantity !== "number" || !Number.isFinite(item.Quantity)) {
        throw new Error(`lineItems[${index}].Quantity must be a finite number`);
      }
      if (typeof item.UnitAmount !== "number" || !Number.isFinite(item.UnitAmount)) {
        throw new Error(`lineItems[${index}].UnitAmount must be a finite number`);
      }
      if (
        item.DiscountRate !== undefined
        && (typeof item.DiscountRate !== "number" || !Number.isFinite(item.DiscountRate))
      ) {
        throw new Error(`lineItems[${index}].DiscountRate must be a finite number`);
      }
      if (
        item.DiscountAmount !== undefined
        && (typeof item.DiscountAmount !== "number" || !Number.isFinite(item.DiscountAmount))
      ) {
        throw new Error(`lineItems[${index}].DiscountAmount must be a finite number`);
      }
      if (item.DiscountRate !== undefined && item.DiscountAmount !== undefined) {
        throw new Error(
          `lineItems[${index}] cannot include both DiscountRate and DiscountAmount`,
        );
      }
      return {
        Description: this.requireNonEmptyString(item.Description, `lineItems[${index}].Description`),
        Quantity: item.Quantity,
        UnitAmount: item.UnitAmount,
        AccountCode: this.requireNonEmptyString(item.AccountCode, `lineItems[${index}].AccountCode`),
        TaxType: this.requireNonEmptyString(item.TaxType, `lineItems[${index}].TaxType`),
        ItemCode: this.optionalNonEmptyString(item.ItemCode, `lineItems[${index}].ItemCode`),
        ...(item.DiscountRate !== undefined ? { DiscountRate: item.DiscountRate } : {}),
        ...(item.DiscountAmount !== undefined ? { DiscountAmount: item.DiscountAmount } : {}),
      };
    });
  }

  private validateAdvancedCreditNoteLineItems(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("advanced credit-note lineItems must be a non-empty array");
    }
    const allowedKeys = new Set([
      "Description",
      "Quantity",
      "UnitAmount",
      "AccountCode",
      "TaxType",
      "ItemCode",
    ]);
    return value.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new Error(`lineItems[${index}] must be an object`);
      }
      const item = rawItem as Record<string, unknown>;
      if ("LineItemID" in item) {
        throw new Error(`lineItems[${index}] must not include LineItemID`);
      }
      if ("CreditNoteID" in item) {
        throw new Error(`lineItems[${index}] must not include CreditNoteID`);
      }
      if ("DiscountRate" in item || "DiscountAmount" in item) {
        throw new Error(
          `lineItems[${index}] must not include DiscountRate or DiscountAmount; use an already-net UnitAmount`,
        );
      }
      const unknownKey = Object.keys(item).find((key) => !allowedKeys.has(key));
      if (unknownKey) {
        throw new Error(`lineItems[${index}] contains unsupported field ${unknownKey}`);
      }
      if (typeof item.Quantity !== "number" || !Number.isFinite(item.Quantity)) {
        throw new Error(`lineItems[${index}].Quantity must be a finite number`);
      }
      if (typeof item.UnitAmount !== "number" || !Number.isFinite(item.UnitAmount)) {
        throw new Error(`lineItems[${index}].UnitAmount must be a finite number`);
      }
      return {
        Description: this.requireNonEmptyString(item.Description, `lineItems[${index}].Description`),
        Quantity: item.Quantity,
        UnitAmount: item.UnitAmount,
        AccountCode: this.requireNonEmptyString(item.AccountCode, `lineItems[${index}].AccountCode`),
        TaxType: this.requireNonEmptyString(item.TaxType, `lineItems[${index}].TaxType`),
        ItemCode: this.optionalNonEmptyString(item.ItemCode, `lineItems[${index}].ItemCode`),
      };
    });
  }

  async updateInvoice(
    invoiceId: string,
    updates: {
      status?: string;
      reference?: string;
      dueDate?: string;
      tenantId?: string;
    } & InvoiceStructuralUpdate
  ): Promise<Invoice> {
    const structuralUpdate: InvoiceStructuralUpdate = {
      contactId: updates.contactId,
      lineItems: updates.lineItems,
      lineAmountTypes: updates.lineAmountTypes,
      currencyCode: updates.currencyCode,
      type: updates.type,
    };
    if (hasStructuralInvoiceUpdate(structuralUpdate)) {
      const current = await this.getInvoice(invoiceId, updates.tenantId);
      if (!current) {
        throw new Error(`Invoice ${invoiceId} was not found.`);
      }
      if (hasNonPaymentSettlementActivity(current)) {
        throw new PaidInvoiceEditManualReviewError(
          `Refusing structural update for invoice ${invoiceId}: non-payment ` +
          "settlement activity requires manual accounting review.",
        );
      }
      if (hasSettlementActivity(current)) {
        throw new Error(
          `Refusing generic structural update for paid/part-paid invoice ${invoiceId}. ` +
          "Use preview-paid-invoice-edit, review its durable plan, then explicitly " +
          "confirm-paid-invoice-edit.",
        );
      }
    }

    const invoiceBody: Record<string, any> = { InvoiceID: invoiceId };
    if (updates.status) invoiceBody.Status = updates.status;
    if (updates.reference) invoiceBody.Reference = updates.reference;
    if (updates.dueDate) invoiceBody.DueDate = updates.dueDate;
    if (updates.contactId !== undefined) {
      invoiceBody.Contact = { ContactID: updates.contactId };
    }
    if (updates.lineItems !== undefined) invoiceBody.LineItems = updates.lineItems;
    if (updates.lineAmountTypes !== undefined) {
      invoiceBody.LineAmountTypes = updates.lineAmountTypes;
    }
    if (updates.currencyCode !== undefined) invoiceBody.CurrencyCode = updates.currencyCode;
    if (updates.type !== undefined) invoiceBody.Type = updates.type;

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

  async previewPaidInvoiceEdit(
    invoiceId: string,
    update: InvoiceStructuralUpdate,
    tenantId?: string,
  ): Promise<PaidInvoiceEditPreview> {
    return this.paidInvoiceEditWorkflow().preview(invoiceId, update, tenantId);
  }

  async confirmPaidInvoiceEdit(
    invoiceId: string,
    planId: string,
    confirmationToken: string,
    tenantId?: string,
  ): Promise<PaidInvoiceEditState> {
    return this.paidInvoiceEditWorkflow().confirmAndRun(
      invoiceId,
      planId,
      confirmationToken,
      tenantId,
    );
  }

  async getPaidInvoiceEditState(
    invoiceId: string,
    tenantId?: string,
  ): Promise<PaidInvoiceEditState | null> {
    return this.paidInvoiceEditWorkflow().getState(invoiceId, tenantId);
  }

  private paidInvoiceEditWorkflow(): PaidInvoiceEditWorkflow {
    return new PaidInvoiceEditWorkflow(
      {
        resolveTenantId: (tenantId) => this.resolveTenantId(tenantId),
        getInvoice: (invoiceId, tenantId) => this.getInvoice(invoiceId, tenantId),
        listInvoicePayments: (invoiceId, tenantId) =>
          this.listPayments({
            where: `Invoice.InvoiceID==Guid("${invoiceId}")`,
            tenantId,
          }),
        removePayment: async (paymentId, tenantId, idempotencyKey) => {
          await this.deletePayment(paymentId, { tenantId, idempotencyKey });
        },
        applyStructuralUpdate: (
          invoiceId,
          update,
          tenantId,
          idempotencyKey,
        ) =>
          this.applyPaidInvoiceStructuralUpdate(
            invoiceId,
            update,
            tenantId,
            idempotencyKey,
          ),
        reapplyPayment: (
          snapshot,
          invoiceId,
          tenantId,
          idempotencyKey,
        ) =>
          this.reapplyPaidInvoicePayment(
            snapshot,
            invoiceId,
            tenantId,
            idempotencyKey,
          ),
      },
      this.paidInvoiceEditStore,
    );
  }

  private async applyPaidInvoiceStructuralUpdate(
    invoiceId: string,
    update: InvoiceStructuralUpdate,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<Invoice> {
    const invoiceBody: Record<string, unknown> = { InvoiceID: invoiceId };
    if (update.contactId !== undefined) {
      invoiceBody.Contact = { ContactID: update.contactId };
    }
    if (update.lineItems !== undefined) invoiceBody.LineItems = update.lineItems;
    if (update.lineAmountTypes !== undefined) {
      invoiceBody.LineAmountTypes = update.lineAmountTypes;
    }
    if (update.currencyCode !== undefined) invoiceBody.CurrencyCode = update.currencyCode;
    if (update.type !== undefined) invoiceBody.Type = update.type;

    const response = await this.request<InvoicesResponse>(
      "POST",
      `/Invoices/${invoiceId}`,
      { Invoices: [invoiceBody] },
      undefined,
      {
        tenantId,
        extraHeaders: { "Idempotency-Key": idempotencyKey },
      },
    );
    if (!response.Invoices?.[0]) {
      throw new Error("Failed to structurally update paid invoice - no invoice returned");
    }
    return response.Invoices[0];
  }

  private async reapplyPaidInvoicePayment(
    snapshot: PaidInvoicePaymentSnapshot,
    invoiceId: string,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<Payment> {
    const paymentBody = {
      Invoice: { InvoiceID: invoiceId },
      Account: { AccountID: snapshot.accountId },
      Amount: snapshot.amount,
      Date: snapshot.date,
      Reference: snapshot.reference,
      ...(snapshot.currencyRate !== undefined
        ? { CurrencyRate: snapshot.currencyRate }
        : {}),
      ...(snapshot.isReconciled !== undefined
        ? { IsReconciled: snapshot.isReconciled }
        : {}),
    };
    const response = await this.request<PaymentsResponse>(
      "PUT",
      "/Payments",
      { Payments: [paymentBody] },
      undefined,
      {
        tenantId,
        extraHeaders: { "Idempotency-Key": idempotencyKey },
      },
    );
    if (!response.Payments?.[0]) {
      throw new Error(
        `Failed to reapply payment ${snapshot.paymentId} - no payment returned`,
      );
    }
    return response.Payments[0];
  }


  async listContacts(options?: ListOptions & { tenantId?: string }): Promise<Contact[]> {
    const tenantId = await this.resolveTenantId(options?.tenantId);
    const cacheKey = createCacheKey("contacts", {
      page: options?.page,
      where: options?.where,
      order: options?.order,
      ifModifiedSince: options?.ifModifiedSince,
      tenantId,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const queryParams: Record<string, string> = {};
        if (options?.page) queryParams.page = options.page.toString();
        if (options?.where) queryParams.where = options.where;
        if (options?.order) queryParams.order = options.order;

        const extraHeaders: Record<string, string> = {};
        if (options?.ifModifiedSince) {
          extraHeaders["If-Modified-Since"] = options.ifModifiedSince;
        }

        const response = await this.request<ContactsResponse>(
          "GET",
          "/Contacts",
          undefined,
          queryParams,
          { tenantId, extraHeaders }
        );
        return response.Contacts || [];
      },
      { ttl: TTL.HOUR }
    );
  }

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

  async createContact(options: CreateContactOptions & { tenantId?: string }): Promise<Contact> {
    this.validateIdempotencyKey(options.idempotencyKey);
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
      {
        tenantId: options.tenantId,
        extraHeaders: options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : undefined,
      }
    );

    if (!response.Contacts?.[0]) {
      throw new Error("Failed to create contact - no contact returned");
    }

    cache.invalidatePattern(/^contacts/);

    return response.Contacts[0];
  }

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

    cache.invalidatePattern(/^contacts/);

    return response.Contacts[0];
  }


  async listAccounts(options?: { where?: string; order?: string; tenantId?: string }): Promise<Account[]> {
    const tenantId = await this.resolveTenantId(options?.tenantId);
    const cacheKey = createCacheKey("accounts", {
      where: options?.where,
      order: options?.order,
      tenantId,
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
          { tenantId }
        );
        return response.Accounts || [];
      },
      { ttl: TTL.DAY }
    );
  }


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

  async createPayment(options: CreatePaymentOptions & { tenantId?: string }): Promise<Payment> {
    const rawOptions = options as unknown as Record<string, unknown>;
    const hasAccountCode = rawOptions.accountCode !== undefined;
    const hasAccountId = rawOptions.accountId !== undefined;
    if (hasAccountCode === hasAccountId) {
      throw new Error("createPayment requires exactly one of accountCode or accountId");
    }
    this.validateIdempotencyKey(rawOptions.idempotencyKey);
    if (rawOptions.idempotencyKey === undefined) {
      throw new Error("idempotencyKey is required to create a payment");
    }
    const idempotencyKey = rawOptions.idempotencyKey as string;
    const paymentDate = this.optionalCalendarDate(rawOptions.date, "date");
    if (paymentDate === undefined) {
      throw new Error("date is required to create a retry-stable payment");
    }

    let accountId: string;
    if (hasAccountId) {
      accountId = this.requireNonEmptyString(rawOptions.accountId, "accountId");
    } else {
      const accountCode = this.requireNonEmptyString(rawOptions.accountCode, "accountCode");
      const accounts = await this.listAccounts({ tenantId: options.tenantId });
      const account = accounts.find((candidate) => candidate.Code === accountCode);
      if (!account) {
        throw new Error(`Account with code ${accountCode} not found`);
      }
      accountId = account.AccountID;
    }

    const paymentBody = {
      Invoice: { InvoiceID: options.invoiceId },
      Account: { AccountID: accountId },
      Amount: options.amount,
      Date: paymentDate,
      Reference: options.reference,
      ...(options.currencyRate !== undefined ? { CurrencyRate: options.currencyRate } : {}),
    };

    const response = await this.request<PaymentsResponse>(
      "PUT",
      "/Payments",
      { Payments: [paymentBody] },
      undefined,
      {
        tenantId: options.tenantId,
        extraHeaders: { "Idempotency-Key": idempotencyKey },
      }
    );

    if (!response.Payments?.[0]) {
      throw new Error("Failed to create payment - no payment returned");
    }

    return response.Payments[0];
  }

  async deletePayment(
    paymentId: string,
    options?: { tenantId?: string; idempotencyKey?: string }
  ): Promise<PaymentsResponse> {
    const response = await this.request<PaymentsResponse>(
      "POST",
      `/Payments/${paymentId}`,
      { Payments: [{ Status: "DELETED" }] },
      undefined,
      {
        tenantId: options?.tenantId,
        extraHeaders: options?.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : undefined,
      }
    );

    if (!response.Payments?.[0]) {
      throw new Error(
        `Failed to delete payment ${paymentId} — Xero returned no payment record`
      );
    }

    return response;
  }


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

  async getCreditNote(creditNoteId: string, tenantId?: string): Promise<CreditNote | null> {
    const validatedCreditNoteId = this.requireGuid(creditNoteId, "creditNoteId");
    const result = await this.readExactCreditNoteById(validatedCreditNoteId, tenantId);
    if (result.state === "match") return result.value;
    if (result.state === "absent") return null;
    throw this.reconciliationFailure("getCreditNote", result);
  }

  private escapeXeroWhereString(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  }

  private dateForExactComparison(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const calendarPrefix = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
    if (calendarPrefix) return calendarPrefix[1];
    const xeroTimestamp = /^\/Date\((\d+)(?:[+-]\d+)?\)\/$/u.exec(value);
    if (xeroTimestamp) {
      const milliseconds = Number(xeroTimestamp[1]);
      const parsed = new Date(milliseconds);
      if (!Number.isFinite(milliseconds) || Number.isNaN(parsed.getTime())) {
        return "INVALID_XERO_DATE";
      }
      return parsed.toISOString().slice(0, 10);
    }
    return value;
  }

  private optionalTextForExactComparison(value: string | undefined): string | undefined {
    return value === "" ? undefined : value;
  }

  private matchesExactCreditNoteCreate(
    note: CreditNote,
    expected: Record<string, unknown>,
  ): boolean {
    const expectedContact = expected.Contact as { ContactID: string };
    const expectedLines = expected.LineItems as Array<Record<string, unknown>>;
    const actualLines = note.LineItems;
    if (!Array.isArray(actualLines)) return false;
    if (actualLines.length !== expectedLines.length) return false;
    const linesMatch = expectedLines.every((line, index) => {
      const actual = actualLines[index];
      return actual !== null
        && typeof actual === "object"
        && actual.Description === line.Description
        && actual.Quantity === line.Quantity
        && actual.UnitAmount === line.UnitAmount
        && actual.AccountCode === line.AccountCode
        && actual.TaxType === line.TaxType
        && actual.ItemCode === line.ItemCode;
    });
    return linesMatch
      && note.Type === expected.Type
      && note.Contact?.ContactID === expectedContact.ContactID
      && note.CreditNoteNumber === expected.CreditNoteNumber
      && note.Status === expected.Status
      && (
        expected.Date === undefined
        || this.dateForExactComparison(note.DateString ?? note.Date)
          === this.dateForExactComparison(expected.Date as string)
      )
      && (
        expected.LineAmountTypes === undefined
        || note.LineAmountTypes === expected.LineAmountTypes
      )
      && (
        expected.Reference === undefined
        || this.optionalTextForExactComparison(note.Reference)
          === this.optionalTextForExactComparison(expected.Reference as string)
      );
  }

  private matchesExactCreditNoteRefund(
    payment: Payment,
    expected: {
      CreditNote: { CreditNoteID: string };
      Account: { AccountID: string };
      Amount: number;
      Date: string;
      Reference: string;
    },
  ): boolean {
    return payment.CreditNote?.CreditNoteID === expected.CreditNote.CreditNoteID
      && payment.Account?.AccountID === expected.Account.AccountID
      && payment.Amount === expected.Amount
      && this.dateForExactComparison(payment.Date) === expected.Date
      && payment.Reference === expected.Reference;
  }

  private async inspectExactCreditNoteCreate(
    expected: Record<string, unknown>,
    tenantId?: string,
  ): Promise<ReconciliationResult<CreditNote>> {
    const creditNoteNumber = expected.CreditNoteNumber as string;
    try {
      const notes = await this.listCreditNotes({
        where: `CreditNoteNumber=="${this.escapeXeroWhereString(creditNoteNumber)}"`,
        tenantId,
      });
      if (!Array.isArray(notes)) {
        return { state: "unknown", detail: "exact-number GET returned malformed CreditNotes" };
      }
      const candidates = notes.filter((note) => note.CreditNoteNumber === creditNoteNumber);
      if (candidates.length === 0) {
        return { state: "absent", detail: `no credit note has number ${creditNoteNumber}` };
      }
      if (candidates.length > 1) {
        return { state: "multiple", detail: `${candidates.length} credit notes have number ${creditNoteNumber}` };
      }
      if (!this.matchesExactCreditNoteCreate(candidates[0], expected)) {
        return { state: "mismatch", detail: `credit note ${creditNoteNumber} does not match the expected body` };
      }
      return {
        state: "match",
        value: { ...candidates[0], ReconciledAfterAmbiguousWrite: true },
      };
    } catch (error) {
      return {
        state: "unknown",
        detail: `exact-number GET failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async inspectExactCreditNoteRefund(
    expected: {
      CreditNote: { CreditNoteID: string };
      Account: { AccountID: string };
      Amount: number;
      Date: string;
      Reference: string;
    },
    tenantId?: string,
  ): Promise<ReconciliationResult<Payment>> {
    try {
      const payments = await this.listPayments({
        where: `Reference=="${this.escapeXeroWhereString(expected.Reference)}"`,
        tenantId,
      });
      if (!Array.isArray(payments)) {
        return { state: "unknown", detail: "exact-reference GET returned malformed Payments" };
      }
      const candidates = payments.filter((payment) => payment.Reference === expected.Reference);
      if (candidates.length === 0) {
        return { state: "absent", detail: `no payment has reference ${expected.Reference}` };
      }
      if (candidates.length > 1) {
        return { state: "multiple", detail: `${candidates.length} payments have reference ${expected.Reference}` };
      }
      if (!this.matchesExactCreditNoteRefund(candidates[0], expected)) {
        return { state: "mismatch", detail: `payment ${expected.Reference} does not match the expected refund body` };
      }
      return {
        state: "match",
        value: { ...candidates[0], ReconciledAfterAmbiguousWrite: true },
      };
    } catch (error) {
      return {
        state: "unknown",
        detail: `exact-reference GET failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async readExactCreditNoteById(
    creditNoteId: string,
    tenantId?: string,
  ): Promise<ReconciliationResult<CreditNote>> {
    let response: unknown;
    try {
      response = await this.request<unknown>(
        "GET",
        `/CreditNotes/${encodeURIComponent(creditNoteId)}`,
        undefined,
        undefined,
        { tenantId },
      );
    } catch (error) {
      return {
        state: "unknown",
        detail: `exact-ID GET failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!response || typeof response !== "object") {
      return { state: "unknown", detail: "exact-ID GET returned a malformed response" };
    }
    const records = (response as { CreditNotes?: unknown }).CreditNotes;
    if (!Array.isArray(records)) {
      return { state: "unknown", detail: "exact-ID GET returned malformed CreditNotes" };
    }
    if (records.length === 0) {
      return { state: "absent", detail: `credit note ${creditNoteId} was not found` };
    }
    if (records.length > 1) {
      return { state: "multiple", detail: `exact-ID GET returned ${records.length} credit notes` };
    }
    const note = records[0];
    if (!note || typeof note !== "object" || Array.isArray(note)) {
      return { state: "mismatch", detail: "exact-ID GET returned a malformed credit note" };
    }
    const typedNote = note as CreditNote;
    if (typedNote.CreditNoteID !== creditNoteId) {
      return {
        state: "mismatch",
        detail: `exact-ID GET returned ${String(typedNote.CreditNoteID)}`,
      };
    }
    return { state: "match", value: typedNote };
  }

  private async inspectExactCreditNoteAuthorisation(
    creditNoteId: string,
    tenantId?: string,
  ): Promise<ReconciliationResult<CreditNote>> {
    const readResult = await this.readExactCreditNoteById(creditNoteId, tenantId);
    if (readResult.state !== "match") return readResult;
    if (readResult.value.Status !== "AUTHORISED") {
      return {
        state: "mismatch",
        detail: `credit note ${creditNoteId} is not the exact AUTHORISED record expected`,
      };
    }
    return {
      state: "match",
      value: { ...readResult.value, ReconciledAfterAmbiguousWrite: true },
    };
  }

  private reconciliationFailure(
    operation: string,
    result: Exclude<ReconciliationResult<unknown>, { state: "match" }>,
  ): Error {
    return new Error(
      `${operation} reconciliation failed: state=${result.state}; ${result.detail}. `
      + "No write was retried; GET and resolve this state before trying again.",
    );
  }

  async createCreditNote(
    options: CreateCreditNoteOptions & { tenantId?: string },
  ): Promise<CreditNote>;
  async createCreditNote(
    contactId: string,
    amount: number,
    description: string,
    reference?: string,
    accountCode?: string,
    tenantId?: string,
    idempotencyKey?: string,
  ): Promise<CreditNote>;
  async createCreditNote(
    optionsOrContactId: (CreateCreditNoteOptions & { tenantId?: string }) | string,
    amount?: number,
    description?: string,
    reference?: string,
    accountCode = "200",
    tenantId?: string,
    positionalIdempotencyKey?: string,
  ): Promise<CreditNote> {
    const options = typeof optionsOrContactId === "string"
      ? {
          contactId: optionsOrContactId,
          amount,
          description,
          reference,
          accountCode,
          tenantId,
          idempotencyKey: positionalIdempotencyKey,
        }
      : optionsOrContactId;
    const rawOptions = options as unknown as Record<string, unknown>;
    if ("CreditNoteID" in rawOptions || "creditNoteId" in rawOptions) {
      throw new Error("createCreditNote must not include CreditNoteID");
    }
    const legacyFields = ["amount", "description", "accountCode"];
    const advancedFields = [
      "lineItems",
      "creditNoteNumber",
      "date",
      "status",
      "lineAmountTypes",
    ];
    const hasLegacyField = legacyFields.some((field) => rawOptions[field] !== undefined);
    const hasAdvancedField = advancedFields.some((field) => rawOptions[field] !== undefined);
    if (hasLegacyField && hasAdvancedField) {
      throw new Error("createCreditNote cannot mix legacy and advanced fields");
    }
    if (!hasLegacyField && !hasAdvancedField) {
      throw new Error("createCreditNote requires legacy amount/description or advanced lineItems");
    }

    const contactId = this.requireNonEmptyString(rawOptions.contactId, "contactId");
    this.validateIdempotencyKey(rawOptions.idempotencyKey);
    let creditNoteBody: Record<string, unknown>;
    const idempotencyKey = rawOptions.idempotencyKey as string | undefined;
    if (hasAdvancedField) {
      const allowedFields = new Set([
        "contactId",
        "reference",
        "lineItems",
        "creditNoteNumber",
        "date",
        "status",
        "lineAmountTypes",
        "idempotencyKey",
        "tenantId",
      ]);
      const unknownField = Object.keys(rawOptions).find((field) => !allowedFields.has(field));
      if (unknownField) {
        throw new Error(`createCreditNote contains unsupported field ${unknownField}`);
      }
      if (rawOptions.idempotencyKey === undefined) {
        throw new Error("idempotencyKey is required in advanced credit-note mode");
      }
      const creditNoteNumber = this.requireNonEmptyString(
        rawOptions.creditNoteNumber,
        "creditNoteNumber",
      );
      const status = rawOptions.status ?? "DRAFT";
      if (status !== "DRAFT" && status !== "AUTHORISED") {
        throw new Error("status must be DRAFT or AUTHORISED");
      }
      const lineAmountTypes = rawOptions.lineAmountTypes;
      if (
        lineAmountTypes !== undefined
        && !["Exclusive", "Inclusive", "NoTax"].includes(String(lineAmountTypes))
      ) {
        throw new Error("lineAmountTypes must be Exclusive, Inclusive, or NoTax");
      }
      creditNoteBody = {
        Type: "ACCRECCREDIT",
        Contact: { ContactID: contactId },
        CreditNoteNumber: creditNoteNumber,
        Date: this.optionalCalendarDate(rawOptions.date, "date"),
        Status: status,
        LineAmountTypes: lineAmountTypes,
        LineItems: this.validateAdvancedCreditNoteLineItems(rawOptions.lineItems),
        Reference: this.optionalNonEmptyString(rawOptions.reference, "reference"),
      };
    } else {
      const allowedFields = new Set([
        "contactId",
        "amount",
        "description",
        "reference",
        "accountCode",
        "idempotencyKey",
        "tenantId",
      ]);
      const unknownField = Object.keys(rawOptions).find((field) => !allowedFields.has(field));
      if (unknownField) {
        throw new Error(`createCreditNote contains unsupported field ${unknownField}`);
      }
      if (typeof rawOptions.amount !== "number" || !Number.isFinite(rawOptions.amount) || rawOptions.amount <= 0) {
        throw new Error("amount must be a finite number greater than zero");
      }
      creditNoteBody = {
        Type: "ACCRECCREDIT",
        Contact: { ContactID: contactId },
        LineItems: [{
          Description: this.requireNonEmptyString(rawOptions.description, "description"),
          Quantity: 1,
          UnitAmount: rawOptions.amount,
          AccountCode: this.optionalNonEmptyString(rawOptions.accountCode, "accountCode") ?? "200",
        }],
        Status: "AUTHORISED",
        Reference: rawOptions.reference,
      };
    }

    const resolvedTenantId = rawOptions.tenantId as string | undefined;
    const canReconcileExactWrite = hasAdvancedField;
    if (idempotencyKey !== undefined && canReconcileExactWrite) {
      const preflight = await this.inspectExactCreditNoteCreate(creditNoteBody, resolvedTenantId);
      if (preflight.state === "match") return preflight.value;
      if (preflight.state !== "absent") {
        throw this.reconciliationFailure("createCreditNote preflight", preflight);
      }
    }

    try {
      const response = await this.request<CreditNotesResponse>(
        "POST",
        "/CreditNotes",
        { CreditNotes: [creditNoteBody] },
        undefined,
        {
          tenantId: resolvedTenantId,
          extraHeaders: idempotencyKey
            ? { "Idempotency-Key": idempotencyKey }
            : undefined,
        },
      );
      const returned = Array.isArray(response?.CreditNotes) ? response.CreditNotes : undefined;
      const created = returned?.[0];
      if (
        !created?.CreditNoteID
        || (
          canReconcileExactWrite
          && (returned?.length !== 1 || !this.matchesExactCreditNoteCreate(created, creditNoteBody))
        )
      ) {
        throw new Error("Xero returned no exact matching credit-note record");
      }
      return created;
    } catch (error) {
      if (idempotencyKey === undefined || !canReconcileExactWrite) throw error;
      const reconciliation = await this.inspectExactCreditNoteCreate(
        creditNoteBody,
        resolvedTenantId,
      );
      if (reconciliation.state === "match") return reconciliation.value;
      throw this.reconciliationFailure("createCreditNote ambiguous write", reconciliation);
    }
  }

  async authoriseCreditNote(
    options: AuthoriseCreditNoteOptions & { tenantId?: string },
  ): Promise<CreditNote> {
    const rawOptions = options as unknown as Record<string, unknown>;
    const allowedFields = new Set(["creditNoteId", "idempotencyKey", "tenantId"]);
    const unknownField = Object.keys(rawOptions).find((field) => !allowedFields.has(field));
    if (unknownField) {
      throw new Error(`authoriseCreditNote contains unsupported field ${unknownField}`);
    }
    const creditNoteId = this.requireNonEmptyString(rawOptions.creditNoteId, "creditNoteId");
    this.validateIdempotencyKey(rawOptions.idempotencyKey);
    if (rawOptions.idempotencyKey === undefined) {
      throw new Error("idempotencyKey is required to authorise a credit note");
    }
    const resolvedTenantId = rawOptions.tenantId as string | undefined;
    const currentRead = await this.readExactCreditNoteById(creditNoteId, resolvedTenantId);
    if (currentRead.state !== "match") {
      throw this.reconciliationFailure("authoriseCreditNote preflight", currentRead);
    }
    const current = currentRead.value;
    if (current.Status === "AUTHORISED") {
      return { ...current, ReconciledAfterAmbiguousWrite: true };
    }
    if (current.Status !== "DRAFT") {
      throw this.reconciliationFailure("authoriseCreditNote preflight", {
        state: "mismatch",
        detail: `credit note ${creditNoteId} has status ${current.Status}, not DRAFT`,
      });
    }

    try {
      const response = await this.request<CreditNotesResponse>(
        "POST",
        `/CreditNotes/${encodeURIComponent(creditNoteId)}`,
        { CreditNotes: [{ CreditNoteID: creditNoteId, Status: "AUTHORISED" }] },
        undefined,
        {
          tenantId: resolvedTenantId,
          extraHeaders: { "Idempotency-Key": rawOptions.idempotencyKey as string },
        },
      );
      const returned = Array.isArray(response?.CreditNotes) ? response.CreditNotes : undefined;
      const authorised = returned?.[0];
      if (
        returned?.length !== 1
        ||
        !authorised?.CreditNoteID
        || authorised.CreditNoteID !== creditNoteId
        || authorised.Status !== "AUTHORISED"
      ) {
        throw new Error("Xero returned no exact AUTHORISED credit-note record");
      }
      return authorised;
    } catch {
      const reconciliation = await this.inspectExactCreditNoteAuthorisation(
        creditNoteId,
        resolvedTenantId,
      );
      if (reconciliation.state === "match") return reconciliation.value;
      throw this.reconciliationFailure("authoriseCreditNote ambiguous write", reconciliation);
    }
  }

  async createCreditNoteRefund(
    options: CreateCreditNoteRefundOptions & { tenantId?: string },
  ): Promise<Payment> {
    const rawOptions = options as unknown as Record<string, unknown>;
    const allowedFields = new Set([
      "creditNoteId",
      "accountId",
      "amount",
      "date",
      "reference",
      "idempotencyKey",
      "tenantId",
    ]);
    const unknownField = Object.keys(rawOptions).find((field) => !allowedFields.has(field));
    if (unknownField) {
      throw new Error(`createCreditNoteRefund contains unsupported field ${unknownField}`);
    }
    const creditNoteId = this.requireNonEmptyString(rawOptions.creditNoteId, "creditNoteId");
    const accountId = this.requireNonEmptyString(rawOptions.accountId, "accountId");
    if (typeof rawOptions.amount !== "number" || !Number.isFinite(rawOptions.amount) || rawOptions.amount <= 0) {
      throw new Error("amount must be a finite number greater than zero");
    }
    const date = this.optionalCalendarDate(rawOptions.date, "date");
    if (date === undefined) {
      throw new Error("date is required for a credit-note refund");
    }
    this.validateIdempotencyKey(rawOptions.idempotencyKey);
    if (rawOptions.idempotencyKey === undefined) {
      throw new Error("idempotencyKey is required for a credit-note refund");
    }
    const reference = this.requireNonEmptyString(rawOptions.reference, "reference");
    const paymentBody = {
      CreditNote: { CreditNoteID: creditNoteId },
      Account: { AccountID: accountId },
      Amount: rawOptions.amount,
      Date: date,
      Reference: reference,
    };
    const resolvedTenantId = rawOptions.tenantId as string | undefined;
    const preflight = await this.inspectExactCreditNoteRefund(paymentBody, resolvedTenantId);
    if (preflight.state === "match") return preflight.value;
    if (preflight.state !== "absent") {
      throw this.reconciliationFailure("createCreditNoteRefund preflight", preflight);
    }
    try {
      const response = await this.request<PaymentsResponse>(
        "PUT",
        "/Payments",
        { Payments: [paymentBody] },
        undefined,
        {
          tenantId: resolvedTenantId,
          extraHeaders: { "Idempotency-Key": rawOptions.idempotencyKey as string },
        },
      );
      const returned = Array.isArray(response?.Payments) ? response.Payments : undefined;
      const created = returned?.[0];
      if (
        returned?.length !== 1
        || !created?.PaymentID
        || !this.matchesExactCreditNoteRefund(created, paymentBody)
      ) {
        throw new Error("Xero returned no exact matching refund payment record");
      }
      return created;
    } catch {
      const reconciliation = await this.inspectExactCreditNoteRefund(
        paymentBody,
        resolvedTenantId,
      );
      if (reconciliation.state === "match") return reconciliation.value;
      throw this.reconciliationFailure("createCreditNoteRefund ambiguous write", reconciliation);
    }
  }

  async allocateCreditNote(
    creditNoteId: string,
    invoiceId: string,
    amount: number,
    tenantIdOrOptions?: string | AllocateCreditNoteOptions,
  ): Promise<Allocation[]> {
    const options = typeof tenantIdOrOptions === "string"
      ? { tenantId: tenantIdOrOptions }
      : (tenantIdOrOptions ?? {});
    this.validateIdempotencyKey(options.idempotencyKey);
    const response = await this.request<{ Allocations?: Allocation[] }>(
      "PUT",
      `/CreditNotes/${creditNoteId}/Allocations`,
      {
        Allocations: [
          {
            Invoice: { InvoiceID: invoiceId },
            Amount: amount,
          },
        ],
      },
      undefined,
      {
        tenantId: options.tenantId,
        extraHeaders: options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : undefined,
      }
    );

    if (!response.Allocations?.length) {
      throw new Error("Failed to allocate credit note - no allocations returned");
    }

    return response.Allocations;
  }


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


  async listTaxRates(tenantId?: string): Promise<TaxRate[]> {
    const resolvedTenantId = await this.resolveTenantId(tenantId);
    return cache.getOrFetch(
      createCacheKey("tax_rates", { tenantId: resolvedTenantId }),
      async () => {
        const response = await this.request<TaxRatesResponse>(
          "GET",
          "/TaxRates",
          undefined,
          undefined,
          { tenantId: resolvedTenantId }
        );
        return response.TaxRates || [];
      },
      { ttl: TTL.DAY }
    );
  }


  async getOrganisation(tenantId?: string): Promise<Organisation | null> {
    const resolvedTenantId = await this.resolveTenantId(tenantId);
    return cache.getOrFetch(
      createCacheKey("organisation", { tenantId: resolvedTenantId }),
      async () => {
        const response = await this.request<OrganisationResponse>(
          "GET",
          "/Organisation",
          undefined,
          undefined,
          { tenantId: resolvedTenantId }
        );
        return response.Organisations?.[0] || null;
      },
      { ttl: TTL.DAY }
    );
  }


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


  clearCache(): number {
    this.clearTenantId();
    this.tenantId = null;
    this.tenantIdValidated = false;
    return cache.clear();
  }
}

export default XeroClient;
