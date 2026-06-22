import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Svg,
  Path,
  G,
  Circle,
  Font,
} from "@react-pdf/renderer";

Font.register({
  family: "Poppins",
  fonts: [
    { src: "https://fonts.gstatic.com/s/poppins/v21/pxiEyp8kv8JHgFVrJJfecg.woff2", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLGT9Z1xlFQ.woff2", fontWeight: 500 },
    { src: "https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLEj6Z1xlFQ.woff2", fontWeight: 600 },
    { src: "https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLCz7Z1xlFQ.woff2", fontWeight: 700 },
  ],
});

const COMPANY = {
  name: "Blue Team Limited",
  address1: "Remera, Gasabo",
  address2: "Kigali, Rwanda",
  reg: "RDB Reg: 121861203",
  email: "contact@blueteamafrica.com",
  phone1: "+250 798 973 375",
  phone2: "+254 119 402 737",
};

const BANK = {
  method: "Payment via bank transfer:",
  bank: "Equity Bank Rwanda",
  account: "4003201036499",
  accountName: "Blue Team Limited",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  RWF: "RWF ",
};

function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

function fmtAmount(n: number): string {
  const [int, dec] = n.toFixed(2).split(".");
  const intStr = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec === "00" ? intStr : `${intStr}.${dec}`;
}

function fmtDate(s: string): string {
  if (!s || s === "—") return s || "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function ShieldMark() {
  return (
    <Svg width={30} height={35} viewBox="0 0 200 234">
      <Path
        d="M 100,228 C 38,200 7,166 7,120 L 7,28 Q 7,7 28,7 L 172,7 Q 193,7 193,28 L 193,120 C 193,166 162,200 100,228 Z"
        fill="#1e3a8a"
      />
      <G transform="translate(26,28) scale(0.74)">
        <Path
          d="M 62,5 C 40,5 2,55 2,68 C 2,82 14,92 22,97 L 38,99 C 55,104 72,101 84,110 C 93,117 92,133 92,162 C 93,175 102,195 122,212 C 134,206 146,190 157,174 C 168,157 172,140 176,128 C 180,116 183,106 197,75 C 194,64 188,61 182,58 C 170,52 155,45 140,20 C 130,8 108,2 84,2 C 74,2 66,3 62,5 Z"
          fill="#ffffff"
        />
      </G>
      <Circle cx={142} cy={112} r={10} fill="#22d3ee" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 60,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: "Poppins",
    color: "#0f172a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  companyName: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#1e3a8a",
    letterSpacing: 1,
  },
  companyTagline: {
    fontSize: 7,
    color: "#4b6cb7",
    letterSpacing: 1.5,
    marginTop: 2,
  },
  invoiceTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#0f172a",
  },
  twoCol: {
    flexDirection: "row",
    marginBottom: 24,
  },
  col: {
    flex: 1,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  metaLabel: {
    fontSize: 9,
    color: "#64748b",
    width: 90,
  },
  metaValue: {
    fontSize: 9,
    color: "#0f172a",
    flex: 1,
  },
  addrHead: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#64748b",
    marginBottom: 5,
    letterSpacing: 0.5,
  },
  addrLine: {
    fontSize: 9.5,
    color: "#0f172a",
    marginBottom: 2,
  },
  amountBanner: {
    backgroundColor: "#f1f5f9",
    padding: 12,
    borderRadius: 4,
    marginBottom: 24,
  },
  amountBannerText: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#0f172a",
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: "#0f172a",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
  },
  colDesc: { flex: 3, fontSize: 9, color: "#0f172a" },
  colQty: { width: 32, fontSize: 9, color: "#0f172a", textAlign: "right" },
  colUnit: { width: 70, fontSize: 9, color: "#0f172a", textAlign: "right" },
  colAmt: { width: 70, fontSize: 9, color: "#0f172a", textAlign: "right" },
  colDescH: { flex: 3, fontSize: 9, color: "#64748b", fontWeight: "bold" },
  colQtyH: { width: 32, fontSize: 9, color: "#64748b", fontWeight: "bold", textAlign: "right" },
  colUnitH: { width: 70, fontSize: 9, color: "#64748b", fontWeight: "bold", textAlign: "right" },
  colAmtH: { width: 70, fontSize: 9, color: "#64748b", fontWeight: "bold", textAlign: "right" },
  totalsBlock: {
    alignItems: "flex-end",
    marginTop: 8,
    marginBottom: 32,
  },
  totalRow: {
    flexDirection: "row",
    marginBottom: 4,
    width: 160,
    justifyContent: "space-between",
  },
  totalLabel: { fontSize: 9, color: "#64748b" },
  totalValue: { fontSize: 9, color: "#0f172a" },
  grandTotalRow: {
    flexDirection: "row",
    width: 160,
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    marginTop: 2,
  },
  grandTotalLabel: { fontSize: 10, fontWeight: "bold", color: "#0f172a" },
  grandTotalValue: { fontSize: 10, fontWeight: "bold", color: "#0f172a" },
  paymentBlock: {
    marginTop: 32,
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
  },
  paymentHead: { fontSize: 9, fontWeight: "bold", color: "#0f172a", marginBottom: 4 },
  paymentLine: { fontSize: 9, color: "#334155", marginBottom: 2 },
});

export type InvoicePdfData = {
  tenant: { id: string; name?: string };
  invoice: {
    invoiceNumber?: string;
    clientId?: string;
    clientName?: string;
    createdAt?: string;
    status?: string;
    amount?: number;
    currency?: string;
    dueDate?: string;
    notes?: string;
    lineItems?: Array<{
      description: string;
      qty?: number;
      unitPrice?: number;
      amount: number;
      currency?: string;
    }>;
  };
  client: { id: string; name?: string; email?: string };
};

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  const { invoice, client } = data;
  const dueDate = fmtDate(invoice.dueDate ?? "—");
  const createdAt = fmtDate(invoice.createdAt ?? "—");
  const amount = invoice.amount ?? 0;
  const currency = invoice.currency ?? "USD";
  const sym = currencySymbol(currency);
  const lineItems = invoice.lineItems?.length ? invoice.lineItems : null;
  const total = lineItems ? lineItems.reduce((s, i) => s + i.amount, 0) : amount;

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header: logo left, Invoice right */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <ShieldMark />
            <View>
              <Text style={styles.companyName}>BLUE TEAM AFRICA</Text>
              <Text style={styles.companyTagline}>DIGITAL SOLUTIONS · EAST AFRICA</Text>
            </View>
          </View>
          <Text style={styles.invoiceTitle}>Invoice</Text>
        </View>

        {/* Invoice meta */}
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Invoice number</Text>
              <Text style={styles.metaValue}>{invoice.invoiceNumber ?? "—"}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date of issue</Text>
              <Text style={styles.metaValue}>{createdAt}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date due</Text>
              <Text style={styles.metaValue}>{dueDate}</Text>
            </View>
          </View>
          <View style={styles.col} />
        </View>

        {/* From / Bill to */}
        <View style={[styles.twoCol, { marginBottom: 28 }]}>
          <View style={styles.col}>
            <Text style={styles.addrHead}>{COMPANY.name}</Text>
            <Text style={styles.addrLine}>{COMPANY.address1}</Text>
            <Text style={styles.addrLine}>{COMPANY.address2}</Text>
            <Text style={styles.addrLine}>{COMPANY.reg}</Text>
            <Text style={styles.addrLine}>{COMPANY.email}</Text>
            <Text style={styles.addrLine}>{COMPANY.phone1} (Rwanda)</Text>
            <Text style={styles.addrLine}>{COMPANY.phone2} (Kenya)</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.addrHead}>Bill to</Text>
            <Text style={styles.addrLine}>{client.name ?? "—"}</Text>
            {client.email ? <Text style={styles.addrLine}>{client.email}</Text> : null}
          </View>
        </View>

        {/* Amount due banner */}
        <View style={styles.amountBanner}>
          <Text style={styles.amountBannerText}>
            {sym}{fmtAmount(total)} {currency} due {dueDate}
          </Text>
        </View>

        {/* Line items table */}
        <View>
          <View style={styles.tableHeader}>
            <Text style={styles.colDescH}>Description</Text>
            <Text style={styles.colQtyH}>Qty</Text>
            <Text style={styles.colUnitH}>Unit price</Text>
            <Text style={styles.colAmtH}>Amount</Text>
          </View>
          {lineItems ? (
            lineItems.map((item, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colDesc}>{item.description}</Text>
                <Text style={styles.colQty}>{item.qty ?? 1}</Text>
                <Text style={styles.colUnit}>{sym}{fmtAmount(item.unitPrice ?? item.amount)}</Text>
                <Text style={styles.colAmt}>{sym}{fmtAmount(item.amount)}</Text>
              </View>
            ))
          ) : invoice.notes ? (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>{invoice.notes}</Text>
              <Text style={styles.colQty}>1</Text>
              <Text style={styles.colUnit}>{sym}{fmtAmount(amount)}</Text>
              <Text style={styles.colAmt}>{sym}{fmtAmount(amount)}</Text>
            </View>
          ) : null}
        </View>

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{sym}{fmtAmount(total)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{sym}{fmtAmount(total)}</Text>
          </View>
        </View>

        {/* Payment info */}
        <View style={styles.paymentBlock}>
          <Text style={styles.paymentHead}>{BANK.method}</Text>
          <Text style={styles.paymentLine}>{BANK.bank}</Text>
          <Text style={styles.paymentLine}>Account: {BANK.account}</Text>
          <Text style={styles.paymentLine}>Account name: {BANK.accountName}</Text>
        </View>

      </Page>
    </Document>
  );
}
