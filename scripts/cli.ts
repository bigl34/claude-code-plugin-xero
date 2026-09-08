#!/usr/bin/env npx tsx

import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  z,
  createCommand,
  runCli,
  cacheCommands,
  cliTypes,
  wrapUntrustedField,
  buildSafeOutput,
  TRUNCATION_DEFAULTS,
} from "@local/cli-utils";
import { XeroClient } from "./xero-client.js";
import type { InvoiceStructuralUpdate } from "./paid-invoice-edit.js";
import type {
  Account,
  Address,
  BankTransaction,
  Contact,
  ContactGroup,
  CreditNote,
  Invoice,
  Item,
  LineItem,
  Organisation,
  Overpayment,
  Payment,
  Phone,
  Prepayment,
  Quote,
  Report,
  TaxRate,
  XeroConnection,
} from "./types.js";


const BODY = TRUNCATION_DEFAULTS.body;
const SUBJECT = TRUNCATION_DEFAULTS.subject;
const NAME = TRUNCATION_DEFAULTS.displayName;

function wrapAddress(addr: Address, path: string): Record<string, unknown> {
  return {
    AddressType: addr.AddressType,
    AddressLine1: wrapUntrustedField(`${path}.AddressLine1`, addr.AddressLine1 ?? "", { maxChars: SUBJECT }),
    AddressLine2: wrapUntrustedField(`${path}.AddressLine2`, addr.AddressLine2 ?? "", { maxChars: SUBJECT }),
    AddressLine3: wrapUntrustedField(`${path}.AddressLine3`, addr.AddressLine3 ?? "", { maxChars: SUBJECT }),
    AddressLine4: wrapUntrustedField(`${path}.AddressLine4`, addr.AddressLine4 ?? "", { maxChars: SUBJECT }),
    AddressLine5: wrapUntrustedField(`${path}.AddressLine5` as string, (addr as unknown as { AddressLine5?: string }).AddressLine5 ?? "", { maxChars: SUBJECT }),
    City: wrapUntrustedField(`${path}.City`, addr.City ?? "", { maxChars: SUBJECT }),
    Region: addr.Region,
    PostalCode: addr.PostalCode,
    Country: addr.Country,
    AttentionTo: addr.AttentionTo ? wrapUntrustedField(`${path}.AttentionTo`, addr.AttentionTo, { maxChars: NAME }) : undefined,
  };
}

function wrapPhone(phone: Phone, path: string): Record<string, unknown> {
  return {
    PhoneType: phone.PhoneType,
    PhoneNumber: wrapUntrustedField(`${path}.PhoneNumber`, phone.PhoneNumber ?? "", { maxChars: NAME }),
    PhoneAreaCode: phone.PhoneAreaCode,
    PhoneCountryCode: phone.PhoneCountryCode,
  };
}

function wrapLineItem(line: LineItem, path: string): Record<string, unknown> {
  return {
    LineItemID: line.LineItemID,
    Description: wrapUntrustedField(`${path}.Description`, line.Description ?? "", { maxChars: BODY }),
    Quantity: line.Quantity,
    UnitAmount: line.UnitAmount,
    ItemCode: line.ItemCode,
    AccountCode: line.AccountCode
      ? wrapUntrustedField(`${path}.AccountCode`, line.AccountCode, { maxChars: SUBJECT })
      : undefined,
    AccountID: line.AccountID,
    TaxType: line.TaxType,
    TaxAmount: line.TaxAmount,
    LineAmount: line.LineAmount,
    Tracking: line.Tracking?.map((tracking, index) => ({
      TrackingCategoryID: tracking.TrackingCategoryID,
      TrackingOptionID: tracking.TrackingOptionID,
      Name: tracking.Name
        ? wrapUntrustedField(`${path}.Tracking[${index}].Name`, tracking.Name, {
            maxChars: NAME,
          })
        : undefined,
      Option: tracking.Option
        ? wrapUntrustedField(`${path}.Tracking[${index}].Option`, tracking.Option, {
            maxChars: NAME,
          })
        : undefined,
      Status: tracking.Status,
    })),
    DiscountRate: line.DiscountRate,
    DiscountAmount: line.DiscountAmount,
  };
}

function wrapContact(contact: Contact, path = "contact"): Record<string, unknown> {
  return {
    ContactID: contact.ContactID,
    ContactNumber: contact.ContactNumber,
    AccountNumber: contact.AccountNumber,
    ContactStatus: contact.ContactStatus,
    Name: wrapUntrustedField(`${path}.Name`, contact.Name ?? "", { maxChars: NAME }),
    FirstName: contact.FirstName
      ? wrapUntrustedField(`${path}.FirstName`, contact.FirstName, { maxChars: NAME })
      : undefined,
    LastName: contact.LastName
      ? wrapUntrustedField(`${path}.LastName`, contact.LastName, { maxChars: NAME })
      : undefined,
    EmailAddress: contact.EmailAddress
      ? wrapUntrustedField(`${path}.EmailAddress`, contact.EmailAddress, { maxChars: NAME })
      : undefined,
    Addresses: contact.Addresses?.map((addr, i) => wrapAddress(addr, `${path}.Addresses[${i}]`)),
    Phones: contact.Phones?.map((phone, i) => wrapPhone(phone, `${path}.Phones[${i}]`)),
    IsSupplier: contact.IsSupplier,
    IsCustomer: contact.IsCustomer,
    DefaultCurrency: contact.DefaultCurrency,
    TaxNumber: contact.TaxNumber,
    UpdatedDateUTC: contact.UpdatedDateUTC,
    Website: contact.Website,
    HasAttachments: contact.HasAttachments,
    Balances: contact.Balances,
  };
}

function wrapInvoice(invoice: Invoice, path = "invoice"): Record<string, unknown> {
  return {
    InvoiceID: invoice.InvoiceID,
    InvoiceNumber: invoice.InvoiceNumber,
    Type: invoice.Type,
    Status: invoice.Status,
    Date: invoice.Date,
    DueDate: invoice.DueDate,
    Reference: invoice.Reference
      ? wrapUntrustedField(`${path}.Reference`, invoice.Reference, { maxChars: SUBJECT })
      : undefined,
    Contact: invoice.Contact
      ? {
          ContactID: invoice.Contact.ContactID,
          Name: invoice.Contact.Name
            ? wrapUntrustedField(`${path}.Contact.Name`, invoice.Contact.Name, { maxChars: NAME })
            : undefined,
          EmailAddress: invoice.Contact.EmailAddress
            ? wrapUntrustedField(`${path}.Contact.EmailAddress`, invoice.Contact.EmailAddress, { maxChars: NAME })
            : undefined,
        }
      : undefined,
    LineItems: invoice.LineItems?.map((line, i) => wrapLineItem(line, `${path}.LineItems[${i}]`)),
    LineAmountTypes: invoice.LineAmountTypes,
    SubTotal: invoice.SubTotal,
    TotalTax: invoice.TotalTax,
    Total: invoice.Total,
    TotalDiscount: invoice.TotalDiscount,
    AmountDue: invoice.AmountDue,
    AmountPaid: invoice.AmountPaid,
    AmountCredited: invoice.AmountCredited,
    CurrencyCode: invoice.CurrencyCode,
    CurrencyRate: invoice.CurrencyRate,
    UpdatedDateUTC: invoice.UpdatedDateUTC,
    FullyPaidOnDate: invoice.FullyPaidOnDate,
    SentToContact: invoice.SentToContact,
    ExpectedPaymentDate: invoice.ExpectedPaymentDate,
    PlannedPaymentDate: invoice.PlannedPaymentDate,
    BrandingThemeID: invoice.BrandingThemeID,
    Url: invoice.Url,
    HasAttachments: invoice.HasAttachments,
  };
}

function wrapPayment(payment: Payment, path = "payment"): Record<string, unknown> {
  return {
    PaymentID: payment.PaymentID,
    Date: payment.Date,
    Amount: payment.Amount,
    CurrencyRate: payment.CurrencyRate,
    PaymentType: payment.PaymentType,
    Status: payment.Status,
    UpdatedDateUTC: payment.UpdatedDateUTC,
    HasAccount: payment.HasAccount,
    IsReconciled: payment.IsReconciled,
    ReconciledAfterAmbiguousWrite: payment.ReconciledAfterAmbiguousWrite,
    BankAccountNumber: payment.BankAccountNumber,
    Particulars: payment.Particulars
      ? wrapUntrustedField(`${path}.Particulars`, payment.Particulars, { maxChars: SUBJECT })
      : undefined,
    Code: payment.Code,
    Reference: payment.Reference
      ? wrapUntrustedField(`${path}.Reference`, payment.Reference, { maxChars: SUBJECT })
      : undefined,
    Invoice: payment.Invoice
      ? {
          InvoiceID: payment.Invoice.InvoiceID,
          InvoiceNumber: payment.Invoice.InvoiceNumber,
        }
      : undefined,
    Account: payment.Account
      ? {
          AccountID: payment.Account.AccountID,
          Code: payment.Account.Code,
          Name: payment.Account.Name
            ? wrapUntrustedField(`${path}.Account.Name`, payment.Account.Name, { maxChars: NAME })
            : undefined,
        }
      : undefined,
  };
}

function wrapCreditNote(note: CreditNote, path = "creditNote"): Record<string, unknown> {
  return {
    CreditNoteID: note.CreditNoteID,
    CreditNoteNumber: note.CreditNoteNumber,
    Type: note.Type,
    Status: note.Status,
    Date: note.Date,
    DueDate: note.DueDate,
    Reference: note.Reference
      ? wrapUntrustedField(`${path}.Reference`, note.Reference, { maxChars: SUBJECT })
      : undefined,
    Contact: note.Contact
      ? {
          ContactID: note.Contact.ContactID,
          Name: note.Contact.Name
            ? wrapUntrustedField(`${path}.Contact.Name`, note.Contact.Name, { maxChars: NAME })
            : undefined,
        }
      : undefined,
    LineItems: note.LineItems?.map((line, i) => wrapLineItem(line, `${path}.LineItems[${i}]`)),
    LineAmountTypes: note.LineAmountTypes,
    SubTotal: note.SubTotal,
    TotalTax: note.TotalTax,
    Total: note.Total,
    UpdatedDateUTC: note.UpdatedDateUTC,
    CurrencyCode: note.CurrencyCode,
    CurrencyRate: note.CurrencyRate,
    FullyPaidOnDate: note.FullyPaidOnDate,
    RemainingCredit: note.RemainingCredit,
    BrandingThemeID: note.BrandingThemeID,
    HasAttachments: note.HasAttachments,
    ReconciledAfterAmbiguousWrite: note.ReconciledAfterAmbiguousWrite,
  };
}

function wrapBankTransaction(tx: BankTransaction, path = "bankTransaction"): Record<string, unknown> {
  return {
    BankTransactionID: tx.BankTransactionID,
    Type: tx.Type,
    Status: tx.Status,
    Date: tx.Date,
    IsReconciled: tx.IsReconciled,
    Reference: tx.Reference
      ? wrapUntrustedField(`${path}.Reference`, tx.Reference, { maxChars: SUBJECT })
      : undefined,
    Contact: tx.Contact
      ? {
          ContactID: tx.Contact.ContactID,
          Name: tx.Contact.Name
            ? wrapUntrustedField(`${path}.Contact.Name`, tx.Contact.Name, { maxChars: NAME })
            : undefined,
        }
      : undefined,
    BankAccount: tx.BankAccount
      ? {
          AccountID: tx.BankAccount.AccountID,
          Code: tx.BankAccount.Code,
          Name: tx.BankAccount.Name
            ? wrapUntrustedField(`${path}.BankAccount.Name`, tx.BankAccount.Name, { maxChars: NAME })
            : undefined,
        }
      : undefined,
    LineItems: tx.LineItems?.map((line, i) => wrapLineItem(line, `${path}.LineItems[${i}]`)),
    LineAmountTypes: tx.LineAmountTypes,
    SubTotal: tx.SubTotal,
    TotalTax: tx.TotalTax,
    Total: tx.Total,
    CurrencyCode: tx.CurrencyCode,
    CurrencyRate: tx.CurrencyRate,
    UpdatedDateUTC: tx.UpdatedDateUTC,
    Url: tx.Url,
    HasAttachments: tx.HasAttachments,
  };
}

function wrapQuote(quote: Quote, path = "quote"): Record<string, unknown> {
  return {
    QuoteID: quote.QuoteID,
    QuoteNumber: quote.QuoteNumber,
    Status: quote.Status,
    Date: quote.Date,
    ExpiryDate: quote.ExpiryDate,
    Reference: quote.Reference
      ? wrapUntrustedField(`${path}.Reference`, quote.Reference, { maxChars: SUBJECT })
      : undefined,
    Terms: quote.Terms
      ? wrapUntrustedField(`${path}.Terms`, quote.Terms, { maxChars: BODY })
      : undefined,
    Title: quote.Title
      ? wrapUntrustedField(`${path}.Title`, quote.Title, { maxChars: SUBJECT })
      : undefined,
    Summary: quote.Summary
      ? wrapUntrustedField(`${path}.Summary`, quote.Summary, { maxChars: BODY })
      : undefined,
    Contact: quote.Contact
      ? {
          ContactID: quote.Contact.ContactID,
          Name: quote.Contact.Name
            ? wrapUntrustedField(`${path}.Contact.Name`, quote.Contact.Name, { maxChars: NAME })
            : undefined,
        }
      : undefined,
    LineItems: quote.LineItems?.map((line, i) => wrapLineItem(line, `${path}.LineItems[${i}]`)),
    LineAmountTypes: quote.LineAmountTypes,
    SubTotal: quote.SubTotal,
    TotalTax: quote.TotalTax,
    Total: quote.Total,
    TotalDiscount: quote.TotalDiscount,
    CurrencyCode: quote.CurrencyCode,
    CurrencyRate: quote.CurrencyRate,
    BrandingThemeID: quote.BrandingThemeID,
    UpdatedDateUTC: quote.UpdatedDateUTC,
  };
}

function wrapPrepayment(pp: Prepayment, path = "prepayment"): Record<string, unknown> {
  return {
    PrepaymentID: pp.PrepaymentID,
    Type: pp.Type,
    Status: pp.Status,
    Date: pp.Date,
    Reference: pp.Reference
      ? wrapUntrustedField(`${path}.Reference`, pp.Reference, { maxChars: SUBJECT })
      : undefined,
    Contact: pp.Contact
      ? {
          ContactID: pp.Contact.ContactID,
          Name: pp.Contact.Name
            ? wrapUntrustedField(`${path}.Contact.Name`, pp.Contact.Name, { maxChars: NAME })
            : undefined,
        }
      : undefined,
    LineItems: pp.LineItems?.map((line, i) => wrapLineItem(line, `${path}.LineItems[${i}]`)),
    SubTotal: pp.SubTotal,
    TotalTax: pp.TotalTax,
    Total: pp.Total,
    RemainingCredit: pp.RemainingCredit,
    AppliedAmount: pp.AppliedAmount,
    CurrencyCode: pp.CurrencyCode,
    CurrencyRate: pp.CurrencyRate,
    UpdatedDateUTC: pp.UpdatedDateUTC,
    HasAttachments: pp.HasAttachments,
  };
}

function wrapOverpayment(op: Overpayment, path = "overpayment"): Record<string, unknown> {
  return {
    OverpaymentID: op.OverpaymentID,
    Type: op.Type,
    Status: op.Status,
    Date: op.Date,
    Reference: op.Reference
      ? wrapUntrustedField(`${path}.Reference`, op.Reference, { maxChars: SUBJECT })
      : undefined,
    Contact: op.Contact
      ? {
          ContactID: op.Contact.ContactID,
          Name: op.Contact.Name
            ? wrapUntrustedField(`${path}.Contact.Name`, op.Contact.Name, { maxChars: NAME })
            : undefined,
        }
      : undefined,
    LineItems: op.LineItems?.map((line, i) => wrapLineItem(line, `${path}.LineItems[${i}]`)),
    SubTotal: op.SubTotal,
    TotalTax: op.TotalTax,
    Total: op.Total,
    RemainingCredit: op.RemainingCredit,
    AppliedAmount: op.AppliedAmount,
    CurrencyCode: op.CurrencyCode,
    CurrencyRate: op.CurrencyRate,
    UpdatedDateUTC: op.UpdatedDateUTC,
    HasAttachments: op.HasAttachments,
  };
}

function wrapAccount(account: Account, path = "account"): Record<string, unknown> {
  return {
    AccountID: account.AccountID,
    Code: account.Code,
    Type: account.Type,
    Status: account.Status,
    Class: account.Class,
    SystemAccount: account.SystemAccount,
    TaxType: account.TaxType,
    EnablePaymentsToAccount: account.EnablePaymentsToAccount,
    ShowInExpenseClaims: account.ShowInExpenseClaims,
    CurrencyCode: account.CurrencyCode,
    BankAccountType: account.BankAccountType,
    BankAccountNumber: account.BankAccountNumber,
    ReportingCode: account.ReportingCode,
    Name: wrapUntrustedField(`${path}.Name`, account.Name ?? "", { maxChars: NAME }),
    Description: account.Description
      ? wrapUntrustedField(`${path}.Description`, account.Description, { maxChars: BODY })
      : undefined,
    ReportingCodeName: account.ReportingCodeName
      ? wrapUntrustedField(`${path}.ReportingCodeName`, account.ReportingCodeName, { maxChars: NAME })
      : undefined,
    UpdatedDateUTC: account.UpdatedDateUTC,
    HasAttachments: account.HasAttachments,
    AddToWatchlist: account.AddToWatchlist,
  };
}

function wrapItem(item: Item, path = "item"): Record<string, unknown> {
  return {
    ItemID: item.ItemID,
    Code: item.Code,
    IsSold: item.IsSold,
    IsPurchased: item.IsPurchased,
    IsTrackedAsInventory: item.IsTrackedAsInventory,
    InventoryAssetAccountCode: item.InventoryAssetAccountCode,
    TotalCostPool: item.TotalCostPool,
    QuantityOnHand: item.QuantityOnHand,
    UpdatedDateUTC: item.UpdatedDateUTC,
    Name: item.Name
      ? wrapUntrustedField(`${path}.Name`, item.Name, { maxChars: NAME })
      : undefined,
    Description: item.Description
      ? wrapUntrustedField(`${path}.Description`, item.Description, { maxChars: BODY })
      : undefined,
    PurchaseDescription: item.PurchaseDescription
      ? wrapUntrustedField(`${path}.PurchaseDescription`, item.PurchaseDescription, { maxChars: BODY })
      : undefined,
    PurchaseDetails: item.PurchaseDetails,
    SalesDetails: item.SalesDetails,
  };
}

function wrapTaxRate(taxRate: TaxRate, path = "taxRate"): Record<string, unknown> {
  return {
    TaxType: taxRate.TaxType,
    Status: taxRate.Status,
    ReportTaxType: taxRate.ReportTaxType,
    CanApplyToAssets: taxRate.CanApplyToAssets,
    CanApplyToEquity: taxRate.CanApplyToEquity,
    CanApplyToExpenses: taxRate.CanApplyToExpenses,
    CanApplyToLiabilities: taxRate.CanApplyToLiabilities,
    CanApplyToRevenue: taxRate.CanApplyToRevenue,
    DisplayTaxRate: taxRate.DisplayTaxRate,
    EffectiveRate: taxRate.EffectiveRate,
    TaxComponents: taxRate.TaxComponents,
    Name: wrapUntrustedField(`${path}.Name`, taxRate.Name ?? "", { maxChars: NAME }),
  };
}

function wrapOrganisation(org: Organisation, path = "organisation"): Record<string, unknown> {
  return {
    OrganisationID: org.OrganisationID,
    Version: org.Version,
    OrganisationType: org.OrganisationType,
    BaseCurrency: org.BaseCurrency,
    CountryCode: org.CountryCode,
    IsDemoCompany: org.IsDemoCompany,
    OrganisationStatus: org.OrganisationStatus,
    RegistrationNumber: org.RegistrationNumber,
    EmployerIdentificationNumber: org.EmployerIdentificationNumber,
    TaxNumber: org.TaxNumber,
    FinancialYearEndDay: org.FinancialYearEndDay,
    FinancialYearEndMonth: org.FinancialYearEndMonth,
    SalesTaxBasis: org.SalesTaxBasis,
    SalesTaxPeriod: org.SalesTaxPeriod,
    DefaultSalesTax: org.DefaultSalesTax,
    DefaultPurchasesTax: org.DefaultPurchasesTax,
    PeriodLockDate: org.PeriodLockDate,
    EndOfYearLockDate: org.EndOfYearLockDate,
    CreatedDateUTC: org.CreatedDateUTC,
    Timezone: org.Timezone,
    OrganisationEntityType: org.OrganisationEntityType,
    Class: org.Class,
    Edition: org.Edition,
    PaysTax: org.PaysTax,
    Name: wrapUntrustedField(`${path}.Name`, org.Name ?? "", { maxChars: NAME }),
    LegalName: org.LegalName
      ? wrapUntrustedField(`${path}.LegalName`, org.LegalName, { maxChars: NAME })
      : undefined,
    ShortCode: org.ShortCode
      ? wrapUntrustedField(`${path}.ShortCode`, org.ShortCode, { maxChars: NAME })
      : undefined,
    LineOfBusiness: org.LineOfBusiness
      ? wrapUntrustedField(`${path}.LineOfBusiness`, org.LineOfBusiness, { maxChars: SUBJECT })
      : undefined,
    Addresses: org.Addresses?.map((addr, i) => wrapAddress(addr, `${path}.Addresses[${i}]`)),
    Phones: org.Phones?.map((phone, i) => wrapPhone(phone, `${path}.Phones[${i}]`)),
  };
}

function wrapContactGroup(group: ContactGroup, path = "contactGroup"): Record<string, unknown> {
  return {
    ContactGroupID: group.ContactGroupID,
    Status: group.Status,
    Name: group.Name
      ? wrapUntrustedField(`${path}.Name`, group.Name, { maxChars: NAME })
      : undefined,
    Contacts: group.Contacts?.map((c, i) => ({
      ContactID: c.ContactID,
      Name: wrapUntrustedField(`${path}.Contacts[${i}].Name`, c.Name ?? "", { maxChars: NAME }),
    })),
  };
}

function wrapConnection(conn: XeroConnection, path = "connection"): Record<string, unknown> {
  return {
    id: conn.id,
    authEventId: conn.authEventId,
    tenantId: conn.tenantId,
    tenantType: conn.tenantType,
    tenantName: wrapUntrustedField(`${path}.tenantName`, conn.tenantName ?? "", { maxChars: NAME }),
    createdDateUtc: conn.createdDateUtc,
    updatedDateUtc: conn.updatedDateUtc,
  };
}

function wrapReport(report: Report, path = "report"): Record<string, unknown> {
  return {
    ReportID: report.ReportID,
    ReportName: report.ReportName,
    ReportType: report.ReportType,
    ReportDate: report.ReportDate,
    UpdatedDateUTC: report.UpdatedDateUTC,
    ReportTitle: report.ReportTitle
      ? wrapUntrustedField(`${path}.ReportTitle`, report.ReportTitle, { maxChars: SUBJECT })
      : undefined,
    Fields: report.Fields,
    Rows: report.Rows,
  };
}

const nonEmptyTrackingText = z.string().trim().min(1);
const structuralTrackingSchema = z
  .object({
    TrackingCategoryID: nonEmptyTrackingText.optional(),
    TrackingOptionID: nonEmptyTrackingText.optional(),
    Name: nonEmptyTrackingText.optional(),
    Option: nonEmptyTrackingText.optional(),
  })
  .strict()
  .superRefine((tracking, context) => {
    if (!tracking.TrackingCategoryID && !tracking.Name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tracking requires TrackingCategoryID or Name",
      });
    }
    if (!tracking.TrackingOptionID && !tracking.Option) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tracking requires TrackingOptionID or Option",
      });
    }
  });

const structuralLineItemsSchema = z.array(
  z
    .object({
      LineItemID: z.string().min(1).optional(),
      Description: z.string().optional(),
      Quantity: z.number().optional(),
      UnitAmount: z.number().optional(),
      ItemCode: z.string().optional(),
      AccountCode: z.string().optional(),
      AccountID: z.string().optional(),
      TaxType: z.string().optional(),
      TaxAmount: z.number().optional(),
      LineAmount: z.number().optional(),
      Tracking: z.array(structuralTrackingSchema).max(2).optional(),
      DiscountRate: z.number().optional(),
      DiscountAmount: z.number().optional(),
    })
    .strict(),
);

function parseStructuralInvoiceUpdate(args: {
  contactId?: string;
  lineItemsJson?: string;
  lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  currencyCode?: string;
  type?: "ACCREC" | "ACCPAY";
}): InvoiceStructuralUpdate {
  let lineItems: LineItem[] | undefined;
  if (args.lineItemsJson !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.lineItemsJson);
    } catch (error) {
      throw new Error(
        `--line-items-json must be valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    lineItems = structuralLineItemsSchema.parse(parsed) as LineItem[];
  }
  return {
    contactId: args.contactId,
    lineItems,
    lineAmountTypes: args.lineAmountTypes,
    currencyCode: args.currencyCode,
    type: args.type,
  };
}

const advancedCreateInvoiceLineItemSchema = z
  .object({
    Description: z.string().min(1),
    Quantity: z.number(),
    UnitAmount: z.number(),
    AccountCode: z.string().min(1),
    TaxType: z.string().min(1),
    ItemCode: z.string().min(1).optional(),
    DiscountRate: z.number().optional(),
    DiscountAmount: z.number().optional(),
  })
  .strict()
  .superRefine((lineItem, context) => {
    if (lineItem.DiscountRate !== undefined && lineItem.DiscountAmount !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A line item cannot include both DiscountRate and DiscountAmount",
      });
    }
  });

const advancedCreateInvoiceLineItemsSchema = z
  .array(advancedCreateInvoiceLineItemSchema)
  .min(1);

type AdvancedCreateInvoiceLineItem = z.infer<
  typeof advancedCreateInvoiceLineItemSchema
>;

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1];
}

const calendarDateSchema = z.string().refine(isCalendarDate, {
  message: "Must be a real calendar date in YYYY-MM-DD format",
});

const xeroGuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
  "Must be a GUID in 8-4-4-4-12 format",
);

function parseAdvancedCreateInvoiceLineItems(
  lineItemsJson: string,
): AdvancedCreateInvoiceLineItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lineItemsJson);
  } catch (error) {
    throw new Error(
      `--line-items-json must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    Array.isArray(parsed)
    && parsed.some(
      (item) => item !== null && typeof item === "object" && "LineItemID" in item,
    )
  ) {
    throw new Error("--line-items-json must not include LineItemID");
  }
  return advancedCreateInvoiceLineItemsSchema.parse(parsed);
}

const advancedCreateCreditNoteLineItemSchema = z
  .object({
    Description: z.string().min(1),
    Quantity: z.number(),
    UnitAmount: z.number(),
    AccountCode: z.string().min(1),
    TaxType: z.string().min(1),
    ItemCode: z.string().min(1).optional(),
  })
  .strict();

const advancedCreateCreditNoteLineItemsSchema = z
  .array(advancedCreateCreditNoteLineItemSchema)
  .min(1);

type AdvancedCreateCreditNoteLineItem = z.infer<
  typeof advancedCreateCreditNoteLineItemSchema
>;

function parseAdvancedCreateCreditNoteLineItems(
  lineItemsJson: string,
): AdvancedCreateCreditNoteLineItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lineItemsJson);
  } catch (error) {
    throw new Error(
      `--line-items-json must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (Array.isArray(parsed)) {
    const unsafeIndex = parsed.findIndex(
      (item) => item !== null
        && typeof item === "object"
        && ("LineItemID" in item || "CreditNoteID" in item),
    );
    if (unsafeIndex !== -1) {
      throw new Error(
        `--line-items-json row ${unsafeIndex} must not include CreditNoteID or LineItemID`,
      );
    }
    const discountIndex = parsed.findIndex(
      (item) => item !== null
        && typeof item === "object"
        && ("DiscountRate" in item || "DiscountAmount" in item),
    );
    if (discountIndex !== -1) {
      throw new Error(
        `--line-items-json row ${discountIndex} must not include DiscountRate or DiscountAmount; use an already-net UnitAmount`,
      );
    }
  }
  return advancedCreateCreditNoteLineItemsSchema.parse(parsed);
}

const createInvoiceSchema = z
  .object({
    contact: z.string().min(1).optional().describe("Contact name (legacy mode)"),
    amount: cliTypes.float(0).optional().describe("Line item amount (legacy mode)"),
    description: z.string().optional().describe("Line item description (legacy mode)"),
    quantity: cliTypes.float(0.01).optional().describe("Line item quantity (legacy mode)"),
    accountCode: z.string().optional().describe("Account code (legacy mode)"),
    contactId: z.string().min(1).optional().describe("Contact ID (advanced mode)"),
    lineItemsJson: z.string().min(1).optional().describe(
      "Non-empty JSON array of strict Xero line items (advanced mode)",
    ),
    invoiceNumber: z.string().min(1).optional().describe("Explicit invoice number (advanced mode)"),
    date: calendarDateSchema.optional().describe("Invoice date (YYYY-MM-DD; advanced mode)"),
    status: z.enum(["DRAFT", "SUBMITTED", "AUTHORISED"]).optional().describe(
      "Initial invoice status (advanced mode)",
    ),
    lineAmountTypes: z.enum(["Exclusive", "Inclusive", "NoTax"]).optional().describe(
      "Line amount tax basis (advanced mode)",
    ),
    type: z.enum(["ACCREC", "ACCPAY"]).optional().describe("Invoice type"),
    dueDate: calendarDateSchema.optional().describe("Due date (YYYY-MM-DD)"),
    reference: z.string().optional().describe("Reference number"),
    idempotencyKey: z.string().min(1).max(128).refine(
      (value) => value.trim().length > 0,
      "idempotencyKey must include a non-whitespace character",
    ).describe("Required stable Xero idempotency key for this invoice write"),
    tenantId: z.string().optional().describe("Xero tenant ID"),
  })
  .superRefine((args, context) => {
    const legacyFields = [
      args.contact,
      args.amount,
      args.description,
      args.quantity,
      args.accountCode,
    ];
    const advancedFields = [
      args.contactId,
      args.lineItemsJson,
      args.invoiceNumber,
      args.date,
      args.status,
      args.lineAmountTypes,
    ];
    const hasLegacyField = legacyFields.some((value) => value !== undefined);
    const hasAdvancedField = advancedFields.some((value) => value !== undefined);

    if (hasLegacyField && hasAdvancedField) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Do not mix legacy contact/amount fields with advanced invoice fields",
      });
      return;
    }
    if (hasAdvancedField) {
      if (args.contactId === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contactId"],
          message: "contactId is required in advanced mode",
        });
      }
      if (args.lineItemsJson === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lineItemsJson"],
          message: "lineItemsJson is required in advanced mode",
        });
      } else {
        try {
          parseAdvancedCreateInvoiceLineItems(args.lineItemsJson);
        } catch (error) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["lineItemsJson"],
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return;
    }
    if (args.contact === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contact"],
        message: "contact is required in legacy mode",
      });
    }
    if (args.amount === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "amount is required in legacy mode",
      });
    }
  });

const createPaymentSchema = z
  .object({
    id: z.string().min(1).describe("Invoice ID (UUID)"),
    accountCode: z.string().min(1).optional().describe("Account code"),
    accountId: z.string().min(1).optional().describe("Account ID (no account lookup)"),
    amount: cliTypes.float(0.01).describe("Payment amount"),
    date: calendarDateSchema.describe(
      "Required payment date (YYYY-MM-DD); keeps identical retries byte-for-byte stable",
    ),
    reference: z.string().optional().describe("Reference number"),
    currencyRate: cliTypes.float(0.000001).optional().describe("Exchange rate override"),
    idempotencyKey: z.string().min(1).max(128).refine(
      (value) => value.trim().length > 0,
      "idempotencyKey must include a non-whitespace character",
    ).describe("Required stable Xero idempotency key for this payment write"),
    tenantId: z.string().optional().describe("Xero tenant ID"),
  })
  .superRefine((args, context) => {
    if ((args.accountCode === undefined) === (args.accountId === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of accountCode or accountId",
      });
    }
  });

const createCreditNoteSchema = z
  .object({
    contactId: z.string().min(1).describe("Exact Xero ContactID"),
    amount: cliTypes.float(0.01).optional().describe("Credit amount (legacy mode)"),
    description: z.string().min(1).optional().describe("Line description (legacy mode)"),
    accountCode: z.string().min(1).optional().describe("Account code (legacy mode)"),
    creditNoteNumber: z.string().min(1).optional().describe(
      "Caller-supplied credit-note number (advanced mode)",
    ),
    date: calendarDateSchema.optional().describe("Credit-note date (advanced mode)"),
    status: z.enum(["DRAFT", "AUTHORISED"]).optional().describe(
      "Initial credit-note status (advanced mode)",
    ),
    lineAmountTypes: z.enum(["Exclusive", "Inclusive", "NoTax"]).optional().describe(
      "Line amount tax basis (advanced mode)",
    ),
    lineItemsJson: z.string().min(1).optional().describe(
      "Non-empty strict Xero credit-note line array (advanced mode)",
    ),
    reference: z.string().optional().describe("Reference number"),
    idempotencyKey: z.string().min(1).max(128).describe(
      "Required stable Xero idempotency key for this credit-note write",
    ),
    tenantId: z.string().optional().describe("Xero tenant ID"),
  })
  .strict()
  .superRefine((args, context) => {
    const hasLegacyField = [args.amount, args.description, args.accountCode]
      .some((value) => value !== undefined);
    const hasAdvancedField = [
      args.creditNoteNumber,
      args.date,
      args.status,
      args.lineAmountTypes,
      args.lineItemsJson,
    ].some((value) => value !== undefined);
    if (hasLegacyField && hasAdvancedField) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Do not mix legacy amount/description fields with advanced credit-note fields",
      });
      return;
    }
    if (hasAdvancedField) {
      if (args.lineItemsJson === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lineItemsJson"],
          message: "lineItemsJson is required in advanced credit-note mode",
        });
      } else {
        try {
          parseAdvancedCreateCreditNoteLineItems(args.lineItemsJson);
        } catch (error) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["lineItemsJson"],
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (args.creditNoteNumber === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["creditNoteNumber"],
          message: "creditNoteNumber is required in advanced credit-note mode",
        });
      }
      return;
    }
    if (args.amount === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "amount is required in legacy credit-note mode",
      });
    }
    if (args.description === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "description is required in legacy credit-note mode",
      });
    }
  });

const createCreditNoteRefundSchema = z
  .object({
    creditNoteId: z.string().min(1).describe("Exact CreditNoteID to refund"),
    accountId: z.string().min(1).describe("Exact clearing AccountID"),
    amount: cliTypes.float(0.01).describe("Refund amount"),
    date: calendarDateSchema.describe("Refund date (YYYY-MM-DD)"),
    reference: z.string().min(1).describe("Stable unique refund reference"),
    idempotencyKey: z.string().min(1).max(128).describe(
      "Required unique Xero idempotency key",
    ),
    tenantId: z.string().optional().describe("Xero tenant ID"),
  })
  .strict();

const authoriseCreditNoteSchema = z
  .object({
    creditNoteId: z.string().min(1).describe("Exact DRAFT CreditNoteID to authorise"),
    idempotencyKey: z.string().min(1).max(128).describe(
      "Required unique Xero idempotency key",
    ),
    tenantId: z.string().optional().describe("Xero tenant ID"),
  })
  .strict();

const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: XeroClient) =>
      buildSafeOutput(
        { command: "list-tools" },
        { tools: client.getTools() },
      ),
    "List all available commands",
    { sideEffect: "read" }
  ),

  "get-connections": createCommand(
    z.object({}),
    async (_args, client: XeroClient) => {
      const connections = await client.getConnections();
      return buildSafeOutput(
        { command: "get-connections", count: connections.length },
        { connections: connections.map((c, i) => wrapConnection(c, `connections[${i}]`)) },
      );
    },
    "Get connected Xero organisations (discover tenant IDs)",
    { sideEffect: "read" }
  ),

  "get-tenant-id": createCommand(
    z.object({}),
    async (_args, client: XeroClient) => {
      const tenantId = await client.resolveTenantId();
      return buildSafeOutput(
        { command: "get-tenant-id" },
        { tenantId },
      );
    },
    "Resolve the configured or unambiguous active Xero tenant ID",
    { sideEffect: "read" }
  ),

  "list-invoices": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      modifiedAfter: z.string().optional().describe(
        "ISO datetime cursor — emits If-Modified-Since to Xero so the response is limited to rows with UpdatedDateUTC strictly newer than this timestamp"
      ),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, modifiedAfter, tenantId } = args as {
        page?: number; where?: string; order?: string;
        modifiedAfter?: string; tenantId?: string;
      };
      const invoices = await client.listInvoices({ page, where, order, ifModifiedSince: modifiedAfter, tenantId });
      return buildSafeOutput(
        { command: "list-invoices", count: invoices.length, page: page ?? null },
        { invoices: invoices.map((inv, i) => wrapInvoice(inv, `invoices[${i}]`)) },
      );
    },
    "List invoices",
    { sideEffect: "read" }
  ),

  "get-invoice": createCommand(
    z.object({
      id: z.string().min(1).describe("Invoice ID (UUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      const invoice = await client.getInvoice(id, tenantId);
      if (!invoice) {
        return buildSafeOutput(
          { command: "get-invoice", id, found: false },
          { invoice: null },
        );
      }
      return buildSafeOutput(
        {
          command: "get-invoice",
          InvoiceID: invoice.InvoiceID,
          InvoiceNumber: invoice.InvoiceNumber,
          Type: invoice.Type,
          Status: invoice.Status,
          Total: invoice.Total,
          SubTotal: invoice.SubTotal,
          AmountDue: invoice.AmountDue,
          AmountPaid: invoice.AmountPaid,
          Date: invoice.Date,
          DueDate: invoice.DueDate,
          ContactID: invoice.Contact?.ContactID,
        },
        { invoice: wrapInvoice(invoice, "invoice") },
      );
    },
    "Get specific invoice details",
    { sideEffect: "read" }
  ),

  "create-invoice": createCommand(
    createInvoiceSchema,
    async (args, client: XeroClient) => {
      const {
        contact,
        amount,
        description,
        quantity,
        accountCode,
        contactId,
        lineItemsJson,
        invoiceNumber,
        date,
        status,
        lineAmountTypes,
        type,
        dueDate,
        reference,
        idempotencyKey,
        tenantId,
      } = args as {
        contact?: string; amount?: number; description?: string; quantity?: number;
        accountCode?: string; contactId?: string; lineItemsJson?: string;
        invoiceNumber?: string; date?: string;
        status?: "DRAFT" | "SUBMITTED" | "AUTHORISED";
        lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
        type?: "ACCREC" | "ACCPAY"; dueDate?: string;
        reference?: string; idempotencyKey: string; tenantId?: string;
      };
      const invoice = contactId !== undefined && lineItemsJson !== undefined
        ? await client.createInvoice({
            contactId,
            lineItems: parseAdvancedCreateInvoiceLineItems(lineItemsJson),
            invoiceNumber,
            date,
            status,
            lineAmountTypes,
            type,
            dueDate,
            reference,
            idempotencyKey,
            tenantId,
          })
        : await client.createInvoice({
            contactName: contact as string,
            lineItems: [{
              description: description || "Invoice item",
              quantity: quantity || 1,
              unitAmount: amount as number,
              accountCode,
            }],
            type,
            dueDate,
            reference,
            idempotencyKey,
            tenantId,
          });
      return buildSafeOutput(
        {
          command: "create-invoice",
          InvoiceID: invoice.InvoiceID,
          InvoiceNumber: invoice.InvoiceNumber,
          Type: invoice.Type,
          Status: invoice.Status,
          Total: invoice.Total,
        },
        { invoice: wrapInvoice(invoice, "invoice") },
      );
    },
    "Create a new invoice",
    { sideEffect: "write" }
  ),

  "update-invoice": createCommand(
    z.object({
      id: z.string().min(1).describe("Invoice ID (UUID)"),
      status: z.string().optional().describe("Invoice status"),
      reference: z.string().optional().describe("Reference number"),
      dueDate: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      contactId: z.string().optional().describe("Replacement contact ID (structural)"),
      lineItemsJson: z.string().optional().describe(
        "Replacement Xero LineItems JSON array (structural)",
      ),
      lineAmountTypes: z
        .enum(["Exclusive", "Inclusive", "NoTax"])
        .optional()
        .describe("Replacement line amount mode (structural)"),
      currencyCode: z.string().optional().describe("Replacement currency code (structural)"),
      type: z.enum(["ACCREC", "ACCPAY"]).optional().describe("Replacement invoice type (structural)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const {
        id,
        status,
        reference,
        dueDate,
        contactId,
        lineItemsJson,
        lineAmountTypes,
        currencyCode,
        type,
        tenantId,
      } = args as {
        id: string;
        status?: string;
        reference?: string;
        dueDate?: string;
        contactId?: string;
        lineItemsJson?: string;
        lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
        currencyCode?: string;
        type?: "ACCREC" | "ACCPAY";
        tenantId?: string;
      };
      const structural = parseStructuralInvoiceUpdate({
        contactId,
        lineItemsJson,
        lineAmountTypes,
        currencyCode,
        type,
      });
      const invoice = await client.updateInvoice(id, {
        status,
        reference,
        dueDate,
        ...structural,
        tenantId,
      });
      return buildSafeOutput(
        {
          command: "update-invoice",
          InvoiceID: invoice.InvoiceID,
          InvoiceNumber: invoice.InvoiceNumber,
          Status: invoice.Status,
          Total: invoice.Total,
        },
        { invoice: wrapInvoice(invoice, "invoice") },
      );
    },
    "Update an existing invoice",
    { sideEffect: "write" }
  ),

  "preview-paid-invoice-edit": createCommand(
    z.object({
      id: z.string().min(1).describe("Paid/part-paid invoice ID (UUID)"),
      contactId: z.string().optional().describe("Replacement contact ID"),
      lineItemsJson: z.string().optional().describe("Replacement Xero LineItems JSON array"),
      lineAmountTypes: z.enum(["Exclusive", "Inclusive", "NoTax"]).optional(),
      currencyCode: z.string().optional().describe("Replacement currency code"),
      type: z.enum(["ACCREC", "ACCPAY"]).optional().describe("Replacement invoice type"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const {
        id,
        contactId,
        lineItemsJson,
        lineAmountTypes,
        currencyCode,
        type,
        tenantId,
      } = args as {
        id: string;
        contactId?: string;
        lineItemsJson?: string;
        lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
        currencyCode?: string;
        type?: "ACCREC" | "ACCPAY";
        tenantId?: string;
      };
      const update = parseStructuralInvoiceUpdate({
        contactId,
        lineItemsJson,
        lineAmountTypes,
        currencyCode,
        type,
      });
      const plan = await client.previewPaidInvoiceEdit(id, update, tenantId);
      return buildSafeOutput(
        {
          command: "preview-paid-invoice-edit",
          planId: plan.planId,
          confirmationToken: plan.confirmationToken,
          InvoiceID: plan.invoiceId,
          InvoiceNumber: plan.invoiceNumber,
          Status: plan.invoiceStatus,
          AmountPaid: plan.amountPaid,
          paymentCount: plan.paymentCount,
          paymentTotal: plan.paymentTotal,
          workflowStatus: plan.status,
          instruction: plan.instruction,
        },
        {
          update: {
            ...plan.update,
            lineItems: plan.update.lineItems?.map((line, index) =>
              wrapLineItem(line, `update.LineItems[${index}]`),
            ),
          },
        },
      );
    },
    "Preview and durably snapshot a structural edit to a paid/part-paid invoice",
    { sideEffect: "write" },
  ),

  "confirm-paid-invoice-edit": createCommand(
    z.object({
      id: z.string().min(1).describe("Paid/part-paid invoice ID (UUID)"),
      planId: z.string().min(1).describe("Exact plan ID returned by preview"),
      confirmationToken: z
        .string()
        .min(1)
        .describe("Exact confirmation token returned by preview"),
      confirm: cliTypes.bool().optional().describe("Required: pass --confirm"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, planId, confirmationToken, confirm, tenantId } = args as {
        id: string;
        planId: string;
        confirmationToken: string;
        confirm?: boolean;
        tenantId?: string;
      };
      if (confirm !== true) {
        throw new Error(
          "confirm-paid-invoice-edit removes and recreates invoice payments. " +
          "Review the preview and re-run with the exact plan/token plus --confirm.",
        );
      }
      const state = await client.confirmPaidInvoiceEdit(
        id,
        planId,
        confirmationToken,
        tenantId,
      );
      return buildSafeOutput(
        {
          command: "confirm-paid-invoice-edit",
          planId: state.planId,
          InvoiceID: state.invoiceId,
          workflowStatus: state.status,
          revision: state.revision,
          paymentCount: state.payments.length,
          removedPaymentIDs: state.payments.map((payment) => payment.paymentId),
          replacementPaymentIDs: state.payments.map(
            (payment) => payment.replacementPaymentId,
          ),
          completed: state.status === "COMPLETED",
        },
        {},
      );
    },
    "Confirm or safely resume an exact paid-invoice structural edit plan",
    { sideEffect: "destructive" },
  ),

  "get-paid-invoice-edit-state": createCommand(
    z.object({
      id: z.string().min(1).describe("Invoice ID (UUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      const state = await client.getPaidInvoiceEditState(id, tenantId);
      return buildSafeOutput(
        {
          command: "get-paid-invoice-edit-state",
          found: state !== null,
          planId: state?.planId,
          InvoiceID: id,
          workflowStatus: state?.status,
          revision: state?.revision,
          hasLastError: state?.lastError !== undefined,
          payments: state?.payments.map((payment) => ({
            PaymentID: payment.paymentId,
            removeState: payment.removeState,
            reapplyState: payment.reapplyState,
            replacementPaymentId: payment.replacementPaymentId,
          })),
        },
        {
          lastError: state?.lastError
            ? wrapUntrustedField("state.lastError", state.lastError, {
                maxChars: BODY,
              })
            : undefined,
        },
      );
    },
    "Inspect durable paid-invoice edit recovery state",
    { sideEffect: "read" },
  ),

  "list-contacts": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      where: z.string().optional().describe("Xero filter expression"),
      order: z.string().optional().describe("Sort order field"),
      modifiedAfter: z.string().optional().describe(
        "ISO datetime cursor — emits If-Modified-Since to Xero so the response is limited to rows with UpdatedDateUTC strictly newer than this timestamp"
      ),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { page, where, order, modifiedAfter, tenantId } = args as {
        page?: number; where?: string; order?: string;
        modifiedAfter?: string; tenantId?: string;
      };
      const contacts = await client.listContacts({ page, where, order, ifModifiedSince: modifiedAfter, tenantId });
      return buildSafeOutput(
        { command: "list-contacts", count: contacts.length, page: page ?? null },
        { contacts: contacts.map((c, i) => wrapContact(c, `contacts[${i}]`)) },
      );
    },
    "List contacts/customers",
    { sideEffect: "read" }
  ),

  "get-contact": createCommand(
    z.object({
      id: z.string().min(1).describe("Contact ID (UUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      const contact = await client.getContact(id, tenantId);
      if (!contact) {
        return buildSafeOutput(
          { command: "get-contact", id, found: false },
          { contact: null },
        );
      }
      return buildSafeOutput(
        {
          command: "get-contact",
          ContactID: contact.ContactID,
          ContactStatus: contact.ContactStatus,
          IsCustomer: contact.IsCustomer,
          IsSupplier: contact.IsSupplier,
        },
        { contact: wrapContact(contact, "contact") },
      );
    },
    "Get specific contact details",
    { sideEffect: "read" }
  ),

  "create-contact": createCommand(
    z.object({
      name: z.string().min(1).describe("Contact name"),
      email: z.string().optional().describe("Email address"),
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      phone: z.string().optional().describe("Phone number"),
      idempotencyKey: z.string().min(1).max(128).describe(
        "Required stable Xero idempotency key for this contact write",
      ),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { name, email, firstName, lastName, phone, idempotencyKey, tenantId } = args as {
        name: string; email?: string; firstName?: string; lastName?: string;
        phone?: string; idempotencyKey: string; tenantId?: string;
      };
      const contact = await client.createContact({ name, email, firstName, lastName, phone, idempotencyKey, tenantId });
      return buildSafeOutput(
        { command: "create-contact", ContactID: contact.ContactID, ContactStatus: contact.ContactStatus },
        { contact: wrapContact(contact, "contact") },
      );
    },
    "Create a new contact",
    { sideEffect: "write" }
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
      const contact = await client.updateContact(id, { name, email, firstName, lastName, phone, tenantId });
      return buildSafeOutput(
        { command: "update-contact", ContactID: contact.ContactID, ContactStatus: contact.ContactStatus },
        { contact: wrapContact(contact, "contact") },
      );
    },
    "Update an existing contact",
    { sideEffect: "write" }
  ),

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
      const accounts = await client.listAccounts({ where, order, tenantId });
      return buildSafeOutput(
        { command: "list-accounts", count: accounts.length },
        { accounts: accounts.map((a, i) => wrapAccount(a, `accounts[${i}]`)) },
      );
    },
    "List chart of accounts",
    { sideEffect: "read" }
  ),

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
      const payments = await client.listPayments({ page, where, order, tenantId });
      return buildSafeOutput(
        { command: "list-payments", count: payments.length, page: page ?? null },
        { payments: payments.map((p, i) => wrapPayment(p, `payments[${i}]`)) },
      );
    },
    "List payment records",
    { sideEffect: "read" }
  ),

  "create-payment": createCommand(
    createPaymentSchema,
    async (args, client: XeroClient) => {
      const { id, accountCode, accountId, amount, date, reference, currencyRate, idempotencyKey, tenantId } = args as {
        id: string; accountCode?: string; accountId?: string; amount: number;
        date: string; reference?: string; currencyRate?: number;
        idempotencyKey: string; tenantId?: string;
      };
      const payment = accountId !== undefined
        ? await client.createPayment({ invoiceId: id, accountId, amount, date, reference, currencyRate, idempotencyKey, tenantId })
        : await client.createPayment({ invoiceId: id, accountCode: accountCode as string, amount, date, reference, currencyRate, idempotencyKey, tenantId });
      return buildSafeOutput(
        {
          command: "create-payment",
          PaymentID: payment.PaymentID,
          Amount: payment.Amount,
          Status: payment.Status,
          Date: payment.Date,
        },
        { payment: wrapPayment(payment, "payment") },
      );
    },
    "Create a payment for an invoice",
    { sideEffect: "write" }
  ),

  "delete-payment": createCommand(
    z.object({
      id: z.string().min(1).describe("Payment ID (UUID) to delete — irreversible"),
      confirm: cliTypes.bool().optional().describe("Required: pass --confirm to actually delete the payment"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, confirm, tenantId } = args as {
        id: string; confirm?: boolean; tenantId?: string;
      };
      if (confirm !== true) {
        throw new Error(
          `delete-payment is destructive and irreversible. ` +
          `Re-run with --confirm to delete payment ${id}.`
        );
      }
      const response = await client.deletePayment(id, { tenantId });
      const payments = response.Payments ?? [];
      return buildSafeOutput(
        {
          command: "delete-payment",
          PaymentID: payments[0]?.PaymentID,
          Status: payments[0]?.Status,
          deleted: true,
        },
        { payments: payments.map((p, i) => wrapPayment(p, `payments[${i}]`)) },
      );
    },
    "Delete (reverse) a payment — requires --confirm; irreversible",
    { sideEffect: "destructive", requiresConfirmation: true }
  ),

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
      const report = await client.getProfitAndLoss({ fromDate, toDate, periods, timeframe, tenantId });
      return buildSafeOutput(
        { command: "get-profit-and-loss", ReportID: report?.ReportID, ReportType: report?.ReportType, ReportDate: report?.ReportDate },
        { report: report ? wrapReport(report, "report") : null },
      );
    },
    "Profit & Loss report",
    { sideEffect: "read" }
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
      const report = await client.getTrialBalance({ date, paymentsOnly, tenantId });
      return buildSafeOutput(
        { command: "get-trial-balance", ReportID: report?.ReportID, ReportType: report?.ReportType, ReportDate: report?.ReportDate },
        { report: report ? wrapReport(report, "report") : null },
      );
    },
    "Trial Balance report",
    { sideEffect: "read" }
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
      const report = await client.getBalanceSheet({ date, periods, timeframe, tenantId });
      return buildSafeOutput(
        { command: "get-balance-sheet", ReportID: report?.ReportID, ReportType: report?.ReportType, ReportDate: report?.ReportDate },
        { report: report ? wrapReport(report, "report") : null },
      );
    },
    "Balance Sheet report",
    { sideEffect: "read" }
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
      const report = await client.getAgedReceivables({ contactId: id, date, fromDate, toDate, tenantId });
      return buildSafeOutput(
        { command: "get-aged-receivables", ReportID: report?.ReportID, ReportType: report?.ReportType, ReportDate: report?.ReportDate },
        { report: report ? wrapReport(report, "report") : null },
      );
    },
    "Aged Receivables by contact",
    { sideEffect: "read" }
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
      const report = await client.getAgedPayables({ contactId: id, date, fromDate, toDate, tenantId });
      return buildSafeOutput(
        { command: "get-aged-payables", ReportID: report?.ReportID, ReportType: report?.ReportType, ReportDate: report?.ReportDate },
        { report: report ? wrapReport(report, "report") : null },
      );
    },
    "Aged Payables by contact",
    { sideEffect: "read" }
  ),

  "get-organisation": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      const org = await client.getOrganisation(tenantId);
      if (!org) {
        return buildSafeOutput(
          { command: "get-organisation", found: false },
          { organisation: null },
        );
      }
      return buildSafeOutput(
        {
          command: "get-organisation",
          OrganisationID: org.OrganisationID,
          OrganisationType: org.OrganisationType,
          BaseCurrency: org.BaseCurrency,
          CountryCode: org.CountryCode,
        },
        { organisation: wrapOrganisation(org, "organisation") },
      );
    },
    "Organisation details",
    { sideEffect: "read" }
  ),

  "list-items": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      const items = await client.listItems(tenantId);
      return buildSafeOutput(
        { command: "list-items", count: items.length },
        { items: items.map((it, i) => wrapItem(it, `items[${i}]`)) },
      );
    },
    "List inventory items",
    { sideEffect: "read" }
  ),

  "list-tax-rates": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      const taxRates = await client.listTaxRates(tenantId);
      return buildSafeOutput(
        { command: "list-tax-rates", count: taxRates.length },
        { taxRates: taxRates.map((t, i) => wrapTaxRate(t, `taxRates[${i}]`)) },
      );
    },
    "List tax rates",
    { sideEffect: "read" }
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
      const notes = await client.listCreditNotes({ page, where, order, tenantId });
      return buildSafeOutput(
        { command: "list-credit-notes", count: notes.length, page: page ?? null },
        { creditNotes: notes.map((n, i) => wrapCreditNote(n, `creditNotes[${i}]`)) },
      );
    },
    "List credit notes",
    { sideEffect: "read" }
  ),

  "get-credit-note": createCommand(
    z.object({
      id: xeroGuidSchema.describe("Exact CreditNoteID (GUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }).strict(),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      const note = await client.getCreditNote(id, tenantId);
      if (!note) {
        return buildSafeOutput(
          { command: "get-credit-note", id, found: false },
          { creditNote: null },
        );
      }
      return buildSafeOutput(
        {
          command: "get-credit-note",
          CreditNoteID: note.CreditNoteID,
          CreditNoteNumber: note.CreditNoteNumber,
          Type: note.Type,
          Status: note.Status,
          Date: note.Date,
          LineAmountTypes: note.LineAmountTypes,
          SubTotal: note.SubTotal,
          TotalTax: note.TotalTax,
          Total: note.Total,
          RemainingCredit: note.RemainingCredit,
          ContactID: note.Contact?.ContactID,
        },
        { creditNote: wrapCreditNote(note, "creditNote") },
      );
    },
    "Get one exact credit note, including all line items",
    { sideEffect: "read" },
  ),

  "create-credit-note": createCommand(
    createCreditNoteSchema,
    async (args, client: XeroClient) => {
      const {
        contactId,
        amount,
        description,
        reference,
        accountCode,
        creditNoteNumber,
        date,
        status,
        lineAmountTypes,
        lineItemsJson,
        idempotencyKey,
        tenantId,
      } = args as {
        contactId: string; amount?: number; description?: string;
        reference?: string; accountCode?: string; creditNoteNumber?: string;
        date?: string; status?: "DRAFT" | "AUTHORISED";
        lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
        lineItemsJson?: string; idempotencyKey?: string; tenantId?: string;
      };
      const note = lineItemsJson !== undefined
        ? await client.createCreditNote({
            contactId,
            creditNoteNumber: creditNoteNumber as string,
            date,
            status,
            lineAmountTypes,
            lineItems: parseAdvancedCreateCreditNoteLineItems(lineItemsJson),
            reference,
            idempotencyKey: idempotencyKey as string,
            tenantId,
          })
        : await client.createCreditNote({
            contactId,
            amount: amount as number,
            description: description as string,
            reference,
            accountCode,
            idempotencyKey,
            tenantId,
          });
      return buildSafeOutput(
        {
          command: "create-credit-note",
          CreditNoteID: note.CreditNoteID,
          CreditNoteNumber: note.CreditNoteNumber,
          Type: note.Type,
          Status: note.Status,
          Total: note.Total,
          ReconciledAfterAmbiguousWrite: note.ReconciledAfterAmbiguousWrite,
        },
        { creditNote: wrapCreditNote(note, "creditNote") },
      );
    },
    "Create a legacy authorised credit note or an exact advanced credit note",
    { sideEffect: "write" }
  ),

  "authorise-credit-note": createCommand(
    authoriseCreditNoteSchema,
    async (args, client: XeroClient) => {
      const { creditNoteId, idempotencyKey, tenantId } = args as {
        creditNoteId: string; idempotencyKey: string; tenantId?: string;
      };
      const note = await client.authoriseCreditNote({
        creditNoteId,
        idempotencyKey,
        tenantId,
      });
      return buildSafeOutput(
        {
          command: "authorise-credit-note",
          CreditNoteID: note.CreditNoteID,
          CreditNoteNumber: note.CreditNoteNumber,
          Status: note.Status,
          ReconciledAfterAmbiguousWrite: note.ReconciledAfterAmbiguousWrite,
        },
        { creditNote: wrapCreditNote(note, "creditNote") },
      );
    },
    "Authorise one exact DRAFT credit note after an exact-ID read boundary",
    { sideEffect: "write" },
  ),

  "create-credit-note-refund": createCommand(
    createCreditNoteRefundSchema,
    async (args, client: XeroClient) => {
      const { creditNoteId, accountId, amount, date, reference, idempotencyKey, tenantId } = args as {
        creditNoteId: string; accountId: string; amount: number; date: string;
        reference: string; idempotencyKey: string; tenantId?: string;
      };
      const payment = await client.createCreditNoteRefund({
        creditNoteId,
        accountId,
        amount,
        date,
        reference,
        idempotencyKey,
        tenantId,
      });
      return buildSafeOutput(
        {
          command: "create-credit-note-refund",
          PaymentID: payment.PaymentID,
          CreditNoteID: payment.CreditNote?.CreditNoteID,
          Amount: payment.Amount,
          Status: payment.Status,
          Date: payment.Date,
          ReconciledAfterAmbiguousWrite: payment.ReconciledAfterAmbiguousWrite,
        },
        { payment: wrapPayment(payment, "payment") },
      );
    },
    "Refund an exact credit note to an exact clearing account; GET-first after an ambiguous response",
    { sideEffect: "write" },
  ),

  "allocate-credit-note": createCommand(
    z.object({
      creditNoteId: z.string().min(1).describe("Credit note ID (UUID)"),
      invoiceId: z.string().min(1).describe("Invoice ID (UUID)"),
      amount: cliTypes.float(0.01).describe("Allocation amount"),
      idempotencyKey: z.string().min(1).max(128).describe(
        "Required stable Xero idempotency key for this allocation",
      ),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { creditNoteId, invoiceId, amount, idempotencyKey, tenantId } = args as {
        creditNoteId: string; invoiceId: string; amount: number;
        idempotencyKey: string; tenantId?: string;
      };
      const allocations = await client.allocateCreditNote(creditNoteId, invoiceId, amount, {
        tenantId,
        idempotencyKey,
      });
      return buildSafeOutput(
        {
          command: "allocate-credit-note",
          CreditNoteID: creditNoteId,
          InvoiceID: invoiceId,
          allocations,
        },
        {},
      );
    },
    "Allocate a credit note to an invoice",
    { sideEffect: "write" }
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
      const txs = await client.listBankTransactions({ page, where, order, tenantId });
      return buildSafeOutput(
        { command: "list-bank-transactions", count: txs.length, page: page ?? null },
        { bankTransactions: txs.map((tx, i) => wrapBankTransaction(tx, `bankTransactions[${i}]`)) },
      );
    },
    "List bank transactions",
    { sideEffect: "read" }
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
      const quotes = await client.listQuotes({ page, where, order, tenantId });
      return buildSafeOutput(
        { command: "list-quotes", count: quotes.length, page: page ?? null },
        { quotes: quotes.map((q, i) => wrapQuote(q, `quotes[${i}]`)) },
      );
    },
    "List quotes",
    { sideEffect: "read" }
  ),

  "get-quote": createCommand(
    z.object({
      id: z.string().min(1).describe("Quote ID (UUID)"),
      tenantId: z.string().optional().describe("Xero tenant ID"),
    }),
    async (args, client: XeroClient) => {
      const { id, tenantId } = args as { id: string; tenantId?: string };
      const quote = await client.getQuote(id, tenantId);
      if (!quote) {
        return buildSafeOutput(
          { command: "get-quote", id, found: false },
          { quote: null },
        );
      }
      return buildSafeOutput(
        {
          command: "get-quote",
          QuoteID: quote.QuoteID,
          QuoteNumber: quote.QuoteNumber,
          Status: quote.Status,
          Total: quote.Total,
          Date: quote.Date,
          ExpiryDate: quote.ExpiryDate,
          ContactID: quote.Contact?.ContactID,
        },
        { quote: wrapQuote(quote, "quote") },
      );
    },
    "Get specific quote details",
    { sideEffect: "read" }
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
      const overpayments = await client.listOverpayments({ page, where, order, tenantId });
      return buildSafeOutput(
        { command: "list-overpayments", count: overpayments.length, page: page ?? null },
        { overpayments: overpayments.map((op, i) => wrapOverpayment(op, `overpayments[${i}]`)) },
      );
    },
    "List overpayments",
    { sideEffect: "read" }
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
      const prepayments = await client.listPrepayments({ page, where, order, tenantId });
      return buildSafeOutput(
        { command: "list-prepayments", count: prepayments.length, page: page ?? null },
        { prepayments: prepayments.map((pp, i) => wrapPrepayment(pp, `prepayments[${i}]`)) },
      );
    },
    "List prepayments",
    { sideEffect: "read" }
  ),

  "list-contact-groups": createCommand(
    z.object({ tenantId: z.string().optional().describe("Xero tenant ID") }),
    async (args, client: XeroClient) => {
      const { tenantId } = args as { tenantId?: string };
      const groups = await client.listContactGroups(tenantId);
      return buildSafeOutput(
        { command: "list-contact-groups", count: groups.length },
        { contactGroups: groups.map((g, i) => wrapContactGroup(g, `contactGroups[${i}]`)) },
      );
    },
    "List contact groups",
    { sideEffect: "read" }
  ),

  ...cacheCommands<XeroClient>(),
};

let isCliEntry = false;
try {
  isCliEntry =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
} catch {
  isCliEntry = false;
}

if (isCliEntry) {
  runCli(commands, XeroClient, {
    programName: "xero-cli",
    description: "Xero accounting operations",
  });
}

export { commands };
export const __wrapInternals = {
  wrapAddress,
  wrapPhone,
  wrapLineItem,
  wrapContact,
  wrapInvoice,
  wrapPayment,
  wrapCreditNote,
  wrapBankTransaction,
  wrapQuote,
  wrapPrepayment,
  wrapOverpayment,
  wrapAccount,
  wrapItem,
  wrapTaxRate,
  wrapOrganisation,
  wrapContactGroup,
  wrapConnection,
  wrapReport,
};

