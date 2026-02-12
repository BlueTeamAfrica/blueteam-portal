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

  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL || "https://portal.blueteamafrica.com";

  const info = await transporter.sendMail({
    from: `"Blue Team Portal" <${process.env.SMTP_USER}>`,
    to,
    subject: "Invoices Generated – Blue Team Africa",
    text: `
Invoices have been generated for Blue Team Africa.

Generated: ${generated}
Skipped: ${skipped}
Errors: ${errors}

Login to the portal: ${portalUrl}/login
  `,
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
        <a href="${portalUrl}/login"
           style="
             display:inline-block;
             padding:10px 16px;
             background:#3b5bdb;
             color:white;
             text-decoration:none;
             border-radius:6px;
             font-weight:bold;
           ">
          Login to Portal
        </a>
      </p>

      <p style="font-size:12px;color:#888;">
        ${portalUrl}/login
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
