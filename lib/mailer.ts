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

  const portalBase =
    (process.env.NEXT_PUBLIC_PORTAL_URL ||
      process.env.PORTAL_BASE_URL ||
      "https://portal.blueteamafrica.com").replace(/\/$/, "");

  const loginUrl = `${portalBase}/login`;

  console.log("EMAIL DEBUG:", { to, subject: "Invoices Generated", loginUrl, hasHtml: true });

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${process.env.SMTP_USER}>`,
    to,
    subject: "Invoices Generated – Blue Team Africa",

    // ✅ TEXT: forces auto-linking in most clients
    text: [
      `Invoices have been generated for Blue Team Africa.`,
      ``,
      `Generated: ${generated}`,
      `Skipped: ${skipped}`,
      `Errors: ${errors}`,
      ``,
      `Login to the portal: <${loginUrl}>`,
      `${loginUrl}`,
    ].join("\n"),

    // ✅ HTML: proper clickable link + button
    html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Invoices Generated – Blue Team Africa</h2>
      <p>Invoices have been generated.</p>
      <ul>
        <li><strong>Generated:</strong> ${generated}</li>
        <li><strong>Skipped:</strong> ${skipped}</li>
        <li><strong>Errors:</strong> ${errors}</li>
      </ul>
      <p>
        <a href="${loginUrl}">${loginUrl}</a>
      </p>
      <p>
        <a href="${loginUrl}"
           style="display:inline-block;padding:10px 16px;background:#3b5bdb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
          Login to Portal
        </a>
      </p>
    </div>
  `,
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
  items: Array<{
    invoiceId: string;
    invoiceLabel: string;
    amount: number;
    currency: string;
    dueDate: string;
  }>;
}) {
  await transporter.verify();

  // Set PORTAL_BASE_URL in Vercel Production (e.g. https://portal.blueteamafrica.com) for correct links
  const base = (process.env.PORTAL_BASE_URL || "https://portal.blueteamafrica.com").replace(
    /\/$/,
    ""
  );
  const pdfUrl = (id: string) => `${base}/api/invoices/${id}/pdf`;

  const subject = `New invoice(s) available – ${tenantName}`;

  const lines = items
    .map(
      (i) =>
        `- ${i.invoiceLabel} | ${i.currency} ${i.amount} | Due: ${i.dueDate}\n  PDF: <${pdfUrl(i.invoiceId)}>`
    )
    .join("\n");

  const text =
    `Hello ${clientName},\n\n` +
    `New invoice(s) have been generated for you by ${tenantName}:\n\n` +
    `${lines}\n\n` +
    `Please login to the client portal to view details.\n\n` +
    `— Blue Team Portal\n`;

  const htmlItems = items
    .map(
      (i) => `
  <li style="margin-bottom:10px;">
    <div><strong>${i.invoiceLabel}</strong> — ${i.currency} ${i.amount} — Due: ${i.dueDate}</div>
    <div><a href="${pdfUrl(i.invoiceId)}">Download PDF</a></div>
  </li>
`
    )
    .join("");

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${user}>`,
    replyTo: user ?? undefined,
    to,
    subject,
    text,
    html: `
  <div style="font-family: Arial, sans-serif; line-height: 1.6;">
    <p>Hello ${clientName},</p>
    <p>New invoice(s) have been generated for you by ${tenantName}:</p>
    <ul>${htmlItems}</ul>
    <p>
      <a href="${base}/login">Login to the portal</a>
    </p>
  </div>
`,
  });

  return info;
}
