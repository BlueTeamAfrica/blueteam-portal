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

function portalBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.PORTAL_BASE_URL ||
    "https://portal.blueteamafrica.com"
  ).replace(/\/$/, "");
}

/** overdue_invoice — client portal automation */
export async function sendClientOverdueInvoiceEmail({
  to,
  clientName,
  tenantName,
  invoiceNumber,
  amountLabel,
  dueDateLabel,
}: {
  to: string;
  clientName: string;
  tenantName: string;
  invoiceNumber: string;
  amountLabel: string;
  dueDateLabel: string;
}) {
  await transporter.verify();
  const base = portalBaseUrl();
  const invoicesUrl = `${base}/client/invoices`;
  const subject = `Invoice overdue — ${tenantName}`;
  const text = [
    `Hello ${clientName},`,
    ``,
    `An invoice is now overdue:`,
    ``,
    `Invoice: ${invoiceNumber}`,
    `Amount: ${amountLabel}`,
    `Due date: ${dueDateLabel}`,
    ``,
    `View your invoices in the client portal:`,
    invoicesUrl,
    ``,
    `— ${tenantName}`,
  ].join("\n");

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${user}>`,
    replyTo: user ?? undefined,
    to,
    subject,
    text,
    html: `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
    <p>Hello ${escapeHtml(clientName)},</p>
    <p><strong>An invoice is now overdue.</strong></p>
    <table style="border-collapse: collapse; margin: 12px 0;">
      <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Invoice</td><td style="padding: 4px 0;"><strong>${escapeHtml(invoiceNumber)}</strong></td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Amount</td><td style="padding: 4px 0;">${escapeHtml(amountLabel)}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Due date</td><td style="padding: 4px 0;">${escapeHtml(dueDateLabel)}</td></tr>
    </table>
    <p>
      <a href="${invoicesUrl}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open invoices</a>
    </p>
    <p style="font-size: 12px; color: #64748b;">${escapeHtml(tenantName)}</p>
  </div>`,
  });
  return info;
}

/** service_waiting_client — client portal automation */
export async function sendClientServiceWaitingEmail({
  to,
  clientName,
  tenantName,
  serviceName,
  healthNote,
  nextAction,
  serviceUrl,
}: {
  to: string;
  clientName: string;
  tenantName: string;
  serviceName: string;
  healthNote: string;
  nextAction: string;
  serviceUrl: string;
}) {
  await transporter.verify();
  const subject = `Action needed — ${serviceName}`;
  const noteBlock = healthNote.trim()
    ? `\n\nNote from the team:\n${healthNote}`
    : "";
  const actionBlock = nextAction.trim() ? `\n\nNext step: ${nextAction}` : "";
  const text = [
    `Hello ${clientName},`,
    ``,
    `We need your input on: ${serviceName}.${actionBlock}${noteBlock}`,
    ``,
    `Open the service in your client portal:`,
    serviceUrl,
    ``,
    `— ${tenantName}`,
  ].join("\n");

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${user}>`,
    replyTo: user ?? undefined,
    to,
    subject,
    text,
    html: `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
    <p>Hello ${escapeHtml(clientName)},</p>
    <p><strong>We need your input</strong> on <strong>${escapeHtml(serviceName)}</strong>.</p>
    ${nextAction.trim() ? `<p><strong>Next step:</strong> ${escapeHtml(nextAction)}</p>` : ""}
    ${healthNote.trim() ? `<p style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;"><strong>Note:</strong> ${escapeHtml(healthNote)}</p>` : ""}
    <p>
      <a href="${serviceUrl}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View service</a>
    </p>
    <p style="font-size: 12px; color: #64748b;">${escapeHtml(tenantName)}</p>
  </div>`,
  });
  return info;
}

/** support_waiting_client — client portal automation */
export async function sendClientSupportReplyWaitingEmail({
  to,
  clientName,
  tenantName,
  ticketSubject,
  ticketUrl,
}: {
  to: string;
  clientName: string;
  tenantName: string;
  ticketSubject: string;
  ticketUrl: string;
}) {
  await transporter.verify();
  const subject = `Reply needed — support ticket`;
  const text = [
    `Hello ${clientName},`,
    ``,
    `We're waiting on your reply for this support ticket:`,
    ``,
    `${ticketSubject}`,
    ``,
    `Open the ticket:`,
    ticketUrl,
    ``,
    `— ${tenantName}`,
  ].join("\n");

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${user}>`,
    replyTo: user ?? undefined,
    to,
    subject,
    text,
    html: `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
    <p>Hello ${escapeHtml(clientName)},</p>
    <p><strong>We're waiting on your reply</strong> for this support ticket:</p>
    <p style="padding:12px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;"><strong>${escapeHtml(ticketSubject)}</strong></p>
    <p>
      <a href="${ticketUrl}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open ticket</a>
    </p>
    <p style="font-size: 12px; color: #64748b;">${escapeHtml(tenantName)}</p>
  </div>`,
  });
  return info;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
