# Oloja Server - Authentication & Data Models Documentation

## Overview

This document outlines all implemented authentication features, data models, and API endpoints for the Oloja delivery platform. The system supports multi-actor authentication (Users, Businesses, Admins, Riders) with integrated wallet/payment functionality.

---

## 🔐 Authentication Features

### Supported Actor Types

1. **USER** (B2C Customer) - Individual customers
2. **BUSINESS** (B2B Merchant) - Business sellers
3. **ADMIN** - Platform administrators
4. **RIDER** - Delivery partners

### Authentication Methods

#### 1. **Email/Password Registration & Login**

- **Endpoint**: `POST /api/v1/auth/{actor_type}s/register`
- **Endpoint**: `POST /api/v1/auth/{actor_type}s/login`
- **Actor Types**: `clients`, `businesses`, `admins`, `riders`

**Registration Request Body:**

```json
{
  "profile": {
    "first_name": "string",
    "last_name": "string",
    "email": "string",
    "phone_number": "string"
  },
  "password": "string (min 8 chars)",
  "kyc": {
    "bvn": "string (optional)",
    "nin": "string (optional)"
  },
  "saved_locations": [] // Only for users
}
```


<!-- 
USER {
  profile: {
    first_name: 'Obe',
    last_name: 'Rejoice',
    email: 'rejoiceobe235@gmail.com',
    phone_number: '07065694628',
    created_at: 2026-06-01T11:33:30.001Z
  },
  saved_locations: [
    {
      label: 'Home',
      street_address: 'Okeowode',
      city: 'Ogbomoso',
      state: 'Oyo',
      coordinates: [Object],
      plus_code: '',
      access_details: [Object]
    }
  ],
  account_status: 'ACTIVE',
  _id: new ObjectId('6a1d6e09fdde35ca1de34b29'),
  auth: {
    password: 'zIeZ$qwDx8o06Go',
    provider: 'PASSWORD',
    email_verified: false
  },
  id: '6a1d6e09fdde35ca1de34b29'
} undefined
 -->

**Registration Response (201):**

```json
{
  "message": "user/business/admin/rider registered successfully. Verification code sent to email.",
  "data": {
    "actor": {
      /* actor details */
    },
    "wallet": {
      /* wallet details */
    },
    "requires_email_verification": true
  }
}
```

**Login Request Body:**

```json
{
  "email": "string OR phone_number: string OR identifier: string",
  "password": "string"
}
```

**Login Response (200):**

```json
{
  "message": "Login successful",
  "data": {
    "actor": {
      /* actor details */
    },
    "access_token": "string",
    "access_token_expires_in": 3600,
    "refresh_token": "string",
    "refresh_token_expires_at": "ISO date"
  }
}
```

**Requirements:**

- ✅ Valid email address
- ✅ Password (minimum 8 characters)
- ✅ Automatic Monnify virtual account creation
- ✅ Automatic wallet creation
- ✅ Email verification required before login
- ✅ Duplicate prevention (email, phone, public_id)

---

#### 2. **Google OAuth Authentication** (Users Only)

- **Endpoint**: `POST /api/v1/auth/clients/google/register`
- **Endpoint**: `POST /api/v1/auth/clients/google/login`

**Request Body:**

```json
{
  "id_token": "string (Firebase Google ID Token)",
  "user_id": "string (optional - auto-generated if not provided)",
  "phone_number": "string (optional)",
  "profile": {
    "first_name": "string (optional)",
    "last_name": "string (optional)"
  }
}
```

**Features:**

- ✅ Firebase Google ID Token verification
- ✅ Automatic email verification if Google token verified
- ✅ Auto-populate first/last name from Google profile
- ✅ Seamless wallet creation
- ✅ Token issuance on successful registration if email verified
- ✅ Email verification code sent if email not verified

**Response (201):**

```json
{
  "message": "Google client registered/logged in successfully",
  "data": {
    "actor": {
      /* user details */
    },
    "wallet": {
      /* wallet details */
    },
    "requires_email_verification": false,
    "access_token": "string",
    "access_token_expires_in": 3600,
    "refresh_token": "string",
    "refresh_token_expires_at": "ISO date"
  }
}
```

---

#### 3. **Email Verification**

- **Endpoint**: `POST /api/v1/auth/email/verify`
- **Endpoint**: `POST /api/v1/auth/email/resend-code`

**Verify Email Request:**

```json
{
  "subject_type": "USER|BUSINESS|ADMIN|RIDER",
  "public_id": "string (e.g., usr_abc123)",
  "email": "string",
  "code": "string (6-digit verification code)"
}
```

**Response (200/400):**

```json
{
  "message": "Email verified successfully" // or error message
}
```

**Resend Code Request:**

```json
{
  "subject_type": "USER|BUSINESS|ADMIN|RIDER",
  "public_id": "string (optional)",
  "email": "string (optional)"
}
```

**Features:**

- ✅ 6-digit code verification
- ✅ Code expires in 10 minutes
- ✅ Only newest unused code is valid
- ✅ Email verification required for login
- ✅ Prevents login until verified (403 Forbidden)

---

#### 4. **Password Reset**

- **Endpoint**: `POST /api/v1/auth/password/forgot`
- **Endpoint**: `POST /api/v1/auth/password/reset`

**Request Password Reset:**

```json
{
  "subject_type": "USER|BUSINESS|ADMIN|RIDER",
  "email": "string"
}
```

**Response (200):**

```json
{
  "message": "If that email exists, a password reset link has been sent"
}
```

**Reset Password Request:**

```json
{
  "token": "string (from reset link)",
  "password": "string (min 8 chars)"
}
```

**Response (200):**

```json
{
  "message": "Password reset successful"
}
```

**Features:**

- ✅ Reset tokens expire in 15 minutes
- ✅ One-time use tokens (marked as used after reset)
- ✅ All active refresh tokens revoked on password reset
- ✅ Generic success response (prevents email enumeration)
- ✅ Reset link contains token and subject_type

---

#### 5. **Session Management (Token Refresh)**

- **Endpoint**: `POST /api/v1/auth/refresh`

**Request (body or cookie):**

```json
{
  "refresh_token": "string (optional - read from cookie if not provided)"
}
```

**Response (200):**

```json
{
  "message": "Session refreshed",
  "data": {
    "access_token": "string",
    "access_token_expires_in": 3600,
    "refresh_token": "string (except for admins)",
    "refresh_token_expires_at": "ISO date"
  }
}
```

**Features:**

- ✅ Refresh Token Rotation (RTR) - token replaced on each refresh
- ✅ Admin refresh tokens stored in HTTP-only cookies
- ✅ Token family tracking for rotation validation
- ✅ Device/IP/User-Agent tracking

---

#### 6. **Logout**

- **Endpoint**: `POST /api/v1/auth/logout`

**Request:**

```json
{
  "refresh_token": "string (optional)"
}
```

**Response (200):**

```json
{
  "message": "Logged out successfully"
}
```

**Features:**

- ✅ Revokes refresh token with "LOGOUT" reason
- ✅ Clears admin refresh cookie
- ✅ Works without refresh token

---

## 📊 Data Models

### 1. **User Model** (`user.model.js`)

Represents B2C customers and B2B merchants.

**Structure:**

```javascript
{
  user_id: String (unique public ID: usr_xxxxx),
  account_type: "B2B_MERCHANT" | "B2C_CUSTOMER" | "ADMIN",

  profile: {
    first_name: String,
    last_name: String,
    business_name: String (B2B only),
    email: String (unique),
    phone_number: String,
    created_at: Date
  },

  auth: {
    password: String (hashed with bcrypt),
    provider: "PASSWORD" | "GOOGLE",
    firebase_uid: String (unique, sparse),
    email_verified: Boolean,
    email_verified_at: Date,
    password_changed_at: Date,
    last_login_at: Date
  },

  saved_locations: [{
    location_id: String,
    label: String,
    street_address: String,
    city: String,
    state: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
      altitude_meters: Number
    },
    plus_code: String,
    access_details: {
      floor: String,
      unit_number: String,
      gate_code: String,
      courier_instructions: String
    }
  }],

  b2b_config: {
    wallet: ObjectId (ref: Wallet),
    wallet_id: String,
    preferred_billing_cycle: "PREPAID_WALLET" | "POSTPAID_INVOICE"
  },

  account_status: "ACTIVE" | "SUSPENDED" | "DELETED",
  delivery_wallet: ObjectId (ref: Wallet)
}
```

---

### 2. **Business Model** (`business.model.js`)

Represents B2B sellers/service providers.

**Structure:**

```javascript
{
  business_id: String (unique: bus_xxxxx),
  name: String,
  business_type: String,

  contact_email: String (unique),
  phone_number: String,

  services: [{
    service_id: String,
    name: String,
    category: "LAUNDRY"|"RESTAURANT"|"PICKUP_DELIVERY"|"GROCERY"|"PHARMACY"|"RETAIL"|"OTHER",
    description: String,
    is_active: Boolean,
    base_price: Number
  }],

  locations: [{
    location_id: String,
    label: String,
    street_address: String,
    city: String,
    state: String,
    country: String,
    coordinates: {
      type: "Point",
      coordinates: [longitude, latitude]
    },
    plus_code: String,
    is_primary: Boolean
  }],

  working_hours: [{
    day: "MONDAY"|"TUESDAY"|...|"SUNDAY",
    is_open: Boolean,
    opens_at: "HH:mm" (24-hour format),
    closes_at: "HH:mm" (24-hour format),
    break_start: "HH:mm" (optional),
    break_end: "HH:mm" (optional)
  }],

  auth: {
    password: String (hashed),
    provider: "PASSWORD",
    email_verified: Boolean,
    email_verified_at: Date,
    password_changed_at: Date,
    last_login_at: Date
  },

  bank_info: {
    account_name: String,
    account_number: String,
    bank_code: String,
    bank_name: String
  },

  kyc_info: {
    bvn: String,
    nin: String,
    verification_status: "PENDING"|"VERIFIED"|"REJECTED"
  },

  status: "ACTIVE" | "SUSPENDED" | "DELETED",
  wallet: ObjectId (ref: Wallet)
}
```

---

### 3. **Admin Model** (`admin.model.js`)

Represents platform administrators with role-based access.

**Structure:**

```javascript
{
  admin_id: String (unique: adm_xxxxx),

  profile: {
    full_name: String,
    email: String (unique),
    phone_number: String (unique),
    avatar_url: String
  },

  employment: {
    staff_id: String (unique),
    job_title: String,
    date_joined: Date,
    employment_status: "FULL_TIME"|"PART_TIME"|"CONTRACT"
  },

  auth: {
    password: String (required),
    email_verified: Boolean,
    email_verified_at: Date,
    password_changed_at: Date,
    last_login_at: Date,
    mfa_enabled: Boolean
  },

  role: "DISPATCHER"|"ACCOUNTANT"|"COORDINATOR"|"SUPER_ADMIN",
  permissions: Array of permission strings,

  access_scope: {
    business_ids: [String],
    service_categories: Array,
    max_daily_transactions_ngn: Number,
    ip_whitelist: [String]
  },

  status: "ACTIVE" | "INACTIVE" | "SUSPENDED"
}
```

**Available Permissions:**

- MANAGE_ADMINS
- MANAGE_BUSINESSES
- MANAGE_RIDERS
- ASSIGN_ORDERS
- VIEW_ORDERS
- UPDATE_ORDER_STATUS
- VIEW_WALLETS
- MANAGE_WALLETS
- VIEW_TRANSACTIONS
- MANAGE_PAYOUTS
- VIEW_REPORTS
- MANAGE_SETTINGS

---

### 4. **Rider Model** (`rider.model.js`)

Represents delivery partners.

**Structure:**

```javascript
{
  rider_id: String (unique: rdr_xxxxx),

  personal_info: {
    full_name: String,
    email: String (unique, sparse),
    phone_number: String (unique),
    emergency_contact: String,
    blood_group: "A+"|"A-"|"B+"|"B-"|"AB+"|"AB-"|"O+"|"O-"
  },

  employment_details: {
    employment_status: "FULL_TIME"|"PART_TIME"|"CONTRACT",
    base_daily_salary: Number,
    date_joined: Date
  },

  assigned_asset: {
    vehicle_id: String (unique),
    vehicle_type: "MOTORCYCLE"|"BICYCLE"|"CAR"|"VAN"|"TRICYCLE",
    license_plate: String (unique),
    tracker_device_id: String (unique)
  },

  live_telemetry: {
    current_status: "AVAILABLE"|"DELIVERING"|"OFFLINE"|"ON_BREAK",
    last_coordinates: {
      latitude: Number,
      longitude: Number,
      altitude_meters: Number,
      heading_degrees: Number (0-360),
      speed_kmh: Number
    },
    current_active_order_id: String,
    last_ping_time: Date
  },

  daily_performance: {
    date: Date,
    trips_completed_today: Number,
    kilometers_traveled_today: Number,
    fuel_allowance_allocated_ngn: Number
  },

  auth: {
    password: String,
    email_verified: Boolean,
    email_verified_at: Date,
    password_changed_at: Date,
    last_login_at: Date
  },

  status: "ACTIVE" | "SUSPENDED" | "ON_LEAVE" | "DELETED"
}
```

---

### 5. **Wallet Model** (`wallet.model.js`)

Payment wallet for all actor types with Monnify integration.

**Structure:**

```javascript
{
  wallet_id: String (unique: wlt_xxxxx),

  owner_type: "USER"|"BUSINESS"|"ADMIN"|"RIDER",
  owner_model: "User"|"Business"|"Admin"|"Rider",
  owner: ObjectId (polymorphic ref),
  owner_id: String (public ID),

  business: ObjectId (ref: Business, unique, sparse),
  business_id: String,

  virtual_account_number: String (unique, NUBAN),
  bank_name: String,
  currency: "NGN",
  current_balance: Number (min 0),

  monnify: {
    account_reference: String (unique),
    reservation_reference: String,
    account_name: String,
    bank_code: String,
    contract_code: String,
    customer_email: String,
    customer_name: String,
    reserved_account_type: String,
    collection_channel: String,
    raw_response: Object
  },

  status: "ACTIVE"|"INACTIVE"|"SUSPENDED",
  last_updated_at: Date,

  // Virtual: transactions (ref: WalletTransaction)
}
```

**Unique Indexes:**

- `{owner_type, owner_id}` - One wallet per owner
- `{business_id}` - One wallet per business
- `{monnify.account_reference}` - Unique Monnify account

---

### 6. **Wallet Transaction Model** (`walletTransaction.model.js`)

Records all wallet transactions (credits/debits).

**Structure:**

```javascript
{
  transaction_id: String (unique: txn_xxxxx),
  wallet: ObjectId (ref: Wallet),
  wallet_id: String,

  transaction_type: "CREDIT"|"DEBIT",
  amount: Number (min 0),
  balance_before: Number,
  balance_after: Number,

  reference_code: String (unique, idempotency key),
  description: String,
  order_id: String (optional),
  metadata: Object (flexible),
  created_at: Date
}
```

---

### 7. **Refresh Token Model** (`refreshToken.model.js`)

Manages refresh token lifecycle with rotation.

**Structure:**

```javascript
{
  subject_type: "USER"|"BUSINESS"|"ADMIN"|"RIDER",
  subject_model: "User"|"Business"|"Admin"|"Rider",
  subject: ObjectId (polymorphic ref),
  subject_public_id: String,

  token_hash: String (unique, SHA256),
  family_id: String (groups rotated tokens),
  replaced_by_token_hash: String (points to new token),

  device_info: String,
  ip_address: String,
  user_agent: String,

  expires_at: Date,
  revoked_at: Date,
  revoked_reason: String,
  last_used_at: Date,

  timestamps: true
}
```

**Features:**

- ✅ Refresh Token Rotation (RTR) - family_id tracks lineage
- ✅ Token chain validation
- ✅ Reuse detection (token replay attacks)

---

### 8. **Password Reset Token Model** (`passwordResetToken.model.js`)

One-time password reset tokens.

**Structure:**

```javascript
{
  subject_type: "USER"|"BUSINESS"|"ADMIN"|"RIDER",
  subject_model: "User"|"Business"|"Admin"|"Rider",
  subject: ObjectId (polymorphic ref),
  subject_public_id: String,

  token_hash: String (unique, SHA256),
  email: String (indexed),
  expires_at: Date,
  used_at: Date (marks as used),

  ip_address: String,
  user_agent: String,

  timestamps: true
}
```

**Features:**

- ✅ 15-minute expiration
- ✅ One-time use validation
- ✅ Prevents reuse

---

### 9. **Email Verification Code Model** (`emailVerificationCode.model.js`)

6-digit email verification codes.

**Structure:**

```javascript
{
  subject_type: "USER"|"BUSINESS"|"ADMIN"|"RIDER",
  subject_model: "User"|"Business"|"Admin"|"Rider",
  subject: ObjectId (polymorphic ref),
  subject_public_id: String,

  email: String,
  code_hash: String (SHA256, not stored as plaintext),
  expires_at: Date,
  used_at: Date,

  ip_address: String,
  user_agent: String,

  timestamps: true
}
```

**Features:**

- ✅ 10-minute expiration
- ✅ Only newest unused code is valid
- ✅ Previous codes auto-marked as used on new code generation

---

### 10. **Monnify Webhook Event Model** (`monnifyWebhookEvent.model.js`)

Tracks payment webhook events.

**Structure:**

```javascript
{
  event_reference: String (unique),
  event_type: String,
  payment_reference: String,
  transaction_reference: String,
  wallet: ObjectId (ref: Wallet),

  processing_status: "RECEIVED"|"PROCESSED"|"IGNORED"|"FAILED",
  raw_payload: Object,
  error_message: String,
  processed_at: Date,

  timestamps: true
}
```

---

## 🔄 Authentication Flow Diagram

### Registration Flow

```
1. Client submits registration (email, password, profile data)
2. Validation checks (duplicate check by email/phone/public_id)
3. Monnify virtual account reserved
4. Actor saved to database
5. Wallet created from Monnify account
6. Email verification code sent
7. Response: actor, wallet, requires_email_verification=true
8. Client must verify email before login
```

### Login Flow

```
1. Client submits email/phone and password
2. Find actor by email or phone
3. Compare password hash
4. Check account status (ACTIVE)
5. Check email_verified (required)
6. Update last_login_at
7. Issue access & refresh tokens
8. Store refresh token hash
9. Response: tokens, actor data
10. Admin: refresh token in HTTP-only cookie
```

### Email Verification Flow

```
1. System generates 6-digit code
2. Code hashed and stored
3. Email sent with code
4. User submits code via API
5. Hash comparison
6. Mark verification code as used
7. Update actor.auth.email_verified
8. Now eligible for login
```

### Password Reset Flow

```
1. User requests reset (email only)
2. Find actor by email
3. Generate random reset token
4. Hash token and store
5. Email reset link with raw token
6. User clicks link (frontend redirects with token)
7. User submits new password + token
8. Validate token (hash, expiry, unused)
9. Update actor password
10. Mark token as used
11. Revoke all active refresh tokens (force re-login)
```

### Token Refresh Flow

```
1. Client sends refresh token
2. Hash and lookup token record
3. Validate: not revoked, not expired
4. Generate NEW refresh token
5. Mark old token as replaced_by
6. Issue new access & refresh tokens
7. Store new token family
8. Admin: set new refresh token in cookie
9. Response: new tokens
```

---

## 🛡️ Security Features

### Authentication Security

- ✅ **Password Hashing**: bcryptjs with salt rounds
- ✅ **Token Hashing**: SHA256 (tokens never stored plaintext)
- ✅ **Email Verification**: 6-digit OTP (10-min expiry)
- ✅ **Refresh Token Rotation (RTR)**: Every refresh generates new token
- ✅ **Token Family Tracking**: Detect token replay attacks
- ✅ **One-Time Tokens**: Password reset & email codes
- ✅ **Expiration**: Access (1hr), Refresh (7/30 days), Reset (15min), Email Code (10min)

### Data Protection

- ✅ **Unique Constraints**: Email, phone, public_id
- ✅ **Soft Deletes**: account_status/status fields (ACTIVE/SUSPENDED/DELETED)
- ✅ **Password Protection**: Select false - not returned by default
- ✅ **Device/IP Tracking**: For refresh tokens and reset codes

### Admin Security

- ✅ **HTTP-Only Cookies**: Refresh tokens stored securely
- ✅ **Role-Based Access Control (RBAC)**: Multiple admin roles with specific permissions
- ✅ **Access Scoping**: Business IDs, service categories, transaction limits
- ✅ **IP Whitelisting**: Optional per-admin

### Wallet Security

- ✅ **Polymorphic Ownership**: Wallets support multiple owner types
- ✅ **Virtual Accounts**: Monnify integration for unique NUBANs
- ✅ **Balance Tracking**: balance_before/after on transactions
- ✅ **Idempotency**: reference_code prevents duplicate transactions
- ✅ **Webhook Verification**: Monnify events tracked with processing status

---

## 📋 API Endpoints Summary

### Authentication Endpoints

| Method | Endpoint                        | Description               |
| ------ | ------------------------------- | ------------------------- |
| POST   | `/auth/clients/register`        | Register user             |
| POST   | `/auth/clients/login`           | Login user                |
| POST   | `/auth/clients/google/register` | Register with Google      |
| POST   | `/auth/clients/google/login`    | Login with Google         |
| POST   | `/auth/businesses/register`     | Register business         |
| POST   | `/auth/businesses/login`        | Login business            |
| POST   | `/auth/admins/register`         | Register admin            |
| POST   | `/auth/admins/login`            | Login admin               |
| POST   | `/auth/riders/register`         | Register rider            |
| POST   | `/auth/riders/login`            | Login rider               |
| POST   | `/auth/email/verify`            | Verify email with code    |
| POST   | `/auth/email/resend-code`       | Resend verification code  |
| POST   | `/auth/password/forgot`         | Request password reset    |
| POST   | `/auth/password/reset`          | Reset password with token |
| POST   | `/auth/refresh`                 | Refresh access token      |
| POST   | `/auth/logout`                  | Logout and revoke token   |

---

## 📝 Environment Variables Required

```env
# Firebase
FIREBASE_PROJECT_ID=xxxx
FIREBASE_PRIVATE_KEY=xxxx
FIREBASE_CLIENT_EMAIL=xxxx

# Monnify Payment
MONNIFY_API_KEY=xxxx
MONNIFY_SECRET_KEY=xxxx
MONNIFY_CONTRACT_CODE=xxxx
MONNIFY_BASE_URL=https://api.monnify.com

# Email Service (Nodemailer)
EMAIL_FROM=no-reply@oloja.com
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=xxxx
EMAIL_PASSWORD=xxxx

# Frontend URLs
FRONTEND_PASSWORD_RESET_URL=http://localhost:3000/reset-password
PASSWORD_RESET_URL=http://localhost:3000/reset-password

# Database
MONGODB_URI=mongodb://...

# Server
NODE_ENV=development|production
PORT=5000
```

---

## 🚀 How to Run Features

### 1. Start the Server

```bash
npm install
npm run dev
```

### 2. Test User Registration (Email/Password)

```bash
curl -X POST http://localhost:5000/api/v1/auth/clients/register \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "phone_number": "+2348012345678"
    },
    "password": "SecurePass123!"
  }'
```

### 3. Test Google Registration

```bash
curl -X POST http://localhost:5000/api/v1/auth/clients/google/register \
  -H "Content-Type: application/json" \
  -d '{
    "id_token": "GOOGLE_ID_TOKEN_HERE",
    "phone_number": "+2348012345678"
  }'
```

### 4. Test Login

```bash
curl -X POST http://localhost:5000/api/v1/auth/clients/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123!"
  }'
```

### 5. Test Email Verification

```bash
curl -X POST http://localhost:5000/api/v1/auth/email/verify \
  -H "Content-Type: application/json" \
  -d '{
    "subject_type": "USER",
    "email": "john@example.com",
    "code": "123456"
  }'
```

### 6. Test Password Reset

```bash
# Step 1: Request reset
curl -X POST http://localhost:5000/api/v1/auth/password/forgot \
  -H "Content-Type: application/json" \
  -d '{
    "subject_type": "USER",
    "email": "john@example.com"
  }'

# Step 2: Reset with token (token sent via email)
curl -X POST http://localhost:5000/api/v1/auth/password/reset \
  -H "Content-Type: application/json" \
  -d '{
    "token": "TOKEN_FROM_EMAIL",
    "password": "NewSecurePass456!"
  }'
```

### 7. Test Token Refresh

```bash
curl -X POST http://localhost:5000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "REFRESH_TOKEN_FROM_LOGIN"
  }'
```

### 8. Test Logout

```bash
curl -X POST http://localhost:5000/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "REFRESH_TOKEN"
  }'
```

---

## ✅ Key Features Implemented

### Registration

- [x] Email/password registration for all actor types
- [x] Google OAuth registration (users only)
- [x] Automatic Monnify virtual account creation
- [x] Automatic wallet creation
- [x] Email verification code generation and sending
- [x] Duplicate prevention (email, phone, public_id)
- [x] Profile data validation

### Authentication

- [x] Email/password login for all actor types
- [x] Google OAuth login (users only)
- [x] Email verification requirement before login
- [x] Password comparison with bcrypt
- [x] Account status checking (ACTIVE/SUSPENDED)
- [x] Last login timestamp tracking
- [x] Login identifier flexibility (email or phone)

### Email Verification

- [x] 6-digit verification code generation
- [x] Email sending with code
- [x] 10-minute expiration
- [x] One-time use enforcement
- [x] Code resend functionality
- [x] Email verification blocking login

### Password Management

- [x] Password reset request (forgot password)
- [x] Reset link generation with token
- [x] 15-minute reset token expiration
- [x] One-time token enforcement
- [x] Password update on reset
- [x] All refresh tokens revoked after reset
- [x] Generic success response (prevents email enumeration)

### Session Management

- [x] Access token issuance (JWT-based)
- [x] Refresh token issuance
- [x] Refresh token rotation (RTR)
- [x] Token family tracking
- [x] Token expiration validation
- [x] Admin refresh token cookie storage
- [x] Logout with token revocation

### Security

- [x] Password hashing with bcryptjs
- [x] Token hashing (SHA256)
- [x] HTTP-only cookie support for admins
- [x] Device/IP tracking on tokens
- [x] Email verification requirement
- [x] Duplicate account prevention
- [x] Account status enforcement

### Data Models

- [x] User model (B2C/B2B support)
- [x] Business model
- [x] Admin model (RBAC with permissions)
- [x] Rider model (with telemetry)
- [x] Wallet model (polymorphic)
- [x] Wallet transaction model
- [x] Refresh token model (with rotation)
- [x] Password reset token model
- [x] Email verification code model
- [x] Monnify webhook event model

---

## 📚 Additional Notes

### Public ID Format

- USER: `usr_XXXXXX` (6 random hex chars)
- BUSINESS: `bus_XXXXXX`
- ADMIN: `adm_XXXXXX`
- RIDER: `rdr_XXXXXX`
- WALLET: `wlt_XXXXXX`
- TRANSACTION: `txn_XXXXXX`

### Actor Config

The system uses actor configuration objects to handle differences between actor types:

- `publicIdField`: Field name for public ID (user_id, business_id, etc.)
- `emailPath`: Path to email in document (profile.email, contact_email, etc.)
- `phonePath`: Path to phone in document
- Methods: `name()`, `email()`, `accountName()`

### Polymorphic References

Used in RefreshToken, PasswordResetToken, EmailVerificationCode, and Wallet models:

- `subject_type`: Human-readable type (USER, BUSINESS, ADMIN, RIDER)
- `subject_model`: MongoDB model name (User, Business, Admin, Rider)
- `subject`: ObjectId reference (refPath uses subject_model)

### Error Handling

- 400: Bad request (missing fields, validation errors)
- 401: Unauthorized (invalid credentials, token required)
- 403: Forbidden (email not verified, account not active)
- 404: Not found (account doesn't exist)
- 409: Conflict (duplicate email/phone/public_id)
- 500: Server error

---

## 🔗 Related Services

- **Firebase Service**: Google ID token verification
- **Token Service**: JWT generation, refresh token rotation
- **Monnify Service**: Virtual account creation
- **Wallet Service**: Wallet creation from Monnify accounts
- **Email Service**: Verification code and password reset emails

---

_Documentation generated for Oloja Server v1.0.0_
