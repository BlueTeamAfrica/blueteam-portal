#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const envContent = `NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBnuX5SwPHo7wOWiZybFl6zRLYceyLh3wI
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=blueteam-portal.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blueteam-portal
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=blueteam-portal.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=188069318759
NEXT_PUBLIC_FIREBASE_APP_ID=1:188069318759:web:0fefa7a1a99ae2f39644c2
`;

const envPath = path.join(__dirname, '.env.local');

try {
  fs.writeFileSync(envPath, envContent);
  console.log('✅ .env.local file created successfully!');
} catch (error) {
  console.error('❌ Error creating .env.local:', error.message);
  process.exit(1);
}
