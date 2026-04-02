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

function portalBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.PORTAL_BASE_URL ||
    "https://portal.blueteamafrica.com"
  ).replace(/\/$/, "");
}

/** Client portal URL for one invoice (sign-in required; PDF via Download on page, not a raw API URL). */
export function getClientInvoicePortalUrl(invoiceId: string) {
  const base = portalBaseUrl();
  return `${base}/client/invoices/${encodeURIComponent(invoiceId)}`;
}

export function getClientServicePortalUrl(serviceId: string) {
  const base = portalBaseUrl();
  return `${base}/client/services/${encodeURIComponent(serviceId)}`;
}

export function getClientSupportTicketPortalUrl(ticketId: string) {
  const base = portalBaseUrl();
  return `${base}/client/support/${encodeURIComponent(ticketId)}`;
}

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

  const loginUrl = `${portalBaseUrl()}/login`;

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

  const base = portalBaseUrl();
  const clientInvoicesUrl = `${base}/client/invoices`;
  const invoicePortalUrl = (invoiceId: string) => getClientInvoicePortalUrl(invoiceId);

  const subject = `New invoice(s) available – ${tenantName}`;

  const lines = items
    .map(
      (i) =>
        `- ${i.invoiceLabel} | ${i.currency} ${i.amount} | Due: ${i.dueDate}\n  View in portal: ${invoicePortalUrl(i.invoiceId)}`
    )
    .join("\n");

  const text =
    `Hello ${clientName},\n\n` +
    `New invoice(s) have been generated for you by ${tenantName}:\n\n` +
    `${lines}\n\n` +
    `Sign in to the client portal to open your invoices and download PDFs (PDF download requires you to be logged in).\n` +
    `All invoices: ${clientInvoicesUrl}\n\n` +
    `— Blue Team Portal\n`;

  const htmlItems = items
    .map(
      (i) => `
  <li style="margin-bottom:10px;">
    <div><strong>${escapeHtml(i.invoiceLabel)}</strong> — ${escapeHtml(String(i.currency))} ${escapeHtml(String(i.amount))} — Due: ${escapeHtml(i.dueDate)}</div>
    <div><a href="${invoicePortalUrl(i.invoiceId)}">View invoice in portal</a> <span style="color:#64748b;font-size:12px;">(sign in to download PDF)</span></div>
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
    <p>Hello ${escapeHtml(clientName)},</p>
    <p>New invoice(s) have been generated for you by ${escapeHtml(tenantName)}:</p>
    <ul>${htmlItems}</ul>
    <p>
      <a href="${clientInvoicesUrl}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open My Invoices</a>
    </p>
    <p style="font-size:13px;color:#64748b;">PDFs are available after you sign in — use Download PDF on the invoice row.</p>
    <p>
      <a href="${base}/login">Sign in to the portal</a>
    </p>
  </div>
`,
  });

  return info;
}

const portalSignInHint =
  "Sign in to the client portal if prompted — links open in your browser, not the raw PDF API.";

/** overdue_invoice — client portal automation */
export async function sendClientOverdueInvoiceEmail({
  to,
  clientName,
  tenantName,
  invoiceId,
  invoiceNumber,
  amountLabel,
  dueDateLabel,
}: {
  to: string;
  clientName: string;
  tenantName: string;
  invoiceId: string;
  invoiceNumber: string;
  amountLabel: string;
  dueDateLabel: string;
}) {
  await transporter.verify();
  const base = portalBaseUrl();
  const invoicesUrl = `${base}/client/invoices`;
  const thisInvoiceUrl = getClientInvoicePortalUrl(invoiceId);
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
    `Open this invoice in the client portal (sign in to download PDF):`,
    thisInvoiceUrl,
    ``,
    `All invoices: ${invoicesUrl}`,
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
      <a href="${thisInvoiceUrl}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open invoice</a>
    </p>
    <p style="font-size: 13px; color: #64748b;">${escapeHtml(portalSignInHint)} Use <strong>Download PDF</strong> on the invoice page.</p>
    <p style="font-size: 13px;">
      <a href="${invoicesUrl}" style="color:#4f46e5;">View all invoices</a>
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
  const subject = `Action needed: ${serviceName}`;
  const noteShort = healthNote.trim().slice(0, 400);
  const actionShort = nextAction.trim().slice(0, 300);
  const text = [
    `Hello ${clientName},`,
    ``,
    `${tenantName} needs a quick update on: ${serviceName}.`,
    actionShort ? `Next step: ${actionShort}` : "",
    noteShort ? `Note: ${noteShort}` : "",
    ``,
    `Open in your client portal:`,
    serviceUrl,
    ``,
    `— ${tenantName}`,
  ]
    .filter(Boolean)
    .join("\n");

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${user}>`,
    replyTo: user ?? undefined,
    to,
    subject,
    text,
    html: `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
    <p>Hello ${escapeHtml(clientName)},</p>
    <p><strong>${escapeHtml(tenantName)}</strong> needs an update on <strong>${escapeHtml(serviceName)}</strong>.</p>
    ${actionShort ? `<p style="margin:0 0 8px;"><strong>Next step:</strong> ${escapeHtml(actionShort)}</p>` : ""}
    ${noteShort ? `<p style="margin:0 0 12px;padding:10px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;font-size:14px;">${escapeHtml(noteShort)}</p>` : ""}
    <p>
      <a href="${serviceUrl}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open in portal</a>
    </p>
    <p style="font-size: 12px; color: #64748b;">${escapeHtml(portalSignInHint)}</p>
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
  const subject = `Reply needed — support`;
  const subjShort = ticketSubject.trim().slice(0, 120) || "Support ticket";
  const text = [
    `Hello ${clientName},`,
    ``,
    `We're waiting for your reply on: ${subjShort}`,
    ``,
    `Reply in the client portal:`,
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
    <p>We're waiting for your <strong>reply</strong> on this ticket:</p>
    <p style="padding:10px 12px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;font-size:14px;"><strong>${escapeHtml(subjShort)}</strong></p>
    <p>
      <a href="${ticketUrl}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reply in portal</a>
    </p>
    <p style="font-size: 12px; color: #64748b;">${escapeHtml(portalSignInHint)}</p>
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
