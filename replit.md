# Selaro — AI Receptionist for Dental Clinics

## Overview
Selaro provides an AI-powered phone receptionist for German dental clinics. It integrates with Twilio for calls, uses OpenAI GPT-4o-mini for natural language conversations in German, extracts patient information, and creates leads automatically in Supabase. The system personalizes responses based on clinic-specific instructions stored in the database. The core purpose is to automate patient intake and lead generation for dental practices.

## User Preferences
I prefer simple language.
I want iterative development.
Ask before making major changes.
Do not make changes to the folder Z.
Do not make changes to the file Y.

## System Architecture

### UI/UX Decisions
The application features a modern, clean design with a dominant mint color scheme. It uses Inter font from Google Fonts for typography. Key UI components include:
- **AI Receptionist Simulator:** A SaaS-style chat interface with a two-column layout (clinic info, chat) on desktop, stacking vertically on mobile. It uses left-aligned grey bubbles for AI messages and right-aligned blue bubbles for user messages, with smooth animations and auto-scrolling.
- **Dark-themed German Dashboard:** Displays the last 50 leads with status badges (e.g., "Akut" for urgent cases) and filtering capabilities.
- **Hero Section:** Features a gradient background with animated "blobs" and clear calls to action.
- **Informative Sections:** "How It Works" and "Connect Your Clinic" sections use card-based layouts with icons and mint accents.

### Technical Implementations
- **Backend:** Node.js with Express (ESM modules).
- **AI:** OpenAI GPT-4o-mini for conversational intelligence, generating natural German responses and extracting structured data.
- **Phone Integration:** Twilio Voice API with German TwiML and Polly.Marlene voice.
- **Database:** Supabase (PostgreSQL) for lead storage, clinic configuration, and logging.
- **Conversation Management:** In-memory storage for conversation state per call session, including full message history and clinic instructions. The AI tracks four required fields (Name, Telefon, Grund, Wunschtermin), asks one question at a time for missing fields, and avoids duplicates.
- **Lead Automation:** When all required fields are collected, the AI outputs a specific "LEAD SUMMARY" format which the backend parses to automatically save leads to Supabase.
- **Deployment:** Configured for Replit Deployments.

### Feature Specifications
- **AI Conversation Flow:** Incoming calls trigger a Twilio webhook. The AI greets the caller, collects essential patient data, and, upon completion, generates a lead summary and saves it to Supabase.
- **Lead Data Extraction:** OpenAI extracts `name`, `concern`, `urgency`, `insurance`, and `preferredSlots` from conversations.
- **Debug & Testing Routes:** Endpoints exist for checking server status, testing AI responses, creating test leads, and listing leads without Twilio integration.

### System Design Choices
- **Scalability:** Designed with a modular Express backend, enabling clear separation of concerns.
- **Real-time Interaction:** Leverages WebSockets for potential future real-time updates and efficient handling of concurrent calls.
- **Data Persistence:** Supabase chosen for robust PostgreSQL database capabilities and ease of integration.

## External Dependencies
- **Twilio Voice API:** For handling incoming phone calls and generating TwiML responses.
- **OpenAI GPT-4o-mini:** For natural language understanding, generation of AI responses, and structured data extraction.
- **Supabase:** Used as the primary database for storing patient leads, clinic configurations, and conversation logs.
- **Google Fonts (Inter):** For typography.