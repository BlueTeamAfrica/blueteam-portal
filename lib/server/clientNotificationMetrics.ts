export type NotificationSkipMetrics = {
  alreadyNotified: number;
  missingClientId: number;
  claimNotTaken: number;
  missingEmail: number;
};

export type NotificationChannelMetrics = {
  sent: number;
  failed: number;
  cleared: number;
  skip: NotificationSkipMetrics;
};

export function emptyChannelMetrics(): NotificationChannelMetrics {
  return {
    sent: 0,
    failed: 0,
    cleared: 0,
    skip: { alreadyNotified: 0, missingClientId: 0, missingEmail: 0, claimNotTaken: 0 },
  };
}

export function mergeSkip(into: NotificationSkipMetrics, from: NotificationSkipMetrics) {
  into.alreadyNotified += from.alreadyNotified;
  into.missingClientId += from.missingClientId;
  into.missingEmail += from.missingEmail;
  into.claimNotTaken += from.claimNotTaken;
}
