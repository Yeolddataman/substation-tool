import { useState, useRef, useEffect } from 'react';
import { CHATBOT_SYSTEM_PROMPT } from '../data/safetyStandards';
import { getToken, clearToken } from '../lib/auth';

// Calls the backend proxy — the user's API key is sent per-request in the
// X-Anthropic-Key header over HTTPS. It is never stored server-side, never
// in the JS bundle, and only reaches Anthropic via the authenticated proxy.
// JWT auth (Authorization header) ensures only logged-in users can use it.
async function callAnthropic(messages, systemPrompt, apiKey) {
  const token = getToken();
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Authorization':    `Bearer ${token}`,
      'Content-Type':     'application/json',
      'X-Anthropic-Key':  apiKey,
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1536,
      system:     systemPrompt || CHATBOT_SYSTEM_PROMPT,
      messages,
    }),
  });
  if (response.status === 401) {
    clearToken();
    window.location.reload();
    return '';
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

// Build enriched system prompt for Insight Mode
function buildInsightSystemPrompt(sub) {
  if (!sub) return CHATBOT_SYSTEM_PROMPT;

  const faultSummary = sub.faultsByYear && Object.keys(sub.faultsByYear).length > 0
    ? Object.entries(sub.faultsByYear).sort(([a],[b])=>a.localeCompare(b))
        .map(([y,n]) => `${y}: ${n} faults`).join(', ')
    : 'No fault history available';

  const subContext = `
## ACTIVE NETWORK CONTEXT — Insight Mode

You are currently viewing the following substation in the SSEN SEPD network map:

**Substation:** ${sub.name}
**Type:** ${sub.type} | **Voltage:** ${sub.voltage} kV
**Operator:** ${sub.operator || 'SSEN SEPD'}
**Grid Reference:** ${sub.gridRef || '—'}
**Upstream GSP:** ${sub.upstreamGSP || '—'}
**Upstream BSP:** ${sub.upstreamBSP || '—'}
**Transformer Rating:** ${sub.transformerRating || '—'}

**Headroom (March 2026):**
- Demand RAG: ${sub.demandRAG || 'N/A'}
- Max Observed Demand: ${sub.maxDemand != null ? sub.maxDemand + ' MVA' : '—'}
- Estimated Demand Headroom: ${sub.demandHeadroom || '—'} MVA
- Demand Constraint: ${sub.demandConstraint || 'None recorded'}
- Generation RAG: ${sub.genRAG || 'N/A'}
- Connected Generation: ${sub.connectedGen != null ? sub.connectedGen + ' MW' : '—'}
- Est. Generation Headroom: ${sub.genHeadroom || '—'} MW
- 3-Phase Fault Level: ${sub.faultLevel3Ph != null ? sub.faultLevel3Ph + ' kA' : '—'} (Rating: ${sub.faultRating3Ph != null ? sub.faultRating3Ph + ' kA' : '—'})

**HV Fault History (NAFIRS):** ${faultSummary}
**Feeder Count:** ${sub.feederCount || '—'}

**Reinforcement Works:** ${sub.reinforcementWorks || 'None recorded'}
**Reinforcement Completion:** ${sub.reinforcementDate || '—'}

**Safety Zone:** ${sub.safetyZone || '—'}

Use this live network data to answer questions with specific, data-driven insights about this substation. Cross-reference with UK safety standards and regulatory context where relevant. You may be asked about capacity planning, fault trends, LCT impact, reinforcement works, or safe working practices at this specific asset.
`;

  return CHATBOT_SYSTEM_PROMPT + '\n\n' + subContext;
}

function buildContentBlock(text, imageData) {
  if (!imageData) return text;
  return [
    { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64 } },
    { type: 'text', text },
  ];
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`chat-message ${isUser ? 'chat-message--user' : 'chat-message--assistant'}`}>
      <div className={`chat-bubble ${isUser ? 'chat-bubble--user' : 'chat-bubble--assistant'}`}>
        {msg.imagePreview && <img src={msg.imagePreview} alt="uploaded" className="chat-image-preview" />}
        <div className="chat-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.displayText) }} />
      </div>
      <div className="chat-meta">{isUser ? 'You' : '⚡ Safety Assistant'}</div>
    </div>
  );
}

function formatMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<h4>$1</h4>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/⚠️/g, '<span class="chat-warning">⚠️</span>')
    .replace(/\n/g, '<br/>');
}

export default function ChatBot({ isOpen, onToggle, initialMessage, initialImage, onMessageHandled, selectedSubstation }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [insightMode, setInsightMode] = useState(false);

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (initialMessage && isOpen) {
      setInput(initialMessage);
      if (initialImage) setPendingImage(initialImage);
      onMessageHandled?.();
      inputRef.current?.focus();
    }
  }, [initialMessage, initialImage, isOpen]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && !pendingImage) return;
    if (!apiKey) { setShowConfig(true); return; }

    setError('');
    const imagePreview = pendingImage?.url || null;
    const imageData = pendingImage ? {
      base64: pendingImage.url.split(',')[1],
      mediaType: pendingImage.file?.type || 'image/jpeg',
    } : null;

    const userMessage = {
      role: 'user',
      displayText: text || '(image submitted)',
      imagePreview,
      content: buildContentBlock(text || 'Please analyse this image.', imageData),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setPendingImage(null);
    setLoading(true);

    try {
      const apiMessages = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));
      const systemPrompt = insightMode ? buildInsightSystemPrompt(selectedSubstation) : CHATBOT_SYSTEM_PROMPT;
      const reply = await callAnthropic(apiMessages, systemPrompt, apiKey);
      setMessages((prev) => [...prev, { role: 'assistant', displayText: reply, content: reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPendingImage({ url: ev.target.result, file, name: file.name });
    reader.readAsDataURL(file);
  };

  const safetySuggestions = [
    'What PPE is required at an HV substation?',
    'Explain the Five Point Safety Rules',
    'What is an Authorised Person under ENA Safety Rules?',
    'When can live working be permitted?',
  ];

  const insightSuggestions = selectedSubstation ? [
    `When will ${selectedSubstation.name} hit capacity based on current headroom?`,
    `What does the fault history suggest about asset condition at ${selectedSubstation.name}?`,
    `What reinforcement is needed and what's the RIIO-ED2 implication?`,
    `How will EV and heat pump uptake impact headroom at this primary by 2035?`,
    `Is the 3-phase fault level within safe limits at ${selectedSubstation.name}?`,
  ] : [
    'Select a substation on the map to enable network-specific insights',
  ];

  const suggestedQuestions = insightMode ? insightSuggestions : safetySuggestions;

  return (
    <>
      <button
        className={`chatbot-toggle ${isOpen ? 'chatbot-toggle--active' : ''}`}
        onClick={onToggle}
        title="Network Intelligence Assistant"
      >
        <span className="chatbot-toggle-icon">🧠</span>
        {!isOpen && <span className="chatbot-toggle-label">Network AI</span>}
      </button>

      {isOpen && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <div className="chatbot-header-info">
              <div className="chatbot-title">🧠 Network Intelligence Assistant</div>
              <div className="chatbot-subtitle">
                {insightMode && selectedSubstation
                  ? `💡 Insight Mode · ${selectedSubstation.name}`
                  : 'Safety · Capacity · DFES · EaWR 1989 · ENA Safety Rules'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                className={`btn btn-sm ${insightMode ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => { setInsightMode(v => !v); setMessages([]); }}
                title={insightMode ? 'Insight Mode ON — click to switch to Safety Mode' : 'Enable Insight Mode — AI answers questions about selected substation data'}
              >
                {insightMode ? '💡 Insight' : '💡 Insight'}
              </button>
              <button
                className={`btn btn-sm btn-outline ${apiKey ? '' : 'btn-warn'}`}
                onClick={() => setShowConfig(v => !v)}
                title={apiKey ? 'API key set — click to change' : 'Enter your Anthropic API key'}
              >⚙{!apiKey && ' !'}</button>
              <button className="close-btn" onClick={onToggle}>✕</button>
            </div>
          </div>

          {showConfig && (
            <div className="api-key-panel">
              <div className="api-key-label">Your Anthropic API Key</div>
              <div className="api-key-note">
                Sent securely to our proxy over HTTPS — never stored server-side.<br />
                Get a key at <strong>console.anthropic.com</strong> → API Keys
              </div>
              <div className="api-key-row" style={{ marginTop: 8 }}>
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  className="api-key-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button className="btn btn-primary" onClick={() => setShowConfig(false)}>Save</button>
              </div>
            </div>
          )}

          <div className="chatbot-messages">
            {messages.length === 0 && (
              <div className="chatbot-welcome">
                <div className="welcome-icon">{insightMode ? '💡' : '⚡'}</div>
                <div className="welcome-title">{insightMode ? 'Insight Mode' : 'Network Intelligence Assistant'}</div>
                <div className="welcome-text">
                  {insightMode
                    ? selectedSubstation
                      ? `Ask data-driven questions about ${selectedSubstation.name} — headroom, fault trends, LCT impact, reinforcement, and safe working.`
                      : 'Select a substation on the map, then ask about capacity, faults, or LCT projections.'
                    : 'Ask questions about working safely with electrical assets. I can analyse equipment images and reference UK safety standards.'}
                </div>
                <div className="suggested-questions">
                  {suggestedQuestions.map((q, i) => (
                    <button key={i} className="suggested-q" onClick={() => setInput(q)}>{q}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => <Message key={i} msg={msg} />)}

            {loading && (
              <div className="chat-message chat-message--assistant">
                <div className="chat-bubble chat-bubble--assistant">
                  <div className="chat-typing"><span /><span /><span /></div>
                </div>
              </div>
            )}

            {error && (
              <div className="chat-error">
                <strong>Error:</strong> {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="chatbot-input-area">
            {pendingImage && (
              <div className="pending-image">
                <img src={pendingImage.url} alt="pending" className="pending-thumb" />
                <div className="pending-name">{pendingImage.name}</div>
                <button className="remove-pending" onClick={() => setPendingImage(null)}>✕</button>
              </div>
            )}
            <div className="chatbot-input-row">
              <button className="img-upload-btn" onClick={() => fileInputRef.current?.click()} title="Upload image">📷</button>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
              <textarea
                ref={inputRef}
                className="chatbot-input"
                placeholder="Ask about safety standards, equipment, or upload an image..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
              />
              <button
                className={`send-btn ${(input.trim() || pendingImage) && !loading ? 'send-btn--active' : ''}`}
                onClick={sendMessage}
                disabled={loading || (!input.trim() && !pendingImage)}
              >
                {loading ? '...' : '→'}
              </button>
            </div>
            <div className="chatbot-footer-note">
              {insightMode
                ? `💡 Insight Mode · ${selectedSubstation ? selectedSubstation.name : 'No substation selected'} · SSEN SEPD Network Data`
                : 'EaWR 1989 · ENA Safety Rules · BS EN 50110 · GS38'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
