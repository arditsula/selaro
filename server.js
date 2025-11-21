import express from 'express';
import cors from 'cors';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const VoiceResponse = twilio.twiml.VoiceResponse;

// Setup __dirname for ESM modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files (audio, assets, etc.)
app.use('/static', express.static(path.join(__dirname, 'static')));

// Supabase setup (also check for typo'd variable name)
const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPARBASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

if (!supabase) {
  console.warn('⚠️  Supabase client not configured - SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
} else {
  console.log('✅ Supabase client configured successfully');
}

// OpenAI setup
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

if (!openai) {
  console.warn('⚠️  OpenAI client not configured - OPENAI_API_KEY missing');
} else {
  console.log('✅ OpenAI client configured successfully');
}

// Nodemailer setup
const emailTransporter = (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: parseInt(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

if (!emailTransporter) {
  console.warn('⚠️  Email transporter not configured - SMTP_HOST, SMTP_PORT, SMTP_USER, or SMTP_PASS missing');
} else {
  console.log('✅ Email transporter configured successfully');
}

// Clinic ID from environment
const CLINIC_ID = process.env.CLINIC_ID || 'bc91d95c-a05c-4004-b932-bc393f0391b6';

// ===== INPUT VALIDATION HELPERS =====
/**
 * Check if value is a non-empty string after trim
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Sanitize string: trim and remove dangerous control characters
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\r\n\t]/g, ' ').substring(0, 5000);
}

/**
 * Check if value is a valid phone (simple: contains digits or +, min length 7)
 */
function isValidPhone(value) {
  if (typeof value !== 'string') return false;
  const cleaned = value.trim();
  const hasDigits = /\d/.test(cleaned);
  return hasDigits && cleaned.length >= 7 && cleaned.length <= 20;
}

/**
 * Check if value is a valid ISO date or yyyy-mm-dd format
 */
function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const cleaned = value.trim();
  const iso = new Date(cleaned);
  if (isNaN(iso.getTime())) return false;
  // Check format is roughly correct (yyyy-mm-dd or ISO)
  return /^\d{4}-\d{2}-\d{2}/.test(cleaned);
}

/**
 * Check if value is valid HH:MM time format
 */
function isValidTime(value) {
  if (typeof value !== 'string') return false;
  return /^\d{2}:\d{2}$/.test(value.trim());
}

/**
 * Log validation error with context
 */
function logValidationError(req, field, reason) {
  console.warn('[VALIDATION ERROR]', {
    path: req.path,
    method: req.method,
    field,
    reason,
    timestamp: new Date().toISOString()
  });
}

// In-memory conversation state management
// Key: CallSid or sessionId, Value: { messages: [], extractedData: {}, leadSaved: false }
const conversationStates = new Map();

// In-memory session state for /simulate endpoint
// Key: sessionId (generated on first message), Value: { messages: [], leadSaved: false }
const simulatorSessions = new Map();

/**
 * Fetch clinic data from Supabase (always fresh, no caching)
 * Returns the full clinic object { id, name, phone_number, instructions, created_at }
 */
async function getClinic() {
  const { data, error } = await supabase
    .from('clinics')
    .select('*')
    .eq('id', process.env.CLINIC_ID)
    .single();

  if (error) {
    console.error('Error fetching clinic:', error);
    throw error;
  }

  return data;
}

/**
 * Fetch clinic instructions from Supabase (legacy function, kept for compatibility)
 */
async function getClinicInstructions() {
  try {
    const clinic = await getClinic();
    return clinic.instructions || 'Sie sind eine freundliche Rezeptionistin für eine Zahnarztpraxis in Leipzig.';
  } catch (err) {
    console.error('Error fetching clinic instructions:', err);
    return 'Sie sind eine freundliche Rezeptionistin für eine Zahnarztpraxis in Leipzig.';
  }
}

/**
 * Call OpenAI to generate a response based on conversation history
 */
async function getAIResponse(messages, clinicInstructions) {
  if (!openai) {
    return 'Vielen Dank für Ihren Anruf. Ein Mitarbeiter wird sich bald bei Ihnen melden.';
  }

  try {
    const systemMessage = {
      role: 'system',
      content: `${clinicInstructions}

WICHTIGE ANWEISUNGEN:
- Sie führen ein Telefongespräch, daher müssen Ihre Antworten kurz und natürlich sein (max 2-3 Sätze)
- Sammeln Sie folgende Informationen: Name, Anliegen/Beschwerden, Versicherung (privat/gesetzlich), bevorzugte Terminzeit
- Seien Sie empathisch und professionell
- Sprechen Sie Deutsch
- Wenn der Anrufer Schmerzen erwähnt, behandeln Sie dies als dringend
- Am Ende des Gesprächs bestätigen Sie, dass sich die Praxis bald meldet`
    };

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [systemMessage, ...messages],
      temperature: 0.7,
      max_tokens: 150
    });

    return completion.choices[0].message.content;
  } catch (err) {
    console.error('OpenAI API error:', err);
    return 'Vielen Dank. Ein Mitarbeiter wird sich bald bei Ihnen melden.';
  }
}

/**
 * Extract structured data from conversation for lead creation
 */
async function extractLeadData(messages) {
  if (!openai || messages.length < 2) {
    return {
      name: 'Unbekannt',
      concern: 'Telefonische Anfrage',
      urgency: null,
      insurance: null,
      preferredSlots: 'unbekannt'
    };
  }

  try {
    const extractionPrompt = {
      role: 'system',
      content: `Analysieren Sie das Gespräch und extrahieren Sie folgende Informationen im JSON-Format:
{
  "name": "Name des Anrufers oder 'Unbekannt'",
  "concern": "Kurze Beschreibung des Anliegens",
  "urgency": "urgent" wenn Schmerzen erwähnt wurden, sonst "normal",
  "insurance": "privat", "gesetzlich", oder null wenn nicht erwähnt,
  "preferredSlots": "Bevorzugte Terminzeit oder 'unbekannt'"
}

Antworten Sie NUR mit dem JSON-Objekt, ohne zusätzlichen Text.`
    };

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [extractionPrompt, ...messages],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' }
    });

    const extracted = JSON.parse(completion.choices[0].message.content);
    return {
      name: extracted.name || 'Unbekannt',
      concern: extracted.concern || 'Telefonische Anfrage',
      urgency: extracted.urgency || null,
      insurance: extracted.insurance || null,
      preferredSlots: extracted.preferredSlots || 'unbekannt'
    };
  } catch (err) {
    console.error('Error extracting lead data:', err);
    return {
      name: 'Unbekannt',
      concern: 'Telefonische Anfrage',
      urgency: null,
      insurance: null,
      preferredSlots: 'unbekannt'
    };
  }
}

/**
 * Log message to messages_log table for debugging
 * Uses RPC call to bypass PostgREST schema cache
 * @param {string} callSid - Twilio CallSid
 * @param {string} role - "user" or "assistant"
 * @param {string} message - The message content
 */
async function logMessage(callSid, role, message) {
  if (!supabase) {
    return; // Skip logging if Supabase not configured
  }
  
  try {
    // Use RPC call to bypass schema cache issues
    const { data, error } = await supabase.rpc('log_twilio_message', {
      p_call_sid: callSid,
      p_role: role,
      p_message: message
    });
    
    if (error) {
      // If RPC doesn't exist, try direct SQL (will also fail gracefully)
      console.warn('📝 Message logging skipped (table not in schema cache)');
      return;
    }
    
    console.log('✅ Message logged successfully');
  } catch (error) {
    // Log error but don't throw - logging is optional
    console.warn('Message logging skipped:', error.message);
  }
}

async function createLeadFromCall({ 
  callSid, 
  name, 
  phone, 
  concern, 
  urgency, 
  insurance, 
  preferredSlotsRaw, 
  notes 
}) {
  try {
    const lead = {
      call_sid: callSid ?? null,
      name,
      phone,
      concern: concern ?? null,
      urgency: urgency ?? null,
      insurance: insurance ?? null,
      preferred_slots: preferredSlotsRaw 
        ? { raw: preferredSlotsRaw } 
        : null,
      notes: notes ?? null,
      status: 'new'
    };

    const { data, error } = await supabase
      .from('leads')
      .insert([lead])
      .select();

    if (error) {
      console.error('Supabase lead insert error:', error);
      throw error;
    }

    return data[0];
  } catch (err) {
    console.error('Unexpected error creating lead from call:', err);
    throw err;
  }
}

/**
 * AI-powered lead extraction from natural German text
 * Uses OpenAI to extract structured fields from receptionist's message
 */
async function extractLeadFieldsFromText(text) {
  try {
    console.log('🔍 Extracting lead fields from text...');
    
    const extractionPrompt = `You are an information extractor. From the following German receptionist message, extract these fields:
- full name (patient's complete name)
- phone number (with country code if present)
- reason for visit (brief description of dental issue)
- preferred time/date (when patient wants appointment, formatted as human-readable like "morgen 15:00" or "nächste Woche Nachmittag")

If a field is not mentioned or unclear, return null for that field.

Return ONLY a valid JSON object with this exact structure:
{
  "name": "string or null",
  "phone": "string or null",
  "reason": "string or null",
  "preferred_time": "string or null"
}

Receptionist message:
${text}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You extract structured information from German text. Always return valid JSON.' },
        { role: 'user', content: extractionPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 300
    });

    const extracted = JSON.parse(completion.choices[0].message.content);
    console.log('✅ Extracted lead fields:', extracted);
    
    return {
      name: extracted.name || null,
      phone: extracted.phone || null,
      reason: extracted.reason || null,
      preferred_time: extracted.preferred_time || null
    };
  } catch (error) {
    console.error('❌ Error extracting lead fields:', error);
    return {
      name: null,
      phone: null,
      reason: null,
      preferred_time: null
    };
  }
}

/**
 * Classify urgency based on pain indicators in German text
 * Returns 'akut' for urgent cases, 'normal' otherwise
 */
function classifyUrgency(reason, fullText) {
  const textToCheck = `${reason || ''} ${fullText || ''}`.toLowerCase();
  
  // Strong pain / emergency indicators (including grammatical variants)
  const urgentIndicators = [
    'starke zahnschmerzen',
    'starken zahnschmerzen',  // dative case
    'starker zahnschmerz',    // genitive singular
    'sehr starke schmerzen',
    'sehr starken schmerzen', // dative case
    'starke schmerzen',
    'starken schmerzen',      // dative case
    'sehr weh',
    'akut',
    'notfall',
    'schmerzen seit gestern',
    'schmerzen seit heute',
    'unerträglich',
    'kaum aushalten',
    'schlimme schmerzen',
    'schlimmen schmerzen'     // dative case
  ];
  
  const isUrgent = urgentIndicators.some(indicator => textToCheck.includes(indicator));
  
  return isUrgent ? 'akut' : 'normal';
}

/**
 * Send email notification to clinic when a new lead is saved
 * @param {Object} lead - Lead data with name, phone, concern, urgency, preferred_slots, source, etc.
 */
async function sendLeadNotification(lead) {
  // Skip if email transporter is not configured
  if (!emailTransporter) {
    console.warn('⚠️  Email notification skipped - SMTP not configured');
    return;
  }

  const clinicEmail = process.env.CLINIC_NOTIFICATION_EMAIL;
  if (!clinicEmail) {
    console.warn('⚠️  Email notification skipped - CLINIC_NOTIFICATION_EMAIL not set');
    return;
  }

  try {
    // Format the preferred time/slots
    const preferredTime = lead.preferred_slots?.raw || 'Nicht angegeben';
    
    // Determine source display
    const sourceDisplay = lead.source === 'twilio' ? 'Telefonanruf' : 
                         lead.source === 'simulate' ? 'Web-Simulator' : 
                         lead.source || 'Unbekannt';
    
    // Determine urgency display
    const urgencyDisplay = lead.urgency === 'akut' ? '🔴 AKUT' : 'Normal';
    
    // Build email subject
    const subject = `Neuer Patientenanruf über Selaro – ${lead.concern || 'Zahnbehandlung'}`;
    
    // Build email body (German)
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #00C896;">Neuer Lead von der AI-Telefonassistenz</h2>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Name:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${lead.name}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Telefonnummer:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${lead.phone}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Grund:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${lead.concern || 'Nicht angegeben'}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Dringlichkeit:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${urgencyDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Wunschtermin:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${preferredTime}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Quelle:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${sourceDisplay}</td>
          </tr>
        </table>
        
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #374151;">
            <strong>Bitte kontaktieren Sie den Patienten zur Terminbestätigung.</strong>
          </p>
        </div>
        
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
          Diese E-Mail wurde automatisch von Selaro generiert.
        </p>
      </div>
    `;
    
    // Plain text version
    const text = `
Neuer Lead von der AI-Telefonassistenz

Name: ${lead.name}
Telefonnummer: ${lead.phone}
Grund: ${lead.concern || 'Nicht angegeben'}
Dringlichkeit: ${urgencyDisplay}
Wunschtermin: ${preferredTime}
Quelle: ${sourceDisplay}

Bitte kontaktieren Sie den Patienten zur Terminbestätigung.

---
Diese E-Mail wurde automatisch von Selaro generiert.
    `.trim();
    
    // Send email
    const info = await emailTransporter.sendMail({
      from: `"Selaro AI Receptionist" <${process.env.SMTP_USER}>`,
      to: clinicEmail,
      subject: subject,
      text: text,
      html: html
    });
    
    console.log('✅ Email notification sent successfully:', info.messageId);
    return info;
    
  } catch (error) {
    console.error('❌ Error sending email notification:', error);
    // Don't throw - we don't want to break lead saving if email fails
    return null;
  }
}

/**
 * Save lead to Supabase - only when all required fields are present
 */
async function saveLead({ name, phone, reason, preferredTime, urgency, requestedTime, source, rawText, callSid }) {
  try {
    // Only save when all fields are present
    if (!name || !phone || !reason || !preferredTime) {
      console.log('⚠️ Skipping lead save - missing required fields:', {
        hasName: !!name,
        hasPhone: !!phone,
        hasReason: !!reason,
        hasPreferredTime: !!preferredTime
      });
      return null;
    }

    console.log('💾 Saving lead to Supabase...');
    console.log('Lead data:', { 
      name, 
      phone, 
      reason, 
      preferredTime, 
      urgency, 
      requestedTime,
      source 
    });

    const lead = {
      call_sid: callSid || `${source}-${Date.now()}`,
      name,
      phone,
      concern: reason,
      urgency: urgency || 'normal',
      insurance: null,
      preferred_slots: { raw: preferredTime },
      notes: rawText || null,
      status: 'new'
    };

    const { data, error } = await supabase
      .from('leads')
      .insert([lead])
      .select();

    if (error) {
      console.error('❌ Supabase lead insert error:', error);
      throw error;
    }

    const savedLead = data[0];
    console.log('✅ Lead saved successfully! ID:', savedLead?.id);
    
    // Send email notification to clinic
    await sendLeadNotification(savedLead);
    
    return savedLead;
  } catch (error) {
    console.error('❌ Error saving lead:', error);
    // Don't throw - we don't want to crash the call
    return null;
  }
}

/**
 * Unified system prompt for AI receptionist (used in both Twilio and simulator)
 * State-machine based receptionist with strict field tracking
 */
function buildSystemPrompt(clinicName, clinicInstructions) {
  return `You are a German receptionist for ${clinicName}.
${clinicInstructions}

====================================================
RECEPTIONIST STATE MACHINE - FOLLOW EXACTLY:
====================================================

Your ONLY job is to collect EXACTLY these 4 fields:
1) Full Name
2) Phone Number  
3) Reason for visit
4) Preferred time or date

MEMORY RULES (CRITICAL):
- Once a field is provided by the user, store it internally.
- Do NOT ask again for any field already provided.
- If user provides multiple fields at once, capture ALL of them.
- Only ask for fields that are still missing.

QUESTION BEHAVIOR:
- Ask ONE question at a time.
- Ask ONLY for missing fields.
- If ALL 4 fields are already known, do NOT ask anything.

WHEN ALL 4 FIELDS ARE KNOWN (CRITICAL):
====================================================
You MUST output this EXACT block and NOTHING ELSE:

LEAD SUMMARY
Name: <full name>
Telefon: <phone>
Grund: <reason>
Wunschtermin: <preferred time>

Vielen Dank! Wir haben Ihre Daten notiert. Die Praxis meldet sich zur Terminbestätigung bei Ihnen.
====================================================

This block is your FINAL ANSWER. Do not continue the conversation after this.

EXAMPLES:

Example 1 - User provides all fields at once:
User: "Ich bin Anna Müller, 0341 123456. Ich habe Zahnschmerzen und möchte morgen kommen."
You: LEAD SUMMARY
     Name: Anna Müller
     Telefon: 0341 123456
     Grund: Zahnschmerzen
     Wunschtermin: morgen

     Vielen Dank! Wir haben Ihre Daten notiert. Die Praxis meldet sich zur Terminbestätigung bei Ihnen.

Example 2 - User provides fields one by one:
User: "Ich habe Zahnschmerzen"
You: "Wie ist Ihr Name?"
User: "Max Schmidt"
You: "Telefonnummer?"
User: "0341 999888"
You: "Wann möchten Sie kommen?"
User: "Nächste Woche"
You: LEAD SUMMARY
     Name: Max Schmidt
     Telefon: 0341 999888
     Grund: Zahnschmerzen
     Wunschtermin: Nächste Woche

     Vielen Dank! Wir haben Ihre Daten notiert. Die Praxis meldet sich zur Terminbestätigung bei Ihnen.

NEVER:
- Ask for a field twice
- Make up appointment times
- Give prices
- Continue conversation after outputting LEAD SUMMARY`;
}

/**
 * Simple regex-based detection of LEAD SUMMARY format
 * Returns { hasSummary: boolean, leadData: {...} } or { hasSummary: false }
 */
function detectLeadSummary(aiResponse) {
  // Check if response contains the required marker (without asterisks)
  if (!aiResponse.includes('LEAD SUMMARY')) {
    return { hasSummary: false, leadData: null };
  }

  try {
    // Extract fields using regex - must appear after "LEAD SUMMARY"
    const nameMatch = aiResponse.match(/Name:\s*(.+?)(?=\n|$)/i);
    const phoneMatch = aiResponse.match(/Telefon:\s*(.+?)(?=\n|$)/i);
    const reasonMatch = aiResponse.match(/Grund:\s*(.+?)(?=\n|$)/i);
    const timeMatch = aiResponse.match(/Wunschtermin:\s*(.+?)(?=\n|$)/i);

    // All 4 fields must be present
    if (!nameMatch || !phoneMatch || !reasonMatch || !timeMatch) {
      console.warn('⚠️ LEAD SUMMARY tag found but missing required fields');
      console.warn('AI Response:', aiResponse);
      return { hasSummary: false, leadData: null };
    }

    const extractedData = {
      name: nameMatch[1].trim(),
      phone: phoneMatch[1].trim(),
      concern: reasonMatch[1].trim(),
      preferredTime: timeMatch[1].trim()
    };

    console.log('✅ Successfully parsed LEAD SUMMARY:', extractedData);

    return {
      hasSummary: true,
      leadData: extractedData
    };
  } catch (err) {
    console.error('❌ Error parsing LEAD SUMMARY:', err);
    console.error('AI Response:', aiResponse);
    return { hasSummary: false, leadData: null };
  }
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Selaro – KI-Rezeption für moderne Zahnarztpraxen. 24/7 automatische Anrufbehandlung, Patientendatenerfassung und Lead-Generierung.">
  <meta property="og:title" content="Selaro – AI Rezeption für Zahnarztpraxen">
  <meta property="og:description" content="Die Zukunft der Telefonrezeption für Zahnarztpraxen. Automatische Anrufbehandlung, keine verpassten Calls.">
  <title>Selaro – AI Rezeption für Zahnarztpraxen | Automatische Telefonbeantworter</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      line-height: 1.6;
      min-height: 100vh;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }
    
    /* Navbar */
    .navbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: rgba(0, 0, 0, 0.2);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding: 1rem 1.5rem;
      z-index: 999;
    }

    .navbar-content {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .navbar-logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .navbar-logo-text {
      font-size: 18px;
      font-weight: 700;
      color: #f1f5f9;
    }

    .navbar-logo-subtitle {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    .logo-link {
      display: inline-flex;
      flex-direction: column;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      transition: opacity 0.2s ease;
    }

    .logo-link:hover {
      opacity: 0.9;
    }

    .button-group {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    
    .btn {
      display: inline-block;
      padding: 0.75rem 2rem;
      font-size: 0.95rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: 0.5rem;
      transition: all 0.3s ease;
      cursor: pointer;
      border: none;
      outline: none;
      font-family: 'Inter', sans-serif;
      min-height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    @media (max-width: 640px) {
      .button-group {
        flex-direction: column;
        gap: 0.75rem;
      }

      .btn {
        width: 100%;
        padding: 0.875rem 1.5rem;
      }
    }
    
    .btn-primary {
      background: #00C896;
      color: white;
      box-shadow: 0 10px 25px rgba(0, 200, 150, 0.3);
    }
    
    .btn-primary:hover {
      background: #00b586;
      transform: translateY(-2px);
      box-shadow: 0 15px 35px rgba(0, 200, 150, 0.4);
    }
    
    .btn-secondary {
      background: transparent;
      color: #00C896;
      border: 2px solid #00C896;
    }
    
    .btn-secondary:hover {
      background: rgba(0, 200, 150, 0.1);
      transform: translateY(-2px);
    }

    /* Hero Section */
    .hero {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8rem 1rem 4rem;
      text-align: center;
      animation: fadeIn 0.6s ease-out;
    }
    
    .hero-content h1 {
      font-size: 3.5rem;
      font-weight: 800;
      margin-bottom: 1.5rem;
      color: #f1f5f9;
      line-height: 1.2;
      background: linear-gradient(135deg, #00C896 0%, #a78bfa 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .hero-content .subheading {
      font-size: 1.25rem;
      color: #cbd5e1;
      margin-bottom: 2.5rem;
      max-width: 700px;
      margin-left: auto;
      margin-right: auto;
      font-weight: 400;
      line-height: 1.7;
    }

    @media (max-width: 768px) {
      .hero-content h1 {
        font-size: 2.5rem;
      }

      .hero-content .subheading {
        font-size: 1rem;
      }

      .hero {
        padding: 6rem 1rem 3rem;
      }
    }

    @media (max-width: 480px) {
      .hero-content h1 {
        font-size: 1.875rem;
      }

      .hero-content .subheading {
        font-size: 0.95rem;
      }
    }

    /* How It Works */
    .how-it-works {
      padding: 5rem 1rem;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .how-it-works h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .steps-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    
    .step {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.3);
      padding: 2rem;
      border-radius: 1rem;
      text-align: center;
      transition: all 0.3s ease;
    }
    
    .step:hover {
      background: rgba(30, 41, 59, 0.8);
      transform: translateY(-5px);
    }
    
    .step-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 50px;
      height: 50px;
      background: #00C896;
      color: #0f172a;
      border-radius: 50%;
      font-weight: 700;
      font-size: 1.5rem;
      margin-bottom: 1rem;
    }
    
    .step h3 {
      font-size: 1.125rem;
      margin-bottom: 0.75rem;
      color: #f1f5f9;
      font-weight: 600;
    }
    
    .step p {
      color: #cbd5e1;
      font-size: 0.95rem;
    }

    /* Features Grid */
    .features {
      padding: 5rem 1rem;
    }
    
    .features h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 2rem;
    }
    
    .feature-card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.2);
      padding: 2rem;
      border-radius: 1rem;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
    }
    
    .feature-card:hover {
      background: rgba(30, 41, 59, 0.8);
      border-color: rgba(0, 200, 150, 0.4);
      transform: translateY(-5px);
    }
    
    .feature-icon {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    
    .feature-card h3 {
      font-size: 1.15rem;
      margin-bottom: 0.75rem;
      color: #f1f5f9;
      font-weight: 600;
    }
    
    .feature-card p {
      color: #cbd5e1;
      font-size: 0.95rem;
      line-height: 1.6;
    }

    /* Built For Section */
    .built-for {
      padding: 5rem 1rem;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(0, 200, 150, 0.05) 100%);
    }
    
    .built-for h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 1rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .built-for-subtitle {
      text-align: center;
      color: #cbd5e1;
      margin-bottom: 3rem;
      font-size: 1.1rem;
    }
    
    .built-for-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    
    .built-for-item {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(0, 200, 150, 0.2);
      padding: 1.5rem;
      border-radius: 0.75rem;
      text-align: center;
    }
    
    .built-for-item .icon {
      font-size: 2.5rem;
      margin-bottom: 0.75rem;
    }
    
    .built-for-item p {
      color: #e2e8f0;
      font-weight: 500;
      font-size: 0.95rem;
    }

    /* Demo Section */
    .demo-section {
      padding: 5rem 1rem;
      background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
      text-align: center;
    }
    
    .demo-section h2 {
      font-size: 2rem;
      color: white;
      margin-bottom: 2rem;
      font-weight: 700;
    }
    
    .phone-mockup {
      width: 200px;
      height: 400px;
      background: #1a1a2e;
      border-radius: 30px;
      margin: 2rem auto;
      border: 8px solid #2a2a4e;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      position: relative;
    }
    
    .phone-mockup::before {
      content: '';
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 150px;
      height: 25px;
      background: #1a1a2e;
      border-radius: 0 0 20px 20px;
      z-index: 10;
    }
    
    .phone-content {
      padding: 40px 15px 15px;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      animation: wave 3s ease-in-out infinite;
    }
    
    .wave {
      height: 10px;
      background: linear-gradient(90deg, #00C896, #a78bfa, #00C896);
      border-radius: 5px;
      animation: shimmer 2s ease-in-out infinite;
    }
    
    @keyframes shimmer {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes wave {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(1.1); }
    }

    .demo-btn {
      margin-top: 1rem;
    }

    /* Summary Card */
    .summary-section {
      padding: 5rem 1rem;
    }
    
    .summary-section h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .summary-card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.3);
      padding: 2rem;
      border-radius: 1rem;
      max-width: 600px;
      margin: 0 auto;
      backdrop-filter: blur(10px);
    }
    
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 1rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      color: #e2e8f0;
    }
    
    .summary-row:last-child {
      border-bottom: none;
    }
    
    .summary-label {
      color: #cbd5e1;
      font-weight: 500;
    }
    
    .summary-value {
      color: #00C896;
      font-weight: 600;
    }

    /* Dashboard Preview */
    .dashboard-preview {
      padding: 5rem 1rem;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .dashboard-preview h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .preview-box {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.3);
      padding: 2rem;
      border-radius: 1rem;
      max-width: 900px;
      margin: 0 auto;
      backdrop-filter: blur(10px);
      text-align: center;
      color: #cbd5e1;
    }

    /* Benefits */
    .benefits {
      padding: 5rem 1rem;
    }
    
    .benefits h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .benefits-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    
    .benefit-card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.3);
      padding: 2rem;
      border-radius: 1rem;
      text-align: center;
    }
    
    .benefit-icon {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    
    .benefit-card h3 {
      color: #f1f5f9;
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    
    .benefit-card p {
      color: #cbd5e1;
      font-size: 0.95rem;
    }

    /* Integrations */
    .integrations {
      padding: 5rem 1rem;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .integrations h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .integrations-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    
    .integration-item {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.2);
      padding: 2rem;
      border-radius: 1rem;
      text-align: center;
      position: relative;
    }
    
    .integration-item .logo {
      font-size: 2rem;
      margin-bottom: 0.75rem;
    }
    
    .integration-item p {
      color: #e2e8f0;
      font-size: 0.9rem;
      font-weight: 500;
    }
    
    .coming-soon {
      position: absolute;
      top: 10px;
      right: 10px;
      background: #00C896;
      color: #0f172a;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    /* Testimonials */
    .testimonials {
      padding: 5rem 1rem;
    }
    
    .testimonials h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .testimonials-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    
    .testimonial-card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.3);
      padding: 2rem;
      border-radius: 1rem;
    }
    
    .testimonial-quote {
      color: #cbd5e1;
      font-size: 0.95rem;
      margin-bottom: 1.5rem;
      line-height: 1.7;
      font-style: italic;
    }
    
    .testimonial-author {
      color: #f1f5f9;
      font-weight: 600;
    }
    
    .testimonial-role {
      color: #00C896;
      font-size: 0.85rem;
    }

    /* Pricing */
    .pricing {
      padding: 5rem 1rem;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .pricing h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    
    .pricing-card {
      background: rgba(30, 41, 59, 0.5);
      border: 2px solid rgba(0, 200, 150, 0.3);
      padding: 2rem;
      border-radius: 1rem;
      text-align: center;
      transition: all 0.3s ease;
    }
    
    .pricing-card:hover {
      border-color: #00C896;
      transform: translateY(-5px);
    }
    
    .pricing-card h3 {
      color: #f1f5f9;
      margin-bottom: 1rem;
      font-weight: 600;
    }
    
    .pricing-price {
      font-size: 2rem;
      color: #00C896;
      font-weight: 700;
      margin-bottom: 1rem;
    }
    
    .pricing-desc {
      color: #cbd5e1;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }

    /* FAQ */
    .faq {
      padding: 5rem 1rem;
    }
    
    .faq h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .faq-container {
      max-width: 700px;
      margin: 0 auto;
    }
    
    .faq-item {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.2);
      margin-bottom: 1rem;
      border-radius: 0.75rem;
      overflow: hidden;
    }
    
    .faq-question {
      background: rgba(30, 41, 59, 0.5);
      padding: 1.5rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #f1f5f9;
      font-weight: 600;
      transition: all 0.3s ease;
    }
    
    .faq-question:hover {
      background: rgba(30, 41, 59, 0.8);
    }
    
    .faq-toggle {
      font-size: 1.2rem;
      transition: transform 0.3s ease;
    }
    
    .faq-item.open .faq-toggle {
      transform: rotate(180deg);
    }
    
    .faq-answer {
      padding: 0 1.5rem;
      color: #cbd5e1;
      max-height: 0;
      overflow: hidden;
      transition: all 0.3s ease;
    }
    
    .faq-item.open .faq-answer {
      padding: 0 1.5rem 1.5rem;
      max-height: 500px;
    }

    /* Footer */
    footer {
      padding: 3rem 1rem;
      text-align: center;
      background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
      color: rgba(255, 255, 255, 0.9);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    footer a {
      color: white;
      text-decoration: none;
      transition: opacity 0.3s ease;
      font-weight: 500;
    }
    
    footer a:hover {
      opacity: 0.7;
    }

    /* Mobile Responsive */
    /* Contact Section */
    #contact {
      padding: 5rem 1rem;
      background: rgba(0, 0, 0, 0.2);
    }
    
    #contact h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 2rem;
      color: #f1f5f9;
      font-weight: 700;
    }
    
    .contact-wrapper {
      max-width: 500px;
      margin: 0 auto;
    }
    
    .contact-text {
      text-align: center;
      color: #cbd5e1;
      margin-bottom: 2rem;
      font-size: 1rem;
    }
    
    .contact-form {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(0, 200, 150, 0.3);
      padding: 2rem;
      border-radius: 1rem;
      backdrop-filter: blur(10px);
    }
    
    .form-group {
      margin-bottom: 1.5rem;
    }
    
    .form-group label {
      display: block;
      color: #e2e8f0;
      font-weight: 500;
      margin-bottom: 0.5rem;
      font-size: 0.95rem;
    }
    
    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 0.75rem;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(0, 200, 150, 0.2);
      border-radius: 0.5rem;
      color: #f1f5f9;
      font-family: 'Inter', sans-serif;
      font-size: 0.95rem;
      transition: all 0.3s ease;
    }
    
    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #00C896;
      background: rgba(15, 23, 42, 0.8);
      box-shadow: 0 0 0 3px rgba(0, 200, 150, 0.1);
    }
    
    .form-group textarea {
      resize: vertical;
      min-height: 100px;
    }
    
    .contact-buttons {
      display: flex;
      gap: 1rem;
      margin-top: 1.5rem;
    }
    
    .contact-buttons .btn {
      flex: 1;
    }
    
    @media (max-width: 768px) {
      .navbar-content {
        flex-direction: column;
        gap: 1rem;
      }

      .hero {
        padding: 6rem 1rem 2rem;
      }

      .hero-content h1 {
        font-size: 2rem;
      }
      
      .hero-content .subheading {
        font-size: 1rem;
      }

      .hero-layout {
        grid-template-columns: 1fr;
      }
      
      .button-group {
        flex-direction: column;
      }
      
      .btn {
        width: 100%;
      }
      
      h2 {
        font-size: 1.75rem !important;
      }
      
      .feature-grid,
      .steps-container,
      .benefits-grid,
      .integrations-grid,
      .testimonials-grid,
      .pricing-grid {
        grid-template-columns: 1fr;
      }

      .contact-buttons {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <!-- Navbar -->
  <nav class="navbar">
    <div class="navbar-content">
      <a href="/" class="logo-link navbar-logo">
        <div class="navbar-logo-text">Selaro</div>
        <div class="navbar-logo-subtitle">AI Reception</div>
      </a>
      <div class="button-group" style="margin-bottom: 0;">
        <a href="/dashboard" class="btn btn-primary">Demo starten</a>
        <a href="/dashboard" class="btn btn-secondary">Login</a>
      </div>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="hero">
    <div class="container">
      <div class="hero-content">
        <h1>Die Zukunft der Telefonrezeption für Zahnarztpraxen</h1>
        <p class="subheading">
          24/7 AI-Assistent, der Patienten professionell begrüßt.<br>
          Keine verpassten Anrufe. Strukturierte Leads im Dashboard.
        </p>
        <div class="button-group">
          <a href="/dashboard" class="btn btn-primary">Demo starten</a>
          <a href="#contact" class="btn btn-secondary">Kontakt aufnehmen</a>
        </div>
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section class="how-it-works">
    <div class="container">
      <h2>So funktioniert Selaro</h2>
      <div class="steps-container">
        <div class="step">
          <div class="step-number">1</div>
          <h3>Patient ruft in der Praxis an</h3>
          <p>Ein Patient wählt Ihre Zahnarztpraxis an.</p>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <h3>AI-Assistent nimmt an und stellt Fragen</h3>
          <p>Selaro beantwortet sofort mit einer freundlichen Begrüßung und sammelt alle wichtigen Informationen.</p>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <h3>Vollständiger Lead im Dashboard</h3>
          <p>Ein strukturierter Lead mit Namen, Grund, Dringlichkeit und Terminwunsch erscheint sofort in Ihrem System.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- For Dental Clinics -->
  <section class="built-for">
    <div class="container">
      <h2>Speziell für Zahnarztpraxen gemacht</h2>
      <div class="feature-grid" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem;">
        <div class="feature-card">
          <div class="feature-icon">🚨</div>
          <h3>Akute Zahnschmerzen erkennen</h3>
          <p>Unterscheidet zwischen akuten Schmerzen und regulären Terminen. Notfälle werden automatisch priorisiert.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🦷</div>
          <h3>Prophylaxe & Kontrolle verstehen</h3>
          <p>Erkennnt Zahnreinigungen, Kontrolltermine und spezifische zahnmedizinische Begriffe.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🛡️</div>
          <h3>Versicherungsstatus erfragen</h3>
          <p>Fragt automatisch nach Versicherungstyp (gesetzlich/privat) für bessere Kommunikation mit Patienten.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">⚙️</div>
          <h3>Individuelle Praxisanweisungen</h3>
          <p>Personalisiert nach Öffnungszeiten, Preisen und Tonalität Ihrer Praxis. Jede Praxis ist einzigartig.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Feature Grid -->
  <section class="features">
    <div class="container">
      <h2>Features im Überblick</h2>
      <div class="feature-grid">
        <div class="feature-card">
          <div class="feature-icon">📞</div>
          <h3>24/7 Erreichbarkeit</h3>
          <p>Antwortet rund um die Uhr, auch nachts und am Wochenende.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">✅</div>
          <h3>Keine verpassten Anrufe</h3>
          <p>Jeder Anruf wird beantwortet. Keine volle Mailbox, keine verlorenen Patienten.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">📋</div>
          <h3>Vollständige Patientendaten</h3>
          <p>Name, Telefon, Grund und Wunschtermin werden vollautomatisch erfasst.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">⚡</div>
          <h3>Priorisierung von Schmerzpatienten</h3>
          <p>Akutfälle werden automatisch erkannt und markiert für schnelle Bearbeitung.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔒</div>
          <h3>DSGVO-konforme Datenspeicherung</h3>
          <p>Vollständige Einhaltung aller Datenschutzbestimmungen. Sichere Verschlüsselung.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔗</div>
          <h3>Einfache Integration</h3>
          <p>Funktioniert mit Ihren bestehenden Abläufen. Keine komplizierten Umbauten nötig.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Live Demo Section -->
  <section class="demo-section">
    <div class="container">
      <h2>Hören Sie, wie sich die AI-Rezeption anhört</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; align-items: center;">
        <div style="color: rgba(255, 255, 255, 0.9);">
          <p style="font-size: 1.05rem; margin-bottom: 1.5rem; line-height: 1.7;">
            Erleben Sie live, wie professionell und natürlich unsere KI-Rezeption klingt. Völlig auf Deutsch, mit einfühlsamer Tonalität und vollständiger Geduld für Ihre Patienten.
          </p>
          <a href="/simulate" class="btn btn-primary">Telefon-Demo starten →</a>
        </div>
        <div style="text-align: center;">
          <div class="phone-mockup">
            <div class="phone-content">
              <div class="wave"></div>
              <div class="wave" style="animation-delay: 0.2s;"></div>
              <div class="wave" style="animation-delay: 0.4s;"></div>
              <div class="wave" style="animation-delay: 0.6s;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Leads Dashboard Preview -->
  <section class="dashboard-preview">
    <div class="container">
      <h2>Alle Anrufe in einem klaren Dashboard</h2>
      <p style="text-align: center; color: #cbd5e1; margin-bottom: 2rem; max-width: 700px; margin-left: auto; margin-right: auto;">
        Jeder Anruf wird zu einem strukturierten Lead. Sehen Sie auf einen Blick: Name, Grund, Dringlichkeit und wann der Anruf eingegangen ist.
      </p>
      <div class="preview-box">
        <table style="width: 100%; font-size: 0.9rem;">
          <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
            <td style="padding: 0.75rem; color: #00C896; font-weight: 600;">Name</td>
            <td style="padding: 0.75rem; color: #e2e8f0;">Grund</td>
            <td style="padding: 0.75rem; color: #e2e8f0;">Dringlichkeit</td>
            <td style="padding: 0.75rem; color: #cbd5e1;">Zeit</td>
            <td style="padding: 0.75rem; color: #e2e8f0;">Status</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
            <td style="padding: 0.75rem; color: #f1f5f9;">Maria Schmidt</td>
            <td style="padding: 0.75rem; color: #cbd5e1;">Zahnschmerzen</td>
            <td style="padding: 0.75rem;"><span style="background: #dc2626; color: white; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem;">🚨 Akut</span></td>
            <td style="padding: 0.75rem; color: #cbd5e1;">14:30</td>
            <td style="padding: 0.75rem; color: #00C896;">Neu</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
            <td style="padding: 0.75rem; color: #f1f5f9;">Thomas Müller</td>
            <td style="padding: 0.75rem; color: #cbd5e1;">Zahnreinigung</td>
            <td style="padding: 0.75rem;"><span style="background: #00C896; color: #0f172a; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem;">Normal</span></td>
            <td style="padding: 0.75rem; color: #cbd5e1;">14:15</td>
            <td style="padding: 0.75rem; color: #94a3b8;">In Bearbeitung</td>
          </tr>
          <tr>
            <td style="padding: 0.75rem; color: #f1f5f9;">Julia Weber</td>
            <td style="padding: 0.75rem; color: #cbd5e1;">Kontrolle</td>
            <td style="padding: 0.75rem;"><span style="background: #00C896; color: #0f172a; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem;">Normal</span></td>
            <td style="padding: 0.75rem; color: #cbd5e1;">14:05</td>
            <td style="padding: 0.75rem; color: #94a3b8;">Abgeschlossen</td>
          </tr>
        </table>
      </div>
    </div>
  </section>

  <!-- Benefits -->
  <section class="benefits">
    <div class="container">
      <h2>Warum Praxen Selaro einsetzen</h2>
      <div class="benefits-grid">
        <div class="benefit-card">
          <div class="benefit-icon">😌</div>
          <h3>Weniger Stress am Telefon</h3>
          <p>Ihre Rezeptionistin muss sich nicht mit hundert Anrufen täglich herumschlagen.</p>
        </div>
        <div class="benefit-card">
          <div class="benefit-icon">🤝</div>
          <h3>Besser informierte Patienten</h3>
          <p>Patienten erhalten sofort professionelle Antworten zu Öffnungszeiten und Leistungen.</p>
        </div>
        <div class="benefit-card">
          <div class="benefit-icon">📊</div>
          <h3>Klare Übersicht für das Team</h3>
          <p>Strukturierte Leads im Dashboard ermöglichen schnelle und organisierte Nachfassung.</p>
        </div>
        <div class="benefit-card">
          <div class="benefit-icon">⏰</div>
          <h3>Mehr Zeit für Behandlungen</h3>
          <p>Das gesamte Team konzentriert sich auf das, was zählt: die Patientenbehandlung.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Integrations -->
  <section class="integrations">
    <div class="container">
      <h2>Integrationen mit Ihren Systemen</h2>
      <p style="text-align: center; color: #cbd5e1; margin-bottom: 2rem;">Integration mit Ihren bestehenden Systemen (coming soon)</p>
      <div class="integrations-grid">
        <div class="integration-item">
          <div class="logo">🔵</div>
          <p>Doctolib</p>
          <div class="coming-soon">Coming Soon</div>
        </div>
        <div class="integration-item">
          <div class="logo">📅</div>
          <p>Google Calendar</p>
          <div class="coming-soon">Coming Soon</div>
        </div>
        <div class="integration-item">
          <div class="logo">📧</div>
          <p>Outlook</p>
          <div class="coming-soon">Coming Soon</div>
        </div>
        <div class="integration-item">
          <div class="logo">🔗</div>
          <p>WordPress</p>
          <div class="coming-soon">Coming Soon</div>
        </div>
        <div class="integration-item">
          <div class="logo">🎤</div>
          <p>OpenAI Voice</p>
          <div class="coming-soon">Coming Soon</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Testimonials -->
  <section class="testimonials">
    <div class="container">
      <h2>Was Praxen über Selaro sagen</h2>
      <div class="testimonials-grid">
        <div class="testimonial-card">
          <div class="testimonial-quote">
            "Selaro hat unsere Telefonbeantworter-Situation komplett revolutioniert. Patienten sind immer sofort verbunden, und alle Daten sind perfekt organisiert."
          </div>
          <div class="testimonial-author">Dr. Müller</div>
          <div class="testimonial-role">Zahnarztpraxis Leipzig</div>
        </div>
        <div class="testimonial-card">
          <div class="testimonial-quote">
            "Die KI versteht wirklich, was eine Zahnpraxis braucht. Zahnschmerzen werden erkannt, und unser Team kann sich auf wichtigere Aufgaben konzentrieren."
          </div>
          <div class="testimonial-author">Petra Hoffmann</div>
          <div class="testimonial-role">Praxismanagerin Dresden</div>
        </div>
        <div class="testimonial-card">
          <div class="testimonial-quote">
            "Seit wir Selaro nutzen, verpassen wir keinen Anruf mehr. Das ist wie einen Assistenten zu haben, der rund um die Uhr arbeitet – ohne Müdigkeit."
          </div>
          <div class="testimonial-author">Dr. Klein</div>
          <div class="testimonial-role">Zahnarztpraxis München</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Pilot Phase Section -->
  <section class="pricing">
    <div class="container">
      <h2 style="text-align: center; margin-bottom: 2rem;">Aktuell in Pilotphase</h2>
      <div style="max-width: 700px; margin: 0 auto; text-align: center;">
        <p style="color: #cbd5e1; font-size: 1.05rem; margin-bottom: 2rem; line-height: 1.7;">
          Selaro wird derzeit mit ausgewählten Zahnarztpraxen getestet. Wenn Sie Interesse an einer Zusammenarbeit haben, schreiben Sie uns für ein unverbindliches Angebot.
        </p>
        <a href="#contact" class="btn btn-primary">Unverbindliche Demo anfragen</a>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="faq">
    <div class="container">
      <h2>Häufige Fragen</h2>
      <div class="faq-container">
        <div class="faq-item">
          <div class="faq-question">
            <span>Wie funktioniert die Integration?</span>
            <span class="faq-toggle">▼</span>
          </div>
          <div class="faq-answer">
            Sie verbinden einfach Ihre Zahnarztpraxis-Telefonnummer mit Selaro. Wir kümmern uns um den technischen Setup (typisch 24-48 Stunden). Keine Softwareinstallation nötig.
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>Brauchen wir neue Telefonnummern?</span>
            <span class="faq-toggle">▼</span>
          </div>
          <div class="faq-answer">
            Nein. Sie behalten Ihre bestehende Nummer. Wir leiten eingehende Anrufe einfach an Selaro weiter, die dann das Gespräch übernimmt.
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>Ist Selaro DSGVO-konform?</span>
            <span class="faq-toggle">▼</span>
          </div>
          <div class="faq-answer">
            Ja, vollständig. Alle Patientendaten werden verschlüsselt und nach den strengsten DSGVO-Standards behandelt. Wir sind zertifiziert und regelmäßig auditiert.
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>Wie lange dauert die Einrichtung?</span>
            <span class="faq-toggle">▼</span>
          </div>
          <div class="faq-answer">
            Etwa 24-48 Stunden nach Vertragsunterzeichnung. Wir kümmern uns um alle technischen Schritte. Sie müssen nur Ihre Praxisinformationen bereitstellen.
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>Kann die KI mehrsprachig antworten?</span>
            <span class="faq-toggle">▼</span>
          </div>
          <div class="faq-answer">
            Ja. Selaro kann auf Deutsch, Englisch und anderen Sprachen antworten. Die Sprache wird automatisch erkannt oder kann vorkonfiguriert werden.
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>Was passiert bei Anrufen nach Feierabend?</span>
            <span class="faq-toggle">▼</span>
          </div>
          <div class="faq-answer">
            Selaro beantwortet alle Anrufe 24/7. Sie können Ihre Öffnungszeiten konfigurieren, damit die KI weiß, wann die Praxis offen ist – und dementsprechend antwortet.
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>Können wir mit der KI chatten?</span>
            <span class="faq-toggle">▼</span>
          </div>
          <div class="faq-answer">
            Im Demo-Modus kann man die KI via Chat testen. Im Live-Betrieb erfolgt die Kommunikation primär über Telefonanrufe – das ist der Hauptzweck von Selaro.
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Contact Section -->
  <section id="contact">
    <div class="container">
      <h2>Bereit für eine persönliche Demo?</h2>
      <div class="contact-wrapper">
        <p class="contact-text">
          Erfahren Sie live, wie Selaro Ihre Zahnarztpraxis revolutioniert. Wir zeigen Ihnen alles und beantworten alle Ihre Fragen.
        </p>
        <form class="contact-form" onsubmit="handleContactForm(event)">
          <div class="form-group">
            <label for="name">Ihr Name</label>
            <input type="text" id="name" name="name" required placeholder="z.B. Dr. Müller">
          </div>
          <div class="form-group">
            <label for="email">E-Mail</label>
            <input type="email" id="email" name="email" required placeholder="praxis@zahnarzt.de">
          </div>
          <div class="form-group">
            <label for="clinic">Name der Praxis</label>
            <input type="text" id="clinic" name="clinic" required placeholder="z.B. Zahnarztpraxis Leipzig">
          </div>
          <div class="form-group">
            <label for="message">Nachricht</label>
            <textarea id="message" name="message" placeholder="Ihre Fragen oder Anforderungen..."></textarea>
          </div>
          <div class="contact-buttons">
            <button type="submit" class="btn btn-primary">Nachricht senden</button>
            <a href="mailto:kontakt@selaro.de?subject=Selaro%20Demo%20Anfrage" class="btn btn-secondary" style="text-align: center;">E-Mail öffnen</a>
          </div>
        </form>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer>
    <div class="container">
      <div class="logo-link navbar-logo" style="margin-bottom: 1rem; justify-content: center;">
        <div class="navbar-logo-text">Selaro</div>
        <div class="navbar-logo-subtitle">AI Reception für Zahnarztpraxen</div>
      </div>
      <p style="margin-bottom: 1rem;">
        <a href="#kontakt">Kontakt</a> · <a href="#datenschutz">Datenschutz</a> · <a href="#impressum">Impressum</a>
      </p>
      <p style="margin-top: 1rem; opacity: 0.8;">© 2024 Selaro. Alle Rechte vorbehalten.</p>
    </div>
  </footer>

  <script>
    // FAQ Accordion
    document.querySelectorAll('.faq-question').forEach(question => {
      question.addEventListener('click', () => {
        const item = question.parentElement;
        item.classList.toggle('open');
      });
    });

    // Dark mode toggle
    function initDarkMode() {
      const html = document.documentElement;
      const stored = localStorage.getItem('darkMode');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = stored !== null ? stored === 'true' : prefersDark;
      
      if (isDark) {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }
    }
    
    initDarkMode();
  </script>
</body>
</html>
  `;
  res.type('html').send(html);
});

// Dashboard page - shows stats and recent leads
app.get('/dashboard', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    // Fetch all leads
    const { data: allLeads, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching leads for dashboard:', error);
      return res
        .status(500)
        .type('html')
        .send('<h1>Fehler beim Laden des Dashboards</h1><p>' + error.message + '</p>');
    }

    const leads = allLeads || [];
    
    // Fetch appointments for today
    const { data: appointmentsData, error: appointmentsError } = await supabase
      .from('appointments')
      .select('*')
      .eq('appointment_date', today.toISOString().split('T')[0])
      .order('appointment_time', { ascending: true });

    const appointments = appointmentsData || [];
    const todayAppointmentsCount = appointments.length;
    const upcomingAppointments = appointments.slice(0, 5);

    // Compute stats
    const newRequestsToday = leads.filter(l => l.created_at >= todayIso).length;
    const acuteCasesToday = leads.filter(l => l.created_at >= todayIso && l.urgency === 'akut').length;
    const openLeads = leads.filter(l => l.status === 'new').length;
    const recentLeads = leads.slice(0, 5);

    // Get today's activities (leads created today, sorted by newest first)
    const activitiesToday = leads
      .filter(l => l.created_at >= todayIso)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Calculate last 7 days analytics
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoIso = sevenDaysAgo.toISOString();

    const callsLast7Days = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      callsLast7Days[dateKey] = 0;
    }

    leads.forEach(lead => {
      if (lead.created_at >= sevenDaysAgoIso) {
        const dateKey = lead.created_at.split('T')[0];
        if (callsLast7Days.hasOwnProperty(dateKey)) {
          callsLast7Days[dateKey]++;
        }
      }
    });

    const dailyCallsArray = Object.entries(callsLast7Days).map(([date, count]) => ({
      date: date,
      count: count,
      dayLabel: new Date(date).toLocaleDateString('de-DE', { weekday: 'short' }).substring(0, 2)
    }));

    const totalAcute = leads.filter(l => l.urgency === 'akut').length;
    const totalNormal = leads.filter(l => l.urgency !== 'akut' && l.urgency).length;

    // Group leads by status for Kanban board
    const statusGroups = {
      'neu': leads.filter(l => l.status === 'new').slice(0, 5),
      'rueckruf': leads.filter(l => l.status === 'callback').slice(0, 5),
      'termin': leads.filter(l => l.status === 'scheduled').slice(0, 5),
      'nicht_erreicht': leads.filter(l => l.status === 'lost').slice(0, 5)
    };
    
    const statusCounts = {
      'neu': leads.filter(l => l.status === 'new').length,
      'rueckruf': leads.filter(l => l.status === 'callback').length,
      'termin': leads.filter(l => l.status === 'scheduled').length,
      'nicht_erreicht': leads.filter(l => l.status === 'lost').length
    };

    // Get today's acute cases
    const acuteCasesForWidget = leads
      .filter(l => l.created_at >= todayIso && l.urgency === 'akut')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Get callback queue (leads needing call-back)
    const callbackQueueAll = leads
      .filter(l => l.status === 'callback')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const callbackQueue = callbackQueueAll.slice(0, 10);
    const callbackQueueCount = callbackQueueAll.length;

    const html = `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard – Selaro</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      min-height: 100vh;
      display: flex;
    }

    /* Sidebar */
    .sidebar {
      width: 260px;
      background: #0f172a;
      color: white;
      padding: 2rem 0;
      position: fixed;
      left: 0;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      z-index: 1000;
    }

    .sidebar-logo {
      padding: 0 1.5rem 2rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      margin-bottom: 2rem;
    }

    .logo-text {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 0.25rem;
      color: white;
    }

    .logo-subtitle {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
    }

    .sidebar-logo.logo-link {
      display: flex;
      flex-direction: column;
    }

    .nav-menu {
      list-style: none;
    }

    .nav-item {
      padding: 0 1rem;
      margin-bottom: 0.5rem;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0.75rem 1rem;
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      border-radius: 0.5rem;
      transition: all 0.2s ease;
      font-size: 14px;
      font-weight: 500;
    }

    .nav-link:hover {
      background: rgba(255, 255, 255, 0.1);
      color: white;
    }

    .nav-link.active {
      background: #00C896;
      color: #0f172a;
    }

    .nav-icon {
      width: 18px;
      height: 18px;
      font-size: 16px;
    }

    /* Main Content */
    .main-container {
      flex: 1;
      margin-left: 260px;
      display: flex;
      flex-direction: column;
    }

    .top-bar {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 1.5rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 70px;
    }

    .top-bar-title {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
    }

    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 1rem;
      font-size: 14px;
      color: #6b7280;
    }

    .demo-badge {
      background: #eff6ff;
      color: #1e40af;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-weight: 500;
      font-size: 12px;
    }

    .content {
      flex: 1;
      padding: 2rem;
      overflow-y: auto;
    }

    @media (max-width: 768px) {
      .content {
        padding: 1.5rem;
      }
    }

    @media (max-width: 480px) {
      .content {
        padding: 1rem;
      }
    }

    /* Shared Card Style */
    .card-base {
      background: #fff;
      border-radius: 1.125rem;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    @media (max-width: 1024px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 640px) {
      .stats-grid {
        grid-template-columns: 1fr;
        gap: 1rem;
      }
    }

    .stat-card {
      padding: 1.5rem;
      background: #fff;
      border-radius: 1.125rem;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    .stat-label {
      font-size: 0.9rem;
      color: #6b7280;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }

    .stat-number {
      font-size: 1.8rem;
      font-weight: 700;
      color: #111827;
    }

    /* Section Spacing */
    .section-title {
      font-size: 1.4rem;
      font-weight: 600;
      color: #111827;
      margin-bottom: 0.75rem;
      margin-top: 0;
      word-break: break-word;
      overflow-wrap: break-word;
    }

    @media (max-width: 640px) {
      .section-title {
        font-size: 1.1rem;
      }
    }

    /* Dashboard Sections */
    .today-overview,
    .activity-feed-section,
    .urgent-cases-section,
    .appointments-section,
    .callback-queue-section,
    .analytics-section,
    .kanban-section {
      margin-bottom: 2rem;
    }

    .leads-table {
      background: white;
      border-radius: 1.125rem;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      background: #f9fafb;
      padding: 1rem;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e5e7eb;
    }

    td {
      padding: 1rem;
      border-bottom: 1px solid #f3f4f6;
      font-size: 14px;
      color: #374151;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover {
      background: #f9fafb;
    }

    .urgency-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }

    .urgency-akut {
      background: #fee2e2;
      color: #991b1b;
    }

    .urgency-normal {
      background: #dbeafe;
      color: #1e40af;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: #6b7280;
    }

    /* Activity Feed Styling */
    .activity-card {
      background: white;
      border-radius: 0.75rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .activity-list {
      divide-y divide-gray-200;
    }

    .activity-item {
      display: flex;
      gap: 1rem;
      padding: 1.25rem;
      transition: background 0.15s ease;
      min-height: 44px;
      align-items: flex-start;
    }

    .activity-item:hover {
      background: #f9fafb;
    }

    .activity-item.activity-urgent {
      background: #fef2f2;
    }

    .activity-item.activity-urgent:hover {
      background: #fee2e2;
    }

    .activity-icon {
      font-size: 20px;
      flex-shrink: 0;
      line-height: 1.5;
    }

    .activity-content {
      flex: 1;
    }

    .activity-time {
      font-size: 13px;
      font-weight: 600;
      color: #6b7280;
      margin-bottom: 0.25rem;
    }

    .activity-patient {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 0.25rem;
    }

    .activity-reason {
      font-size: 13px;
      color: #6b7280;
    }

    /* Urgent Cases Widget Styling */
    .urgent-cases-section {
      margin-top: 2rem;
      margin-bottom: 2rem;
    }

    .urgent-cases-card {
      background: white;
      border-radius: 0.75rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      border-left: 4px solid #dc2626;
      overflow: hidden;
    }

    .urgent-cases-list {
      display: flex;
      flex-direction: column;
    }

    .urgent-case-item {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      transition: background 0.15s ease;
      min-height: 44px;
      align-items: flex-start;
    }

    .urgent-case-item:hover {
      background: #fef2f2;
    }

    .urgent-case-time {
      font-size: 13px;
      font-weight: 700;
      color: #dc2626;
      min-width: 50px;
      flex-shrink: 0;
    }

    .urgent-case-content {
      flex: 1;
    }

    .urgent-case-name {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 0.25rem;
    }

    .urgent-case-reason {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 0.25rem;
    }

    .urgent-case-phone {
      font-size: 12px;
      color: #9ca3af;
      font-family: 'Courier New', monospace;
    }

    .urgent-cases-empty {
      text-align: center;
      padding: 2rem 1rem;
      color: #6b7280;
      font-size: 14px;
    }

    /* Appointments Widget Styling */
    .appointments-section {
      margin-top: 2rem;
      margin-bottom: 2rem;
    }

    .appointments-card {
      background: white;
      border-radius: 0.75rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .appointments-list {
      display: flex;
      flex-direction: column;
    }

    .appointment-item {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      transition: background 0.15s ease;
      min-height: 44px;
      align-items: flex-start;
    }

    .appointment-item:hover {
      background: #f9fafb;
    }

    .appointment-time {
      font-size: 14px;
      font-weight: 700;
      color: #1e40af;
      min-width: 50px;
      flex-shrink: 0;
    }

    .appointment-content {
      flex: 1;
    }

    .appointment-patient {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 0.25rem;
    }

    .appointment-reason {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 0.25rem;
    }

    .appointment-phone {
      font-size: 12px;
      color: #9ca3af;
      font-family: 'Courier New', monospace;
    }

    .appointments-empty {
      text-align: center;
      padding: 2rem 1rem;
      color: #6b7280;
      font-size: 14px;
    }

    /* Call-back Queue Styling */
    .callback-queue-section {
      margin-top: 2rem;
      margin-bottom: 2rem;
    }

    .callback-queue-card {
      background: white;
      border-radius: 0.75rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .callback-queue-list {
      display: flex;
      flex-direction: column;
    }

    .callback-queue-item {
      display: flex;
      gap: 0.75rem;
      padding: 1rem;
      transition: background 0.15s ease;
      min-height: 44px;
      align-items: flex-start;
    }

    .callback-queue-item:hover {
      background: #f9fafb;
    }

    .callback-queue-icon {
      font-size: 18px;
      flex-shrink: 0;
      line-height: 1.5;
    }

    .callback-queue-content {
      flex: 1;
    }

    .callback-queue-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .callback-queue-name {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
    }

    .callback-urgency-badge {
      display: inline-block;
      background: #fee2e2;
      color: #991b1b;
      font-size: 11px;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 999px;
    }

    .callback-queue-phone {
      font-size: 13px;
      font-family: 'Courier New', monospace;
      color: #374151;
      font-weight: 500;
      margin-bottom: 0.25rem;
    }

    .callback-queue-reason {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 0.25rem;
    }

    .callback-queue-time {
      font-size: 11px;
      color: #9ca3af;
    }

    .callback-queue-empty {
      text-align: center;
      padding: 2rem 1rem;
      color: #6b7280;
      font-size: 14px;
    }

    .callback-queue-more {
      text-align: center;
      font-size: 12px;
      color: #3b82f6;
      font-weight: 600;
      padding: 0.75rem;
      cursor: pointer;
    }

    .callback-queue-more:hover {
      color: #2563eb;
    }

    /* Analytics Styling */
    .analytics-section {
      margin-top: 2rem;
    }

    .analytics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
    }

    .analytics-card {
      background: white;
      border-radius: 0.75rem;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .chart-title {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 1.5rem;
    }

    /* Bar Chart */
    .bar-chart {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      gap: 0.75rem;
      height: 200px;
    }

    .bar-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }

    .bar-container {
      flex: 1;
      width: 100%;
      background: #f3f4f6;
      border-radius: 0.375rem;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      min-height: 10px;
    }

    .bar {
      width: 100%;
      max-width: 100%;
      background: linear-gradient(180deg, #3b82f6 0%, #1e40af 100%);
      border-radius: 0.25rem;
      transition: background 0.2s ease;
    }

    .bar:hover {
      background: linear-gradient(180deg, #2563eb 0%, #1e40af 100%);
    }

    .bar-label {
      font-size: 12px;
      color: #6b7280;
      font-weight: 600;
      margin-top: 0.5rem;
    }

    .bar-value {
      font-size: 12px;
      color: #374151;
      font-weight: 700;
      margin-top: 0.25rem;
    }

    /* Donut Chart */
    .donut-chart-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }

    .donut-chart {
      max-width: 150px;
    }

    .chart-legend {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 13px;
      color: #374151;
    }

    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 0.25rem;
      flex-shrink: 0;
    }

    @media (max-width: 768px) {
      .analytics-grid {
        grid-template-columns: 1fr;
      }

      .chart-container {
        min-height: 300px;
      }
    }

    @media (max-width: 480px) {
      .chart-container {
        min-height: 250px;
      }

      .bar-chart {
        max-width: 100%;
        overflow-x: auto;
      }
    }

    /* Kanban Board Styling */
    .kanban-section {
      margin-top: 2rem;
    }

    .kanban-board {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
    }

    .kanban-column {
      background: white;
      border-radius: 0.75rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 500px;
    }

    .kanban-header {
      background: #f9fafb;
      padding: 1rem;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .kanban-header h3 {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      margin: 0;
    }

    .kanban-count {
      background: #e5e7eb;
      color: #374151;
      font-size: 12px;
      font-weight: 700;
      padding: 0.25rem 0.5rem;
      border-radius: 999px;
      min-width: 24px;
      text-align: center;
    }

    .kanban-items {
      flex: 1;
      overflow-y: auto;
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .kanban-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 0.5rem;
      padding: 0.75rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .kanban-card:hover {
      background: #f3f4f6;
      border-color: #d1d5db;
    }

    .card-name {
      font-size: 13px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 0.25rem;
    }

    .card-reason {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 0.5rem;
      line-height: 1.4;
    }

    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .card-urgency {
      font-size: 11px;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 999px;
      text-transform: capitalize;
    }

    .urgency-badge-akut {
      background: #fee2e2;
      color: #991b1b;
    }

    .urgency-badge-normal {
      background: #dbeafe;
      color: #1e40af;
    }

    .card-time {
      font-size: 11px;
      color: #9ca3af;
    }

    .kanban-empty {
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
      padding: 1.5rem 0.5rem;
    }

    .kanban-more {
      text-align: center;
      font-size: 12px;
      color: #3b82f6;
      font-weight: 600;
      padding: 0.5rem;
      cursor: pointer;
    }

    .kanban-more:hover {
      color: #2563eb;
    }

    @media (max-width: 1200px) {
      .kanban-board {
        grid-template-columns: repeat(2, 1fr);
      }

      .kanban-column {
        height: 400px;
      }
    }

    @media (max-width: 768px) {
      .kanban-board {
        grid-template-columns: 1fr;
        overflow-x: auto;
        padding-bottom: 1rem;
      }

      .kanban-column {
        height: 300px;
        min-width: 280px;
      }
    }

    @media (max-width: 480px) {
      .kanban-column {
        height: 250px;
        min-width: 250px;
      }

      .kanban-card {
        padding: 0.5rem;
        min-height: 44px;
      }
    }

    @media (max-width: 1024px) {
      .sidebar {
        width: 220px;
      }

      .main-container {
        margin-left: 220px;
      }
    }

    @media (max-width: 768px) {
      .sidebar {
        width: 200px;
        padding: 1rem 0;
      }

      .main-container {
        margin-left: 200px;
      }

      .top-bar {
        padding: 1rem;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
        height: auto;
      }

      .stats-grid {
        grid-template-columns: 1fr;
      }

      table {
        font-size: 13px;
      }

      td, th {
        padding: 0.75rem;
      }
    }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <a href="/" class="logo-link sidebar-logo" title="Zur Startseite">
      <div class="logo-text">Selaro</div>
      <div class="logo-subtitle">AI Reception</div>
    </a>
    
    <nav>
      <ul class="nav-menu">
        <li class="nav-item">
          <a href="/dashboard" class="nav-link active">
            <span class="nav-icon">📊</span>
            <span>Dashboard</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="/simulate" class="nav-link">
            <span class="nav-icon">💬</span>
            <span>Simulator</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="/leads" class="nav-link">
            <span class="nav-icon">📋</span>
            <span>Leads</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="/settings" class="nav-link">
            <span class="nav-icon">⚙️</span>
            <span>Einstellungen</span>
          </a>
        </li>
      </ul>
    </nav>
  </aside>

  <!-- Main Content -->
  <div class="main-container">
    <!-- Top Bar -->
    <div class="top-bar">
      <h1 class="top-bar-title">Dashboard</h1>
      <div class="top-bar-right">
        <span>Zahnarztpraxis Stela Xhelili</span>
        <span class="demo-badge">Demo</span>
      </div>
    </div>

    <!-- Content -->
    <div class="content">
      <!-- Today Overview Section -->
      <section class="today-overview">
        <div class="stats-grid">
          <div class="stat-card">
            <div style="font-size: 24px; margin-bottom: 0.75rem;">📞</div>
            <div class="stat-label">Anrufe heute</div>
            <div class="stat-number">${newRequestsToday}</div>
          </div>
          <div class="stat-card">
            <div style="font-size: 24px; margin-bottom: 0.75rem;">⚠️</div>
            <div class="stat-label">Akutfälle</div>
            <div class="stat-number">${acuteCasesToday}</div>
          </div>
          <div class="stat-card">
            <div style="font-size: 24px; margin-bottom: 0.75rem;">📅</div>
            <div class="stat-label">Termine heute</div>
            <div class="stat-number">${todayAppointmentsCount}</div>
          </div>
          <div class="stat-card">
            <div style="font-size: 24px; margin-bottom: 0.75rem;">❗</div>
            <div class="stat-label">Unbeantwortet</div>
            <div class="stat-number">${openLeads}</div>
          </div>
        </div>
      </section>

      <!-- Activity Feed Section -->
      <section class="activity-feed-section">
        <h2 class="section-title">Aktivität heute</h2>
        <div class="activity-card">
          ${activitiesToday.length > 0 ? `
            <div class="activity-list">
              ${activitiesToday.map((activity, index) => {
                const time = new Date(activity.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                const urgencyClass = activity.urgency === 'akut' ? 'activity-urgent' : 'activity-normal';
                const urgencyText = activity.urgency === 'akut' ? '(akut)' : '(normal)';
                return `
                  <div class="activity-item ${urgencyClass}" ${index < activitiesToday.length - 1 ? 'style="border-bottom: 1px solid #e5e7eb;"' : ''}>
                    <div class="activity-icon">📞</div>
                    <div class="activity-content">
                      <div class="activity-time">${time} · Neue Anfrage</div>
                      <div class="activity-patient">${activity.name || 'Unbekannt'}</div>
                      <div class="activity-reason">${activity.concern || activity.reason || 'Grund nicht angegeben'} ${urgencyText}</div>
                      <div style="margin-top: 8px;">
                        <a href="/leads?lead=${activity.id}" class="action-link" style="font-size: 12px; color: rgba(255,255,255,0.8); text-decoration: none;">Details ansehen →</a>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="empty-state">
              <p>Heute gibt es noch keine Aktivitäten.</p>
            </div>
          `}
        </div>
      </section>

      <!-- Urgent Cases Widget -->
      <section class="urgent-cases-section">
        <h2 class="section-title">🚨 Akutfälle heute</h2>
        <div class="urgent-cases-card">
          ${acuteCasesForWidget.length > 0 ? `
            <div class="urgent-cases-list">
              ${acuteCasesForWidget.map((lead, index) => {
                const time = new Date(lead.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                const phone = lead.phone || 'Keine Nummer';
                return `
                  <div class="urgent-case-item" ${index < acuteCasesForWidget.length - 1 ? 'style="border-bottom: 1px solid #fee2e2;"' : ''}>
                    <div class="urgent-case-time">${time}</div>
                    <div class="urgent-case-content">
                      <div class="urgent-case-name">${lead.name || 'Unbekannt'}</div>
                      <div class="urgent-case-reason">${lead.concern || lead.reason || 'Grund nicht angegeben'}</div>
                      <div class="urgent-case-phone">${phone}</div>
                      <div style="margin-top: 8px; display: flex; gap: 12px;">
                        <a href="/leads?lead=${lead.id}" class="action-link">Details</a>
                        <button class="action-link" style="background: none; border: none; padding: 0; cursor: pointer;" onclick="window.dashboardActions.openAppointmentModal('${lead.id}', '${(lead.name || '').replace(/'/g, "\\'")}', '${(lead.phone || '').replace(/'/g, "\\'")}')" data-testid="button-appointment-${lead.id}">Termin</button>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="urgent-cases-empty">
              <p>Heute wurden keine Akutfälle gemeldet. 👍</p>
            </div>
          `}
        </div>
      </section>

      <!-- Today's Appointments Widget -->
      <section class="appointments-section">
        <h2 class="section-title">📅 Heutige Termine</h2>
        <div class="appointments-card">
          ${appointments.length > 0 ? `
            <div class="appointments-list">
              ${appointments.map((apt, index) => {
                const time = apt.appointment_time ? apt.appointment_time.substring(0, 5) : '--:--';
                const phone = apt.patient_phone || 'Keine Nummer';
                return `
                  <div class="appointment-item" ${index < appointments.length - 1 ? 'style="border-bottom: 1px solid #e5e7eb;"' : ''}>
                    <div class="appointment-time">${time}</div>
                    <div class="appointment-content">
                      <div class="appointment-patient">${apt.patient_name || 'Unbekannt'}</div>
                      <div class="appointment-reason">${apt.reason || 'Grund nicht angegeben'}</div>
                      <div class="appointment-phone">${phone}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="appointments-empty">
              <p>Für heute sind keine Termine eingetragen.</p>
            </div>
          `}
        </div>
      </section>

      <!-- Call-back Queue Widget -->
      <section class="callback-queue-section">
        <h2 class="section-title">📞 Rückruf-Warteliste</h2>
        <div class="callback-queue-card">
          ${callbackQueue.length > 0 ? `
            <div class="callback-queue-list">
              ${callbackQueue.map((lead, index) => {
                const createdTime = new Date(lead.created_at).toLocaleString('de-DE', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit'
                });
                const phone = lead.phone || 'Keine Nummer';
                const urgencyBadge = lead.urgency === 'akut' ? '<span class="callback-urgency-badge">akut</span>' : '';
                return `
                  <div class="callback-queue-item" ${index < callbackQueue.length - 1 ? 'style="border-bottom: 1px solid #e5e7eb;"' : ''}>
                    <div class="callback-queue-icon">📞</div>
                    <div class="callback-queue-content">
                      <div class="callback-queue-header">
                        <div class="callback-queue-name">${lead.name || 'Unbekannt'}</div>
                        ${urgencyBadge}
                      </div>
                      <div class="callback-queue-phone">${phone}</div>
                      <div class="callback-queue-reason">${lead.concern || lead.reason || 'Grund nicht angegeben'}</div>
                      <div class="callback-queue-time">${createdTime}</div>
                      <div style="margin-top: 8px; display: flex; gap: 12px;">
                        <a href="/leads?lead=${lead.id}" class="action-link">Details</a>
                        <button class="action-link" style="background: none; border: none; padding: 0; cursor: pointer;" onclick="window.dashboardActions.markCallbackDone('${lead.id}')" data-testid="button-callback-done-${lead.id}">Erledigt</button>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
              ${callbackQueueCount > 10 ? `<div class="callback-queue-more">+${callbackQueueCount - 10} weitere in der Warteliste</div>` : ''}
            </div>
          ` : `
            <div class="callback-queue-empty">
              <p>Keine Patienten in der Rückruf-Warteliste.</p>
            </div>
          `}
        </div>
      </section>

      <!-- Analytics Section -->
      <section class="analytics-section">
        <h2 class="section-title">Analytics</h2>
        <div class="analytics-grid">
          <!-- Chart 1: Calls per Day -->
          <div class="analytics-card">
            <h3 class="chart-title">Anrufe pro Tag (letzte 7 Tage)</h3>
            <div class="bar-chart">
              ${dailyCallsArray.map(day => {
                const maxCount = Math.max(...dailyCallsArray.map(d => d.count), 5);
                const height = (day.count / maxCount) * 100;
                return `
                  <div class="bar-item">
                    <div class="bar-container">
                      <div class="bar" style="height: ${height}%;" title="${day.count} Anrufe"></div>
                    </div>
                    <div class="bar-label">${day.dayLabel}</div>
                    <div class="bar-value">${day.count}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Chart 2: Acute vs Normal -->
          <div class="analytics-card">
            <h3 class="chart-title">Anfragetypen</h3>
            <div class="donut-chart-container">
              <svg class="donut-chart" width="200" height="200" viewBox="0 0 200 200">
                ${totalAcute + totalNormal > 0 ? `
                  <circle cx="100" cy="100" r="90" fill="none" stroke="#dbeafe" stroke-width="40"></circle>
                  ${totalAcute > 0 ? `
                    <circle cx="100" cy="100" r="90" fill="none" stroke="#fee2e2" stroke-width="40" 
                      stroke-dasharray="${(totalAcute / (totalAcute + totalNormal)) * 565.48} 565.48" 
                      stroke-dashoffset="0" transform="rotate(-90 100 100)"></circle>
                  ` : ''}
                  <text x="100" y="110" text-anchor="middle" font-size="24" font-weight="700" fill="#111827">
                    ${totalAcute + totalNormal}
                  </text>
                ` : `
                  <circle cx="100" cy="100" r="90" fill="none" stroke="#e5e7eb" stroke-width="40"></circle>
                  <text x="100" y="110" text-anchor="middle" font-size="16" fill="#9ca3af">Keine Daten</text>
                `}
              </svg>
              <div class="chart-legend">
                <div class="legend-item">
                  <div class="legend-color" style="background: #dbeafe;"></div>
                  <span>Normal: <strong>${totalNormal}</strong></span>
                </div>
                <div class="legend-item">
                  <div class="legend-color" style="background: #fee2e2;"></div>
                  <span>Akut: <strong>${totalAcute}</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Kanban Status Board -->
      <section class="kanban-section">
        <h2 class="section-title">Lead-Status</h2>
        <div class="kanban-board">
          <!-- Column 1: Neu -->
          <div class="kanban-column">
            <div class="kanban-header">
              <h3>Neu</h3>
              <span class="kanban-count">${statusCounts.neu}</span>
            </div>
            <div class="kanban-items">
              ${statusGroups.neu.length > 0 ? `
                ${statusGroups.neu.map(lead => {
                  const time = new Date(lead.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                  const urgencyClass = lead.urgency === 'akut' ? 'urgency-badge-akut' : 'urgency-badge-normal';
                  return `
                    <div class="kanban-card">
                      <div class="card-name">${lead.name || 'Unbekannt'}</div>
                      <div class="card-reason">${lead.concern || lead.reason || 'Grund nicht angegeben'}</div>
                      <div class="card-footer">
                        <span class="card-urgency ${urgencyClass}">${lead.urgency || 'normal'}</span>
                        <span class="card-time">${time}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
                ${statusCounts.neu > 5 ? `<div class="kanban-more">+${statusCounts.neu - 5} weitere</div>` : ''}
              ` : `<div class="kanban-empty">Keine Leads</div>`}
            </div>
          </div>

          <!-- Column 2: Rückruf nötig -->
          <div class="kanban-column">
            <div class="kanban-header">
              <h3>Rückruf nötig</h3>
              <span class="kanban-count">${statusCounts.rueckruf}</span>
            </div>
            <div class="kanban-items">
              ${statusGroups.rueckruf.length > 0 ? `
                ${statusGroups.rueckruf.map(lead => {
                  const time = new Date(lead.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                  const urgencyClass = lead.urgency === 'akut' ? 'urgency-badge-akut' : 'urgency-badge-normal';
                  return `
                    <div class="kanban-card">
                      <div class="card-name">${lead.name || 'Unbekannt'}</div>
                      <div class="card-reason">${lead.concern || lead.reason || 'Grund nicht angegeben'}</div>
                      <div class="card-footer">
                        <span class="card-urgency ${urgencyClass}">${lead.urgency || 'normal'}</span>
                        <span class="card-time">${time}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
                ${statusCounts.rueckruf > 5 ? `<div class="kanban-more">+${statusCounts.rueckruf - 5} weitere</div>` : ''}
              ` : `<div class="kanban-empty">Keine Leads</div>`}
            </div>
          </div>

          <!-- Column 3: Termin vereinbart -->
          <div class="kanban-column">
            <div class="kanban-header">
              <h3>Termin vereinbart</h3>
              <span class="kanban-count">${statusCounts.termin}</span>
            </div>
            <div class="kanban-items">
              ${statusGroups.termin.length > 0 ? `
                ${statusGroups.termin.map(lead => {
                  const time = new Date(lead.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                  const urgencyClass = lead.urgency === 'akut' ? 'urgency-badge-akut' : 'urgency-badge-normal';
                  return `
                    <div class="kanban-card">
                      <div class="card-name">${lead.name || 'Unbekannt'}</div>
                      <div class="card-reason">${lead.concern || lead.reason || 'Grund nicht angegeben'}</div>
                      <div class="card-footer">
                        <span class="card-urgency ${urgencyClass}">${lead.urgency || 'normal'}</span>
                        <span class="card-time">${time}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
                ${statusCounts.termin > 5 ? `<div class="kanban-more">+${statusCounts.termin - 5} weitere</div>` : ''}
              ` : `<div class="kanban-empty">Keine Leads</div>`}
            </div>
          </div>

          <!-- Column 4: Nicht erreicht -->
          <div class="kanban-column">
            <div class="kanban-header">
              <h3>Nicht erreicht</h3>
              <span class="kanban-count">${statusCounts.nicht_erreicht}</span>
            </div>
            <div class="kanban-items">
              ${statusGroups.nicht_erreicht.length > 0 ? `
                ${statusGroups.nicht_erreicht.map(lead => {
                  const time = new Date(lead.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                  const urgencyClass = lead.urgency === 'akut' ? 'urgency-badge-akut' : 'urgency-badge-normal';
                  return `
                    <div class="kanban-card">
                      <div class="card-name">${lead.name || 'Unbekannt'}</div>
                      <div class="card-reason">${lead.concern || lead.reason || 'Grund nicht angegeben'}</div>
                      <div class="card-footer">
                        <span class="card-urgency ${urgencyClass}">${lead.urgency || 'normal'}</span>
                        <span class="card-time">${time}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
                ${statusCounts.nicht_erreicht > 5 ? `<div class="kanban-more">+${statusCounts.nicht_erreicht - 5} weitere</div>` : ''}
              ` : `<div class="kanban-empty">Keine Leads</div>`}
            </div>
          </div>
        </div>
      </section>

      <!-- Additional Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Neue Anfragen (heute)</div>
          <div class="stat-number">${newRequestsToday}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Akutfälle (heute)</div>
          <div class="stat-number">${acuteCasesToday}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Offene Leads</div>
          <div class="stat-number">${openLeads}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Leads insgesamt</div>
          <div class="stat-number">${leads.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Termine (heute)</div>
          <div class="stat-number">${todayAppointmentsCount}</div>
        </div>
      </div>

      <!-- Heutige Termine -->
      <h2 class="section-title">Heutige Termine</h2>
      <div class="leads-table">
        ${upcomingAppointments.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>Uhrzeit</th>
                <th>Patient</th>
                <th>Grund</th>
              </tr>
            </thead>
            <tbody>
              ${upcomingAppointments.map(apt => {
                const time = apt.appointment_time ? apt.appointment_time.substring(0, 5) : '-';
                return `
                  <tr>
                    <td><strong>${time}</strong></td>
                    <td>${apt.patient_name || '-'}</td>
                    <td>${apt.reason || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        ` : `
          <div class="empty-state">
            <p>Keine Termine heute</p>
          </div>
        `}
      </div>

      <!-- Recent Leads -->
      <h2 class="section-title">Zuletzt eingegangene Anfragen</h2>
      <div class="leads-table">
        ${recentLeads.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Grund</th>
                <th>Dringlichkeit</th>
                <th>Zeitstempel</th>
              </tr>
            </thead>
            <tbody>
              ${recentLeads.map(lead => `
                <tr>
                  <td>${lead.name || '-'}</td>
                  <td>${lead.reason || '-'}</td>
                  <td><span class="urgency-badge urgency-${lead.urgency || 'normal'}">${lead.urgency || 'normal'}</span></td>
                  <td>${new Date(lead.created_at).toLocaleString('de-DE')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="empty-state">
            <p>Noch keine Anfragen vorhanden</p>
          </div>
        `}
      </div>
    </div>
  </div>

  <script>
    // Dashboard action handlers for quick actions
    window.dashboardActions = {
      openAppointmentModal: function(leadId, name, phone) {
        // Navigate to /leads and pass lead ID for opening modal
        window.location.href = '/leads?lead=' + encodeURIComponent(leadId) + '&action=appointment';
      },
      markCallbackDone: function(leadId) {
        // Update status to "lost" (Nicht erreicht)
        fetch('/api/leads/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: leadId, status: 'lost' })
        })
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            // Show success message and refresh
            alert('Status aktualisiert - Seite wird neu geladen');
            location.reload();
          } else {
            alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
          }
        })
        .catch(err => {
          console.error('Error:', err);
          alert('Fehler beim Aktualisieren');
        });
      }
    };
  </script>
</body>
</html>
    `;
    res.type('html').send(html);
  } catch (err) {
    console.error('Unexpected error loading dashboard:', err);
    res.status(500).type('html').send('<h1>Fehler</h1><p>' + err.message + '</p>');
  }
});

// Simulator page - premium SaaS UI with glassmorphism to test the AI receptionist
app.get('/simulate', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Selaro – AI Receptionist Simulator</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow-x: hidden;
        }

        /* Shared Navigation Bar */
        .nav-bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 70px;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 40px;
          z-index: 100;
        }

        .nav-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .nav-logo {
          font-size: 18px;
          font-weight: 700;
          color: white;
          letter-spacing: -0.5px;
        }

        .nav-subtitle {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.6);
          font-weight: 400;
        }

        .nav-right {
          display: flex;
          align-items: center;
          gap: 32px;
        }

        .nav-link {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.7);
          text-decoration: none;
          font-weight: 500;
          transition: all 0.2s ease;
          position: relative;
          padding-bottom: 4px;
        }

        .nav-link:hover {
          color: white;
        }

        .nav-link.active {
          color: white;
          border-bottom: 2px solid white;
        }

        /* Content wrapper */
        .app-content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 70px 20px 20px;
          min-height: 100vh;
        }

        /* Glassmorphism Container */
        .glass-card {
          width: 100%;
          max-width: 1200px;
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          display: grid;
          grid-template-columns: 2fr 3fr;
          min-height: 680px;
        }

        /* LEFT COLUMN - Clinic Info */
        .clinic-panel {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          padding: 48px 40px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          border-right: 1px solid rgba(255, 255, 255, 0.2);
          position: relative;
        }

        .tooth-icon {
          width: 48px;
          height: 48px;
          margin-bottom: 24px;
          opacity: 0.9;
        }

        .clinic-title {
          font-size: 26px;
          font-weight: 700;
          color: white;
          margin-bottom: 8px;
          line-height: 1.2;
          letter-spacing: -0.5px;
        }

        .clinic-subtitle {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.8);
          margin-bottom: 32px;
          font-weight: 400;
        }

        .info-item {
          display: flex;
          align-items: center;
          margin-bottom: 16px;
          color: rgba(255, 255, 255, 0.9);
          font-size: 14px;
        }

        .info-item svg {
          width: 18px;
          height: 18px;
          margin-right: 12px;
          opacity: 0.8;
        }

        .clinic-description {
          font-size: 14px;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.75);
          background: rgba(255, 255, 255, 0.08);
          padding: 20px;
          border-radius: 16px;
          margin-top: 32px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .powered-badge {
          display: inline-flex;
          align-items: center;
          padding: 8px 16px;
          background: rgba(255, 255, 255, 0.95);
          color: #2563eb;
          font-size: 12px;
          font-weight: 600;
          border-radius: 999px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          margin-top: auto;
        }

        /* RIGHT COLUMN - Chat */
        .chat-panel {
          background: rgba(255, 255, 255, 0.95);
          display: flex;
          flex-direction: column;
        }

        .chat-header {
          padding: 24px 28px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.5);
          backdrop-filter: blur(10px);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 16px;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
        }

        .header-info {
          display: flex;
          flex-direction: column;
        }

        .header-name {
          font-size: 16px;
          font-weight: 600;
          color: #111827;
          line-height: 1.2;
        }

        .header-subtitle {
          font-size: 13px;
          color: #6b7280;
          line-height: 1.3;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(16, 185, 129, 0.1);
          border-radius: 999px;
          font-size: 13px;
          color: #10b981;
          font-weight: 500;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          background: #10b981;
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(0.9);
          }
        }

        /* Chat Messages */
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          background: transparent;
          max-height: 480px;
        }

        .chat-messages::-webkit-scrollbar {
          width: 6px;
        }

        .chat-messages::-webkit-scrollbar-track {
          background: transparent;
        }

        .chat-messages::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 3px;
        }

        .message {
          display: flex;
          animation: fadeSlideIn 0.4s ease-out;
        }

        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .message.ai {
          justify-content: flex-start;
        }

        .message.user {
          justify-content: flex-end;
        }

        .message-bubble {
          max-width: 72%;
          padding: 14px 18px;
          border-radius: 16px;
          line-height: 1.5;
          word-wrap: break-word;
          font-size: 15px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .message.ai .message-bubble {
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(10px);
          color: #111827;
          border-bottom-left-radius: 4px;
          border: 1px solid rgba(0, 0, 0, 0.05);
        }

        .message.user .message-bubble {
          background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
          color: white;
          border-bottom-right-radius: 4px;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
        }

        /* Input Area */
        .chat-input-area {
          padding: 20px 28px 24px;
          border-top: 1px solid rgba(0, 0, 0, 0.06);
          background: rgba(255, 255, 255, 0.5);
          backdrop-filter: blur(10px);
        }

        .loading-text {
          font-size: 13px;
          color: #6b7280;
          margin-bottom: 12px;
          display: none;
          align-items: center;
          gap: 8px;
        }

        .loading-text.visible {
          display: flex;
        }

        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(107, 114, 128, 0.2);
          border-top-color: #6b7280;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .input-container {
          display: flex;
          gap: 10px;
          align-items: center;
          background: white;
          border-radius: 999px;
          padding: 6px 6px 6px 20px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
          border: 1px solid rgba(0, 0, 0, 0.06);
          transition: all 0.2s ease;
        }

        .input-container:focus-within {
          box-shadow: 0 6px 24px rgba(37, 99, 235, 0.15);
          border-color: rgba(37, 99, 235, 0.3);
        }

        #input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 15px;
          color: #111827;
          background: transparent;
          font-family: 'Inter', sans-serif;
        }

        #input::placeholder {
          color: #9ca3af;
        }

        #input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        #sendBtn {
          padding: 11px 24px;
          background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
          color: white;
          border: none;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
          font-family: 'Inter', sans-serif;
        }

        #sendBtn:hover:not(:disabled) {
          transform: scale(1.02);
          box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
        }

        #sendBtn:active:not(:disabled) {
          transform: scale(0.98);
        }

        #sendBtn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        /* Mobile Responsive */
        @media (max-width: 768px) {
          .nav-bar {
            padding: 0 20px;
          }

          .nav-right {
            gap: 20px;
          }

          .nav-link {
            font-size: 13px;
          }

          .app-content {
            padding: 70px 12px 12px;
          }

          .glass-card {
            grid-template-columns: 1fr;
            min-height: auto;
            max-height: 90vh;
          }

          .clinic-panel {
            padding: 32px 24px;
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
          }

          .clinic-title {
            font-size: 22px;
          }

          .chat-messages {
            max-height: 380px;
            padding: 20px;
          }

          .message-bubble {
            max-width: 85%;
            font-size: 14px;
          }

          .chat-header {
            padding: 18px 20px;
          }

          .chat-input-area {
            padding: 16px 20px;
          }
        }
      </style>
    </head>
    <body>
      <!-- Shared Navigation Bar -->
      <div class="nav-bar">
        <div class="nav-left">
          <div class="nav-logo">Selaro</div>
          <div class="nav-subtitle">AI Reception</div>
        </div>
        <div class="nav-right">
          <a href="/simulate" class="nav-link active">Simulator</a>
          <a href="/leads" class="nav-link">Leads</a>
        </div>
      </div>

      <!-- Main Content -->
      <div class="app-content">
        <div class="glass-card">
        <!-- LEFT COLUMN: Clinic Info -->
        <div class="clinic-panel">
          <div>
            <!-- Tooth Icon SVG -->
            <svg class="tooth-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C9.5 2 7 3.5 7 6C7 7 7 8 7 9C7 11 6 13 6 15C6 17 7 19 8 20C9 21 10 22 12 22C14 22 15 21 16 20C17 19 18 17 18 15C18 13 17 11 17 9C17 8 17 7 17 6C17 3.5 14.5 2 12 2Z" fill="white" opacity="0.9"/>
            </svg>

            <h1 class="clinic-title">Zahnarztpraxis<br/>Stela Xhelili</h1>
            <p class="clinic-subtitle">Karl-Liebknecht-Straße 1, Leipzig</p>

            <div class="info-item">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/>
              </svg>
              <span>Mo–Fr · 09:00–18:00</span>
            </div>

            <div class="clinic-description">
              Dies ist eine Simulation der AI-Telefonrezeption. So klingt der Assistent, wenn Patienten in der Praxis anrufen.
            </div>
          </div>

          <div class="powered-badge">
            Powered by Selaro
          </div>
        </div>

        <!-- RIGHT COLUMN: Chat -->
        <div class="chat-panel">
          <!-- Header -->
          <div class="chat-header">
            <div class="header-left">
              <div class="avatar">SX</div>
              <div class="header-info">
                <div class="header-name">AI-Rezeption</div>
                <div class="header-subtitle">Zahnarztpraxis Stela Xhelili</div>
              </div>
            </div>
            <div class="status-badge">
              <span class="status-dot"></span>
              Online
            </div>
          </div>

          <!-- Messages -->
          <div class="chat-messages" id="chat"></div>

          <!-- Input Area -->
          <div class="chat-input-area">
            <div class="loading-text" id="loadingText">
              <div class="spinner"></div>
              Der Assistent denkt nach…
            </div>
            <form class="input-container" id="form">
              <input 
                type="text" 
                id="input" 
                placeholder="Nachricht eingeben…" 
                autocomplete="off"
              />
              <button type="submit" id="sendBtn">Senden</button>
            </form>
          </div>
        </div>
      </div>
      </div>

      <script>
        const chat = document.getElementById('chat');
        const form = document.getElementById('form');
        const input = document.getElementById('input');
        const sendBtn = document.getElementById('sendBtn');
        const loadingText = document.getElementById('loadingText');
        
        let sessionId = null;

        function addMessage(text, role) {
          const messageDiv = document.createElement('div');
          messageDiv.className = 'message ' + role;
          
          const bubbleDiv = document.createElement('div');
          bubbleDiv.className = 'message-bubble';
          bubbleDiv.textContent = text;
          
          messageDiv.appendChild(bubbleDiv);
          chat.appendChild(messageDiv);
          
          // Smooth scroll to bottom
          chat.scrollTo({
            top: chat.scrollHeight,
            behavior: 'smooth'
          });
        }

        // Initial greeting - pre-loaded without API call
        addMessage('Guten Tag, Sie sind mit der Zahnarztpraxis Stela Xhelili in der Karl-Liebknecht-Straße 1 in Leipzig verbunden. Wie kann ich Ihnen helfen?', 'ai');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          
          // Add user message
          addMessage(text, 'user');
          input.value = '';
          
          // Show loading state
          input.disabled = true;
          sendBtn.disabled = true;
          sendBtn.textContent = 'Senden…';
          loadingText.classList.add('visible');
          
          try {
            const body = { message: text };
            if (sessionId) {
              body.sessionId = sessionId;
            }
            
            const res = await fetch('/api/simulate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            
            const data = await res.json();
            
            if (data.sessionId) {
              sessionId = data.sessionId;
            }
            
            addMessage(data.reply || 'Fehler: Keine Antwort vom Server.', 'ai');
          } catch (err) {
            addMessage('Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.', 'ai');
          } finally {
            // Reset loading state
            input.disabled = false;
            sendBtn.disabled = false;
            sendBtn.textContent = 'Senden';
            loadingText.classList.remove('visible');
            input.focus();
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Alternative simulator route (in case of CDN caching issues)
app.get('/simulator', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Selaro – Receptionist Simulator</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #f5f7fb 0%, #e8f3f1 100%);
      color: #1f2937;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    .header {
      background: white;
      padding: 1rem 2rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .header h1 {
      font-size: 1.5rem;
      color: #111827;
    }
    
    .back-link {
      color: #00C896;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.875rem;
    }
    
    .back-link:hover {
      text-decoration: underline;
    }
    
    .chat-container {
      flex: 1;
      max-width: 800px;
      width: 100%;
      margin: 2rem auto;
      background: white;
      border-radius: 1rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      height: calc(100vh - 8rem);
    }
    
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .message {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      max-width: 70%;
      animation: slideIn 0.3s ease-out;
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .message.receptionist {
      align-self: flex-start;
    }
    
    .message.caller {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    
    .message-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-weight: 600;
      font-size: 0.875rem;
    }
    
    .receptionist .message-avatar {
      background: #00C896;
      color: white;
    }
    
    .caller .message-avatar {
      background: #3b82f6;
      color: white;
    }
    
    .message-bubble {
      padding: 0.75rem 1rem;
      border-radius: 1rem;
      line-height: 1.5;
    }
    
    .receptionist .message-bubble {
      background: #f3f4f6;
      color: #111827;
      border-bottom-left-radius: 0.25rem;
    }
    
    .caller .message-bubble {
      background: #3b82f6;
      color: white;
      border-bottom-right-radius: 0.25rem;
    }
    
    .chat-input-area {
      border-top: 1px solid #e5e7eb;
      padding: 1.5rem;
      background: #f9fafb;
      border-bottom-left-radius: 1rem;
      border-bottom-right-radius: 1rem;
    }
    
    .input-wrapper {
      display: flex;
      gap: 0.75rem;
    }
    
    #messageInput {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 2px solid #e5e7eb;
      border-radius: 0.5rem;
      font-size: 1rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    
    #messageInput:focus {
      border-color: #00C896;
    }
    
    #sendButton {
      padding: 0.75rem 2rem;
      background: #00C896;
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    #sendButton:hover:not(:disabled) {
      background: #00b586;
      transform: translateY(-1px);
    }
    
    #sendButton:disabled {
      background: #d1d5db;
      cursor: not-allowed;
      transform: none;
    }
    
    .loading-indicator {
      display: none;
      align-items: center;
      gap: 0.5rem;
      padding: 1rem;
      background: #f3f4f6;
      border-radius: 1rem;
      max-width: 70%;
      align-self: flex-start;
    }
    
    .loading-indicator.active {
      display: flex;
    }
    
    .loading-dots {
      display: flex;
      gap: 0.25rem;
    }
    
    .loading-dots span {
      width: 8px;
      height: 8px;
      background: #6b7280;
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    
    .loading-dots span:nth-child(1) {
      animation-delay: -0.32s;
    }
    
    .loading-dots span:nth-child(2) {
      animation-delay: -0.16s;
    }
    
    @keyframes bounce {
      0%, 80%, 100% {
        transform: scale(0);
      }
      40% {
        transform: scale(1);
      }
    }
    
    @media (max-width: 768px) {
      .chat-container {
        margin: 1rem;
        height: calc(100vh - 6rem);
        border-radius: 0.5rem;
      }
      
      .header {
        padding: 1rem;
      }
      
      .header h1 {
        font-size: 1.25rem;
      }
      
      .message {
        max-width: 85%;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Selaro – Receptionist Simulator</h1>
    <a href="/" class="back-link">← Back to Home</a>
  </div>
  
  <div class="chat-container">
    <div id="chatMessages" class="chat-messages">
      <!-- Messages will be appended here -->
    </div>
    
    <div class="loading-indicator" id="loadingIndicator">
      <div class="loading-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span style="color: #6b7280; font-size: 0.875rem;">AI is typing...</span>
    </div>
    
    <div class="chat-input-area">
      <div class="input-wrapper">
        <input 
          type="text" 
          id="messageInput" 
          placeholder="Type your message in German..." 
          autocomplete="off"
        />
        <button id="sendButton">Send</button>
      </div>
    </div>
  </div>
  
  <script>
    const chatMessages = document.getElementById('chatMessages');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    
    // Initial greeting from the receptionist (same as Twilio route)
    const initialGreeting = "Guten Tag, Sie sind mit der Zahnarztpraxis Stela Xhelili in der Karl-Liebknecht-Straße 1 in Leipzig verbunden. Wie kann ich Ihnen helfen?";
    
    // Add a message to the chat
    function addMessage(text, sender) {
      const messageDiv = document.createElement('div');
      messageDiv.className = \`message \${sender}\`;
      
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = sender === 'receptionist' ? 'AI' : 'You';
      
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.textContent = text;
      
      messageDiv.appendChild(avatar);
      messageDiv.appendChild(bubble);
      chatMessages.appendChild(messageDiv);
      
      // Scroll to bottom
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Show the initial greeting on page load
    addMessage(initialGreeting, 'receptionist');
    
    // Send message to the AI
    async function sendMessage() {
      const message = messageInput.value.trim();
      
      if (!message) return;
      
      // Add user message to chat
      addMessage(message, 'caller');
      
      // Clear input
      messageInput.value = '';
      
      // Disable send button and show loading
      sendButton.disabled = true;
      loadingIndicator.classList.add('active');
      
      try {
        // Send POST request to /api/simulate
        const response = await fetch('/api/simulate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message })
        });
        
        if (!response.ok) {
          throw new Error('Failed to get response from AI');
        }
        
        const data = await response.json();
        
        // Hide loading
        loadingIndicator.classList.remove('active');
        
        // Add AI reply to chat
        if (data.reply) {
          addMessage(data.reply, 'receptionist');
        } else if (data.error) {
          addMessage('Es tut mir leid, es ist ein Fehler aufgetreten.', 'receptionist');
        }
      } catch (error) {
        console.error('Error:', error);
        loadingIndicator.classList.remove('active');
        addMessage('Es tut mir leid, es ist ein technischer Fehler aufgetreten.', 'receptionist');
      } finally {
        // Re-enable send button
        sendButton.disabled = false;
        messageInput.focus();
      }
    }
    
    // Send on button click
    sendButton.addEventListener('click', sendMessage);
    
    // Send on Enter key
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !sendButton.disabled) {
        sendMessage();
      }
    });
    
    // Focus input on page load
    messageInput.focus();
  </script>
</body>
</html>
  `;
  res.type('html').send(html);
});

app.get('/debug/status', (req, res) => {
  const status = {
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: {
      TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  };
  res.json(status);
});

app.get('/debug/env-keys', (req, res) => {
  const keys = Object.keys(process.env).sort();
  const env = {};

  for (const key of keys) {
    env[key] = !!process.env[key]; // true if env var exists, false if missing
  }

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    count: keys.length,
    env,
  });
});

// Manual debug route for testing lead insertion (never called automatically)
app.get('/debug/test-lead', async (req, res) => {
  try {
    await saveLead({
      name: 'Debug Lead',
      phone: '+49123456789',
      reason: 'Test Zahnschmerzen',
      preferredTime: 'morgen 10:00',
      urgency: 'normal',
      requestedTime: 'morgen 10:00',
      source: 'debug',
      rawText: 'Debug lead insertion test',
      callSid: `debug-${Date.now()}`
    });
    res.json({ ok: true, message: 'Debug lead created successfully' });
  } catch (err) {
    console.error('Error creating debug lead:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// List last 10 leads from Supabase (debug)
app.get('/debug/list-leads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads') // change this if your table name is different
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Supabase select error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({
      ok: true,
      count: data.length,
      leads: data
    });
  } catch (err) {
    console.error('Unexpected error listing leads:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// API endpoint to update lead status
app.post('/api/leads/update-status', async (req, res) => {
  try {
    const { id, status } = req.body;
    
    // Validate id is non-empty string
    if (!isNonEmptyString(id)) {
      logValidationError(req, 'id', 'Lead ID is required');
      return res.status(400).json({ ok: false, error: 'Invalid lead status update: id required.' });
    }
    
    // Validate status value (whitelist)
    const validStatuses = ['new', 'callback', 'scheduled', 'lost'];
    const trimmedStatus = sanitizeString(status);
    if (!validStatuses.includes(trimmedStatus)) {
      logValidationError(req, 'status', `Invalid status: ${trimmedStatus}, allowed: ${validStatuses.join(',')}`);
      return res.status(400).json({ ok: false, error: 'Invalid status value.' });
    }
    
    // Check Supabase availability
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Database not configured' });
    }
    
    const { data, error } = await supabase
      .from('leads')
      .update({ status: trimmedStatus })
      .eq('id', sanitizeString(id))
      .select();
    
    if (error) {
      console.error('Error updating lead status:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
    
    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: 'Lead not found' });
    }
    
    res.json({ ok: true, lead: data[0] });
  } catch (err) {
    console.error('Unexpected error updating status:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API endpoint to update lead notes
app.post('/api/leads/update-notes', async (req, res) => {
  try {
    const { id, notes } = req.body;
    
    // Validate id is non-empty string
    if (!isNonEmptyString(id)) {
      logValidationError(req, 'id', 'Lead ID is required for notes update');
      return res.status(400).json({ ok: false, error: 'Invalid input: lead id required.' });
    }
    
    // Sanitize and limit notes length
    const trimmedNotes = sanitizeString(notes || '').substring(0, 5000);
    
    // Check Supabase availability
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Database not configured' });
    }
    
    const { data, error } = await supabase
      .from('leads')
      .update({ notes: trimmedNotes })
      .eq('id', sanitizeString(id))
      .select();
    
    if (error) {
      console.error('Error updating lead notes:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
    
    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: 'Lead not found' });
    }
    
    res.json({ ok: true, lead: data[0] });
  } catch (err) {
    console.error('Unexpected error updating notes:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Leads dashboard HTML (dark theme, German)
app.get('/leads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching leads:', error);
      return res
        .status(500)
        .type('html')
        .send('<h1>Fehler beim Laden der Leads</h1><p>' + error.message + '</p>');
    }

    const leadsData = JSON.stringify(data || []);
    
    let html = `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Selaro – Leads</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-x: hidden;
    }

    /* Shared Navigation Bar */
    .nav-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 70px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 40px;
      z-index: 100;
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-logo {
      font-size: 18px;
      font-weight: 700;
      color: white;
      letter-spacing: -0.5px;
    }

    .nav-subtitle {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    .nav-right {
      display: flex;
      align-items: center;
      gap: 32px;
    }

    .nav-link {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      font-weight: 500;
      transition: all 0.2s ease;
      position: relative;
      padding-bottom: 4px;
    }

    .nav-link:hover {
      color: white;
    }

    .nav-link.active {
      color: white;
      border-bottom: 2px solid white;
    }

    /* Main Content */
    .app-content {
      flex: 1;
      padding: 90px 40px 40px;
      max-width: 1600px;
      width: 100%;
      margin: 0 auto;
    }

    .dashboard-header {
      margin-bottom: 32px;
    }

    .dashboard-title {
      font-size: 32px;
      font-weight: 700;
      color: white;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }

    .dashboard-subtitle {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.7);
    }

    /* Filters Section */
    .filters-section {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .search-box {
      flex: 1;
      min-width: 300px;
      position: relative;
    }

    #searchInput {
      width: 100%;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      color: white;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
    }

    #searchInput::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }

    #searchInput:focus {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .filter-chips {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .filter-chip {
      padding: 10px 20px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 999px;
      color: rgba(255, 255, 255, 0.8);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .filter-chip:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .filter-chip.active {
      background: rgba(255, 255, 255, 0.95);
      color: #667eea;
      border-color: rgba(255, 255, 255, 0.95);
    }

    /* Leads Grid */
    .leads-container {
      display: grid;
      grid-template-columns: 1fr 400px;
      gap: 24px;
      align-items: start;
    }

    .leads-list {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(20px);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      overflow: hidden;
    }

    .leads-table {
      width: 100%;
      border-collapse: collapse;
    }

    .leads-table thead {
      background: rgba(255, 255, 255, 0.05);
    }

    .leads-table th {
      padding: 16px 20px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.7);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .leads-table tbody tr {
      cursor: pointer;
      transition: all 0.2s ease;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .leads-table tbody tr:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .leads-table tbody tr.selected {
      background: rgba(255, 255, 255, 0.12);
    }

    .leads-table tbody tr:last-child {
      border-bottom: none;
    }

    .leads-table td {
      padding: 16px 20px;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.9);
      vertical-align: middle;
    }

    .urgency-tag {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* Quick Action Buttons */
    .action-buttons {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .action-btn {
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.9);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
      text-decoration: none;
      display: inline-block;
    }

    .action-btn:hover {
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .action-btn:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .action-link {
      color: rgba(255, 255, 255, 0.8);
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .action-link:hover {
      color: white;
      text-decoration: underline;
    }

    .urgency-urgent {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
    }

    .urgency-normal {
      background: rgba(59, 130, 246, 0.2);
      color: #93c5fd;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(16, 185, 129, 0.2);
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      color: #6ee7b7;
      cursor: pointer;
      position: relative;
      transition: all 0.2s ease;
    }

    .status-badge:hover {
      background: rgba(16, 185, 129, 0.3);
    }

    .status-new {
      background: rgba(59, 130, 246, 0.2);
      color: #93c5fd;
    }

    .status-in_progress {
      background: rgba(251, 191, 36, 0.2);
      color: #fcd34d;
    }

    .status-done {
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
    }

    .status-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background: rgba(30, 30, 50, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 4px;
      min-width: 150px;
      z-index: 10;
      display: none;
    }

    .status-dropdown.show {
      display: block;
    }

    .status-option {
      padding: 8px 12px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      border-radius: 6px;
      transition: background 0.2s ease;
    }

    .status-option:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    /* Detail Panel */
    .detail-panel {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(20px);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 28px;
      position: sticky;
      top: 90px;
      display: none;
    }

    .detail-panel.show {
      display: block;
    }

    .detail-header {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .detail-name {
      font-size: 20px;
      font-weight: 700;
      color: white;
      margin-bottom: 4px;
    }

    .detail-phone {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.7);
    }

    .detail-section {
      margin-bottom: 20px;
    }

    .detail-label {
      font-size: 11px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .detail-value {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.9);
      line-height: 1.5;
    }

    .notes-textarea {
      width: 100%;
      padding: 12px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      color: white;
      font-size: 14px;
      font-family: 'Inter', sans-serif;
      resize: vertical;
      min-height: 120px;
      outline: none;
      transition: all 0.2s ease;
    }

    .notes-textarea::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .notes-textarea:focus {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .save-btn {
      padding: 10px 20px;
      background: rgba(255, 255, 255, 0.95);
      color: #667eea;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 12px;
    }

    .save-btn:hover {
      transform: scale(1.02);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .save-btn:active {
      transform: scale(0.98);
    }

    .save-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Appointment Button */
    .appointment-btn {
      padding: 10px 20px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 12px;
      width: 100%;
    }

    .appointment-btn:hover {
      background: #5568d3;
      transform: scale(1.02);
    }

    /* Modal */
    .modal {
      display: none;
      position: fixed;
      z-index: 2000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
    }

    .modal.show {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-content {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }

    .modal-header {
      font-size: 20px;
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-label {
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 6px;
    }

    .form-input, .form-textarea {
      width: 100%;
      padding: 10px 12px;
      background: rgba(0, 0, 0, 0.05);
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 8px;
      font-size: 14px;
      color: #1f2937;
      font-family: 'Inter', sans-serif;
      outline: none;
      transition: all 0.2s ease;
    }

    .form-input:focus, .form-textarea:focus {
      background: rgba(0, 0, 0, 0.08);
      border-color: #667eea;
    }

    .form-textarea {
      resize: vertical;
      min-height: 80px;
    }

    .modal-buttons {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }

    .modal-btn {
      flex: 1;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .modal-btn-submit {
      background: #667eea;
      color: white;
    }

    .modal-btn-submit:hover {
      background: #5568d3;
    }

    .modal-btn-cancel {
      background: rgba(0, 0, 0, 0.1);
      color: #1f2937;
    }

    .modal-btn-cancel:hover {
      background: rgba(0, 0, 0, 0.15);
    }

    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(30, 30, 50, 0.95);
      backdrop-filter: blur(10px);
      color: white;
      padding: 14px 20px;
      border-radius: 12px;
      font-size: 14px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      z-index: 1000;
      display: none;
      animation: slideIn 0.3s ease-out;
    }

    .toast.show {
      display: block;
    }

    @keyframes slideIn {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 15px;
    }

    /* Mobile Responsive */
    @media (max-width: 1024px) {
      .leads-container {
        grid-template-columns: 1fr;
      }

      .detail-panel {
        position: relative;
        top: 0;
      }
    }

    @media (max-width: 768px) {
      .nav-bar {
        padding: 0 20px;
      }

      .app-content {
        padding: 90px 20px 20px;
      }

      .dashboard-title {
        font-size: 24px;
      }

      .filters-section {
        flex-direction: column;
      }

      .search-box {
        min-width: 100%;
      }

      .leads-table th,
      .leads-table td {
        padding: 12px 16px;
        font-size: 13px;
      }
    }
  </style>
</head>
<body>
  <!-- Shared Navigation Bar -->
  <div class="nav-bar">
    <div class="nav-left">
      <div class="nav-logo">Selaro</div>
      <div class="nav-subtitle">AI Reception</div>
    </div>
    <div class="nav-right">
      <a href="/simulate" class="nav-link">Simulator</a>
      <a href="/leads" class="nav-link active">Leads</a>
    </div>
  </div>

  <!-- Main Content -->
  <div class="app-content">
    <div class="dashboard-header">
      <h1 class="dashboard-title">Leads Dashboard</h1>
      <div class="dashboard-subtitle">Letzte ${data ? data.length : 0} eingegangene Anfragen</div>
    </div>

    <!-- Filters -->
    <div class="filters-section">
      <div class="search-box">
        <input 
          type="text" 
          id="searchInput" 
          placeholder="Name oder Telefonnummer suchen…"
          autocomplete="off"
        />
      </div>
      <div class="filter-chips">
        <div class="filter-chip active" data-filter="alle">Alle</div>
        <div class="filter-chip" data-filter="urgent">Akut</div>
        <div class="filter-chip" data-filter="normal">Normal</div>
      </div>
    </div>

    <!-- Leads Grid -->
    <div class="leads-container">
      <!-- Leads Table -->
      <div class="leads-list">
        <table class="leads-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Name</th>
              <th>Telefon</th>
              <th>Anliegen</th>
              <th>Dringlichkeit</th>
              <th>Status</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody id="leadsTableBody">
            <!-- Populated by JavaScript -->
          </tbody>
        </table>
        <div id="emptyState" class="empty-state" style="display: none;">
          Keine Ergebnisse gefunden
        </div>
      </div>

      <!-- Detail Panel -->
      <div class="detail-panel" id="detailPanel">
        <div class="detail-header">
          <div class="detail-name" id="detailName">-</div>
          <div class="detail-phone" id="detailPhone">-</div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Datum</div>
          <div class="detail-value" id="detailDate">-</div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Anliegen</div>
          <div class="detail-value" id="detailConcern">-</div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Versicherung</div>
          <div class="detail-value" id="detailInsurance">-</div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Wunschtermin</div>
          <div class="detail-value" id="detailTime">-</div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Notizen</div>
          <textarea 
            class="notes-textarea" 
            id="notesTextarea" 
            placeholder="Interne Notizen hinzufügen…"
          ></textarea>
          <button class="save-btn" id="saveNotesBtn">Notizen speichern</button>
        </div>

        <button class="appointment-btn" id="appointmentBtn">Termin eintragen</button>
      </div>
    </div>
  </div>

  <!-- Appointment Modal -->
  <div class="modal" id="appointmentModal">
    <div class="modal-content">
      <div class="modal-header">Termin eintragen</div>
      <form id="appointmentForm">
        <div class="form-group">
          <label class="form-label">Patient</label>
          <input type="text" class="form-input" id="aptPatientName" required />
        </div>
        <div class="form-group">
          <label class="form-label">Telefon</label>
          <input type="tel" class="form-input" id="aptPhone" required />
        </div>
        <div class="form-group">
          <label class="form-label">Grund</label>
          <input type="text" class="form-input" id="aptReason" />
        </div>
        <div class="form-group">
          <label class="form-label">Datum</label>
          <input type="date" class="form-input" id="aptDate" required />
        </div>
        <div class="form-group">
          <label class="form-label">Uhrzeit</label>
          <input type="time" class="form-input" id="aptTime" required />
        </div>
        <div class="form-group">
          <label class="form-label">Notizen</label>
          <textarea class="form-textarea" id="aptNotes" placeholder="Optional"></textarea>
        </div>
        <div class="modal-buttons">
          <button type="button" class="modal-btn modal-btn-cancel" id="cancelAptBtn">Abbrechen</button>
          <button type="submit" class="modal-btn modal-btn-submit">Speichern</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Toast Notification -->
  <div class="toast" id="toast"></div>

  <script>
    // Load leads data
    const allLeads = ${leadsData};
    let filteredLeads = [...allLeads];
    let selectedLead = null;
    let currentFilter = 'alle';
    let currentSearch = '';

    // DOM elements
    const searchInput = document.getElementById('searchInput');
    const filterChips = document.querySelectorAll('.filter-chip');
    const tableBody = document.getElementById('leadsTableBody');
    const emptyState = document.getElementById('emptyState');
    const detailPanel = document.getElementById('detailPanel');
    const toast = document.getElementById('toast');

    // Detail panel elements
    const detailName = document.getElementById('detailName');
    const detailPhone = document.getElementById('detailPhone');
    const detailDate = document.getElementById('detailDate');
    const detailConcern = document.getElementById('detailConcern');
    const detailInsurance = document.getElementById('detailInsurance');
    const detailTime = document.getElementById('detailTime');
    const notesTextarea = document.getElementById('notesTextarea');
    const saveNotesBtn = document.getElementById('saveNotesBtn');

    // Apply filters
    function applyFilters() {
      filteredLeads = allLeads.filter(lead => {
        // Search filter
        const searchMatch = !currentSearch || 
          (lead.name && lead.name.toLowerCase().includes(currentSearch.toLowerCase())) ||
          (lead.phone && lead.phone.toLowerCase().includes(currentSearch.toLowerCase()));

        // Urgency filter
        let urgencyMatch = true;
        if (currentFilter === 'urgent') {
          urgencyMatch = lead.urgency === 'urgent';
        } else if (currentFilter === 'normal') {
          urgencyMatch = lead.urgency === 'normal' || !lead.urgency;
        }

        return searchMatch && urgencyMatch;
      });

      renderTable();
      
      // Auto-select first lead if filtered results exist
      if (filteredLeads.length > 0) {
        // Only auto-select if no lead is currently selected or if the current selection is not in filtered results
        const currentLeadInFiltered = selectedLead && filteredLeads.find(l => l.id === selectedLead.id);
        if (!currentLeadInFiltered) {
          selectLead(0);
        }
      } else {
        // Clear detail panel if no results
        selectedLead = null;
        detailPanel.classList.remove('show');
      }
    }

    // Render table
    function renderTable() {
      if (filteredLeads.length === 0) {
        tableBody.innerHTML = '';
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';
      tableBody.innerHTML = filteredLeads.map((lead, index) => {
        const date = lead.created_at ? new Date(lead.created_at).toLocaleString('de-DE') : '-';
        const urgencyClass = lead.urgency === 'urgent' ? 'urgency-urgent' : 'urgency-normal';
        const urgencyText = lead.urgency === 'urgent' ? 'Akut' : (lead.urgency || 'Normal');
        const statusClass = 'status-' + (lead.status || 'new').replace(/\\s+/g, '_');
        const statusText = getStatusText(lead.status || 'new');

        return \`
          <tr onclick="selectLead(\${index})" class="\${selectedLead && selectedLead.id === lead.id ? 'selected' : ''}">
            <td>\${date}</td>
            <td>\${lead.name || '-'}</td>
            <td>\${lead.phone || '-'}</td>
            <td>\${lead.concern || '-'}</td>
            <td><span class="urgency-tag \${urgencyClass}">\${urgencyText}</span></td>
            <td>
              <span class="status-badge \${statusClass}" onclick="event.stopPropagation(); toggleStatusDropdown(\${index}, event)">
                \${statusText}
                <span style="font-size: 8px;">▼</span>
                <div class="status-dropdown" id="statusDropdown\${index}">
                  <div class="status-option" onclick="updateStatus('\${lead.id}', 'new')">Neu</div>
                  <div class="status-option" onclick="updateStatus('\${lead.id}', 'callback')">Rückruf nötig</div>
                  <div class="status-option" onclick="updateStatus('\${lead.id}', 'scheduled')">Termin vereinbart</div>
                  <div class="status-option" onclick="updateStatus('\${lead.id}', 'lost')">Nicht erreicht</div>
                </div>
              </span>
            </td>
            <td>
              <div class="action-buttons" onclick="event.stopPropagation();">
                <button class="action-btn" onclick="selectLead(\${index})">Details</button>
                <button class="action-btn" onclick="openAppointmentModal('\${lead.id}', '\${lead.name || ''}', '\${lead.phone || ''}')">Termin</button>
                <button class="action-btn" onclick="quickUpdateStatus('\${lead.id}', 'lost')">Erledigt</button>
              </div>
            </td>
          </tr>
        \`;
      }).join('');
    }

    // Get status display text
    function getStatusText(status) {
      const statusMap = {
        'new': 'Neu',
        'callback': 'Rückruf nötig',
        'scheduled': 'Termin vereinbart',
        'lost': 'Nicht erreicht'
      };
      return statusMap[status] || status;
    }

    // Quick action: update status
    async function quickUpdateStatus(leadId, newStatus) {
      try {
        const response = await fetch('/api/leads/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: leadId, status: newStatus })
        });

        const result = await response.json();

        if (result.ok) {
          const leadIndex = allLeads.findIndex(l => l.id === leadId);
          if (leadIndex !== -1) {
            allLeads[leadIndex].status = newStatus;
          }
          if (selectedLead && selectedLead.id === leadId) {
            selectedLead.status = newStatus;
          }
          applyFilters();
          showToast('Status aktualisiert');
        } else {
          showToast('Fehler beim Aktualisieren');
        }
      } catch (err) {
        console.error('Error updating status:', err);
        showToast('Fehler beim Aktualisieren');
      }
    }

    // Open appointment modal with lead data
    function openAppointmentModal(leadId, name, phone) {
      const lead = allLeads.find(l => l.id === leadId);
      if (!lead) return;

      document.getElementById('aptPatientName').value = name || '';
      document.getElementById('aptPhone').value = phone || '';
      document.getElementById('aptReason').value = lead.concern || '';
      
      selectedLead = lead;
      document.getElementById('appointmentModal').style.display = 'block';
    }

    // Select lead
    function selectLead(index) {
      selectedLead = filteredLeads[index];
      
      // Update detail panel
      detailName.textContent = selectedLead.name || '-';
      detailPhone.textContent = selectedLead.phone || '-';
      detailDate.textContent = selectedLead.created_at ? new Date(selectedLead.created_at).toLocaleString('de-DE') : '-';
      detailConcern.textContent = selectedLead.concern || '-';
      detailInsurance.textContent = selectedLead.insurance || '-';
      detailTime.textContent = selectedLead.preferred_time || selectedLead.requested_time || '-';
      notesTextarea.value = selectedLead.notes || '';
      
      // Show panel
      detailPanel.classList.add('show');
      
      // Update selected row
      renderTable();
    }

    // Toggle status dropdown
    function toggleStatusDropdown(index, event) {
      const dropdown = document.getElementById('statusDropdown' + index);
      const allDropdowns = document.querySelectorAll('.status-dropdown');
      
      // Close all other dropdowns
      allDropdowns.forEach(d => {
        if (d !== dropdown) d.classList.remove('show');
      });
      
      dropdown.classList.toggle('show');
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.status-badge')) {
        document.querySelectorAll('.status-dropdown').forEach(d => {
          d.classList.remove('show');
        });
      }
    });

    // Update status
    async function updateStatus(leadId, newStatus) {
      try {
        const response = await fetch('/api/leads/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: leadId, status: newStatus })
        });

        const result = await response.json();

        if (result.ok) {
          // Update local data
          const leadIndex = allLeads.findIndex(l => l.id === leadId);
          if (leadIndex !== -1) {
            allLeads[leadIndex].status = newStatus;
          }

          // Update selected lead if needed
          if (selectedLead && selectedLead.id === leadId) {
            selectedLead.status = newStatus;
          }

          // Refresh view
          applyFilters();
          showToast('Status aktualisiert');
        } else {
          showToast('Fehler beim Aktualisieren: ' + result.error);
        }
      } catch (err) {
        console.error('Error updating status:', err);
        showToast('Fehler beim Aktualisieren');
      }
    }

    // Save notes
    saveNotesBtn.addEventListener('click', async () => {
      if (!selectedLead) return;

      const notes = notesTextarea.value;
      saveNotesBtn.disabled = true;
      saveNotesBtn.textContent = 'Speichern…';

      try {
        const response = await fetch('/api/leads/update-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedLead.id, notes: notes })
        });

        const result = await response.json();

        if (result.ok) {
          // Update local data
          const leadIndex = allLeads.findIndex(l => l.id === selectedLead.id);
          if (leadIndex !== -1) {
            allLeads[leadIndex].notes = notes;
          }
          selectedLead.notes = notes;

          showToast('Notizen gespeichert');
        } else {
          showToast('Fehler: ' + result.error);
        }
      } catch (err) {
        console.error('Error saving notes:', err);
        showToast('Fehler beim Speichern');
      } finally {
        saveNotesBtn.disabled = false;
        saveNotesBtn.textContent = 'Notizen speichern';
      }
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.trim();
      applyFilters();
    });

    // Filter chips
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        // Remove active class from all
        filterChips.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked
        chip.classList.add('active');
        
        // Update filter
        currentFilter = chip.getAttribute('data-filter');
        applyFilters();
      });
    });

    // Show toast
    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }

    // Appointment Modal
    const appointmentModal = document.getElementById('appointmentModal');
    const appointmentBtn = document.getElementById('appointmentBtn');
    const cancelAptBtn = document.getElementById('cancelAptBtn');
    const appointmentForm = document.getElementById('appointmentForm');
    const aptPatientName = document.getElementById('aptPatientName');
    const aptPhone = document.getElementById('aptPhone');
    const aptReason = document.getElementById('aptReason');
    const aptDate = document.getElementById('aptDate');
    const aptTime = document.getElementById('aptTime');
    const aptNotes = document.getElementById('aptNotes');

    appointmentBtn.addEventListener('click', () => {
      if (!selectedLead) return;
      aptPatientName.value = selectedLead.name || '';
      aptPhone.value = selectedLead.phone || '';
      aptReason.value = selectedLead.concern || selectedLead.reason || '';
      aptDate.value = '';
      aptTime.value = '';
      aptNotes.value = '';
      appointmentModal.classList.add('show');
    });

    cancelAptBtn.addEventListener('click', () => {
      appointmentModal.classList.remove('show');
    });

    appointmentModal.addEventListener('click', (e) => {
      if (e.target === appointmentModal) {
        appointmentModal.classList.remove('show');
      }
    });

    appointmentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      try {
        const response = await fetch('/api/appointments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: selectedLead.id,
            patient_name: aptPatientName.value,
            phone: aptPhone.value,
            reason: aptReason.value,
            appointment_date: aptDate.value,
            appointment_time: aptTime.value,
            notes: aptNotes.value
          })
        });

        const result = await response.json();

        if (result.ok) {
          showToast('Termin gespeichert');
          appointmentModal.classList.remove('show');
          
          // Update lead status if needed
          if (selectedLead) {
            selectedLead.status = 'Termin vereinbart';
            applyFilters();
          }
        } else {
          showToast('Fehler: ' + result.error);
        }
      } catch (err) {
        console.error('Error creating appointment:', err);
        showToast('Fehler beim Speichern');
      }
    });

    // Initial render
    renderTable();
  </script>
</body>
</html>
    `;

    res.type('html').send(html);
  } catch (err) {
    console.error('Unexpected error in /leads:', err);
    res
      .status(500)
      .type('html')
      .send('<h1>Interner Fehler</h1><p>' + err.message + '</p>');
  }
});

// API endpoint to update clinic settings
app.post('/api/clinic/update', async (req, res) => {
  try {
    const { name, phone_number, address, instructions } = req.body;
    
    // Validate clinic name
    if (!isNonEmptyString(name)) {
      logValidationError(req, 'name', 'Clinic name is required');
      return res.status(400).json({ ok: false, error: 'Praxisname ist erforderlich.' });
    }
    
    // Validate phone number
    if (!isValidPhone(phone_number)) {
      logValidationError(req, 'phone_number', 'Invalid phone number format');
      return res.status(400).json({ ok: false, error: 'Telefonnummer ungültig.' });
    }
    
    // Validate instructions length if provided
    if (instructions && sanitizeString(instructions).length > 10000) {
      logValidationError(req, 'instructions', 'Instructions too long (max 10000 chars)');
      return res.status(400).json({ ok: false, error: 'Anweisungen sind zu lang.' });
    }
    
    // Check Supabase availability
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Datenbank nicht konfiguriert' });
    }
    
    // Determine clinic ID
    const clinicId = process.env.CLINIC_ID;
    if (!clinicId) {
      return res.status(500).json({ ok: false, error: 'Klinik-ID nicht konfiguriert' });
    }
    
    // Build update payload with sanitized data
    const updateData = {
      name: sanitizeString(name),
      phone_number: sanitizeString(phone_number),
      instructions: instructions ? sanitizeString(instructions) : ''
    };
    
    // Add address if it was provided (and not just "-")
    if (address && address.trim() && address.trim() !== '-') {
      updateData.address = address.trim();
    }
    
    // Update clinic in Supabase
    const { data, error } = await supabase
      .from('clinics')
      .update(updateData)
      .eq('id', clinicId)
      .select();
    
    if (error) {
      console.error('Error updating clinic:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
    
    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: 'Klinik nicht gefunden' });
    }
    
    res.json({ ok: true, clinic: data[0] });
  } catch (err) {
    console.error('Unexpected error updating clinic:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Settings page - Show clinic configuration (editable)
app.get('/settings', async (req, res) => {
  try {
    let clinic = null;
    
    // Fetch clinic from Supabase
    if (!supabase) {
      return res
        .status(500)
        .type('html')
        .send('<h1>Fehler</h1><p>Datenbank nicht konfiguriert</p>');
    }

    // Try to fetch by CLINIC_ID first, otherwise get first clinic
    if (process.env.CLINIC_ID) {
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .eq('id', process.env.CLINIC_ID)
        .single();
      
      if (!error && data) {
        clinic = data;
      }
    } else {
      // Get first clinic ordered by created_at
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      
      if (!error && data) {
        clinic = data;
      }
    }

    const clinicName = clinic?.name || 'Zahnarztpraxis';
    const clinicPhone = clinic?.phone_number || '-';
    const clinicAddress = clinic?.address || '-';
    const clinicHours = 'Mo–Fr · 09:00–18:00'; // Hardcoded for now
    const clinicInstructions = clinic?.instructions || 'Keine Anweisungen vorhanden';

    const html = `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Einstellungen – Selaro</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-x: hidden;
    }

    /* Shared Navigation Bar */
    .nav-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 70px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 40px;
      z-index: 100;
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-logo {
      font-size: 18px;
      font-weight: 700;
      color: white;
      letter-spacing: -0.5px;
    }

    .nav-subtitle {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    .nav-right {
      display: flex;
      align-items: center;
      gap: 32px;
    }

    .nav-link {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      font-weight: 500;
      transition: all 0.2s ease;
      position: relative;
      padding-bottom: 4px;
    }

    .nav-link:hover {
      color: white;
    }

    .nav-link.active {
      color: white;
      border-bottom: 2px solid white;
    }

    /* Main Content */
    .app-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 90px 40px 40px;
      min-height: 100vh;
    }

    /* Settings Card Container */
    .settings-container {
      width: 100%;
      max-width: 1100px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
      display: grid;
      grid-template-columns: 1fr 1.5fr;
      gap: 0;
    }

    /* LEFT CARD: Basic Clinic Info */
    .settings-left {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
    }

    .settings-title {
      font-size: 22px;
      font-weight: 700;
      color: white;
      margin-bottom: 28px;
      letter-spacing: -0.5px;
    }

    .settings-field {
      display: flex;
      flex-direction: column;
      margin-bottom: 20px;
    }

    .settings-label {
      font-size: 12px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .settings-value {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.95);
      font-weight: 500;
      word-break: break-word;
    }

    .powered-badge {
      display: inline-flex;
      align-items: center;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.95);
      color: #2563eb;
      font-size: 12px;
      font-weight: 600;
      border-radius: 999px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      margin-top: auto;
      width: fit-content;
    }

    /* RIGHT CARD: AI Instructions */
    .settings-right {
      background: rgba(255, 255, 255, 0.95);
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
    }

    .settings-right .settings-title {
      color: #1f2937;
      margin-bottom: 16px;
    }

    .instructions-textarea {
      flex: 1;
      background: rgba(0, 0, 0, 0.03);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      padding: 16px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: #1f2937;
      line-height: 1.6;
      resize: none;
      overflow-y: auto;
      margin-bottom: 12px;
    }

    .instructions-textarea:focus {
      outline: none;
      border-color: rgba(0, 0, 0, 0.15);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .instructions-helper {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
      margin-bottom: 0;
    }

    /* Input Styles for Left Card */
    .settings-input {
      width: 100%;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      padding: 10px 12px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.95);
      transition: all 0.2s ease;
    }

    .settings-input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .settings-input:focus {
      outline: none;
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
    }

    /* Button Styles */
    .save-button {
      align-self: flex-end;
      padding: 10px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: auto;
    }

    .save-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
    }

    .save-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    /* Settings Form Container */
    .settings-form {
      display: grid;
      grid-template-columns: 1fr 1.5fr;
      gap: 0;
    }

    .form-left {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(255, 255, 255, 0.2);
    }

    .form-right {
      background: rgba(255, 255, 255, 0.95);
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(34, 197, 94, 0.95);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.2s ease;
      z-index: 1000;
    }

    .toast.show {
      opacity: 1;
    }

    .toast.error {
      background: rgba(239, 68, 68, 0.95);
    }

    /* Error/No Clinic State */
    .no-clinic-message {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px 40px;
      text-align: center;
    }

    .no-clinic-title {
      font-size: 28px;
      font-weight: 700;
      color: white;
      margin-bottom: 12px;
    }

    .no-clinic-subtitle {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.7);
    }

    /* Mobile Responsive */
    @media (max-width: 768px) {
      .nav-bar {
        padding: 0 20px;
      }

      .app-content {
        padding: 90px 20px 20px;
      }

      .settings-container {
        grid-template-columns: 1fr;
      }

      .settings-left {
        border-right: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      }

      .settings-title {
        font-size: 18px;
      }

      .settings-label {
        font-size: 11px;
      }

      .settings-value {
        font-size: 14px;
      }
    }
  </style>
</head>
<body>
  <!-- Shared Navigation Bar -->
  <div class="nav-bar">
    <div class="nav-left">
      <div class="nav-logo">Selaro</div>
      <div class="nav-subtitle">AI Reception</div>
    </div>
    <div class="nav-right">
      <a href="/simulate" class="nav-link">Simulator</a>
      <a href="/leads" class="nav-link">Leads</a>
      <a href="/settings" class="nav-link active">Einstellungen</a>
    </div>
  </div>

  <!-- Main Content -->
  <div class="app-content">
    ${clinic ? `
    <div class="settings-container">
      <!-- LEFT CARD: Basic Clinic Info -->
      <div class="settings-left">
        <h1 class="settings-title">Praxis Einstellungen</h1>

        <div class="settings-field">
          <div class="settings-label">Praxisname</div>
          <input type="text" id="clinic-name" class="settings-input" value="${clinicName}" />
        </div>

        <div class="settings-field">
          <div class="settings-label">Telefonnummer</div>
          <input type="text" id="clinic-phone" class="settings-input" value="${clinicPhone}" />
        </div>

        <div class="settings-field">
          <div class="settings-label">Adresse</div>
          <input type="text" id="clinic-address" class="settings-input" value="${clinicAddress}" />
        </div>

        <div class="settings-field">
          <div class="settings-label">Öffnungszeiten</div>
          <div class="settings-value">${clinicHours}</div>
        </div>

        <div class="powered-badge">
          Powered by Selaro
        </div>
      </div>

      <!-- RIGHT CARD: AI Instructions -->
      <div class="settings-right">
        <h1 class="settings-title">AI-Rezeptionsanweisungen</h1>
        <textarea id="clinic-instructions" class="instructions-textarea" rows="10">${clinicInstructions}</textarea>
        <div class="instructions-helper">
          Diese Anweisungen steuern, wie der AI-Assistent am Telefon mit Patienten spricht.
        </div>
        <button id="save-settings-btn" class="save-button">Einstellungen speichern</button>
      </div>
    </div>
    ` : `
    <div class="settings-container no-clinic-message">
      <h1 class="no-clinic-title">Keine Klinik-Konfiguration gefunden</h1>
      <div class="no-clinic-subtitle">Bitte legen Sie eine Klinik in der Datenbank an.</div>
    </div>
    `}
  </div>
</body>
</html>
    `;

    res.type('html').send(html);
  } catch (err) {
    console.error('Unexpected error in /settings:', err);
    res
      .status(500)
      .type('html')
      .send('<h1>Interner Fehler</h1><p>' + err.message + '</p>');
  }
});

// AI-powered Twilio voice receptionist endpoint
app.post('/api/twilio/voice/step', async (req, res) => {
  try {
    // Parse standard Twilio fields
    const speechResult = req.body.SpeechResult;
    const fromNumber = req.body.From;
    const callSid = req.body.CallSid;
    
    // FIRST REQUEST (no SpeechResult) - Initialize conversation
    if (!speechResult) {
      // Initialize conversation state
      conversationStates.set(callSid, {
        messages: [],
        leadSaved: false,
        fromNumber: fromNumber
      });
      
      const twiml = new VoiceResponse();
      const gather = twiml.gather({
        input: 'speech',
        action: '/api/twilio/voice/step',
        method: 'POST'
      });
      
      const greeting = 'Guten Tag, Sie sind mit der Zahnarztpraxis Stela Xhelili in der Karl-Liebknecht-Straße 1 in Leipzig verbunden. Wie kann ich Ihnen helfen?';
      
      gather.say({
        language: 'de-DE'
      }, greeting);
      
      return res.type('text/xml').send(twiml.toString());
    }
    
    // SUBSEQUENT REQUESTS (SpeechResult exists)
    // Get or create conversation state
    let state = conversationStates.get(callSid);
    if (!state) {
      state = {
        messages: [],
        leadSaved: false,
        fromNumber: fromNumber
      };
      conversationStates.set(callSid, state);
    }
    
    // Add user message to conversation history
    state.messages.push({
      role: 'user',
      content: speechResult
    });
    
    // Use getClinic() to load clinic data
    const clinic = await getClinic();
    
    // Log to verify fresh instructions are being used
    console.log('📞 [Twilio] AI using clinic instructions:', clinic.instructions?.slice(0, 120));
    
    // Build unified system prompt
    const systemPrompt = buildSystemPrompt(clinic.name, clinic.instructions);
    
    // Call OpenAI with full conversation history
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...state.messages
      ],
      temperature: 0.7,
      max_tokens: 200
    });
    
    // Extract AI reply
    const aiReply = completion.choices[0].message.content;
    
    // Add AI response to conversation history
    state.messages.push({
      role: 'assistant',
      content: aiReply
    });
    
    // AI-powered lead extraction and saving
    if (!state.leadSaved && supabase) {
      try {
        console.log('🔎 Attempting to extract lead from AI response...');
        
        // Extract lead fields using OpenAI
        const extractedLead = await extractLeadFieldsFromText(aiReply);
        console.log('Extracted lead:', extractedLead);
        
        // Collect all user messages for urgency classification
        const userMessages = state.messages
          .filter(msg => msg.role === 'user')
          .map(msg => msg.content)
          .join(' ');
        
        // Classify urgency based on pain indicators in user messages
        const urgency = classifyUrgency(extractedLead.reason, userMessages);
        console.log('📊 Classified urgency:', urgency);
        console.log('   Checked text:', extractedLead.reason, '|', userMessages.substring(0, 100));
        
        // Extract requested time (human-readable format)
        const requestedTime = extractedLead.preferred_time;
        console.log('🕐 Requested time:', requestedTime);
        
        // Save lead if all fields are present
        const savedLead = await saveLead({
          name: extractedLead.name,
          phone: extractedLead.phone,
          reason: extractedLead.reason,
          preferredTime: extractedLead.preferred_time,
          urgency: urgency,
          requestedTime: requestedTime,
          source: 'twilio',
          rawText: aiReply,
          callSid: callSid
        });
        
        if (savedLead) {
          state.leadSaved = true;
          console.log('✅ Lead saved from Twilio call! ID:', savedLead.id);
        }
      } catch (leadError) {
        // Log error but don't break the call
        console.error('⚠️ Error extracting/saving lead (call continues):', leadError);
      }
    }
    
    // Respond with TwiML
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
      input: 'speech',
      action: '/api/twilio/voice/step',
      method: 'POST',
      timeout: 4
    });
    
    gather.say({
      language: 'de-DE'
    }, aiReply);
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    // ERROR HANDLING
    console.error('Error in /api/twilio/voice/step:', error);
    const twiml = new VoiceResponse();
    twiml.say({
      language: 'de-DE'
    }, 'Es ist ein technischer Fehler aufgetreten. Bitte rufen Sie später noch einmal an.');
    res.type('text/xml').send(twiml.toString());
  }
});

// JSON simulator endpoint - uses the SAME AI receptionist logic as Twilio route
app.post('/api/simulate', async (req, res) => {
  try {
    // Expect JSON body: { "message": "some user input text", "sessionId": "optional" }
    const { message, sessionId } = req.body;
    
    // Validate message input
    if (!isNonEmptyString(message)) {
      logValidationError(req, 'message', 'Message is required and must be non-empty');
      return res.status(400).json({ ok: false, error: 'Invalid input: message is required.' });
    }
    
    const sanitizedMessage = sanitizeString(message);
    
    // Generate or use existing session ID
    const sid = sessionId || `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Get or create session state
    let state = simulatorSessions.get(sid);
    if (!state) {
      state = {
        messages: [],
        leadSaved: false
      };
      simulatorSessions.set(sid, state);
    }
    
    // Add user message to conversation history
    state.messages.push({
      role: 'user',
      content: sanitizedMessage
    });
    
    // Use the same getClinic() helper
    const clinic = await getClinic();
    
    // Log to verify fresh instructions are being used
    console.log('💬 [Simulator] AI using clinic instructions:', clinic.instructions?.slice(0, 120));
    
    // Build unified system prompt (same as Twilio)
    const systemPrompt = buildSystemPrompt(clinic.name, clinic.instructions);
    
    // Call OpenAI with full conversation history
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...state.messages
      ],
      temperature: 0.7,
      max_tokens: 200
    });
    
    // Extract AI reply
    const reply = completion.choices[0].message.content;
    
    // Add AI response to conversation history
    state.messages.push({
      role: 'assistant',
      content: reply
    });
    
    // AI-powered lead extraction and saving
    if (!state.leadSaved && supabase) {
      try {
        console.log('🔎 Attempting to extract lead from simulator response...');
        
        // Extract lead fields using OpenAI
        const extractedLead = await extractLeadFieldsFromText(reply);
        console.log('Extracted lead:', extractedLead);
        
        // Collect all user messages for urgency classification
        const userMessages = state.messages
          .filter(msg => msg.role === 'user')
          .map(msg => msg.content)
          .join(' ');
        
        // Classify urgency based on pain indicators in user messages
        const urgency = classifyUrgency(extractedLead.reason, userMessages);
        console.log('📊 Classified urgency:', urgency);
        console.log('   Checked text:', extractedLead.reason, '|', userMessages.substring(0, 100));
        
        // Extract requested time (human-readable format)
        const requestedTime = extractedLead.preferred_time;
        console.log('🕐 Requested time:', requestedTime);
        
        // Save lead if all fields are present
        const savedLead = await saveLead({
          name: extractedLead.name,
          phone: extractedLead.phone,
          reason: extractedLead.reason,
          preferredTime: extractedLead.preferred_time,
          urgency: urgency,
          requestedTime: requestedTime,
          source: 'simulate',
          rawText: reply,
          callSid: sid
        });
        
        if (savedLead) {
          state.leadSaved = true;
          console.log('✅ Lead saved from simulator! ID:', savedLead.id);
        }
      } catch (leadError) {
        // Log error but don't break the conversation
        console.error('⚠️ Error extracting/saving lead from simulator (conversation continues):', leadError);
      }
    }
    
    // Return JSON response with sessionId for client to maintain state
    res.json({ 
      reply,
      sessionId: sid
    });
    
  } catch (error) {
    console.error('Error in /api/simulate:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// AI-powered conversation handler
app.post('/api/twilio/voice/next', async (req, res) => {
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult || '';
  const callerPhone = req.body.From || '';
  
  const twiml = new VoiceResponse();
  
  // Get or initialize conversation state
  let state = conversationStates.get(callSid);
  if (!state) {
    state = {
      messages: [],
      clinicInstructions: await getClinicInstructions()
    };
    conversationStates.set(callSid, state);
  }
  
  // Add user message to conversation history
  if (userSpeech) {
    state.messages.push({
      role: 'user',
      content: userSpeech
    });
  }
  
  // Determine if conversation should end (max 4 turns to keep it short)
  const shouldEnd = state.messages.length >= 8 || 
                     userSpeech.toLowerCase().includes('danke') ||
                     userSpeech.toLowerCase().includes('tschüss') ||
                     userSpeech.toLowerCase().includes('auf wiedersehen');
  
  if (shouldEnd) {
    // Generate final response
    const finalResponse = await getAIResponse(state.messages, state.clinicInstructions);
    
    twiml.say({
      language: 'de-DE',
      voice: 'Polly.Marlene'
    }, finalResponse + ' Auf Wiederhören!');
    
    twiml.hangup();
    
    // Extract lead data and save to Supabase
    if (supabase) {
      try {
        const extractedData = await extractLeadData(state.messages);
        
        const lead = await createLeadFromCall({
          callSid,
          name: extractedData.name,
          phone: callerPhone,
          concern: extractedData.concern,
          urgency: extractedData.urgency,
          insurance: extractedData.insurance,
          preferredSlotsRaw: extractedData.preferredSlots,
          notes: `AI-Gespräch mit ${state.messages.length / 2} Interaktionen`
        });
        
        console.log('✅ AI Lead created:', lead.id, extractedData);
      } catch (error) {
        console.error('Error creating AI lead:', error);
      }
    }
    
    // Clean up conversation state
    conversationStates.delete(callSid);
    
  } else {
    // Continue conversation
    const aiResponse = await getAIResponse(state.messages, state.clinicInstructions);
    
    // Add AI response to conversation history
    state.messages.push({
      role: 'assistant',
      content: aiResponse
    });
    
    // Gather next user input
    const gather = twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      language: 'de-DE',
      action: '/api/twilio/voice/next',
      method: 'POST',
      timeout: 4
    });
    
    gather.say({
      language: 'de-DE',
      voice: 'Polly.Marlene'
    }, aiResponse);
    
    // Fallback if user doesn't respond
    twiml.say({
      language: 'de-DE',
      voice: 'Polly.Marlene'
    }, 'Vielen Dank für Ihren Anruf. Wir melden uns bald. Auf Wiederhören!');
    
    twiml.hangup();
  }
  
  res.type('text/xml').send(twiml.toString());
});

// Test AI response endpoint (for debugging)
app.post('/debug/test-ai', async (req, res) => {
  try {
    const clinicInstructions = await getClinicInstructions();
    const testMessages = req.body.messages || [
      { role: 'user', content: 'Ich habe Zahnschmerzen und brauche einen Termin' }
    ];
    
    const response = await getAIResponse(testMessages, clinicInstructions);
    const extractedData = await extractLeadData(testMessages);
    
    res.json({
      ok: true,
      aiResponse: response,
      extractedData,
      clinicInstructions: clinicInstructions.substring(0, 100) + '...',
      conversationLength: testMessages.length
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Get leads JSON API
app.get('/api/leads', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({
      ok: false,
      error: 'Supabase not configured'
    });
  }

  try {
    const { data, error} = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }

    res.json({
      ok: true,
      data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// API endpoint to create an appointment
app.post('/api/appointments/create', async (req, res) => {
  try {
    const { lead_id, patient_name, phone, reason, appointment_date, appointment_time, notes } = req.body;

    // Validate required fields
    if (!patient_name || !patient_name.trim()) {
      return res.status(400).json({ ok: false, error: 'Patient name is required' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ ok: false, error: 'Phone is required' });
    }
    if (!appointment_date) {
      return res.status(400).json({ ok: false, error: 'Appointment date is required' });
    }
    if (!appointment_time) {
      return res.status(400).json({ ok: false, error: 'Appointment time is required' });
    }

    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Supabase not configured' });
    }

    // Insert appointment
    const { data, error } = await supabase
      .from('appointments')
      .insert([{
        lead_id: lead_id || null,
        patient_name: patient_name.trim(),
        phone: phone.trim(),
        reason: reason ? reason.trim() : null,
        appointment_date,
        appointment_time,
        notes: notes ? notes.trim() : null,
        status: 'geplant'
      }])
      .select();

    if (error) {
      console.error('Error creating appointment:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    // Optionally update lead status if lead_id exists
    if (lead_id) {
      await supabase
        .from('leads')
        .update({ status: 'Termin vereinbart' })
        .eq('id', lead_id)
        .catch(err => console.error('Note: Could not update lead status:', err));
    }

    res.json({ ok: true, appointment: data[0] });
  } catch (err) {
    console.error('Unexpected error creating appointment:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Selaro server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 Twilio configured: ${!!process.env.TWILIO_ACCOUNT_SID}`);
});

export default app;
