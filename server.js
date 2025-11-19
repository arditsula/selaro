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
// Key: CallSid, Value: { messages: [], extractedData: {} }
const conversationStates = new Map();

/**
 * Fetch clinic instructions from Supabase
 */
async function getClinicInstructions() {
  if (!supabase) {
    console.warn('Supabase not configured, using default instructions');
    return 'Sie sind eine freundliche Rezeptionistin für eine Zahnarztpraxis in Leipzig.';
  }

  try {
    const { data, error } = await supabase
      .from('clinics')
      .select('instructions')
      .eq('id', CLINIC_ID)
      .single();

    if (error) {
      console.error('Error fetching clinic instructions:', error);
      return 'Sie sind eine freundliche Rezeptionistin für eine Zahnarztpraxis in Leipzig.';
    }

    return data?.instructions || 'Sie sind eine freundliche Rezeptionistin für eine Zahnarztpraxis in Leipzig.';
  } catch (err) {
    console.error('Unexpected error fetching clinic instructions:', err);
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
      <button class="btn btn-primary" onclick="openSimulateModal()">Simulate a Call</button>
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

// AI-powered Twilio voice entry point
app.post('/api/twilio/voice/step', async (req, res) => {
  const callSid = req.body.CallSid;
  const twiml = new VoiceResponse();
  
  // Initialize conversation state for new call
  if (!conversationStates.has(callSid)) {
    conversationStates.set(callSid, {
      messages: [],
      clinicInstructions: await getClinicInstructions()
    });
  }
  
  const gather = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    language: 'de-DE',
    action: '/api/twilio/voice/next',
    method: 'POST',
    timeout: 3
  });
  
  gather.say({
    language: 'de-DE',
    voice: 'Polly.Marlene'
  }, 'Guten Tag! Zahnarztpraxis Xhelili, wie kann ich Ihnen helfen?');
  
  res.type('text/xml').send(twiml.toString());
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
