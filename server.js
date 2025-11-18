import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      background: #f5f7fb;
      color: #1f2937;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      width: 100%;
    }
    
    header {
      text-align: center;
      padding: 3rem 0 2rem 0;
    }
    
    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
      color: #111827;
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
      padding: 0.875rem 2rem;
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: 0.5rem;
      transition: all 0.2s;
      cursor: pointer;
    }
    
    .btn-primary {
      background: #00C896;
      color: white;
      border: 2px solid #00C896;
    }
    
    .btn-primary:hover {
      background: #00b586;
      transform: translateY(-2px);
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
    
    .section {
      background: white;
      border-radius: 0.75rem;
      padding: 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    h2 {
      font-size: 1.75rem;
      margin-bottom: 1rem;
      color: #111827;
    }
    
    .section p {
      color: #4b5563;
      font-size: 1.0625rem;
      line-height: 1.7;
    }
    
    footer {
      background: white;
      padding: 2rem 1.5rem;
      text-align: center;
      color: #6b7280;
      font-size: 0.9rem;
      margin-top: auto;
      border-top: 1px solid #e5e7eb;
    }
    
    @media (max-width: 768px) {
      h1 {
        font-size: 2rem;
      }
      
      .buttons {
        flex-direction: column;
        align-items: stretch;
      }
      
      .btn {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Selaro — AI Receptionist for Dental Clinics</h1>
      <div class="buttons">
        <a href="#simulate" class="btn btn-primary">Simulate a Call</a>
        <a href="#dashboard" class="btn btn-secondary">Dashboard Preview</a>
      </div>
    </header>
    
    <div id="how-it-works" class="section">
      <h2>How It Works</h2>
      <p>
        Selaro uses AI to answer patient calls in German, capture appointment details, 
        and store leads automatically. Your practice never misses an opportunity, 
        even after hours or during busy times.
      </p>
    </div>
    
    <div id="simulate" class="section">
      <h2>Simulate a Call</h2>
      <p>
        Experience how Selaro handles incoming patient calls. The AI asks the right 
        questions, understands natural responses, and captures all necessary information 
        including patient name, concern, insurance, and preferred appointment times.
      </p>
    </div>
    
    <div id="dashboard" class="section">
      <h2>Dashboard Preview</h2>
      <p>
        View all captured leads in one place. See patient names, phone numbers, 
        concerns, insurance information, and preferred appointment times. 
        Manage and follow up with potential patients efficiently.
      </p>
    </div>
  </div>
  
  <footer>
    © Selaro — AI Receptionist for Dental Clinics
  </footer>
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

app.post('/api/twilio/voice/step', (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="de-DE" speechTimeout="auto" action="/api/twilio/voice/next" method="POST">
    <Say language="de-DE" voice="Polly.Marlene">Guten Tag, hier ist die digitale Rezeptionsassistenz der Zahnarztpraxis. Wie kann ich Ihnen helfen?</Say>
  </Gather>
</Response>`;
  
  res.type('text/xml');
  res.send(twiml);
});

app.post('/api/twilio/voice/next', (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">Vielen Dank. Ein Mitarbeiter meldet sich bald zurück.</Say>
  <Hangup/>
</Response>`;
  
  res.type('text/xml');
  res.send(twiml);
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Selaro server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 Twilio configured: ${!!process.env.TWILIO_ACCOUNT_SID}`);
});

export default app;
