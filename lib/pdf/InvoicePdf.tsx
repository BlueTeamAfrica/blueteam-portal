import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontSize: 11,
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    paddingBottom: 12,
  },
  companyName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0f172a",
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 16,
    color: "#0f172a",
  },
  row: {
    flexDirection: "row",
    marginBottom: 6,
  },
  label: {
    width: 100,
    color: "#64748b",
  },
  value: {
    flex: 1,
    color: "#0f172a",
  },
  section: {
    marginTop: 16,
    marginBottom: 8,
  },
  notes: {
    marginTop: 16,
    padding: 10,
    backgroundColor: "#f8fafc",
    borderRadius: 4,
  },
  notesTitle: {
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 4,
    color: "#64748b",
  },
  lineItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
});

export type InvoicePdfData = {
  tenant: { id: string; name?: string };
  invoice: {
    invoiceNumber?: string;
    clientId?: string;
    clientName?: string;
    status?: string;
    amount?: number;
    currency?: string;
    dueDate?: string;
    notes?: string;
    lineItems?: Array<{ description: string; amount: number; currency?: string }>;
  };
  client: { id: string; name?: string; email?: string };
};

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  const { tenant, invoice, client } = data;
  const dueDate = invoice.dueDate ?? "—";
  const amount = invoice.amount != null ? invoice.amount : 0;
  const currency = invoice.currency ?? "USD";
  const lineItems = invoice.lineItems && invoice.lineItems.length > 0 ? invoice.lineItems : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.companyName}>{tenant.name ?? "Blue Team Africa"}</Text>
        </View>

        <Text style={styles.title}>Invoice</Text>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Invoice #</Text>
            <Text style={styles.value}>{invoice.invoiceNumber ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Client</Text>
            <Text style={styles.value}>{client.name ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{client.email ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Amount</Text>
            <Text style={styles.value}>
              {currency} {amount.toLocaleString()}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Due date</Text>
            <Text style={styles.value}>{dueDate}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>{invoice.status ?? "—"}</Text>
          </View>
        </View>

        {lineItems && (
          <View style={styles.section}>
            <Text style={styles.notesTitle}>Line items</Text>
            {lineItems.map((item, i) => (
              <View key={i} style={styles.lineItem}>
                <Text style={styles.value}>{item.description}</Text>
                <Text style={styles.value}>
                  {item.currency ?? currency} {item.amount.toLocaleString()}
                </Text>
              </View>
            ))}
          </View>
        )}

        {invoice.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.value}>{invoice.notes}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
