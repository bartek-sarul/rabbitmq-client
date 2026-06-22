import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Message } from "../types";
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('xml', xml);

interface Props {
  message: Message;
  onClose: () => void;
}

interface FullMessage {
  id: string;
  timestamp: string;
  headers: string;
  properties: {
    content_type: string | null;
    delivery_mode: number | null;
    correlation_id: string | null;
    message_id: string | null;
  };
  body: string;
}

export function MessageDetailPanel({ message, onClose }: Props) {
  const [fullMessage, setFullMessage] = useState<FullMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"payload" | "headers" | "properties">("payload");
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Custom 300ms debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Reset index when query changes
  useEffect(() => {
    setCurrentMatchIndex(debouncedSearchQuery.length >= 2 ? 1 : 0);
  }, [debouncedSearchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        if (activeTab === "payload") {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab]);

  // Memoize properties to avoid re-parsing on every keystroke
  const isMessageJson = useMemo(() => {
    if (!fullMessage) return false;
    if (fullMessage.properties.content_type?.includes("json")) return true;
    try {
      JSON.parse(fullMessage.body);
      return true;
    } catch {
      return false;
    }
  }, [fullMessage]);

  const isMessageXml = useMemo(() => {
    if (!fullMessage) return false;
    if (fullMessage.properties.content_type?.includes("xml")) return true;
    const body = fullMessage.body.trim();
    return body.startsWith("<") && body.endsWith(">");
  }, [fullMessage]);

  const bodyText = useMemo(() => {
    if (!fullMessage) return "";
    if (isMessageJson) {
      try {
        const parsed = JSON.parse(fullMessage.body);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return fullMessage.body;
      }
    }
    return fullMessage.body;
  }, [fullMessage, isMessageJson]);

  // Generate ultra-fast raw HTML for search highlights to bypass React VDOM limits
  const { html: highlightedHtml, count: matchCount } = useMemo(() => {
    if (!debouncedSearchQuery || debouncedSearchQuery.length < 2) return { html: null, count: 0 };
    
    // Escape regex special chars
    const safeRegexQuery = debouncedSearchQuery.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
    const regex = new RegExp(`(${safeRegexQuery})`, 'gi');
    
    let count = 0;
    // Inject invisible control characters (\u0001 and \u0002) around matches
    const htmlWithMarkers = bodyText.replace(regex, (match) => {
      count++;
      return `\u0001${count}\u0002${match}\u0003`;
    });
    
    // Safely escape the HTML
    const escaped = escapeHtml(htmlWithMarkers);
    
    // Swap the control characters back into <mark> tags
    const finalHtml = escaped
      .replace(/\u0001(\d+)\u0002/g, '<mark id="search-match-$1" class="search-match">')
      .replace(/\u0003/g, '</mark>');
      
    return { html: finalHtml, count };
  }, [bodyText, debouncedSearchQuery]);

  const handleNextMatch = () => setCurrentMatchIndex(prev => prev < matchCount ? prev + 1 : 1);
  const handlePrevMatch = () => setCurrentMatchIndex(prev => prev > 1 ? prev - 1 : matchCount);

  // Auto-scroll to active match
  useEffect(() => {
    if (matchCount > 0 && currentMatchIndex > 0) {
      const el = document.getElementById(`search-match-${currentMatchIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentMatchIndex, matchCount, highlightedHtml]);

  const getLanguage = () => {
    if (isMessageJson) return "json";
    if (isMessageXml) return "xml";
    return "text";
  };

  useEffect(() => {
    let active = true;
    
    async function load() {
      setLoading(true);
      setError(null);
      setFullMessage(null);
      
      try {
        const dataStr = await invoke<string>("read_message_file", { path: message.filePath });
        if (!active) return;
        const data = JSON.parse(dataStr) as FullMessage;
        setFullMessage(data);
      } catch (err) {
        if (active) setError(String(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    
    load();
    return () => { active = false; };
  }, [message.id, message.filePath]);

  function doCopy(text: string, section: string) {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopiedSection(section);
        setTimeout(() => setCopiedSection(null), 1500);
      })
      .catch(() => {});
  }

  return (
    <div style={{
      width: "100%",
      borderLeft: "1px solid var(--border-color)",
      backgroundColor: "var(--bg-primary)",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      flexShrink: 0
    }}>
      {/* Header */}
      <div style={{ padding: "16px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--bg-sidebar)" }}>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Message Details</h3>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}
          title="Close panel"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div style={{ padding: "24px", display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)" }}>
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "pulse 1s infinite" }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="30 10" />
          </svg>
          Loading message from disk...
        </div>
      )}
      {error && (
        <div style={{ padding: "24px", color: "var(--danger-color)" }}>
          Failed to load message: {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && fullMessage && (
        <>
          <div style={{ padding: "16px", paddingBottom: "0" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>ID: <span style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{fullMessage.id}</span></div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Received: <span style={{ color: "var(--text-primary)" }}>{fullMessage.timestamp.replace("T", " ").slice(0, 19)}</span></div>
            </div>

            <div style={{ display: "flex", gap: "16px", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px" }}>
              <button
                type="button"
                onClick={() => setActiveTab("payload")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", fontSize: "14px", fontWeight: activeTab === "payload" ? 600 : 400, color: activeTab === "payload" ? "var(--primary-color)" : "var(--text-secondary)", borderBottom: activeTab === "payload" ? "2px solid var(--primary-color)" : "2px solid transparent", marginBottom: "-9px" }}
              >
                Payload
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("headers")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", fontSize: "14px", fontWeight: activeTab === "headers" ? 600 : 400, color: activeTab === "headers" ? "var(--primary-color)" : "var(--text-secondary)", borderBottom: activeTab === "headers" ? "2px solid var(--primary-color)" : "2px solid transparent", marginBottom: "-9px" }}
              >
                Headers
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("properties")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", fontSize: "14px", fontWeight: activeTab === "properties" ? 600 : 400, color: activeTab === "properties" ? "var(--primary-color)" : "var(--text-secondary)", borderBottom: activeTab === "properties" ? "2px solid var(--primary-color)" : "2px solid transparent", marginBottom: "-9px" }}
              >
                Properties
              </button>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px", minHeight: 0 }}>
            {activeTab === "payload" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minHeight: 0 }}>
                {matchCount > 0 && currentMatchIndex > 0 && (
                  <style>{`
                    .search-match { background-color: rgba(243, 107, 40, 0.3) !important; color: inherit !important; outline: 1px solid rgba(243, 107, 40, 0.5); border-radius: 2px; }
                    #search-match-${currentMatchIndex} { background-color: var(--accent-color) !important; color: #fff !important; outline: 2px solid var(--accent-color); z-index: 1; position: relative; }
                  `}</style>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>{isMessageJson ? "JSON Payload" : "Raw Payload"}</span>
                    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: "6px" }}>
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input 
                          ref={searchInputRef}
                          type="text" 
                          placeholder="Search (Cmd+F)" 
                          className="input" 
                          value={searchQuery} 
                          onChange={(e) => setSearchQuery(e.target.value)} 
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleNextMatch();
                            } else if (e.key === 'Escape') {
                              if (searchQuery) {
                                e.stopPropagation();
                                setSearchQuery('');
                              }
                            }
                          }}
                          style={{ fontSize: "12px", padding: "4px 8px 4px 22px", width: "160px" }} 
                        />
                      </div>
                      {matchCount > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "2px 6px" }}>
                          <span style={{ minWidth: "32px", textAlign: "center" }}>{currentMatchIndex} / {matchCount}</span>
                          <div style={{ display: "flex", gap: "2px", borderLeft: "1px solid var(--border-color)", paddingLeft: "6px" }}>
                            <button onClick={handlePrevMatch} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "inherit", display: "flex" }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                            </button>
                            <button onClick={handleNextMatch} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "inherit", display: "flex" }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className={`btn-secondary ${copiedSection === "body" ? "copied" : ""}`}
                      style={{ padding: "4px 8px", fontSize: "12px", height: "auto" }}
                      onClick={() => doCopy(fullMessage.body, "body")}
                    >
                      {copiedSection === "body" ? "Copied ✓" : "Copy Raw"}
                    </button>
                    {isMessageJson && (
                      <button
                        className={`btn-secondary ${copiedSection === "body_json" ? "copied" : ""}`}
                        style={{ padding: "4px 8px", fontSize: "12px", height: "auto" }}
                        onClick={() => doCopy(bodyText, "body_json")}
                      >
                        {copiedSection === "body_json" ? "Copied ✓" : "Copy JSON"}
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ position: "relative", flexGrow: 1, minHeight: "200px" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
                    {bodyText.length > 50000 || highlightedHtml ? (
                      <pre 
                        style={{ margin: 0, height: "100%", borderRadius: "6px", padding: "12px", fontSize: "12px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--text-primary)" }}
                        dangerouslySetInnerHTML={highlightedHtml ? { __html: highlightedHtml } : undefined}
                      >
                        {!highlightedHtml ? bodyText : undefined}
                      </pre>
                    ) : (
                      <SyntaxHighlighter 
                        language={getLanguage()} 
                        style={atomOneDark} 
                        customStyle={{ margin: 0, minHeight: "100%", height: "100%", borderRadius: "6px", fontSize: "12px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", overflow: "auto" }}
                        wrapLines={true}
                        wrapLongLines={true}
                      >
                        {bodyText}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "headers" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    className={`btn-secondary ${copiedSection === "headers" ? "copied" : ""}`}
                    style={{ padding: "4px 8px", fontSize: "12px", height: "auto" }}
                    onClick={() => doCopy(fullMessage.headers || "", "headers")}
                  >
                    {copiedSection === "headers" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <div style={{ position: "relative", flexGrow: 1, minHeight: "200px" }}>
                  <pre style={{ 
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, 
                    margin: 0, padding: "12px", backgroundColor: "var(--bg-secondary)", 
                    borderRadius: "6px", border: "1px solid var(--border-color)", 
                    overflowY: "auto", fontSize: "12px", whiteSpace: "pre-wrap", color: "var(--text-primary)" 
                  }}>
                    {fullMessage.headers || "(none)"}
                  </pre>
                </div>
              </div>
            )}

            {activeTab === "properties" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    className={`btn-secondary ${copiedSection === "properties" ? "copied" : ""}`}
                    style={{ padding: "4px 8px", fontSize: "12px", height: "auto" }}
                    onClick={() => doCopy(JSON.stringify(fullMessage.properties, null, 2), "properties")}
                  >
                    {copiedSection === "properties" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <div style={{ position: "relative", flexGrow: 1, minHeight: "200px" }}>
                  <pre style={{ 
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, 
                    margin: 0, padding: "12px", backgroundColor: "var(--bg-secondary)", 
                    borderRadius: "6px", border: "1px solid var(--border-color)", 
                    overflowY: "auto", fontSize: "12px", whiteSpace: "pre-wrap", color: "var(--text-primary)" 
                  }}>
                    {JSON.stringify(fullMessage.properties, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
          
          <div style={{ padding: "16px", borderTop: "1px solid var(--border-color)", backgroundColor: "var(--bg-sidebar)", flexShrink: 0 }}>
             <button
                className={`btn-secondary ${copiedSection === "full" ? "copied" : ""}`}
                onClick={() => doCopy(JSON.stringify(fullMessage, null, 2), "full")}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
              >
                {copiedSection === "full" ? (
                  <>Copied ✓</>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy Full Message (JSON)
                  </>
                )}
              </button>
          </div>
        </>
      )}
    </div>
  );
}
