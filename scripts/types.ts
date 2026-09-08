

export interface XeroConfig {
  clientId: string;
  clientSecret: string;
  tenantId?: string;
}

export interface ConfigFile {
  xero?: XeroConfig;
  mcpServer?: {
    command?: string;
    args?: string[];
    env?: {
      XERO_CLIENT_ID?: string;
      XERO_CLIENT_SECRET?: string;
      XERO_TENANT_ID?: string;
    };
  };
}


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


export interface XeroConnection {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}


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
  EmailAddress?: string;
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


export interface Payment {
  PaymentID: string;
  BatchPaymentID?: string;
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
  ReconciledAfterAmbiguousWrite?: boolean;
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
  ReconciledAfterAmbiguousWrite?: boolean;
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


export interface BrandingTheme {
  BrandingThemeID?: string;
  Name?: string;
  LogoUrl?: string;
  Type?: "STANDARD" | "INVOICE";
  SortOrder?: number;
  CreatedDateUTC?: string;
}


export interface BatchPaymentDetails {
  BankAccountNumber?: string;
  BankAccountName?: string;
  Details?: string;
  Code?: string;
  Reference?: string;
}


export interface ValidationError {
  Message?: string;
}


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


export interface ListOptions {
  page?: number;
  where?: string;
  order?: string;
  ifModifiedSince?: string;
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

interface CreateInvoiceCommonOptions {
  type?: "ACCREC" | "ACCPAY";
  dueDate?: string;
  reference?: string;
  idempotencyKey: string;
}

export interface LegacyCreateInvoiceOptions extends CreateInvoiceCommonOptions {
  contactName: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
  }>;
  contactId?: never;
  invoiceNumber?: never;
  date?: never;
  status?: never;
  lineAmountTypes?: never;
}

export interface AdvancedCreateInvoiceOptions extends CreateInvoiceCommonOptions {
  contactId: string;
  lineItems: Array<{
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode: string;
    TaxType: string;
    ItemCode?: string;
    DiscountRate?: number;
    DiscountAmount?: number;
  }>;
  invoiceNumber?: string;
  date?: string;
  status?: "DRAFT" | "SUBMITTED" | "AUTHORISED";
  lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  contactName?: never;
}

export type CreateInvoiceOptions =
  | LegacyCreateInvoiceOptions
  | AdvancedCreateInvoiceOptions;

export interface CreateContactOptions {
  name: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  idempotencyKey?: string;
}

interface CreatePaymentCommonOptions {
  invoiceId: string;
  amount: number;
  date: string;
  reference?: string;
  currencyRate?: number;
  idempotencyKey: string;
}

export type CreatePaymentOptions = CreatePaymentCommonOptions & (
  | { accountCode: string; accountId?: never }
  | { accountId: string; accountCode?: never }
);

interface CreateCreditNoteCommonOptions {
  contactId: string;
  reference?: string;
}

export interface LegacyCreateCreditNoteOptions extends CreateCreditNoteCommonOptions {
  amount: number;
  description: string;
  accountCode?: string;
  lineItems?: never;
  creditNoteNumber?: never;
  date?: never;
  status?: never;
  lineAmountTypes?: never;
  idempotencyKey?: string;
}

export interface AdvancedCreateCreditNoteOptions extends CreateCreditNoteCommonOptions {
  lineItems: Array<{
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode: string;
    TaxType: string;
    ItemCode?: string;
  }>;
  creditNoteNumber: string;
  date?: string;
  status?: "DRAFT" | "AUTHORISED";
  lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  idempotencyKey: string;
  amount?: never;
  description?: never;
  accountCode?: never;
}

export type CreateCreditNoteOptions =
  | LegacyCreateCreditNoteOptions
  | AdvancedCreateCreditNoteOptions;

export interface AllocateCreditNoteOptions {
  tenantId?: string;
  idempotencyKey?: string;
}

export interface CreateCreditNoteRefundOptions {
  creditNoteId: string;
  accountId: string;
  amount: number;
  date: string;
  reference: string;
  idempotencyKey: string;
}

export interface AuthoriseCreditNoteOptions {
  creditNoteId: string;
  idempotencyKey: string;
}
