# Blue Team Portal

Internal client portal for Blue Team Africa.

## Setup Instructions

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
node setup-env.js
```
This will create the `.env.local` file with your Firebase configuration.

Alternatively, manually create `.env.local` with:
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBnuX5SwPHo7wOWiZybFl6zRLYceyLh3wI
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=blueteam-portal.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blueteam-portal
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=blueteam-portal.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=188069318759
NEXT_PUBLIC_FIREBASE_APP_ID=1:188069318759:web:0fefa7a1a99ae2f39644c2
```

3. Set up Firebase:
   - Enable Email/Password authentication in Firebase Console
   - Create Firestore database
   - Deploy security rules from `firestore.rules`
   - Create a user document in Firestore: `users/{uid}` with `role: "admin"`

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Firestore Collections Structure

### users/{uid}
- `role`: "admin" | "staff"

### clients/{clientId}
- `name`: string
- `email`: string
- `phone`: string
- `country`: string
- `status`: "active" | "paused" | "closed"
- `createdAt`: timestamp

### services/{serviceId}
- `clientId`: reference
- `type`: "web-design" | "hosting" | "seo" | "crm"
- `plan`: "Starter" | "Pro" | "Custom"
- `domain`: string
- `hostingProvider`: string
- `emailUsed`: number
- `startDate`: date
- `renewalDate`: date
- `status`: "active" | "expired" | "pending"
- `notes`: string

### invoices/{invoiceId}
- `clientId`: reference
- `amount`: number
- `currency`: string
- `status`: "paid" | "unpaid"
- `dueDate`: date
- `createdAt`: timestamp

## Features

- Secure authentication with Firebase Auth
- Role-based access control (admin only)
- Dashboard with KPIs
- Client management with search and filters
- Service tracking with renewal alerts
- Invoice management
