# Selaro — AI Receptionist for Dental Clinics

Live AI-powered phone receptionist for German dental clinic "Zahnarztpraxis Stela Xhelili – Karli 1 Leipzig"

## Overview

This application provides a **fully functional AI receptionist** that answers phone calls via Twilio, holds natural German conversations using OpenAI GPT-4, extracts patient information, and automatically creates leads in Supabase. The system uses the clinic's specific instructions from Supabase to personalize responses.

## Tech Stack

- **Backend**: Node.js with Express (ESM modules)
- **AI**: OpenAI GPT-4o-mini for conversational intelligence
- **Phone**: Twilio Voice API with German TwiML (Polly.Marlene voice)
- **Database**: Supabase (PostgreSQL) for lead storage and clinic configuration
- **Deployment**: Replit → selaro.app

## Environment Variables (Required)

**IMPORTANT: Fix the typo in your environment variables!**
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Correct
- ✅ `OPENAI_API_KEY` - Correct
- ✅ `CLINIC_ID` - Correct (bc91d95c-a05c-4004-b932-bc393f0391b6)
- ⚠️ `SUPARBASE_URL` - **TYPO!** Should be `SUPABASE_URL` (add the missing 'B')

The code checks for both spellings as a fallback, but please fix the environment variable name to `SUPABASE_URL` in Replit Secrets.

## AI Receptionist Flow

### 1. Incoming Call → Twilio Webhook
When a patient calls the dental clinic's Twilio number, Twilio sends a POST request to:
```
POST https://selaro.app/api/twilio/voice/step
```

### 2. AI Conversation Management
- **Conversation State**: Stored in-memory per `CallSid` with message history
- **Clinic Instructions**: Fetched from Supabase `clinics` table for clinic ID `bc91d95c-a05c-4004-b932-bc393f0391b6`
- **OpenAI Integration**: GPT-4o-mini generates natural German responses (max 150 tokens, short and conversational)
- **Data Collection**: AI gathers name, concern, insurance, and preferred appointment time
- **Turn Limit**: Max 4 conversation turns (8 messages) to keep calls brief

### 3. Conversation End & Lead Creation
When the conversation ends (goodbye keywords or max turns), the system:
1. Extracts structured data using OpenAI with `response_format: json_object`
2. Saves lead to Supabase `leads` table with:
   - `call_sid`, `name`, `phone`, `concern`, `urgency`, `insurance`, `preferred_slots`, `notes`, `status`
3. Cleans up conversation state from memory
4. Hangs up with a friendly German goodbye

## Database Tables

### leads
Main table for storing patient leads created from calls.

**Columns:**
- `id` (uuid, primary key)
- `call_sid` (text) - Twilio call identifier
- `name` (text) - Patient name
- `phone` (text) - Patient phone number
- `concern` (text) - Reason for visit
- `urgency` (text) - "urgent" or "normal"
- `insurance` (text) - Insurance type
- `preferred_slots` (jsonb) - Preferred appointment times
- `notes` (text) - Additional notes
- `status` (text) - Lead status (default: "new")
- `created_at` (timestamptz) - When lead was created

### messages_log
**Debug/logging table** for tracking conversation flow.

**Columns:**
- `id` (uuid, primary key)
- `call_sid` (text) - Twilio call identifier
- `role` (text) - "user" or "assistant"
- `message` (text) - Message content
- `created_at` (timestamptz) - When message was logged

**Note:** After creating this table, Supabase's PostgREST schema cache may take a few minutes to refresh. Logging will start working automatically once the cache updates. You can manually refresh it in your Supabase dashboard under Settings → API → Reload schema cache.

### clinics
Configuration table for clinic information.

**Columns:**
- `id` (uuid, primary key)
- `name` (text) - Clinic name
- `phone_number` (text) - Clinic phone
- `instructions` (text) - AI receptionist instructions
- `created_at` (timestamptz)

## API Routes

### Core Routes

#### GET /
Homepage with information about Selaro AI Receptionist.

#### GET /leads
**Dark-themed German dashboard** displaying the last 50 leads from Supabase with:
- Date, Name, Phone, Concern, Urgency, Insurance, Status
- "Akut" red tag for urgent cases
- Green status badges
- Direct link back to homepage

### Debug & Testing Routes

#### GET /debug/status
Returns server status information including uptime and configured port.

**Response:**
```json
{
  "ok": true,
  "uptime": 123.456,
  "envPort": "5000"
}
```

#### POST /debug/test-ai
Test the AI conversation logic without Twilio.

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Ich habe Zahnschmerzen" }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "aiResponse": "AI's German response",
  "extractedData": {
    "name": "Extracted name",
    "concern": "Extracted concern",
    "urgency": "urgent" or "normal",
    "insurance": "privat" or "gesetzlich",
    "preferredSlots": "Extracted time"
  },
  "clinicInstructions": "First 100 chars...",
  "conversationLength": 1
}
```

#### GET /debug/env-keys
Lists which environment variables are configured (values hidden).

#### POST /debug/create-test-lead
Creates a test lead in Supabase for testing purposes.

#### GET /debug/list-leads
Returns the last 10 leads from Supabase in JSON format.

### POST /api/calls/log
Logs a new call from the simulation modal.

**Request Body:**
```json
{
  "name": "string",
  "phone": "string", 
  "service": "string",
  "preferredTime": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "saved": {
    "id": "uuid",
    "name": "string",
    "phone": "string",
    "service": "string",
    "preferredTime": "string",
    "status": "New",
    "createdAt": "ISO timestamp"
  },
  "count": number
}
```

### GET /api/calls/all
Retrieves all logged calls.

**Response:**
```json
{
  "ok": true,
  "rows": [
    {
      "id": "uuid",
      "name": "string",
      "phone": "string",
      "service": "string",
      "preferredTime": "string",
      "status": "New" | "Called" | "Booked",
      "createdAt": "ISO timestamp"
    }
  ]
}
```

### POST /api/twilio/voice/step
**AI-Powered Twilio Voice Entry Point** - First endpoint called when a patient phones the clinic.

**Content-Type:** `application/x-www-form-urlencoded`

**Request Body (form-encoded):**
- `CallSid` - Twilio call identifier (required)
- `From` - Caller's phone number

**Behavior:**
1. Initializes conversation state for the call
2. Fetches clinic-specific instructions from Supabase `clinics` table
3. Greets caller: "Guten Tag! Zahnarztpraxis Xhelili, wie kann ich Ihnen helfen?"
4. Redirects to `/api/twilio/voice/next` for AI conversation

**Response:** TwiML XML with German greeting

### POST /api/twilio/voice/next
**AI-Powered Conversation Handler** - Manages multi-turn conversations with OpenAI.

**Content-Type:** `application/x-www-form-urlencoded`

**Request Body (form-encoded):**
- `CallSid` - Twilio call identifier (required)
- `From` - Caller's phone number
- `SpeechResult` - (optional) Transcribed speech from caller

**Behavior:**
1. **Conversation Management**:
   - Adds user speech to conversation history
   - Calls OpenAI GPT-4o-mini for intelligent response
   - Stores assistant response in history
   - Limits conversation to max 4 turns (8 messages)

2. **Conversation End Triggers**:
   - Max 8 messages reached
   - User says goodbye keywords ("danke", "tschüss", "auf wiedersehen")

3. **When Ending**:
   - Extracts structured data (name, concern, urgency, insurance, preferred time) using OpenAI
   - Saves lead to Supabase via `createLeadFromCall()`
   - Says final goodbye in German
   - Hangs up
   - Cleans up conversation state

4. **When Continuing**:
   - Generates AI response using clinic instructions
   - Gathers next user input
   - Loops back to this endpoint

**Lead Data Extraction:**
Uses OpenAI with `response_format: json_object` to extract:
- `name`: Patient name or "Unbekannt"
- `concern`: Brief description of issue
- `urgency`: "urgent" if pain mentioned, otherwise "normal"
- `insurance`: "privat", "gesetzlich", or null
- `preferredSlots`: Preferred appointment time or "unbekannt"

**State Management:**
- Conversation state stored in-memory per `CallSid`
- State includes: message history, clinic instructions
- State cleaned up after call ends
- State is automatically deleted after call completion

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "ok": true
}
```

### GET /debug/status
Debug endpoint to check environment variables and Supabase connection status.

**Response:**
```json
{
  "ok": true,
  "environment": {
    "SUPABASE_URL": false,
    "SUPABASE_ANON_KEY": false,
    "OPENAI_API_KEY": true,
    "TWILIO_ACCOUNT_SID": false,
    "TWILIO_AUTH_TOKEN": false,
    "TWILIO_FROM": false
  },
  "supabase": {
    "configured": false,
    "leadsTableExists": false,
    "error": null
  }
}
```

### POST /debug/lead-test
Debug endpoint to test Supabase lead insertion with test data.

**Response (Success):**
```json
{
  "ok": true,
  "message": "Test lead saved successfully",
  "testData": {
    "call_sid": "test-1234567890",
    "name": "Max Mustermann",
    "phone": "+49123456789",
    "concern": "Zahnreinigung",
    "urgency": "normal",
    "insurance": "AOK",
    "preferred_slots": "morgen um 10:00",
    "notes": "Test lead created via debug endpoint",
    "status": "new"
  }
}
```

**Response (Error - Supabase not configured):**
```json
{
  "ok": false,
  "error": "supabase-missing",
  "message": "Failed to save test lead"
}
```

## Supabase Integration

### Configuration
The application supports Supabase for lead storage. Set these environment variables:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous/public key

### saveLead() Helper Function
Located in `server/routes.ts`, this function stores leads in the `leads` table:

```typescript
await saveLead({
  call_sid: "twilio-call-sid",
  name: "Patient Name",
  phone: "+49123456789",
  concern: "Zahnreinigung",
  urgency: "normal",
  insurance: "AOK",
  preferred_slots: "morgen um 10:00",
  notes: "Additional notes",
  status: "new"
});
```

### Database Schema
The `leads` table should have these columns:
- `call_sid` (text, nullable)
- `name` (text, nullable)
- `phone` (text, nullable)
- `concern` (text, nullable)
- `urgency` (text, nullable)
- `insurance` (text, nullable)
- `preferred_slots` (jsonb, nullable) - Stores as `{raw: string}`
- `notes` (text, nullable)
- `status` (text, default: "new")

## Features

### 1. Hero Section
- Gradient background with animated mint "blobs"
- Large, bold headline
- Two CTA buttons: "Simulate a Call" and "See Dashboard Preview"
- Smooth scroll to dashboard on second CTA click

### 2. How It Works
- Three feature cards explaining the AI receptionist flow
- Numbered steps with icons
- Clean card design with mint accents

### 3. Call Simulation Modal
- Interactive demo with AI/patient chat transcript
- Audio waveform placeholder
- Editable form fields (prefilled with German example data)
- POST to API on "End Demo & Log" button
- Toast notification on success

### 4. Dashboard Preview
- Real-time table of logged calls
- Status badges (New, Called, Booked)
- Refresh button to reload data from API
- Responsive table design

### 5. Connect Your Clinic
- Three integration cards (Twilio, FAQ Upload, WhatsApp)
- "Coming Soon" badges
- Disabled state with appropriate styling

### 6. Footer
- Minimal design with mint accent line
- Credits: "Built by Ardit · Powered by GPT-5, Twilio, Botpress"

## Design System

### Colors
- **Primary (Mint)**: #00C896
- **Secondary**: #10B981
- **Soft Mint**: #A7F3D0
- **Background**: #F9FAFB
- **Text**: #111827
- **Muted Text**: #6B7280

### Typography
- Font: Inter (from Google Fonts)
- Headings: Bold, large sizes (5xl-8xl)
- Body: Light to normal weight (text-base to text-xl)

### Spacing
- Generous vertical spacing (py-24, py-32)
- Max width: 1200px (max-w-7xl)
- Consistent padding (px-6, px-8)

## Current State

✅ Fully functional UI with mint design
✅ API routes implemented with validation
✅ In-memory storage
✅ Client-side state management with API integration
✅ Toast notifications
✅ Form validation
✅ Loading states

## Next Steps (Not Implemented)

- Database integration (replace in-memory storage)
- Real Twilio integration
- FAQ upload and management
- WhatsApp integration
- Authentication system
- Admin dashboard with CRUD operations
- Real AI integration (GPT-5, Botpress)

## Running the Project

The workflow "Start application" runs `npm run dev` which:
1. Starts the Express server on port 5000 (development)
2. Starts the Vite dev server
3. Serves frontend and backend on the same port

## Deployment

The application is configured for Replit Deployments and custom domains (selaro.app):

- **Port Handling**: The server uses `process.env.PORT || 5000`, allowing Replit Deployments to assign the correct port dynamically
- **Root Route**: `GET /` returns a simple message confirming the service is live
- **Health Checks**: Both `/debug/status` and `/health` endpoints available for monitoring
- **Custom Domain**: Ready to deploy to selaro.app via Replit Deployments

To deploy:
1. Click "Deploy" in Replit
2. Configure custom domain (selaro.app) in deployment settings
3. All environment variables (SUPABASE_URL, OPENAI_API_KEY, etc.) are automatically carried over

## Notes

- All data is stored in memory and will be lost on server restart
- The call simulation uses placeholder transcript data
- Form fields are prefilled with German example data (Anna Müller)
- Status defaults to "New" for all new calls
- Timestamps are automatically generated
