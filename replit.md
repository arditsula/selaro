# AI Receptionist for Dental Clinics

A minimal, premium SaaS landing page with mint-green design inspired by Granola.ai.

## Overview

This is a click-through demo showcasing an AI-powered receptionist service for dental clinics. The application features a calm, professional design with mint-green accents and smooth interactions.

## Tech Stack

- **Frontend**: React with TypeScript, Tailwind CSS, Wouter (routing)
- **Backend**: Express.js with TypeScript
- **Styling**: Shadcn UI components with custom mint-green theme
- **Storage**: In-memory storage (module-level array)

## API Routes

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
1. Starts the Express server on port 5000
2. Starts the Vite dev server
3. Serves frontend and backend on the same port

## Notes

- All data is stored in memory and will be lost on server restart
- The call simulation uses placeholder transcript data
- Form fields are prefilled with German example data (Anna Müller)
- Status defaults to "New" for all new calls
- Timestamps are automatically generated
