/**
 * VoxDesk — Frontend React con Twilio Browser SDK
 * 
 * Questo componente usa l'SDK ufficiale Twilio Voice per fare
 * e ricevere chiamate REALI direttamente dal browser.
 * 
 * Dipendenze (in index.html o CDN):
 *   <script src="https://sdk.twilio.com/js/client/releases/2.9.0/twilio.min.js"></script>
 * 
 * Oppure: npm install @twilio/voice-sdk
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ──────────────────────────────────────────────────────────────────
const BACKEND_URL = "http://voxdesk-backend-production.up.railway.app"; // cambia in produzione
const AGENT_IDENTITY = "agente_1";

// ─── Hook: Twilio Device ──────────────────────────────────────────────────────
function useTwilioDevice() {
  const deviceRef = useRef(null);
  const [status, setStatus] = useState("disconnesso"); // disconnesso | pronto | in_chiamata | squillo
  const [activeCall, setActiveCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [error, setError] = useState(null);

  const initDevice = useCallback(async () => {
    try {
      setStatus("connessione...");

      // 1. Chiedi token al backend
      const res = await fetch(`${BACKEND_URL}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: AGENT_IDENTITY }),
      });
      const { token } = await res.json();

      // 2. Inizializza SDK Twilio (richiede lo script CDN caricato)
      const { Device } = window.Twilio;
      const device = new Device(token, {
        logLevel: 1,
        codecPreferences: ["opus", "pcmu"],
      });

      // 3. Event listeners
      device.on("ready", () => setStatus("pronto"));
      device.on("error", (err) => {
        setError(err.message);
        setStatus("errore");
      });
      device.on("disconnect", () => {
        setStatus("pronto");
        setActiveCall(null);
      });
      device.on("incoming", (call) => {
        setIncomingCall(call);
        setStatus("squillo");
        // Auto-reject dopo 30 secondi se non risponde
        setTimeout(() => {
          if (call.status() === "pending") call.reject();
        }, 30000);
      });

      device.register(); // abilita ricezione chiamate
      deviceRef.current = device;

    } catch (err) {
      setError(`Errore init: ${err.message}`);
      setStatus("errore");
    }
  }, []);

  // Chiamata outbound
  const makeCall = useCallback(async (to) => {
    if (!deviceRef.current) return;
    try {
      const call = await deviceRef.current.connect({
        params: { To: to },
      });
      call.on("accept", () => setStatus("in_chiamata"));
      call.on("disconnect", () => { setStatus("pronto"); setActiveCall(null); });
      call.on("error", (err) => setError(err.message));
      setActiveCall(call);
      setStatus("in_chiamata");
      return call;
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Rispondi a chiamata in entrata
  const acceptCall = useCallback(() => {
    if (!incomingCall) return;
    incomingCall.accept();
    setActiveCall(incomingCall);
    setIncomingCall(null);
    setStatus("in_chiamata");
  }, [incomingCall]);

  // Rifiuta/termina
  const rejectCall = useCallback(() => {
    if (incomingCall) { incomingCall.reject(); setIncomingCall(null); }
    setStatus("pronto");
  }, [incomingCall]);

  const hangUp = useCallback(() => {
    if (activeCall) activeCall.disconnect();
    if (deviceRef.current) deviceRef.current.disconnectAll();
    setActiveCall(null);
    setStatus("pronto");
  }, [activeCall]);

  const mute = useCallback((val) => {
    if (activeCall) activeCall.mute(val);
  }, [activeCall]);

  return { status, activeCall, incomingCall, error, initDevice, makeCall, acceptCall, rejectCall, hangUp, mute };
}

// ─── Dati mock CRM ────────────────────────────────────────────────────────────
const mockContacts = [
  { id: 1, name: "Marco Ferretti", company: "Edilsud Srl", phone: "+39 02 1234 5678", tag: "cliente", avatar: "MF" },
  { id: 2, name: "Laura Conti", company: "Studio Legale Conti", phone: "+39 06 9876 5432", tag: "lead", avatar: "LC" },
  { id: 3, name: "James O'Brien", company: "Bray Logistics", phone: "+353 1 555 0199", tag: "cliente", avatar: "JO" },
  { id: 4, name: "Sofia Mancini", company: "Mancini Consulting", phone: "+39 011 3344 556", tag: "lead", avatar: "SM" },
];

const tagStyle = {
  cliente: { bg: "#0d2e1a", text: "#4ade80" },
  lead: { bg: "#0d1f3c", text: "#60a5fa" },
  prospect: { bg: "#2d1f05", text: "#fbbf24" },
};

// ─── Componenti UI ────────────────────────────────────────────────────────────
const StatusDot = ({ status }) => {
  const colors = { pronto: "#4ade80", in_chiamata: "#f97316", squillo: "#a78bfa", disconnesso: "#6b7280", errore: "#ef4444", "connessione...": "#fbbf24" };
  return <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors[status] || "#6b7280", flexShrink: 0 }} />;
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function VoxDeskLive() {
  const [view, setView] = useState("dialer");
  const [dialValue, setDialValue] = useState("");
  const [callTimer, setCallTimer] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [note, setNote] = useState("");
  const [callLog, setCallLog] = useState([]);
  const timerRef = useRef(null);

  const { status, activeCall, incomingCall, error, initDevice, makeCall, acceptCall, rejectCall, hangUp, mute } = useTwilioDevice();

  // Inizializza device al mount
  useEffect(() => { initDevice(); }, [initDevice]);

  // Timer chiamata
  useEffect(() => {
    if (status === "in_chiamata") {
      timerRef.current = setInterval(() => setCallTimer(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      if (callTimer > 0) setCallTimer(0);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  // Carica storico dal backend
  useEffect(() => {
    fetch(`${BACKEND_URL}/calls`)
      .then(r => r.json())
      .then(setCallLog)
      .catch(() => {});
  }, [status]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const handleCall = async (number) => {
    if (!number) return;
    await makeCall(number.replace(/\s/g, ""));
  };

  const handleMute = () => {
    mute(!muted);
    setMuted(m => !m);
  };

  const navItems = [
    { id: "dialer", label: "📞 Chiama" },
    { id: "contacts", label: "👥 Contatti" },
    { id: "calls", label: "📋 Storico" },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0c0f1a", minHeight: "100vh", color: "#e0e3f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes ring { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(8deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .animate { animation: slideUp 0.25s ease forwards; }
        .btn:hover { opacity: 0.85; }
        .key:hover { background: #252a3d !important; }
        .key:active { transform: scale(0.93); }
        .row:hover { background: #141827 !important; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#10131f", borderBottom: "1px solid #1c2030", padding: "0 20px", height: 52, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,#34d399,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>📞</div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>VoxDesk</span>
          <span style={{ fontSize: 11, color: "#4b5280", background: "#1c2030", padding: "1px 7px", borderRadius: 10 }}>LIVE</span>
        </div>

        <nav style={{ display: "flex", gap: 2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              background: view === n.id ? "#1c2030" : "transparent",
              border: "none", color: view === n.id ? "#34d399" : "#6b7280",
              padding: "5px 13px", borderRadius: 8, cursor: "pointer",
              fontSize: 12, fontWeight: 500, fontFamily: "inherit", transition: "all 0.15s",
            }}>{n.label}</button>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* Status badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1c2030", borderRadius: 20, padding: "4px 12px" }}>
            <StatusDot status={status} />
            <span style={{ fontSize: 11, color: "#8b90a8", fontFamily: "'DM Mono', monospace" }}>
              {status === "in_chiamata" ? `🔴 ${fmt(callTimer)}` : status}
            </span>
          </div>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>A</div>
        </div>
      </div>

      {/* Incoming call overlay */}
      {incomingCall && (
        <div style={{
          position: "fixed", inset: 0, background: "#0008", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ background: "#10131f", border: "1px solid #34d399", borderRadius: 20, padding: 32, textAlign: "center", minWidth: 280 }}>
            <div style={{ fontSize: 40, animation: "ring 0.5s ease infinite", marginBottom: 12 }}>📲</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Chiamata in entrata</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{incomingCall.parameters?.From || "Sconosciuto"}</div>
            <div style={{ fontSize: 12, color: "#34d399", marginBottom: 24, animation: "pulse 1.5s ease infinite" }}>Squillo...</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn" onClick={rejectCall} style={{ background: "#ef4444", border: "none", color: "white", borderRadius: 50, width: 56, height: 56, fontSize: 22, cursor: "pointer" }}>📵</button>
              <button className="btn" onClick={acceptCall} style={{ background: "#22c55e", border: "none", color: "white", borderRadius: 50, width: 56, height: 56, fontSize: 22, cursor: "pointer" }}>📞</button>
            </div>
          </div>
        </div>
      )}

      {/* Error bar */}
      {error && (
        <div style={{ background: "#2d0a0a", borderBottom: "1px solid #7f1d1d", padding: "8px 20px", fontSize: 12, color: "#fca5a5", display: "flex", justifyContent: "space-between" }}>
          ⚠️ {error}
          <button onClick={() => {}} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
      )}

      {/* Active call bar */}
      {status === "in_chiamata" && (
        <div style={{ background: "linear-gradient(90deg,#052e16,#064e3b)", borderBottom: "1px solid #059669", padding: "0 20px", height: 44, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", animation: "pulse 1s ease infinite" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#34d399" }}>IN CHIAMATA</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: "#a7f3d0" }}>{fmt(callTimer)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn" onClick={handleMute} style={{ background: muted ? "#065f46" : "#1e2a30", border: "none", color: muted ? "#34d399" : "#9ca3af", borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {muted ? "🔇 MUTATO" : "🎤 MUTO"}
            </button>
            <button className="btn" onClick={hangUp} style={{ background: "#dc2626", border: "none", color: "white", borderRadius: 8, padding: "4px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              📵 TERMINA
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>

        {/* DIALER */}
        {view === "dialer" && (
          <div className="animate" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20 }}>
            {/* Left: call note area */}
            <div>
              <div style={{ background: "#10131f", border: "1px solid #1c2030", borderRadius: 14, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#4b5280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Note chiamata</div>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Scrivi note durante la chiamata..."
                  style={{
                    width: "100%", background: "#0c0f1a", border: "1px solid #1c2030", borderRadius: 10,
                    padding: 12, color: "#e0e3f0", fontSize: 13, fontFamily: "inherit",
                    resize: "none", height: 120, outline: "none", lineHeight: 1.6,
                  }}
                />
              </div>

              {/* Quick contacts */}
              <div style={{ background: "#10131f", border: "1px solid #1c2030", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #1c2030", fontSize: 11, color: "#4b5280", letterSpacing: "0.1em", textTransform: "uppercase" }}>Contatti recenti</div>
                {mockContacts.slice(0, 3).map(c => (
                  <div key={c.id} className="row" onClick={() => setDialValue(c.phone.replace(/\s/g, ""))}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid #141827", cursor: "pointer", transition: "background 0.1s" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: "#1c2030", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#34d399" }}>{c.avatar}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                      <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "#4b5280" }}>{c.phone}</div>
                    </div>
                    <button className="btn" onClick={e => { e.stopPropagation(); handleCall(c.phone); }}
                      style={{ background: "#052e16", border: "1px solid #065f46", color: "#34d399", borderRadius: 8, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                      Chiama
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: keypad */}
            <div style={{ background: "#10131f", border: "1px solid #1c2030", borderRadius: 14, padding: 20 }}>
              <input
                value={dialValue}
                onChange={e => setDialValue(e.target.value)}
                placeholder="+39 o +353..."
                style={{
                  width: "100%", background: "#0c0f1a", border: "1px solid #1c2030",
                  borderRadius: 10, padding: "12px", color: "#e0e3f0",
                  fontSize: 20, fontFamily: "'DM Mono', monospace",
                  textAlign: "center", outline: "none", marginBottom: 16, letterSpacing: "0.06em",
                }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
                {["1","2","3","4","5","6","7","8","9","*","0","#"].map(k => (
                  <button key={k} className="key" onClick={() => setDialValue(v => v + k)} style={{
                    background: "#181d2e", border: "none", color: "#e0e3f0", borderRadius: 10,
                    padding: "14px", fontSize: 18, fontWeight: 500, cursor: "pointer",
                    fontFamily: "'DM Mono', monospace", transition: "all 0.1s",
                  }}>{k}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="key" onClick={() => setDialValue(v => v.slice(0, -1))} style={{
                  background: "#181d2e", border: "none", color: "#6b7280", borderRadius: 10,
                  padding: "13px 16px", fontSize: 16, cursor: "pointer",
                }}>⌫</button>
                <button className="btn" onClick={() => handleCall(dialValue)} disabled={!dialValue || status === "in_chiamata"}
                  style={{
                    flex: 1, background: status === "in_chiamata" ? "#1c2030" : "linear-gradient(135deg,#16a34a,#15803d)",
                    border: "none", color: status === "in_chiamata" ? "#4b5280" : "white",
                    borderRadius: 10, padding: "13px", fontSize: 18, cursor: dialValue ? "pointer" : "default",
                  }}>📞</button>
              </div>

              {/* SDK status */}
              <div style={{ marginTop: 14, padding: "8px 12px", background: "#0c0f1a", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <StatusDot status={status} />
                <span style={{ fontSize: 11, color: "#4b5280", fontFamily: "'DM Mono', monospace" }}>SDK: {status}</span>
                {status === "errore" && (
                  <button onClick={initDevice} style={{ marginLeft: "auto", background: "none", border: "1px solid #374151", color: "#9ca3af", borderRadius: 6, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>Riconnetti</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CONTACTS */}
        {view === "contacts" && (
          <div className="animate">
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 16, letterSpacing: "-0.02em" }}>Contatti</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {mockContacts.map(c => (
                <div key={c.id} style={{ background: "#10131f", border: "1px solid #1c2030", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: "#1c2030", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#34d399" }}>{c.avatar}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{c.company}</div>
                    <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "#4b5280", marginTop: 2 }}>{c.phone}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tagStyle[c.tag]?.bg, color: tagStyle[c.tag]?.text }}>{c.tag}</span>
                  <button className="btn" onClick={() => handleCall(c.phone)} style={{
                    background: "linear-gradient(135deg,#16a34a,#15803d)", border: "none", color: "white",
                    borderRadius: 8, padding: "7px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                  }}>📞 Chiama</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CALLS */}
        {view === "calls" && (
          <div className="animate">
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 16, letterSpacing: "-0.02em" }}>Storico Chiamate</h2>
            <div style={{ background: "#10131f", border: "1px solid #1c2030", borderRadius: 12, overflow: "hidden" }}>
              {callLog.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "#4b5280", fontSize: 13 }}>
                  Nessuna chiamata ancora — il log si popola in tempo reale
                </div>
              ) : callLog.map(call => (
                <div key={call.id} className="row" style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #141827", transition: "background 0.1s", cursor: "default" }}>
                  <div style={{ fontSize: 18, marginRight: 12 }}>{call.type === "inbound" ? "↙" : "↗"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{call.type === "inbound" ? call.from : call.to}</div>
                    <div style={{ fontSize: 11, color: "#4b5280" }}>{new Date(call.startTime).toLocaleString("it-IT")}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: call.status === "completed" ? "#052e16" : "#2d0a0a", color: call.status === "completed" ? "#34d399" : "#f87171" }}>
                    {call.duration ? `${call.duration}s` : call.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
