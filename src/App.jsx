import { useState, useRef, useCallback } from 'react';
import MapView from './components/MapView';
import SubstationSidebar from './components/SubstationSidebar';
import ChatBot from './components/ChatBot';
import SafetyPanel from './components/SafetyPanel';
import FaultsPanel from './components/FaultsPanel';
import DataQualityPage from './components/DataQualityPage';
import LoginScreen from './components/LoginScreen';
import { getToken, clearToken } from './lib/auth';
import './App.css';

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => !!getToken());
  const [selectedSubstation, setSelectedSubstation] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [faultsPanelOpen, setFaultsPanelOpen] = useState(false);
  const [chatInitMessage, setChatInitMessage] = useState('');
  const [chatInitImage, setChatInitImage] = useState(null);
  const [lvCountInEsa, setLvCountInEsa]     = useState(null);
  const [dqOpen, setDqOpen]                 = useState(false);
  const [outageData, setOutageData]         = useState([]);
  const [showFaultsOnMap, setShowFaultsOnMap] = useState(false);
  const [forecastData, setForecastData]     = useState(null);
  const [forecastDay, setForecastDay]       = useState(0);
  const [forecastOverlayActive, setForecastOverlayActive] = useState(false);

  // flyTo bridge: FaultsPanel calls flyTo → MapView pans the map
  const flyToFnRef = useRef(null);
  const handleFlyToReady = useCallback((fn) => { flyToFnRef.current = fn; }, []);
  const handleLocate = useCallback((lat, lng) => { flyToFnRef.current?.(lat, lng); }, []);

  const handleLogout = () => {
    clearToken();
    setAuthenticated(false);
    setSelectedSubstation(null);
    setChatOpen(false);
  };

  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  const handleSelectSubstation = (sub) => {
    setSelectedSubstation(sub);
  };

  const handleAskChatbot = (message, image = null) => {
    setChatInitMessage(message);
    setChatInitImage(image);
    setChatOpen(true);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="header-logo">⚡</div>
          <div className="header-title-group">
            <span className="header-title">UK Substation Mapping Tool</span>
            <span className="header-subtitle">South England Network · Proof of Concept v1</span>
          </div>
        </div>
        <div className="header-right">
          <div className="header-stats">
            <span className="stat-item">
              <span className="stat-dot" style={{ background: '#FF4444' }} />
              <span>400/132kV GSPs</span>
            </span>
            <span className="stat-item">
              <span className="stat-dot" style={{ background: '#FFD700' }} />
              <span>Primary 33/11kV</span>
            </span>
            <span className="stat-item">
              <span className="stat-dot" style={{ background: '#00BCD4' }} />
              <span>LV 11/0.4kV</span>
            </span>
          </div>
          <button
            className={`btn btn-outline header-btn ${faultsPanelOpen ? 'btn-active' : ''}`}
            onClick={() => setFaultsPanelOpen(v => !v)}
          >
            ⚡ Faults
          </button>
          <button
            className={`btn btn-outline header-btn ${dqOpen ? 'btn-active' : ''}`}
            onClick={() => setDqOpen((v) => !v)}
          >
            🔗 Data Quality
          </button>
          <button
            className={`btn btn-outline header-btn ${safetyOpen ? 'btn-active' : ''}`}
            onClick={() => setSafetyOpen((v) => !v)}
          >
            📋 Safety Standards
          </button>
          <button
            className="btn btn-outline header-btn"
            onClick={handleLogout}
            title="Sign out"
            style={{ opacity: 0.6 }}
          >
            ⏏ Sign Out
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="app-body">
        {/* Faults Panel — left-side drawer */}
        <FaultsPanel
          isOpen={faultsPanelOpen}
          onClose={() => setFaultsPanelOpen(false)}
          selectedSubstation={selectedSubstation}
          onOutagesChange={setOutageData}
          onShowOnMapChange={setShowFaultsOnMap}
          showFaultsOnMap={showFaultsOnMap}
          onLocate={handleLocate}
          forecastData={forecastData}
          forecastDay={forecastDay}
          onForecastLoaded={setForecastData}
          onForecastDayChange={setForecastDay}
          onForecastOverlayChange={setForecastOverlayActive}
          forecastOverlayActive={forecastOverlayActive}
        />

        {/* Map */}
        <div className={`map-area ${selectedSubstation ? 'map-area--with-sidebar' : ''}`} style={{ position: 'relative' }}>
          <MapView
            onSelectSubstation={handleSelectSubstation}
            selectedSubstation={selectedSubstation}
            onLvCountChange={setLvCountInEsa}
            forecastData={forecastOverlayActive ? forecastData : null}
            forecastDay={forecastDay}
            outageData={outageData}
            showFaultsOnMap={showFaultsOnMap}
            onFlyToReady={handleFlyToReady}
          />
        </div>

        {/* Substation Sidebar */}
        {selectedSubstation && (
          <SubstationSidebar
            substation={selectedSubstation}
            onClose={() => setSelectedSubstation(null)}
            onAskChatbot={handleAskChatbot}
            lvCountInEsa={lvCountInEsa}
          />
        )}

        {/* Safety Standards Panel */}
        <SafetyPanel isOpen={safetyOpen} onClose={() => setSafetyOpen(false)} />
      </div>

      {/* Data Quality full-page overlay */}
      <DataQualityPage isOpen={dqOpen} onClose={() => setDqOpen(false)} />

      {/* Chatbot */}
      <ChatBot
        isOpen={chatOpen}
        onToggle={() => setChatOpen((v) => !v)}
        initialMessage={chatInitMessage}
        initialImage={chatInitImage}
        onMessageHandled={() => { setChatInitMessage(''); setChatInitImage(null); }}
        selectedSubstation={selectedSubstation}
      />
    </div>
  );
}
