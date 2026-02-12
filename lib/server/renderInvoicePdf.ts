import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf, type InvoicePdfData } from "@/lib/pdf/InvoicePdf";

export type { InvoicePdfData } from "@/lib/pdf/InvoicePdf";

export async function renderInvoicePdfBuffer(data: InvoicePdfData): Promise<Buffer> {
  const element = React.createElement(InvoicePdf, { data }) as React.ReactElement;
  const buffer = await renderToBuffer(element);
  return Buffer.from(buffer);
}
