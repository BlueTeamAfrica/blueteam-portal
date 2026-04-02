/** Dedupe: invoice doc — legacy overdue email flag; cleared when paid or no longer past due. */
export const INVOICE_OVERDUE_SENT_AT = "clientOverdueNotificationSentAt";
/** Dedupe: invoice doc — overdue email sent once per spell (canonical). */
export const OVERDUE_EMAIL_SENT_AT = "overdueEmailSentAt";
/** Invoice: first time portal/cron marked invoice overdue (optional audit). */
export const OVERDUE_NOTIFIED_AT = "overdueNotifiedAt";
/** Dedupe: service doc — sent once per waiting_client spell; cleared when health changes. */
export const SERVICE_WAITING_CLIENT_SENT_AT = "clientWaitingClientNotificationSentAt";
/** Dedupe: ticket doc — sent once per waiting_client spell; cleared when status changes. */
export const TICKET_REPLY_WAITING_SENT_AT = "clientReplyWaitingNotificationSentAt";
