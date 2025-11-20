import express from 'express';
import cors from 'cors';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const app = express();
const VoiceResponse = twilio.twiml.VoiceResponse;

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

// Clinic ID from environment
const CLINIC_ID = process.env.CLINIC_ID || 'bc91d95c-a05c-4004-b932-bc393f0391b6';

// In-memory conversation state management
// Key: CallSid or sessionId, Value: { messages: [], extractedData: {}, leadSaved: false }
const conversationStates = new Map();

// In-memory session state for /simulate endpoint
// Key: sessionId (generated on first message), Value: { messages: [], leadSaved: false }
const simulatorSessions = new Map();

// In-memory clinic cache
let cachedClinic = null;

/**
 * Fetch and cache clinic data from Supabase
 * Returns the full clinic object { id, name, phone_number, instructions, created_at }
 */
async function getClinic() {
  if (cachedClinic) return cachedClinic;

  const { data, error } = await supabase
    .from('clinics')
    .select('*')
    .eq('id', process.env.CLINIC_ID)
    .single();

  if (error) {
    console.error('Error fetching clinic:', error);
    throw error;
  }

  cachedClinic = data;
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
 * Unified system prompt for AI receptionist (used in both Twilio and simulator)
 */
function buildSystemPrompt(clinicName, clinicInstructions) {
  return `You are a polite and professional German receptionist for a dental clinic.
Clinic name: ${clinicName}
Clinic instructions: ${clinicInstructions}

CRITICAL RULES:
1. Always answer in German (de-DE).
2. Keep responses SHORT and friendly (max 2-3 sentences per turn).
3. To book an appointment, you MUST collect these 4 fields:
   - Name (full name)
   - Telefon (phone number)
   - Grund (reason for visit: pain, cleaning, checkup, etc.)
   - Wunschtermin (preferred day/time)

4. FIELD TRACKING BEHAVIOR:
   - Track which fields you have already collected in this conversation.
   - If a field was already provided, NEVER ask for it again.
   - If user mentions a field in passing, capture it and confirm.
   - Ask for ONE missing field at a time.

5. WHEN ALL 4 FIELDS ARE COLLECTED:
   - Stop asking questions immediately.
   - Output this EXACT format (replace <> with actual values):

**LEAD SUMMARY**
Name: <Full Name>
Telefon: <Phone Number>
Grund: <Reason>
Wunschtermin: <Preferred Time>

Vielen Dank! Unser Team meldet sich zur Terminbestätigung bei Ihnen.

6. EXAMPLE CONVERSATION FLOW:
   User: "Ich habe Zahnschmerzen"
   You: "Das tut mir leid. Wie ist Ihr vollständiger Name?"
   User: "Anna Müller"
   You: "Unter welcher Telefonnummer können wir Sie erreichen?"
   User: "0341 123456"
   You: "Wann hätten Sie am liebsten einen Termin?"
   User: "Morgen Vormittag"
   You: [Output the **LEAD SUMMARY** format above]

7. Never give prices. Never make up appointment times.`;
}

/**
 * Simple regex-based detection of LEAD SUMMARY format
 * Returns { hasSummary: boolean, leadData: {...} } or { hasSummary: false }
 */
function detectLeadSummary(aiResponse) {
  // Check if response contains the required marker
  if (!aiResponse.includes('**LEAD SUMMARY**')) {
    return { hasSummary: false, leadData: null };
  }

  try {
    // Extract fields using regex
    const nameMatch = aiResponse.match(/Name:\s*(.+)/i);
    const phoneMatch = aiResponse.match(/Telefon:\s*(.+)/i);
    const reasonMatch = aiResponse.match(/Grund:\s*(.+)/i);
    const timeMatch = aiResponse.match(/Wunschtermin:\s*(.+)/i);

    // All 4 fields must be present
    if (!nameMatch || !phoneMatch || !reasonMatch || !timeMatch) {
      console.warn('⚠️ LEAD SUMMARY tag found but missing fields');
      return { hasSummary: false, leadData: null };
    }

    return {
      hasSummary: true,
      leadData: {
        name: nameMatch[1].trim(),
        phone: phoneMatch[1].trim(),
        concern: reasonMatch[1].trim(),
        preferredTime: timeMatch[1].trim()
      }
    };
  } catch (err) {
    console.error('Error parsing LEAD SUMMARY:', err);
    return { hasSummary: false, leadData: null };
  }
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Selaro — AI Receptionist for Dental Clinics</title>
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
      padding: 2rem 1rem;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      text-align: center;
    }
    
    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: #111827;
    }
    
    .subheading {
      font-size: 1.125rem;
      color: #4b5563;
      margin-bottom: 2.5rem;
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
    }
    
    .buttons {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 3rem;
    }
    
    .btn {
      display: inline-block;
      padding: 1rem 2.5rem;
      font-size: 1.0625rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: 0.5rem;
      transition: all 0.2s;
      cursor: pointer;
      border: none;
      outline: none;
    }
    
    .btn-primary {
      background: #00C896;
      color: white;
      box-shadow: 0 4px 6px rgba(0, 200, 150, 0.3);
    }
    
    .btn-primary:hover {
      background: #00b586;
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(0, 200, 150, 0.4);
    }
    
    .btn-secondary {
      background: white;
      color: #00C896;
      border: 2px solid #00C896;
    }
    
    .btn-secondary:hover {
      background: #f0fdf9;
      transform: translateY(-2px);
    }
    
    /* Modal Styles */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    
    .modal-overlay.active {
      display: flex;
    }
    
    .modal {
      background: white;
      border-radius: 1rem;
      max-width: 600px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      position: relative;
    }
    
    .modal-header {
      padding: 1.5rem;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .modal-header h2 {
      font-size: 1.5rem;
      color: #111827;
      margin: 0;
    }
    
    .modal-close {
      background: transparent;
      border: none;
      font-size: 1.5rem;
      color: #6b7280;
      cursor: pointer;
      padding: 0.25rem;
      line-height: 1;
      width: 2rem;
      height: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 0.25rem;
    }
    
    .modal-close:hover {
      background: #f3f4f6;
      color: #111827;
    }
    
    .modal-body {
      padding: 1.5rem;
      text-align: left;
    }
    
    .flow-step {
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: #f9fafb;
      border-radius: 0.5rem;
      border-left: 4px solid #00C896;
    }
    
    .flow-step h3 {
      font-size: 1.125rem;
      color: #111827;
      margin-bottom: 0.5rem;
    }
    
    .flow-step p {
      color: #4b5563;
      margin: 0;
    }
    
    .script-box {
      background: #1f2937;
      color: #e5e7eb;
      padding: 1rem;
      border-radius: 0.5rem;
      font-family: 'Courier New', monospace;
      margin-top: 1rem;
      line-height: 1.8;
    }
    
    .note-box {
      background: #fef3c7;
      border: 1px solid #fbbf24;
      padding: 1rem;
      border-radius: 0.5rem;
      margin-top: 1rem;
    }
    
    .note-box strong {
      color: #92400e;
    }
    
    /* Status Display */
    .status-grid {
      display: grid;
      gap: 1rem;
      margin-top: 1rem;
    }
    
    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: #f9fafb;
      border-radius: 0.5rem;
    }
    
    .status-label {
      font-weight: 500;
      color: #374151;
    }
    
    .status-indicator {
      font-size: 1.25rem;
    }
    
    .status-ok { color: #10b981; }
    .status-error { color: #ef4444; }
    
    .status-info {
      margin-top: 1rem;
      padding: 1rem;
      background: #eff6ff;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      color: #1e40af;
    }
    
    .loading {
      text-align: center;
      padding: 2rem;
      color: #6b7280;
    }
    
    footer {
      margin-top: 4rem;
      text-align: center;
      color: #6b7280;
      font-size: 0.875rem;
    }
    
    @media (max-width: 768px) {
      h1 {
        font-size: 2rem;
      }
      
      .buttons {
        flex-direction: column;
      }
      
      .btn {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Selaro — AI Receptionist for Dental Clinics</h1>
    <p class="subheading">
      Never miss a patient call. Our AI receptionist answers in German, captures appointment details, 
      and stores leads automatically—even after hours.
    </p>
    
    <div class="buttons">
      <a href="/simulate" class="btn btn-primary">Try Receptionist Demo</a>
      <button class="btn btn-secondary" onclick="openSimulateModal()">How It Works</button>
      <button class="btn btn-secondary" onclick="openStatusModal()">System Status</button>
    </div>
  </div>
  
  <footer>
    © 2025 Selaro — AI Receptionist for Dental Clinics
  </footer>
  
  <!-- Simulate Modal -->
  <div id="simulateModal" class="modal-overlay" onclick="closeModalOnBackdrop(event, 'simulateModal')">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2>How the AI Call Works</h2>
        <button class="modal-close" onclick="closeSimulateModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="flow-step">
          <h3>Step 1: Patient Calls</h3>
          <p>A patient calls your dental clinic phone number. Instead of voicemail or a busy signal, Selaro's AI receptionist answers immediately.</p>
        </div>
        
        <div class="flow-step">
          <h3>Step 2: AI Captures Information</h3>
          <p>The AI greets the caller in German and asks key questions to understand their needs: name, reason for visit, insurance type, and preferred appointment time.</p>
        </div>
        
        <div class="flow-step">
          <h3>Step 3: Data Stored Automatically</h3>
          <p>All information is captured and stored securely. Your team receives the lead details and can follow up to confirm the appointment.</p>
        </div>
        
        <h3 style="margin-top: 1.5rem; color: #111827;">Sample AI Script (German)</h3>
        <div class="script-box">
          <strong>AI:</strong> "Guten Tag, hier ist die digitale Rezeptionsassistenz der Zahnarztpraxis. Wie kann ich Ihnen helfen?"<br><br>
          <strong>Patient:</strong> "Ich brauche einen Termin für eine Zahnreinigung."<br><br>
          <strong>AI:</strong> "Sehr gerne. Wie ist Ihr Name?"<br><br>
          <strong>Patient:</strong> "Anna Müller."<br><br>
          <strong>AI:</strong> "Danke, Frau Müller. Sind Sie privat oder gesetzlich versichert?"<br><br>
          <strong>Patient:</strong> "Gesetzlich, bei der AOK."<br><br>
          <strong>AI:</strong> "Perfekt. Wann möchten Sie gerne kommen?"<br><br>
          <strong>Patient:</strong> "Am liebsten morgen Vormittag."<br><br>
          <strong>AI:</strong> "Vielen Dank. Ein Mitarbeiter meldet sich bald zurück, um den Termin zu bestätigen. Auf Wiederhören!"
        </div>
        
        <div class="note-box">
          <strong>Note:</strong> Real call simulation happens via Twilio phone integration, not in the browser. 
          To test with a real phone call, configure your Twilio number to point to the webhook endpoints.
        </div>
      </div>
    </div>
  </div>
  
  <!-- Status Modal -->
  <div id="statusModal" class="modal-overlay" onclick="closeModalOnBackdrop(event, 'statusModal')">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2>System Status</h2>
        <button class="modal-close" onclick="closeStatusModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div id="statusContent" class="loading">
          Loading system status...
        </div>
      </div>
    </div>
  </div>
  
  <script>
    function openSimulateModal() {
      document.getElementById('simulateModal').classList.add('active');
    }
    
    function closeSimulateModal() {
      document.getElementById('simulateModal').classList.remove('active');
    }
    
    function openStatusModal() {
      const modal = document.getElementById('statusModal');
      modal.classList.add('active');
      fetchSystemStatus();
    }
    
    function closeStatusModal() {
      document.getElementById('statusModal').classList.remove('active');
    }
    
    function closeModalOnBackdrop(event, modalId) {
      if (event.target.id === modalId) {
        document.getElementById(modalId).classList.remove('active');
      }
    }
    
    async function fetchSystemStatus() {
      const statusContent = document.getElementById('statusContent');
      
      try {
        const response = await fetch('/debug/status');
        const data = await response.json();
        
        const timestamp = new Date(data.timestamp).toLocaleString();
        const uptimeMinutes = Math.floor(data.uptime / 60);
        const uptimeSeconds = Math.floor(data.uptime % 60);
        
        let html = '<div class="status-grid">';
        
        // Overall status
        html += \`
          <div class="status-item">
            <span class="status-label">Server Status</span>
            <span class="status-indicator \${data.ok ? 'status-ok' : 'status-error'}">\${data.ok ? '✅' : '❌'}</span>
          </div>
        \`;
        
        // Environment variables
        for (const [key, value] of Object.entries(data.environment)) {
          html += \`
            <div class="status-item">
              <span class="status-label">\${key}</span>
              <span class="status-indicator \${value ? 'status-ok' : 'status-error'}">\${value ? '✅' : '❌'}</span>
            </div>
          \`;
        }
        
        html += '</div>';
        
        html += \`
          <div class="status-info">
            <strong>Last Updated:</strong> \${timestamp}<br>
            <strong>Uptime:</strong> \${uptimeMinutes}m \${uptimeSeconds}s
          </div>
        \`;
        
        statusContent.innerHTML = html;
      } catch (error) {
        statusContent.innerHTML = \`
          <div style="color: #ef4444; text-align: center; padding: 2rem;">
            <strong>Error loading status</strong><br>
            <small>\${error.message}</small>
          </div>
        \`;
      }
    }
    
    // Close modals with Escape key
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeSimulateModal();
        closeStatusModal();
      }
    });
  </script>
</body>
</html>
  `;
  res.type('html').send(html);
});

// Simulator page - simple chat UI to test the AI receptionist
app.get('/simulate', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8" />
      <title>Selaro – Receptionist Simulator</title>
      <style>
        body { font-family: sans-serif; max-width: 600px; margin: 40px auto; }
        .chat { border: 1px solid #ddd; border-radius: 8px; padding: 12px; height: 400px; overflow-y: auto; margin-bottom: 12px; }
        .msg { margin: 6px 0; padding: 8px 10px; border-radius: 6px; max-width: 80%; }
        .ai { background: #f2f2f2; text-align: left; }
        .user { background: #dff0ff; margin-left: auto; text-align: right; }
        .row { display: flex; gap: 8px; }
        input[type="text"] { flex: 1; padding: 8px; }
        button { padding: 8px 12px; }
      </style>
    </head>
    <body>
      <h1>Selaro – Receptionist Simulator</h1>
      <div class="chat" id="chat"></div>
      <form class="row" id="form">
        <input type="text" id="input" placeholder="Schreiben Sie hier..." autocomplete="off" />
        <button type="submit">Send</button>
      </form>

      <script>
        const chat = document.getElementById('chat');
        const form = document.getElementById('form');
        const input = document.getElementById('input');
        
        let sessionId = null; // Track session ID for conversation continuity

        function addMessage(text, role) {
          const div = document.createElement('div');
          div.className = 'msg ' + (role === 'ai' ? 'ai' : 'user');
          div.textContent = text;
          chat.appendChild(div);
          chat.scrollTop = chat.scrollHeight;
        }

        // First greeting
        addMessage('Guten Tag, Sie sind mit der Zahnarztpraxis Stela Xhelili in der Karl-Liebknecht-Straße 1 in Leipzig verbunden. Wie kann ich Ihnen helfen?', 'ai');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          addMessage(text, 'user');
          input.value = '';
          try {
            const body = { message: text };
            if (sessionId) {
              body.sessionId = sessionId; // Include sessionId if exists
            }
            
            const res = await fetch('/api/simulate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            const data = await res.json();
            
            // Store sessionId from response for next request
            if (data.sessionId) {
              sessionId = data.sessionId;
            }
            
            addMessage(data.reply || 'Fehler: Keine Antwort vom Server.', 'ai');
          } catch (err) {
            addMessage('Es ist ein Fehler aufgetreten.', 'ai');
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

// Create a test lead in Supabase (debug)
app.post('/debug/create-test-lead', async (req, res) => {
  try {
    const testLead = {
      name: 'Test Lead Selaro',
      phone: '+49123456789',
      notes: 'Ky është një lead test nga /debug/create-test-lead'
    };

    const { data, error } = await supabase
      .from('leads')
      .insert([testLead])
      .select();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({
      ok: true,
      message: 'Test lead u krijua me sukses 🎉',
      lead: data[0]
    });
  } catch (err) {
    console.error('Unexpected error creating test lead:', err);
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

    let html = `
      <!DOCTYPE html>
      <html lang="de">
      <head>
        <meta charset="UTF-8" />
        <title>Selaro – Leads</title>
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #0b1120;
            color: #e5e7eb;
            margin: 0;
            padding: 2rem;
          }
          h1 {
            margin-bottom: 1rem;
          }
          .subtitle {
            color: #9ca3af;
            margin-bottom: 1.5rem;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            background: #020617;
            border-radius: 0.75rem;
            overflow: hidden;
          }
          thead {
            background: #111827;
          }
          th, td {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid #1f2937;
            font-size: 0.875rem;
            text-align: left;
            vertical-align: top;
          }
          th {
            font-weight: 600;
            color: #9ca3af;
          }
          tr:last-child td {
            border-bottom: none;
          }
          .tag {
            display: inline-block;
            padding: 0.15rem 0.5rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            background: #1f2937;
            color: #e5e7eb;
          }
          .tag-urgent {
            background: #7f1d1d;
            color: #fecaca;
          }
          .status-badge {
            display: inline-block;
            padding: 0.15rem 0.6rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            background: #064e3b;
            color: #a7f3d0;
            text-transform: uppercase;
            letter-spacing: 0.03em;
          }
          .empty-state {
            padding: 2rem;
            text-align: center;
            color: #6b7280;
          }
          .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
          }
          .toolbar a {
            color: #60a5fa;
            text-decoration: none;
            font-size: 0.875rem;
          }
          .toolbar a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <div>
            <h1>Selaro – Leads</h1>
            <div class="subtitle">
              Letzte eingegangene Anfragen (Telefon-Leads)
            </div>
          </div>
          <div>
            <a href="/">Zurück zur Startseite</a>
          </div>
        </div>
    `;

    if (!data || data.length === 0) {
      html += `
        <div class="empty-state">
          <p>Noch keine Leads vorhanden.</p>
        </div>
      `;
    } else {
      html += `<table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Name</th>
            <th>Telefon</th>
            <th>Anliegen</th>
            <th>Dringlichkeit</th>
            <th>Versicherung</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
      `;

      for (const lead of data) {
        const createdAt = lead.created_at
          ? new Date(lead.created_at).toLocaleString('de-DE')
          : '';
        const urgencyTag = lead.urgency === 'urgent'
          ? '<span class="tag tag-urgent">Akut</span>'
          : (lead.urgency
                ? '<span class="tag">' + lead.urgency + '</span>'
                : '');
        const insurance = lead.insurance || '';
        const concern = lead.concern || '';
        const statusBadge = '<span class="status-badge">' + (lead.status || 'new') + '</span>';

        html += `
          <tr>
            <td>${createdAt}</td>
            <td>${lead.name || ''}</td>
            <td>${lead.phone || ''}</td>
            <td>${concern}</td>
            <td>${urgencyTag}</td>
            <td>${insurance}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      }

      html += `
        </tbody>
      </table>
      `;
    }

    html += `
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
    
    // Detect LEAD SUMMARY and save if not already saved
    if (!state.leadSaved && supabase) {
      const { hasSummary, leadData } = detectLeadSummary(aiReply);
      
      if (hasSummary && leadData) {
        try {
          console.log('📋 LEAD SUMMARY detected! Saving to Supabase...', leadData);
          
          const lead = await createLeadFromCall({
            callSid: callSid,
            name: leadData.name,
            phone: leadData.phone,
            concern: leadData.concern,
            urgency: null,
            insurance: null,
            preferredSlotsRaw: leadData.preferredTime,
            notes: `Twilio Call - CallSid: ${callSid}`
          });
          
          state.leadSaved = true;
          console.log('✅ Lead saved successfully! ID:', lead.id);
        } catch (leadError) {
          // Log error but don't break the call
          console.error('⚠️ Error saving lead (call continues):', leadError);
        }
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
    
    if (!message) {
      return res.status(400).json({ error: 'Missing "message" field in request body' });
    }
    
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
      content: message
    });
    
    // Use the same getClinic() helper
    const clinic = await getClinic();
    
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
    
    // Detect LEAD SUMMARY and save if not already saved
    if (!state.leadSaved && supabase) {
      const { hasSummary, leadData } = detectLeadSummary(reply);
      
      if (hasSummary && leadData) {
        try {
          console.log('📋 LEAD SUMMARY detected in simulator! Saving to Supabase...', leadData);
          
          const lead = await createLeadFromCall({
            callSid: sid,
            name: leadData.name,
            phone: leadData.phone,
            concern: leadData.concern,
            urgency: null,
            insurance: null,
            preferredSlotsRaw: leadData.preferredTime,
            notes: `Web Simulator - Session: ${sid}`
          });
          
          state.leadSaved = true;
          console.log('✅ Lead saved successfully from simulator! ID:', lead.id);
        } catch (leadError) {
          // Log error but don't break the conversation
          console.error('⚠️ Error saving lead from simulator (conversation continues):', leadError);
        }
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

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Selaro server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 Twilio configured: ${!!process.env.TWILIO_ACCOUNT_SID}`);
});

export default app;
