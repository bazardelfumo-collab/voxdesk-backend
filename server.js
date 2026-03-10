require("dotenv").config();
const express = require("express");
const cors = require("cors");
const twilio = require("twilio");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_TWIML_APP_SID,
  TWILIO_CALLER_ID,
  PORT = 3001,
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const VoiceResponse = twilio.twiml.VoiceResponse;

const callLog = [];

app.post("/token", (req, res) => {
  const identity = req.body.identity || "agente_1";
  const token = new AccessToken(
    TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY,
    process.env.TWILIO_API_SECRET,
    { identity }
  );
  const grant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_TWIML_APP_SID,
    incomingAllow: true,
  });
  token.addGrant(grant);
  res.json({ token: token.toJwt(), identity, expiresIn: 3600 });
});

app.post("/voice", (req, res) => {
  const twiml = new VoiceResponse();
  const to = req.body.To;
  if (to) {
    const dial = twiml.dial({
      callerId: TWILIO_CALLER_ID,
      record: "record-from-answer",
      recordingStatusCallback: "/recording",
      action: "/status",
    });
    if (to.startsWith("+") || to.match(/^\d/)) {
      dial.number({ statusCallbackEvent: "initiated ringing answered completed" }, to);
    } else {
      dial.client(to);
    }
  } else {
    twiml.say({ language: "it-IT" }, "Numero non trovato. Riprova.");
  }
  callLog.unshift({
    id: Date.now(),
    type: "outbound",
    to: to,
    from: TWILIO_CALLER_ID,
    startTime: new Date().toISOString(),
    status: "initiated",
  });
  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/incoming", (req, res) => {
  const twiml = new VoiceResponse();
  const caller = req.body.From;
  const dial = twiml.dial({ timeout: 20, record: "record-from-answer" });
  dial.client("agente_1");
  callLog.unshift({
    id: Date.now(),
    type: "inbound",
    from: caller,
    to: TWILIO_CALLER_ID,
    startTime: new Date().toISOString(),
    status: "ringing",
  });
  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/status", (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  const call = callLog.find(c => c.callSid === CallSid);
  if (call) {
    call.status = CallStatus;
    call.duration = CallDuration;
  }
  console.log(`[STATUS] ${CallSid} → ${CallStatus} (${CallDuration}s)`);
  res.sendStatus(204);
});

app.post("/recording", (req, res) => {
  const { CallSid, RecordingUrl, RecordingDuration } = req.body;
  const call = callLog.find(c => c.callSid === CallSid);
  if (call) {
    call.recordingUrl = RecordingUrl + ".mp3";
    call.recordingDuration = RecordingDuration;
  }
  console.log(`[RECORDING] ${RecordingUrl}`);
  res.sendStatus(204);
});

app.get("/numbers", async (req, res) => {
  try {
    const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
    res.json(numbers.map(n => ({
      sid: n.sid,
      number: n.phoneNumber,
      friendlyName: n.friendlyName,
      capabilities: n.capabilities,
      dateCreated: n.dateCreated,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/calls", (req, res) => {
  res.json(callLog.slice(0, 50));
});

app.listen(PORT, () => {
  console.log(`VoxDesk backend avviato su http://localhost:${PORT}`);
  console.log(`Caller ID: ${TWILIO_CALLER_ID}`);
});
