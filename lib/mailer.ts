import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const secureEnv = process.env.SMTP_SECURE?.toLowerCase();
const secure = secureEnv === "true" ? true : secureEnv === "false" ? false : port === 465;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
});

export async function sendAdminInvoiceEmail({
  to,
  tenantName,
  generated,
  skipped,
  errors,
}: {
  to: string;
  tenantName: string;
  generated: number;
  skipped: number;
  errors: number;
}) {
  // Verify SMTP connection (prints useful errors if blocked)
  await transporter.verify();

  const subject = `Invoices Generated – ${tenantName}`;
  const text =
    `Invoices have been generated for ${tenantName}.\n\n` +
    `Generated: ${generated}\n` +
    `Skipped: ${skipped}\n` +
    `Errors: ${errors}\n\n` +
    `Login to the portal to review invoices.\n`;

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${user}>`,
    to,
    subject,
    text,
  });

  return info; // return nodemailer response so API can log it
}

export async function sendClientInvoicesEmail({
  to,
  clientName,
  tenantName,
  items,
}: {
  to: string;
  clientName: string;
  tenantName: string;
  items: Array<{ invoiceLabel: string; amount: number; currency: string; dueDate: string }>;
}) {
  await transporter.verify();

  const subject = `New invoice(s) available – ${tenantName}`;

  const lines = items
    .map((i) => `- ${i.invoiceLabel} | ${i.currency} ${i.amount} | Due: ${i.dueDate}`)
    .join("\n");

  const text =
    `Hello ${clientName},\n\n` +
    `New invoice(s) have been generated for you by ${tenantName}:\n\n` +
    `${lines}\n\n` +
    `Please login to the client portal to view details.\n\n` +
    `— Blue Team Portal\n`;

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${user}>`,
    replyTo: user ?? undefined,
    to,
    subject,
    text,
  });

  return info;
}
