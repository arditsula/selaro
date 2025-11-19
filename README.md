# Selaro — AI Receptionist for Dental Clinics

AI-powered phone receptionist for German dental clinic "Zahnarztpraxis Stela Xhelili – Karli 1 Leipzig"

## Overview

This application provides a fully functional AI receptionist that answers phone calls via Twilio, holds natural German conversations using OpenAI GPT-4, extracts patient information, and automatically creates leads in Supabase.

## Tech Stack

- **Backend**: Node.js with Express (ESM modules)
- **AI**: OpenAI GPT-4o-mini for conversational intelligence
- **Phone**: Twilio Voice API with German TwiML (Polly.Marlene voice)
- **Database**: Supabase (PostgreSQL) for lead storage and clinic configuration
- **Deployment**: Replit → selaro.app

## Environment Variables

Required environment variables:

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (for bypassing RLS)
- `OPENAI_API_KEY` - OpenAI API key for GPT-4o-mini
- `CLINIC_ID` - UUID of the clinic in Supabase `clinics` table (e.g., `bc91d95c-a05c-4004-b932-bc393f0391b6`)

## Connecting Twilio to Your AI Receptionist

To connect your Twilio phone number to the AI receptionist:

1. **Go to Twilio Console**
   - Navigate to: **Phone Numbers** → **Active Numbers** → **[your number]**

2. **Configure Voice Webhook**
   - Under the section **"A CALL COMES IN"**, set:
     - **Webhook URL**: `https://selaro.app/api/twilio/voice/step`
     - **HTTP Method**: `POST`

3. **Save Configuration**
   - Click **Save** at the bottom of the page

Your Twilio number is now connected! When someone calls, Twilio will send a POST request to your endpoint, and the AI receptionist will handle the conversation in German.

## Database Tables

### `clinics`
Configuration table for clinic information.

**Columns:**
- `id` (uuid, primary key) - Clinic identifier
- `name` (text) - Clinic name
- `phone_number` (text) - Clinic phone
- `instructions` (text) - AI receptionist instructions
- `created_at` (timestamptz) - Timestamp

### `leads`
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

### `messages_log`
Debug/logging table for tracking conversation flow.

**Columns:**
- `id` (uuid, primary key)
- `call_sid` (text) - Twilio call identifier
- `role` (text) - "user" or "assistant"
- `message` (text) - Message content
- `created_at` (timestamptz) - When message was logged

**Note:** After creating this table, Supabase's PostgREST schema cache may take a few minutes to refresh. Logging will start working automatically once the cache updates.

## API Routes

### AI Receptionist Endpoint

#### `POST /api/twilio/voice/step`
**AI-Powered Twilio Voice Entry Point** - Called when a patient phones the clinic.

**Content-Type:** `application/x-www-form-urlencoded`

**Request Body (form-encoded):**
- `CallSid` - Twilio call identifier (required)
- `From` - Caller's phone number
- `SpeechResult` - (optional) Transcribed speech from caller

**Behavior:**
1. **First request (no SpeechResult)**: Greets caller in German
2. **Subsequent requests (with SpeechResult)**: 
   - Loads clinic data from Supabase
   - Calls OpenAI GPT-4o-mini for intelligent response
   - Returns German TwiML response

**Response:** TwiML XML with German conversation

### Dashboard & Debug Routes

#### `GET /leads`
Dark-themed German dashboard displaying the last 50 leads from Supabase.

#### `GET /debug/status`
Returns server status information including uptime and configured port.

#### `GET /debug/list-leads`
Returns the last 10 leads from Supabase in JSON format.

#### `POST /debug/test-ai`
Test the AI conversation logic without Twilio.

#### `GET /debug/env-keys`
Lists which environment variables are configured (values hidden).

#### `POST /debug/create-test-lead`
Creates a test lead in Supabase for testing purposes.

## Running the Project

```bash
npm install
npm run dev
```

The server will start on port 5000 (or the port specified by `PORT` environment variable).

## Deployment

Deployed to Replit and accessible at: **https://selaro.app**

The application is configured for Replit Deployments with custom domain support.
