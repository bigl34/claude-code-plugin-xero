/**
 * Xero API TypeScript Types
 *
 * Type definitions for the Xero Accounting REST API.
 * Based on https://developer.xero.com/documentation/api/accounting/overview
 */

// ==================== Configuration ====================

export interface XeroConfig {
  clientId: string;
  clientSecret: string;
}

export interface ConfigFile {
  xero?: XeroConfig;
  mcpServer?: {
    command?: string;
    args?: string[];
    env?: {
      XERO_CLIENT_ID?: string;
      XERO_CLIENT_SECRET?: string;
    };
  };
}

// ==================== Token ====================

export interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

// ==================== Connections ====================

export interface XeroConnection {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

// ==================== Contact ====================

export interface Contact {
  ContactID: string;
  ContactNumber?: string;
  AccountNumber?: string;
  ContactStatus: "ACTIVE" | "ARCHIVED" | "GDPRREQUEST";
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  SkypeUserName?: string;
  BankAccountDetails?: string;
  TaxNumber?: string;
  AccountsReceivableTaxType?: string;
  AccountsPayableTaxType?: string;
  Addresses?: Address[];
  Phones?: Phone[];
  IsSupplier?: boolean;
  IsCustomer?: boolean;
  DefaultCurrency?: string;
  XeroNetworkKey?: string;
  SalesDefaultAccountCode?: string;
  PurchasesDefaultAccountCode?: string;
  SalesTrackingCategories?: TrackingCategory[];
  PurchasesTrackingCategories?: TrackingCategory[];
  TrackingCategoryName?: string;
  TrackingCategoryOption?: string;
  PaymentTerms?: PaymentTerms;
  UpdatedDateUTC?: string;
  ContactGroups?: ContactGroup[];
  Website?: string;
  BrandingTheme?: BrandingTheme;
  BatchPayments?: BatchPaymentDetails;
  Discount?: number;
  Balances?: ContactBalances;
  HasAttachments?: boolean;
  ValidationErrors?: ValidationError[];
  HasValidationErrors?: boolean;
  StatusAttributeString?: string;
}

export interface Address {
  AddressType: "POBOX" | "STREET" | "DELIVERY";
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  AddressLine4?: string;
  City?: string;
  Region?: string;
  PostalCode?: string;
  Country?: string;
  AttentionTo?: string;
}

export interface Phone {
  PhoneType: "DEFAULT" | "DDI" | "MOBILE" | "FAX";
  PhoneNumber?: string;
  PhoneAreaCode?: string;
  PhoneCountryCode?: string;
}

export interface ContactGroup {
  ContactGroupID?: string;
  Name?: string;
  Status?: "ACTIVE" | "DELETED";
  Contacts?: Contact[];
}

export interface ContactBalances {
  AccountsReceivable?: Balance;
  AccountsPayable?: Balance;
}

export interface Balance {
  Outstanding?: number;
  Overdue?: number;
}

// ==================== Invoice ====================

export interface Invoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Reference?: string;
  Type: "ACCREC" | "ACCPAY";
  Status:
    | "DRAFT"
    | "SUBMITTED"
    | "AUTHORISED"
    | "PAID"
    | "VOIDED"
    | "DELETED";
  Contact: ContactRef;
  DateString?: string;
  Date?: string;
  DueDateString?: string;
  DueDate?: string;
  LineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  LineItems: LineItem[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  TotalDiscount?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  FullyPaidOnDate?: string;
  AmountDue?: number;
  AmountPaid?: number;
  AmountCredited?: number;
  SentToContact?: boolean;
  ExpectedPaymentDate?: string;
  PlannedPaymentDate?: string;
  CISDeduction?: number;
  Payments?: Payment[];
  CreditNotes?: CreditNote[];
  Prepayments?: Prepayment[];
  Overpayments?: Overpayment[];
  HasAttachments?: boolean;
  RepeatingInvoiceID?: string;
  BrandingThemeID?: string;
  Url?: string;
  HasErrors?: boolean;
  ValidationErrors?: ValidationError[];
}

export interface ContactRef {
  ContactID: string;
  Name?: string;
}

export interface LineItem {
  LineItemID?: string;
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  ItemCode?: string;
  AccountCode?: string;
  AccountID?: string;
  TaxType?: string;
  TaxAmount?: number;
  LineAmount?: number;
  Tracking?: TrackingCategory[];
  DiscountRate?: number;
  DiscountAmount?: number;
  RepeatingInvoiceID?: string;
}

// ==================== Payment ====================

export interface Payment {
  PaymentID: string;
  Date?: string;
  BankAccountNumber?: string;
  Particulars?: string;
  Code?: string;
  Reference?: string;
  Amount?: number;
  CurrencyRate?: number;
  PaymentType?: string;
  Status?: "AUTHORISED" | "DELETED";
  UpdatedDateUTC?: string;
  HasAccount?: boolean;
  HasValidationErrors?: boolean;
  StatusAttributeString?: string;
  ValidationErrors?: ValidationError[];
  Invoice?: InvoiceRef;
  CreditNote?: CreditNoteRef;
  Prepayment?: PrepaymentRef;
  Overpayment?: OverpaymentRef;
  Account?: AccountRef;
  IsReconciled?: boolean;
}

export interface InvoiceRef {
  InvoiceID: string;
  InvoiceNumber?: string;
}

export interface CreditNoteRef {
  CreditNoteID: string;
  CreditNoteNumber?: string;
}

export interface PrepaymentRef {
  PrepaymentID: string;
}

export interface OverpaymentRef {
  OverpaymentID: string;
}

export interface AccountRef {
  AccountID: string;
  Code?: string;
  Name?: string;
}

// ==================== Account ====================

export interface Account {
  AccountID: string;
  Code?: string;
  Name: string;
  Type:
    | "BANK"
    | "CURRENT"
    | "CURRLIAB"
    | "DEPRECIATN"
    | "DIRECTCOSTS"
    | "EQUITY"
    | "EXPENSE"
    | "FIXED"
    | "INVENTORY"
    | "LIABILITY"
    | "NONCURRENT"
    | "OTHERINCOME"
    | "OVERHEADS"
    | "PREPAYMENT"
    | "REVENUE"
    | "SALES"
    | "TERMLIAB"
    | "PAYGLIABILITY"
    | "SUPERANNUATIONEXPENSE"
    | "SUPERANNUATIONLIABILITY"
    | "WAGESEXPENSE"
    | "WAGESPAYABLELIABILITY";
  Status?: "ACTIVE" | "ARCHIVED";
  Description?: string;
  TaxType?: string;
  EnablePaymentsToAccount?: boolean;
  ShowInExpenseClaims?: boolean;
  Class?:
    | "ASSET"
    | "EQUITY"
    | "EXPENSE"
    | "LIABILITY"
    | "REVENUE";
  SystemAccount?: string;
  ReportingCode?: string;
  ReportingCodeName?: string;
  BankAccountNumber?: string;
  BankAccountType?: "BANK" | "CREDITCARD" | "PAYPAL";
  CurrencyCode?: string;
  HasAttachments?: boolean;
  UpdatedDateUTC?: string;
  AddToWatchlist?: boolean;
  ValidationErrors?: ValidationError[];
}

// ==================== Credit Note ====================

export interface CreditNote {
  CreditNoteID: string;
  CreditNoteNumber?: string;
  Reference?: string;
  Type: "ACCPAYCREDIT" | "ACCRECCREDIT";
  Status:
    | "DRAFT"
    | "SUBMITTED"
    | "AUTHORISED"
    | "PAID"
    | "VOIDED"
    | "DELETED";
  Contact: ContactRef;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  LineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  LineItems?: LineItem[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  FullyPaidOnDate?: string;
  RemainingCredit?: number;
  Allocations?: Allocation[];
  Payments?: Payment[];
  BrandingThemeID?: string;
  StatusAttributeString?: string;
  HasAttachments?: boolean;
  HasErrors?: boolean;
  ValidationErrors?: ValidationError[];
}

export interface Allocation {
  AllocationID?: string;
  Invoice?: InvoiceRef;
  Overpayment?: OverpaymentRef;
  Prepayment?: PrepaymentRef;
  CreditNote?: CreditNoteRef;
  Amount?: number;
  Date?: string;
  StatusAttributeString?: string;
  ValidationErrors?: ValidationError[];
}

// ==================== Bank Transaction ====================

export interface BankTransaction {
  BankTransactionID: string;
  Type:
    | "RECEIVE"
    | "RECEIVE-OVERPAYMENT"
    | "RECEIVE-PREPAYMENT"
    | "SPEND"
    | "SPEND-OVERPAYMENT"
    | "SPEND-PREPAYMENT"
    | "RECEIVE-TRANSFER"
    | "SPEND-TRANSFER";
  Contact?: ContactRef;
  LineItems: LineItem[];
  BankAccount: AccountRef;
  IsReconciled?: boolean;
  Date?: string;
  DateString?: string;
  Reference?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  Url?: string;
  Status?: "AUTHORISED" | "DELETED";
  LineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  PrepaymentID?: string;
  OverpaymentID?: string;
  UpdatedDateUTC?: string;
  HasAttachments?: boolean;
  StatusAttributeString?: string;
  ValidationErrors?: ValidationError[];
}

// ==================== Prepayment / Overpayment ====================

export interface Prepayment {
  PrepaymentID: string;
  Type: "RECEIVE-PREPAYMENT" | "SPEND-PREPAYMENT";
  Contact?: ContactRef;
  Date?: string;
  Status?: "AUTHORISED" | "PAID" | "VOIDED";
  LineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  LineItems?: LineItem[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  RemainingCredit?: number;
  Allocations?: Allocation[];
  Payments?: Payment[];
  AppliedAmount?: number;
  HasAttachments?: boolean;
  Reference?: string;
}

export interface Overpayment {
  OverpaymentID: string;
  Type: "RECEIVE-OVERPAYMENT" | "SPEND-OVERPAYMENT";
  Contact?: ContactRef;
  Date?: string;
  Status?: "AUTHORISED" | "PAID" | "VOIDED";
  LineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  LineItems?: LineItem[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  RemainingCredit?: number;
  Allocations?: Allocation[];
  Payments?: Payment[];
  AppliedAmount?: number;
  HasAttachments?: boolean;
  Reference?: string;
}

// ==================== Item ====================

export interface Item {
  ItemID: string;
  Code: string;
  Name?: string;
  Description?: string;
  PurchaseDescription?: string;
  PurchaseDetails?: ItemDetails;
  SalesDetails?: ItemDetails;
  IsSold?: boolean;
  IsPurchased?: boolean;
  IsTrackedAsInventory?: boolean;
  InventoryAssetAccountCode?: string;
  TotalCostPool?: number;
  QuantityOnHand?: number;
  UpdatedDateUTC?: string;
  ValidationErrors?: ValidationError[];
}

export interface ItemDetails {
  UnitPrice?: number;
  AccountCode?: string;
  COGSAccountCode?: string;
  TaxType?: string;
}

// ==================== Tax Rate ====================

export interface TaxRate {
  Name: string;
  TaxType: string;
  TaxComponents?: TaxComponent[];
  Status?: "ACTIVE" | "DELETED" | "ARCHIVED";
  ReportTaxType?: string;
  CanApplyToAssets?: boolean;
  CanApplyToEquity?: boolean;
  CanApplyToExpenses?: boolean;
  CanApplyToLiabilities?: boolean;
  CanApplyToRevenue?: boolean;
  DisplayTaxRate?: number;
  EffectiveRate?: number;
}

export interface TaxComponent {
  Name?: string;
  Rate?: number;
  IsCompound?: boolean;
  IsNonRecoverable?: boolean;
}

// ==================== Organisation ====================

export interface Organisation {
  OrganisationID: string;
  APIKey?: string;
  Name: string;
  LegalName?: string;
  PaysTax?: boolean;
  Version?: string;
  OrganisationType?:
    | "ACCOUNTING_PRACTICE"
    | "COMPANY"
    | "CHARITY"
    | "CLUB_OR_SOCIETY"
    | "LOOK_THROUGH_COMPANY"
    | "NOT_FOR_PROFIT"
    | "PARTNERSHIP"
    | "S_CORPORATION"
    | "SELF_MANAGED_SUPERANNUATION_FUND"
    | "SOLE_TRADER"
    | "SUPERANNUATION_FUND"
    | "TRUST";
  BaseCurrency?: string;
  CountryCode?: string;
  IsDemoCompany?: boolean;
  OrganisationStatus?: string;
  RegistrationNumber?: string;
  EmployerIdentificationNumber?: string;
  TaxNumber?: string;
  FinancialYearEndDay?: number;
  FinancialYearEndMonth?: number;
  SalesTaxBasis?: "PAYMENTS" | "INVOICE" | "NONE" | "CASH" | "FLAT";
  SalesTaxPeriod?: string;
  DefaultSalesTax?: string;
  DefaultPurchasesTax?: string;
  PeriodLockDate?: string;
  EndOfYearLockDate?: string;
  CreatedDateUTC?: string;
  Timezone?: string;
  OrganisationEntityType?: string;
  ShortCode?: string;
  Class?: "DEMO" | "TRIAL" | "STARTER" | "STANDARD" | "PREMIUM" | "PREMIUM_20" | "PREMIUM_50" | "PREMIUM_100" | "LEDGER" | "GST_CASHBOOK" | "NON_GST_CASHBOOK" | "ULTIMATE";
  Edition?: "BUSINESS" | "PARTNER";
  LineOfBusiness?: string;
  Addresses?: Address[];
  Phones?: Phone[];
  ExternalLinks?: ExternalLink[];
  PaymentTerms?: PaymentTerms;
}

export interface ExternalLink {
  LinkType?: string;
  Url?: string;
  Description?: string;
}

export interface PaymentTerms {
  Bills?: PaymentTerm;
  Sales?: PaymentTerm;
}

export interface PaymentTerm {
  Day?: number;
  Type?: "DAYSAFTERBILLDATE" | "DAYSAFTERBILLMONTH" | "OFCURRENTMONTH" | "OFFOLLOWINGMONTH";
}

// ==================== Reports ====================

export interface Report {
  ReportID?: string;
  ReportName?: string;
  ReportType?: string;
  ReportTitle?: string;
  ReportDate?: string;
  UpdatedDateUTC?: string;
  Fields?: ReportField[];
  Rows?: ReportRow[];
}

export interface ReportField {
  FieldID?: string;
  Description?: string;
  Value?: string;
}

export interface ReportRow {
  RowType: "Header" | "Section" | "Row" | "SummaryRow";
  Title?: string;
  Cells?: ReportCell[];
  Rows?: ReportRow[];
}

export interface ReportCell {
  Value?: string;
  Attributes?: ReportAttribute[];
}

export interface ReportAttribute {
  Value?: string;
  Id?: string;
}

// ==================== Quotes ====================

export interface Quote {
  QuoteID: string;
  QuoteNumber?: string;
  Reference?: string;
  Terms?: string;
  Contact: ContactRef;
  LineItems: LineItem[];
  Date?: string;
  DateString?: string;
  ExpiryDate?: string;
  ExpiryDateString?: string;
  Status?:
    | "DRAFT"
    | "SENT"
    | "DECLINED"
    | "ACCEPTED"
    | "INVOICED"
    | "DELETED";
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  TotalDiscount?: number;
  Title?: string;
  Summary?: string;
  BrandingThemeID?: string;
  UpdatedDateUTC?: string;
  LineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  StatusAttributeString?: string;
  ValidationErrors?: ValidationError[];
}

// ==================== Tracking ====================

export interface TrackingCategory {
  TrackingCategoryID?: string;
  TrackingOptionID?: string;
  Name?: string;
  Option?: string;
  Status?: "ACTIVE" | "ARCHIVED" | "DELETED";
  Options?: TrackingOption[];
}

export interface TrackingOption {
  TrackingOptionID?: string;
  Name?: string;
  Status?: "ACTIVE" | "ARCHIVED" | "DELETED";
}

// ==================== Branding Theme ====================

export interface BrandingTheme {
  BrandingThemeID?: string;
  Name?: string;
  LogoUrl?: string;
  Type?: "STANDARD" | "INVOICE";
  SortOrder?: number;
  CreatedDateUTC?: string;
}

// ==================== Batch Payments ====================

export interface BatchPaymentDetails {
  BankAccountNumber?: string;
  BankAccountName?: string;
  Details?: string;
  Code?: string;
  Reference?: string;
}

// ==================== Validation ====================

export interface ValidationError {
  Message?: string;
}

// ==================== API Response Wrappers ====================

export interface XeroResponse<T> {
  Id?: string;
  Status?: string;
  ProviderName?: string;
  DateTimeUTC?: string;
}

export interface InvoicesResponse extends XeroResponse<Invoice> {
  Invoices: Invoice[];
}

export interface ContactsResponse extends XeroResponse<Contact> {
  Contacts: Contact[];
}

export interface AccountsResponse extends XeroResponse<Account> {
  Accounts: Account[];
}

export interface PaymentsResponse extends XeroResponse<Payment> {
  Payments: Payment[];
}

export interface CreditNotesResponse extends XeroResponse<CreditNote> {
  CreditNotes: CreditNote[];
}

export interface BankTransactionsResponse extends XeroResponse<BankTransaction> {
  BankTransactions: BankTransaction[];
}

export interface ItemsResponse extends XeroResponse<Item> {
  Items: Item[];
}

export interface TaxRatesResponse extends XeroResponse<TaxRate> {
  TaxRates: TaxRate[];
}

export interface OrganisationResponse extends XeroResponse<Organisation> {
  Organisations: Organisation[];
}

export interface ReportsResponse extends XeroResponse<Report> {
  Reports: Report[];
}

export interface QuotesResponse extends XeroResponse<Quote> {
  Quotes: Quote[];
}

export interface PrepaymentsResponse extends XeroResponse<Prepayment> {
  Prepayments: Prepayment[];
}

export interface OverpaymentsResponse extends XeroResponse<Overpayment> {
  Overpayments: Overpayment[];
}

export interface ContactGroupsResponse extends XeroResponse<ContactGroup> {
  ContactGroups: ContactGroup[];
}

// ==================== CLI Options ====================

export interface ListOptions {
  page?: number;
  where?: string;
  order?: string;
}

export interface ReportOptions {
  date?: string;
  fromDate?: string;
  toDate?: string;
  periods?: number;
  timeframe?: "MONTH" | "QUARTER" | "YEAR";
  paymentsOnly?: boolean;
  contactId?: string;
}

export interface CreateInvoiceOptions {
  contactName: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
  }>;
  type?: "ACCREC" | "ACCPAY";
  dueDate?: string;
  reference?: string;
}

export interface CreateContactOptions {
  name: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface CreatePaymentOptions {
  invoiceId: string;
  accountCode: string;
  amount: number;
  date?: string;
  reference?: string;
}
