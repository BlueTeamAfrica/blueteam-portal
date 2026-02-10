# Quick Start Guide

## 1. Install Dependencies
```bash
cd blueteam-portal
npm install
```

## 2. Set Up Environment Variables
```bash
node setup-env.js
```

This creates the `.env.local` file with your Firebase configuration.

## 3. Firebase Setup

### Enable Authentication
1. Go to Firebase Console → Authentication
2. Click "Get Started" or "Sign-in method"
3. Enable "Email/Password" provider

### Create Firestore Database
1. Go to Firebase Console → Firestore Database
2. Click "Create database"
3. Start in **test mode** (we'll deploy security rules next)
4. Choose a location (e.g., us-central1)

### Deploy Security Rules
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init firestore` (select existing project: blueteam-portal)
4. Deploy rules: `firebase deploy --only firestore:rules`

Or manually copy `firestore.rules` content to Firebase Console → Firestore → Rules

### Create Admin User
1. Go to Firebase Console → Authentication
2. Click "Add user" and create a user with email/password
3. Copy the User UID
4. Go to Firestore Database
5. Create a new document:
   - Collection: `users`
   - Document ID: `{the-user-uid-you-copied}`
   - Fields:
     - `role` (string): `admin`

## 4. Run Development Server
```bash
npm run dev
```

## 5. Access the Portal
- Open http://localhost:3000
- You'll be redirected to `/login`
- Sign in with the admin user you created
- You'll be redirected to `/portal` dashboard

## Troubleshooting

**"User not found in system"**
- Make sure you created the `users/{uid}` document in Firestore with `role: "admin"`

**"Access denied. Admin role required."**
- Check that the user document has `role: "admin"` (not "staff")

**Firebase connection errors**
- Verify `.env.local` exists and has correct values
- Restart the dev server after creating `.env.local`
