
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Invoice, LineItem, Payment } from "./types.js";

export interface InvoiceStructuralUpdate {
  contactId?: string;
  lineItems?: LineItem[];
  lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  currencyCode?: string;
  type?: "ACCREC" | "ACCPAY";
}

export interface PaidInvoiceEditClient {
  resolveTenantId(tenantId?: string): Promise<string>;
  getInvoice(invoiceId: string, tenantId: string): Promise<Invoice | null>;
  listInvoicePayments(invoiceId: string, tenantId: string): Promise<Payment[]>;
  removePayment(
    paymentId: string,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<void>;
  applyStructuralUpdate(
    invoiceId: string,
    update: InvoiceStructuralUpdate,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<Invoice>;
  reapplyPayment(
    snapshot: PaidInvoicePaymentSnapshot,
    invoiceId: string,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<Payment>;
}

export type PaidInvoiceEditStatus =
  | "PREVIEWED"
  | "CONFIRMED"
  | "SNAPSHOT_SAVED"
  | "REMOVING_PAYMENTS"
  | "PAYMENTS_REMOVED"
  | "UPDATING_INVOICE"
  | "INVOICE_UPDATED"
  | "REAPPLYING_PAYMENTS"
  | "COMPLETED"
  | "BLOCKED_STALE"
  | "MANUAL_REVIEW_REQUIRED";

export interface PaidInvoicePaymentSnapshot {
  paymentId: string;
  accountId: string;
  amount: number;
  date: string;
  reference?: string;
  currencyRate?: number;
  isReconciled?: boolean;
  updatedDateUtc?: string;
  removeState: "PENDING" | "IN_FLIGHT" | "REMOVED";
  removeIdempotencyKey: string;
  reapplyState: "PENDING" | "IN_FLIGHT" | "REAPPLIED";
  reapplyIdempotencyKey: string;
  reapplyKeyIssuedAt?: string;
  replacementPaymentId?: string;
}

export interface PaidInvoiceEditState {
  schemaVersion: 1;
  revision: number;
  planId: string;
  confirmationToken: string;
  tenantId: string;
  invoiceId: string;
  status: PaidInvoiceEditStatus;
  update: InvoiceStructuralUpdate;
  previewInvoice: Invoice;
  previewFingerprint: string;
  snapshotInvoice?: Invoice;
  payments: PaidInvoicePaymentSnapshot[];
  invoiceUpdateIdempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface PaidInvoiceEditPreview {
  planId: string;
  confirmationToken: string;
  invoiceId: string;
  invoiceNumber?: string;
  invoiceStatus: Invoice["Status"];
  amountPaid: number;
  paymentCount: number;
  paymentTotal: number;
  update: InvoiceStructuralUpdate;
  status: PaidInvoiceEditStatus;
  instruction: string;
}

export interface PaidInvoiceEditStore {
  load(tenantId: string, invoiceId: string): Promise<PaidInvoiceEditState | null>;
  create(state: PaidInvoiceEditState): Promise<PaidInvoiceEditState>;
  save(
    state: PaidInvoiceEditState,
    expectedRevision: number,
  ): Promise<PaidInvoiceEditState>;
}

export class PaidInvoiceEditConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidInvoiceEditConflictError";
  }
}

export class PaidInvoiceEditStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidInvoiceEditStaleError";
  }
}

export class PaidInvoiceEditManualReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidInvoiceEditManualReviewError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cleanObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, cleanObject(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(cleanObject(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function makeIdempotencyKey(planId: string, action: string, subject: string): string {
  return `example-paid-edit-${digest({ planId, action, subject })}`;
}

export function hasStructuralInvoiceUpdate(
  update: InvoiceStructuralUpdate,
): boolean {
  return (
    update.contactId !== undefined ||
    update.lineItems !== undefined ||
    update.lineAmountTypes !== undefined ||
    update.currencyCode !== undefined ||
    update.type !== undefined
  );
}

function hasActiveCreditNote(invoice: Invoice): boolean {
  return (invoice.CreditNotes ?? []).some(
    (creditNote) => creditNote.Status !== "DELETED" && creditNote.Status !== "VOIDED",
  );
}

function hasActivePrepaymentOrOverpayment(invoice: Invoice): boolean {
  return [...(invoice.Prepayments ?? []), ...(invoice.Overpayments ?? [])].some(
    (settlement) => settlement.Status !== "VOIDED",
  );
}

function amountDueShowsSettlement(invoice: Invoice): boolean {
  return (
    Number.isFinite(invoice.Total) &&
    Number.isFinite(invoice.AmountDue) &&
    (invoice.AmountDue as number) < (invoice.Total as number) - 0.000001
  );
}

const SETTLEMENT_TOLERANCE = 0.000001;

function amountDueHasUnexplainedSettlement(invoice: Invoice): boolean {
  if (!Number.isFinite(invoice.Total) || !Number.isFinite(invoice.AmountDue)) {
    return false;
  }
  const settledByAmountDue = (invoice.Total as number) - (invoice.AmountDue as number);
  const declaredPaid = Number.isFinite(invoice.AmountPaid) ? (invoice.AmountPaid as number) : 0;
  return Math.abs(settledByAmountDue - declaredPaid) > SETTLEMENT_TOLERANCE;
}

function paymentSnapshotDoesNotReconcile(invoice: Invoice): boolean {
  if (invoice.Payments === undefined) return false;
  const declaredPaid = Number.isFinite(invoice.AmountPaid) ? (invoice.AmountPaid as number) : 0;
  const payments = (invoice.Payments ?? []).filter((payment) => payment.Status !== "DELETED");
  if (payments.some((payment) => !Number.isFinite(payment.Amount))) return true;
  const paymentTotal = payments.reduce((sum, payment) => sum + (payment.Amount ?? 0), 0);
  return Math.abs(paymentTotal - declaredPaid) > SETTLEMENT_TOLERANCE;
}

export function hasNonPaymentSettlementActivity(invoice: Invoice): boolean {
  if (
    (invoice.AmountCredited ?? 0) > 0 ||
    hasActiveCreditNote(invoice) ||
    hasActivePrepaymentOrOverpayment(invoice)
  ) {
    return true;
  }

  return amountDueHasUnexplainedSettlement(invoice) || paymentSnapshotDoesNotReconcile(invoice);
}

export function hasSettlementActivity(invoice: Invoice): boolean {
  return (
    invoice.Status === "PAID" ||
    (invoice.AmountPaid ?? 0) > 0 ||
    (invoice.AmountCredited ?? 0) > 0 ||
    amountDueShowsSettlement(invoice) ||
    hasActiveCreditNote(invoice) ||
    hasActivePrepaymentOrOverpayment(invoice) ||
    (invoice.Payments ?? []).some((payment) => payment.Status !== "DELETED")
  );
}

function activePayments(payments: Payment[]): Payment[] {
  return payments.filter((payment) => payment.Status !== "DELETED");
}

function invoiceFingerprint(invoice: Invoice, payments: Payment[]): string {
  return digest({
    InvoiceID: invoice.InvoiceID,
    Status: invoice.Status,
    UpdatedDateUTC: invoice.UpdatedDateUTC,
    Total: invoice.Total,
    AmountPaid: invoice.AmountPaid,
    AmountCredited: invoice.AmountCredited,
    AmountDue: invoice.AmountDue,
    ContactID: invoice.Contact?.ContactID,
    Type: invoice.Type,
    CurrencyCode: invoice.CurrencyCode,
    LineAmountTypes: invoice.LineAmountTypes,
    LineItems: invoice.LineItems,
    Payments: activePayments(payments)
      .map((payment) => ({
        PaymentID: payment.PaymentID,
        Status: payment.Status,
        Amount: payment.Amount,
        Date: payment.Date,
        UpdatedDateUTC: payment.UpdatedDateUTC,
        AccountID: payment.Account?.AccountID,
        Reference: payment.Reference,
        CurrencyRate: payment.CurrencyRate,
        IsReconciled: payment.IsReconciled,
        BatchPaymentID: payment.BatchPaymentID,
      }))
      .sort((left, right) => left.PaymentID.localeCompare(right.PaymentID)),
  });
}

function normaliseRequestedLineItem(line: LineItem): Record<string, unknown> {
  return cleanObject({
    Description: line.Description,
    Quantity: line.Quantity,
    UnitAmount: line.UnitAmount,
    ItemCode: line.ItemCode,
    AccountCode: line.AccountCode,
    AccountID: line.AccountID,
    TaxType: line.TaxType,
    Tracking: line.Tracking,
    DiscountRate: line.DiscountRate,
    DiscountAmount: line.DiscountAmount,
  }) as Record<string, unknown>;
}

function invoiceValuesForUpdate(
  invoice: Invoice,
  update: InvoiceStructuralUpdate,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (update.contactId !== undefined) values.contactId = invoice.Contact?.ContactID;
  if (update.type !== undefined) values.type = invoice.Type;
  if (update.currencyCode !== undefined) values.currencyCode = invoice.CurrencyCode;
  if (update.lineAmountTypes !== undefined) values.lineAmountTypes = invoice.LineAmountTypes;
  if (update.lineItems !== undefined) {
    values.lineItems = (invoice.LineItems ?? []).map(normaliseRequestedLineItem);
  }
  return cleanObject(values) as Record<string, unknown>;
}

function requestedValues(update: InvoiceStructuralUpdate): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (update.contactId !== undefined) values.contactId = update.contactId;
  if (update.type !== undefined) values.type = update.type;
  if (update.currencyCode !== undefined) values.currencyCode = update.currencyCode;
  if (update.lineAmountTypes !== undefined) values.lineAmountTypes = update.lineAmountTypes;
  if (update.lineItems !== undefined) {
    values.lineItems = update.lineItems.map(normaliseRequestedLineItem);
  }
  return cleanObject(values) as Record<string, unknown>;
}

function invoiceMatchesUpdate(
  invoice: Invoice,
  update: InvoiceStructuralUpdate,
): boolean {
  return stableJson(invoiceValuesForUpdate(invoice, update)) === stableJson(requestedValues(update));
}

function invoiceStillMatchesSnapshot(
  invoice: Invoice,
  snapshot: Invoice,
  update: InvoiceStructuralUpdate,
): boolean {
  return (
    stableJson(invoiceValuesForUpdate(invoice, update)) ===
    stableJson(invoiceValuesForUpdate(snapshot, update))
  );
}

function paymentMatchesSnapshot(payment: Payment, snapshot: PaidInvoicePaymentSnapshot): boolean {
  return (
    payment.Status !== "DELETED" &&
    payment.Invoice?.InvoiceID !== undefined &&
    payment.Amount === snapshot.amount &&
    payment.Date === snapshot.date &&
    payment.Account?.AccountID === snapshot.accountId &&
    (payment.Reference ?? undefined) === snapshot.reference &&
    (payment.CurrencyRate ?? undefined) === snapshot.currencyRate &&
    (payment.IsReconciled ?? false) === (snapshot.isReconciled ?? false)
  );
}

function toPaymentSnapshots(
  payments: Payment[],
  planId: string,
): PaidInvoicePaymentSnapshot[] {
  return activePayments(payments).map((payment) => {
    if (payment.Status !== "AUTHORISED") {
      throw new PaidInvoiceEditManualReviewError(
        `Cannot safely edit paid invoice: payment ${payment.PaymentID || "(unknown)"} ` +
        `has unsupported status ${payment.Status || "(missing)"}.`,
      );
    }
    if (payment.BatchPaymentID) {
      throw new PaidInvoiceEditManualReviewError(
        `Cannot safely edit paid invoice: payment ${payment.PaymentID || "(unknown)"} ` +
        `belongs to batch ${payment.BatchPaymentID}, whose child payment cannot be deleted independently.`,
      );
    }
    if (
      !payment.PaymentID ||
      !payment.Account?.AccountID ||
      !payment.Date ||
      payment.Amount === undefined ||
      !Number.isFinite(payment.Amount) ||
      payment.Amount <= 0
    ) {
      throw new Error(
        `Cannot safely edit paid invoice: payment ${payment.PaymentID || "(unknown)"} ` +
        "is missing PaymentID, Account.AccountID, Date, or a positive Amount needed for reapplication.",
      );
    }
    return {
      paymentId: payment.PaymentID,
      accountId: payment.Account.AccountID,
      amount: payment.Amount,
      date: payment.Date,
      reference: payment.Reference,
      currencyRate: payment.CurrencyRate,
      isReconciled: payment.IsReconciled,
      updatedDateUtc: payment.UpdatedDateUTC,
      removeState: "PENDING",
      removeIdempotencyKey: makeIdempotencyKey(planId, "remove", payment.PaymentID),
      reapplyState: "PENDING",
      reapplyIdempotencyKey: makeIdempotencyKey(planId, "reapply", payment.PaymentID),
    };
  });
}

export function resolvePaidInvoiceEditPaths(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): { directory: string; legacyDirectory: string } {
  const stateDirectory = env.XERO_ACCOUNTING_STATE_DIR
    || join(env.BIZ_ROOT || join(home, "biz"), "var", "xero-accounting-manager");
  return {
    directory: join(stateDirectory, "paid-invoice-edits"),
    legacyDirectory: join(
      home,
      ".local",
      "state",
      "xero-accounting-manager",
      "paid-invoice-edits",
    ),
  };
}

export function legacyPaidInvoiceEditBlocker(
  legacyDirectory: string,
): string | undefined {
  if (!existsSync(legacyDirectory)) return undefined;
  for (const entry of readdirSync(legacyDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".lock") || entry.name.includes(".tmp")) {
      return `Legacy paid-invoice recovery state is still active at ${legacyDirectory}`;
    }
    if (!entry.name.endsWith(".json")) continue;
    try {
      const state = JSON.parse(
        readFileSync(join(legacyDirectory, entry.name), "utf8"),
      ) as { status?: unknown };
      if (!["COMPLETED", "BLOCKED_STALE"].includes(String(state.status))) {
        return `Legacy paid-invoice recovery state is still active at ${legacyDirectory}`;
      }
    } catch {
      return `Legacy paid-invoice recovery state is unreadable at ${legacyDirectory}`;
    }
  }
  return `Legacy paid-invoice recovery directory still exists at ${legacyDirectory}`;
}

export class FilePaidInvoiceEditStore implements PaidInvoiceEditStore {
  private readonly directory: string;
  private readonly legacyDirectory?: string;

  constructor(directory?: string, legacyDirectory?: string) {
    if (directory) {
      this.directory = directory;
      this.legacyDirectory = legacyDirectory;
      return;
    }
    const paths = resolvePaidInvoiceEditPaths();
    this.directory = paths.directory;
    this.legacyDirectory = paths.legacyDirectory;
  }

  async load(tenantId: string, invoiceId: string): Promise<PaidInvoiceEditState | null> {
    this.assertUsable();
    const path = this.statePath(tenantId, invoiceId);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PaidInvoiceEditState;
    if (
      parsed.schemaVersion !== 1 ||
      parsed.tenantId !== tenantId ||
      parsed.invoiceId !== invoiceId
    ) {
      throw new Error(`Invalid paid-invoice edit state at ${path}`);
    }
    return clone(parsed);
  }

  async create(state: PaidInvoiceEditState): Promise<PaidInvoiceEditState> {
    this.assertUsable();
    return this.withLock(state.tenantId, state.invoiceId, () => {
      const path = this.statePath(state.tenantId, state.invoiceId);
      if (existsSync(path)) {
        throw new PaidInvoiceEditConflictError(
          `A paid-invoice edit plan already exists for invoice ${state.invoiceId}.`,
        );
      }
      return this.atomicWrite(path, { ...clone(state), revision: 1 });
    });
  }

  async save(
    state: PaidInvoiceEditState,
    expectedRevision: number,
  ): Promise<PaidInvoiceEditState> {
    this.assertUsable();
    return this.withLock(state.tenantId, state.invoiceId, () => {
      const path = this.statePath(state.tenantId, state.invoiceId);
      if (!existsSync(path)) {
        throw new PaidInvoiceEditConflictError(
          `Paid-invoice edit state disappeared for invoice ${state.invoiceId}.`,
        );
      }
      const current = JSON.parse(readFileSync(path, "utf8")) as PaidInvoiceEditState;
      const replacingFinishedPlan =
        current.planId !== state.planId &&
        ["COMPLETED", "BLOCKED_STALE"].includes(current.status);
      if (
        current.revision !== expectedRevision ||
        (current.planId !== state.planId && !replacingFinishedPlan)
      ) {
        throw new PaidInvoiceEditConflictError(
          `Stale paid-invoice edit state for invoice ${state.invoiceId}; ` +
          `expected revision ${expectedRevision}, found ${current.revision}.`,
        );
      }
      return this.atomicWrite(path, {
        ...clone(state),
        revision: expectedRevision + 1,
      });
    });
  }

  private statePath(tenantId: string, invoiceId: string): string {
    const key = digest({ tenantId, invoiceId });
    return join(this.directory, `${key}.json`);
  }

  private assertUsable(): void {
    const legacyBlocker = this.legacyDirectory
      ? legacyPaidInvoiceEditBlocker(this.legacyDirectory)
      : undefined;
    if (legacyBlocker) {
      throw new PaidInvoiceEditConflictError(
        `${legacyBlocker}; stop the legacy deployment, resume or close any in-flight plan there, then move the legacy directory aside before using the workspace-local store.`,
      );
    }
  }

  private withLock<T>(tenantId: string, invoiceId: string, fn: () => T): T {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = `${this.statePath(tenantId, invoiceId)}.lock`;
    let fd: number;
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch {
      throw new PaidInvoiceEditConflictError(
        `Another process is changing paid-invoice edit state for invoice ${invoiceId}.`,
      );
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      rmSync(lockPath, { force: true });
    }
  }

  private atomicWrite(
    path: string,
    state: PaidInvoiceEditState,
  ): PaidInvoiceEditState {
    const stored = {
      ...state,
      updatedAt: new Date().toISOString(),
    };
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    return clone(stored);
  }
}

export class PaidInvoiceEditWorkflow {
  constructor(
    private readonly client: PaidInvoiceEditClient,
    private readonly store: PaidInvoiceEditStore = new FilePaidInvoiceEditStore(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async preview(
    invoiceId: string,
    update: InvoiceStructuralUpdate,
    tenantId?: string,
  ): Promise<PaidInvoiceEditPreview> {
    if (!hasStructuralInvoiceUpdate(update)) {
      throw new Error("A paid-invoice edit preview requires at least one structural field.");
    }

    const resolvedTenantId = await this.client.resolveTenantId(tenantId);
    const existing = await this.store.load(resolvedTenantId, invoiceId);
    if (existing && !["COMPLETED", "BLOCKED_STALE"].includes(existing.status)) {
      if (
        existing.status === "PREVIEWED" &&
        stableJson(existing.update) === stableJson(update)
      ) {
        return this.toPreview(existing);
      }
      throw new PaidInvoiceEditConflictError(
        `Invoice ${invoiceId} already has active plan ${existing.planId} ` +
        `at state ${existing.status}; resume that plan before creating another.`,
      );
    }

    const { invoice, payments } = await this.readPaidInvoice(invoiceId, resolvedTenantId);
    const planId = randomUUID();
    const createdAt = this.now().toISOString();
    const previewFingerprint = invoiceFingerprint(invoice, payments);
    const confirmationToken = digest({
      planId,
      invoiceId,
      tenantId: resolvedTenantId,
      update,
      previewFingerprint,
    }).slice(0, 32);
    const state: PaidInvoiceEditState = {
      schemaVersion: 1,
      revision: 0,
      planId,
      confirmationToken,
      tenantId: resolvedTenantId,
      invoiceId,
      status: "PREVIEWED",
      update: clone(update),
      previewInvoice: clone(invoice),
      previewFingerprint,
      payments: toPaymentSnapshots(payments, planId),
      invoiceUpdateIdempotencyKey: makeIdempotencyKey(planId, "update", invoiceId),
      createdAt,
      updatedAt: createdAt,
    };

    let saved: PaidInvoiceEditState;
    if (existing) {
      saved = await this.store.save(state, existing.revision);
    } else {
      saved = await this.store.create(state);
    }
    return this.toPreview(saved);
  }

  async confirmAndRun(
    invoiceId: string,
    planId: string,
    confirmationToken: string,
    tenantId?: string,
  ): Promise<PaidInvoiceEditState> {
    const resolvedTenantId = await this.client.resolveTenantId(tenantId);
    let state = await this.requireState(resolvedTenantId, invoiceId, planId);
    if (state.confirmationToken !== confirmationToken) {
      throw new Error(
        `Confirmation token does not match paid-invoice edit plan ${planId}.`,
      );
    }
    if (state.status === "COMPLETED") return state;
    if (state.status === "BLOCKED_STALE") {
      throw new PaidInvoiceEditStaleError(
        `Plan ${planId} is stale. Create and explicitly confirm a new preview.`,
      );
    }
    if (state.status === "MANUAL_REVIEW_REQUIRED") {
      throw new PaidInvoiceEditManualReviewError(
        `Plan ${planId} requires manual review. No automatic rollback or further write was attempted.`,
      );
    }

    if (state.status === "PREVIEWED" || state.status === "CONFIRMED") {
      const { invoice, payments } = await this.readPaidInvoice(invoiceId, resolvedTenantId);
      const currentFingerprint = invoiceFingerprint(invoice, payments);
      if (currentFingerprint !== state.previewFingerprint) {
        state = await this.saveState(state, {
          status: "BLOCKED_STALE",
          lastError:
            "Invoice or payment state changed after preview. No payment was removed.",
        });
        throw new PaidInvoiceEditStaleError(
          `Invoice ${invoiceId} changed after preview; plan ${planId} was blocked before any write.`,
        );
      }

      if (state.status === "PREVIEWED") {
        state = await this.saveState(state, {
          status: "CONFIRMED",
          lastError: undefined,
        });
      }
      state = await this.saveState(state, {
        status: "SNAPSHOT_SAVED",
        snapshotInvoice: clone(invoice),
        payments: toPaymentSnapshots(payments, planId),
        lastError: undefined,
      });
    }

    return this.runFromSnapshot(state);
  }

  async getState(
    invoiceId: string,
    tenantId?: string,
  ): Promise<PaidInvoiceEditState | null> {
    const resolvedTenantId = await this.client.resolveTenantId(tenantId);
    return this.store.load(resolvedTenantId, invoiceId);
  }

  private async runFromSnapshot(
    initialState: PaidInvoiceEditState,
  ): Promise<PaidInvoiceEditState> {
    let state = initialState;
    try {
      state = await this.removePayments(state);
      state = await this.updateInvoice(state);
      state = await this.reapplyPayments(state);
      if (state.status !== "COMPLETED") {
        state = await this.saveState(state, {
          status: "COMPLETED",
          lastError: undefined,
        });
      }
      return state;
    } catch (error) {
      if (
        error instanceof PaidInvoiceEditConflictError ||
        error instanceof PaidInvoiceEditManualReviewError ||
        error instanceof PaidInvoiceEditStaleError
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      try {
        const durable = await this.store.load(state.tenantId, state.invoiceId);
        if (durable?.planId === state.planId) {
          state = await this.saveState(durable, { lastError: message });
        }
      } catch {
      }
      throw new Error(
        `Paid-invoice edit plan ${state.planId} stopped at ${state.status}: ${message}. ` +
        "Retry the same confirmed plan; do not issue a separate update or payment.",
        { cause: error },
      );
    }
  }

  private async removePayments(
    initialState: PaidInvoiceEditState,
  ): Promise<PaidInvoiceEditState> {
    let state = initialState;
    if (["PAYMENTS_REMOVED", "UPDATING_INVOICE", "INVOICE_UPDATED", "REAPPLYING_PAYMENTS", "COMPLETED"].includes(state.status)) {
      return state;
    }
    if (state.status !== "REMOVING_PAYMENTS") {
      state = await this.saveState(state, {
        status: "REMOVING_PAYMENTS",
        lastError: undefined,
      });
    }

    for (let index = 0; index < state.payments.length; index += 1) {
      let payment = state.payments[index];
      if (payment.removeState === "REMOVED") continue;

      if (payment.removeState === "IN_FLIGHT") {
        const current = activePayments(
          await this.client.listInvoicePayments(state.invoiceId, state.tenantId),
        );
        if (!current.some((item) => item.PaymentID === payment.paymentId)) {
          state = await this.updatePayment(state, index, {
            removeState: "REMOVED",
          });
          continue;
        }
      } else {
        state = await this.updatePayment(state, index, {
          removeState: "IN_FLIGHT",
        });
        payment = state.payments[index];
      }

      await this.client.removePayment(
        payment.paymentId,
        state.tenantId,
        payment.removeIdempotencyKey,
      );
      state = await this.updatePayment(state, index, {
        removeState: "REMOVED",
      });
    }

    return this.saveState(state, {
      status: "PAYMENTS_REMOVED",
      lastError: undefined,
    });
  }

  private async updateInvoice(
    initialState: PaidInvoiceEditState,
  ): Promise<PaidInvoiceEditState> {
    let state = initialState;
    if (["INVOICE_UPDATED", "REAPPLYING_PAYMENTS", "COMPLETED"].includes(state.status)) {
      return state;
    }
    if (!state.snapshotInvoice) {
      return this.manualReview(
        state,
        "Confirmed snapshot is missing; refusing to guess the pre-edit invoice structure.",
      );
    }

    if (state.status === "UPDATING_INVOICE") {
      const current = await this.client.getInvoice(state.invoiceId, state.tenantId);
      if (!current) {
        return this.manualReview(
          state,
          "Invoice disappeared while its structural update was in flight.",
        );
      }
      if (invoiceMatchesUpdate(current, state.update)) {
        return this.saveState(state, {
          status: "INVOICE_UPDATED",
          lastError: undefined,
        });
      }
      if (!invoiceStillMatchesSnapshot(current, state.snapshotInvoice, state.update)) {
        return this.manualReview(
          state,
          "Invoice structure differs from both the snapshot and requested update.",
        );
      }
    } else {
      state = await this.saveState(state, {
        status: "UPDATING_INVOICE",
        lastError: undefined,
      });
    }

    await this.client.applyStructuralUpdate(
      state.invoiceId,
      state.update,
      state.tenantId,
      state.invoiceUpdateIdempotencyKey,
    );
    return this.saveState(state, {
      status: "INVOICE_UPDATED",
      lastError: undefined,
    });
  }

  private async reapplyPayments(
    initialState: PaidInvoiceEditState,
  ): Promise<PaidInvoiceEditState> {
    let state = initialState;
    if (state.status === "COMPLETED") return state;
    if (state.status !== "REAPPLYING_PAYMENTS") {
      state = await this.saveState(state, {
        status: "REAPPLYING_PAYMENTS",
        lastError: undefined,
      });
    }

    for (let index = 0; index < state.payments.length; index += 1) {
      let payment = state.payments[index];
      if (payment.reapplyState === "REAPPLIED") continue;

      if (payment.reapplyState === "IN_FLIGHT") {
        const claimedReplacementIds = new Set(
          state.payments
            .filter((_, candidateIndex) => candidateIndex !== index)
            .map((candidate) => candidate.replacementPaymentId)
            .filter((paymentId): paymentId is string => Boolean(paymentId)),
        );
        const candidates = activePayments(
          await this.client.listInvoicePayments(state.invoiceId, state.tenantId),
        ).filter(
          (candidate) =>
            candidate.PaymentID !== payment.paymentId &&
            !claimedReplacementIds.has(candidate.PaymentID) &&
            paymentMatchesSnapshot(candidate, payment),
        );
        if (candidates.length === 1) {
          state = await this.updatePayment(state, index, {
            reapplyState: "REAPPLIED",
            replacementPaymentId: candidates[0].PaymentID,
          });
          continue;
        }
        if (candidates.length > 1) {
          return this.manualReview(
            state,
            `Multiple replacement payments match original payment ${payment.paymentId}.`,
          );
        }

        const issuedAt = payment.reapplyKeyIssuedAt
          ? new Date(payment.reapplyKeyIssuedAt).getTime()
          : Number.NaN;
        if (
          !Number.isFinite(issuedAt) ||
          this.now().getTime() - issuedAt >= 5 * 60 * 1000
        ) {
          return this.manualReview(
            state,
            `The idempotency window expired while reapplying payment ${payment.paymentId}, ` +
            "and no unique replacement could be verified.",
          );
        }
      } else {
        state = await this.updatePayment(state, index, {
          reapplyState: "IN_FLIGHT",
          reapplyKeyIssuedAt: this.now().toISOString(),
        });
        payment = state.payments[index];
      }

      const currentInvoice = await this.client.getInvoice(state.invoiceId, state.tenantId);
      const remainingAmount = state.payments
        .filter((candidate) => candidate.reapplyState !== "REAPPLIED")
        .reduce((sum, candidate) => sum + candidate.amount, 0);
      if (
        !currentInvoice ||
        !Number.isFinite(currentInvoice.AmountDue) ||
        (currentInvoice.AmountDue as number) + SETTLEMENT_TOLERANCE < remainingAmount
      ) {
        return this.manualReview(
          state,
          `Updated invoice has insufficient outstanding value for the remaining payments (${remainingAmount}).`,
        );
      }

      const replacement = await this.client.reapplyPayment(
        payment,
        state.invoiceId,
        state.tenantId,
        payment.reapplyIdempotencyKey,
      );
      if (!replacement.PaymentID) {
        throw new Error(
          `Xero returned no PaymentID while reapplying payment ${payment.paymentId}.`,
        );
      }
      state = await this.updatePayment(state, index, {
        reapplyState: "REAPPLIED",
        replacementPaymentId: replacement.PaymentID,
      });
    }

    const finalPayments = activePayments(
      await this.client.listInvoicePayments(state.invoiceId, state.tenantId),
    );
    const replacementIds = state.payments.map((payment) => payment.replacementPaymentId);
    const uniqueReplacementIds = new Set(replacementIds.filter((paymentId): paymentId is string => Boolean(paymentId)));
    const finalInvoice = await this.client.getInvoice(state.invoiceId, state.tenantId);
    const expectedAmountPaid = state.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const paymentSetMatches =
      uniqueReplacementIds.size === state.payments.length &&
      finalPayments.length === state.payments.length &&
      state.payments.every((snapshot) => {
        const candidate = finalPayments.find(
          (payment) => payment.PaymentID === snapshot.replacementPaymentId,
        );
        return Boolean(candidate && paymentMatchesSnapshot(candidate, snapshot));
      });
    if (
      !paymentSetMatches ||
      !finalInvoice ||
      !Number.isFinite(finalInvoice.AmountPaid) ||
      Math.abs((finalInvoice.AmountPaid as number) - expectedAmountPaid) > SETTLEMENT_TOLERANCE
    ) {
      return this.manualReview(
        state,
        "The final active-payment set or invoice AmountPaid does not exactly match the durable snapshot.",
      );
    }

    return this.saveState(state, {
      status: "COMPLETED",
      lastError: undefined,
    });
  }

  private async manualReview(
    state: PaidInvoiceEditState,
    message: string,
  ): Promise<never> {
    const saved = await this.saveState(state, {
      status: "MANUAL_REVIEW_REQUIRED",
      lastError: message,
    });
    throw new PaidInvoiceEditManualReviewError(
      `Plan ${saved.planId} requires manual review: ${message} ` +
      "No automatic rollback or further write was attempted.",
    );
  }

  private async readPaidInvoice(
    invoiceId: string,
    tenantId: string,
  ): Promise<{ invoice: Invoice; payments: Payment[] }> {
    const invoice = await this.client.getInvoice(invoiceId, tenantId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} was not found.`);
    }
    const payments = activePayments(
      await this.client.listInvoicePayments(invoiceId, tenantId),
    );
    const invoiceWithPayments = { ...invoice, Payments: payments };
    if (hasNonPaymentSettlementActivity(invoiceWithPayments)) {
      throw new PaidInvoiceEditManualReviewError(
        `Invoice ${invoiceId} has credit-note, prepayment, overpayment, or ` +
        "otherwise unattributed settlement activity. This payment-only workflow " +
        "cannot preserve those allocations; manual accounting review is required.",
      );
    }
    if (!hasSettlementActivity(invoiceWithPayments)) {
      throw new Error(
        `Invoice ${invoiceId} is not paid or part-paid; use the generic update-invoice command.`,
      );
    }
    if (payments.length === 0) {
      throw new Error(
        `Invoice ${invoiceId} reports paid value/status but no active payments were found. ` +
        "Refusing structural edit because a complete reapplication snapshot cannot be built.",
      );
    }
    return { invoice, payments };
  }

  private async requireState(
    tenantId: string,
    invoiceId: string,
    planId: string,
  ): Promise<PaidInvoiceEditState> {
    const state = await this.store.load(tenantId, invoiceId);
    if (!state || state.planId !== planId) {
      throw new Error(
        `Paid-invoice edit plan ${planId} was not found for invoice ${invoiceId}.`,
      );
    }
    return state;
  }

  private async saveState(
    state: PaidInvoiceEditState,
    changes: Partial<PaidInvoiceEditState>,
  ): Promise<PaidInvoiceEditState> {
    return this.store.save(
      {
        ...clone(state),
        ...clone(changes),
        updatedAt: this.now().toISOString(),
      },
      state.revision,
    );
  }

  private async updatePayment(
    state: PaidInvoiceEditState,
    index: number,
    changes: Partial<PaidInvoicePaymentSnapshot>,
  ): Promise<PaidInvoiceEditState> {
    const payments = clone(state.payments);
    payments[index] = { ...payments[index], ...clone(changes) };
    return this.saveState(state, { payments });
  }

  private toPreview(state: PaidInvoiceEditState): PaidInvoiceEditPreview {
    return {
      planId: state.planId,
      confirmationToken: state.confirmationToken,
      invoiceId: state.invoiceId,
      invoiceNumber: state.previewInvoice.InvoiceNumber,
      invoiceStatus: state.previewInvoice.Status,
      amountPaid: state.previewInvoice.AmountPaid ?? 0,
      paymentCount: state.payments.length,
      paymentTotal: state.payments.reduce((sum, payment) => sum + payment.amount, 0),
      update: clone(state.update),
      status: state.status,
      instruction:
        "Review this plan, then explicitly run confirm-paid-invoice-edit with " +
        "the exact planId and confirmationToken. Confirmation removes and recreates payments.",
    };
  }
}
