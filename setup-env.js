#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Firebase web config below is public (shipped to the browser). Server secrets are left blank — fill them in by hand.
const envContent = `# Firebase web config (public)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBnuX5SwPHo7wOWiZybFl6zRLYceyLh3wI
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=blueteam-portal.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blueteam-portal
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=blueteam-portal.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=188069318759
NEXT_PUBLIC_FIREBASE_APP_ID=1:188069318759:web:0fefa7a1a99ae2f39644c2

# Firebase Admin — full service-account JSON on a single line (lib/firebaseAdmin.ts)
FIREBASE_ADMIN_SERVICE_ACCOUNT=

# Shared secret for /api/cron/* (sent as x-cron-secret or Authorization: Bearer)
CRON_SECRET=

# SMTP (lib/mailer.ts). SMTP_SECURE defaults to true only when SMTP_PORT=465.
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

# Base URL for email links. PORTAL_BASE_URL is a fallback if this is unset.
NEXT_PUBLIC_PORTAL_URL=https://portal.blueteamafrica.com
`;

const envPath = path.join(__dirname, '.env.local');

if (fs.existsSync(envPath) && !process.argv.includes('--force')) {
  console.error('❌ .env.local already exists — not overwriting. Re-run with --force to replace it.');
  process.exit(1);
}

try {
  fs.writeFileSync(envPath, envContent);
  console.log('✅ .env.local file created successfully! Fill in FIREBASE_ADMIN_SERVICE_ACCOUNT, CRON_SECRET and SMTP_* before running server routes.');
} catch (error) {
  console.error('❌ Error creating .env.local:', error.message);
  process.exit(1);
}
