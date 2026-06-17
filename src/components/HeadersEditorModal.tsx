import { useState } from "react";

interface Props {
  initialHeadersJson: string;
  onSave: (newJson: string) => void;
  onClose: () => void;
}

interface HeaderRow {
  key: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'json';
}

const POPULAR_HEADERS = [
  { key: "x-delay", value: 5000, type: 'number', desc: "Delayed Message Plugin" },
  { key: "x-deduplication-header", value: "", type: 'string', desc: "Message Deduplication Plugin" },
  { key: "x-match", value: "all", type: 'string', desc: "Headers Exchange matching" },
  { key: "__TypeId__", value: "", type: 'string', desc: "Spring AMQP Type Id" },
  { key: "x-sharding-key", value: "", type: 'string', desc: "Consistent Hash Exchange Routing" },
  { key: "x-exception-message", value: "", type: 'string', desc: "Spring AMQP exception message (DLQ)" },
  { key: "CC", value: "[]", type: 'json', desc: "Sender-selected routing (Carbon Copy)" },
  { key: "BCC", value: "[]", type: 'json', desc: "Sender-selected routing (Blind Carbon Copy)" },
];

export function HeadersEditorModal({ initialHeadersJson, onSave, onClose }: Props) {
  const [rows, setRows] = useState<HeaderRow[]>(() => {
    let parsed: any = {};
    if (initialHeadersJson.trim()) {
      try {
        parsed = JSON.parse(initialHeadersJson);
      } catch (e) {
        // keep empty if parsing fails
      }
    }
    const initialRows: HeaderRow[] = [];
    for (const [k, v] of Object.entries(parsed)) {
      let t: HeaderRow['type'] = 'string';
      let val = v;
      if (typeof v === 'number') t = 'number';
      else if (typeof v === 'boolean') t = 'boolean';
      else if (typeof v === 'object') {
        t = 'json';
        val = JSON.stringify(v);
      } else {
        val = String(v);
      }
      initialRows.push({ key: k, value: val, type: t });
    }
    return initialRows;
  });

  const [error, setError] = useState<string | null>(null);

  function handleAddCustom() {
    setRows([...rows, { key: "", value: "", type: "string" }]);
  }

  function handleAddPopular(h: typeof POPULAR_HEADERS[0]) {
    if (rows.some(r => r.key === h.key)) return; // already exists
    setRows([...rows, { key: h.key, value: h.value, type: h.type as any }]);
  }

  function handleRowChange(index: number, field: keyof HeaderRow, val: any) {
    const next = [...rows];
    next[index] = { ...next[index], [field]: val };
    
    // Auto-adjust default value when type changes
    if (field === 'type') {
      if (val === 'number') next[index].value = 0;
      else if (val === 'boolean') next[index].value = false;
      else if (val === 'string') next[index].value = "";
      else if (val === 'json') next[index].value = "{}";
    }

    setRows(next);
  }

  function handleDeleteRow(index: number) {
    const next = [...rows];
    next.splice(index, 1);
    setRows(next);
  }

  function handleSave() {
    setError(null);
    const result: any = {};
    for (const r of rows) {
      if (!r.key.trim()) continue;
      
      let parsedVal: any = r.value;
      if (r.type === 'number') {
        parsedVal = Number(r.value);
        if (isNaN(parsedVal)) {
          setError(`Invalid number for header "${r.key}"`);
          return;
        }
      } else if (r.type === 'json') {
        try {
          parsedVal = JSON.parse(r.value);
        } catch (e) {
          setError(`Invalid JSON for header "${r.key}"`);
          return;
        }
      }
      
      result[r.key.trim()] = parsedVal;
    }
    
    const outJson = Object.keys(result).length > 0 ? JSON.stringify(result, null, 2) : "";
    onSave(outJson);
  }

  return (
    <div className="mode-picker-overlay" style={{ display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}>
      <div style={{
        background: "var(--bg-primary)",
        border: "1px solid var(--border-color)",
        borderRadius: "12px",
        width: "700px",
        height: "550px",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
      }}>
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "16px", fontWeight: 700 }}>Headers Editor</span>
        </div>

        {/* Content */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* Popular Headers */}
          <div>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>Popular Headers</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {POPULAR_HEADERS.map(h => (
                <button
                  key={h.key}
                  onClick={() => handleAddPopular(h)}
                  disabled={rows.some(r => r.key === h.key)}
                  title={h.desc}
                  style={{
                    background: "var(--bg-sidebar)",
                    border: "1px solid var(--border-color)",
                    color: rows.some(r => r.key === h.key) ? "var(--text-muted)" : "var(--text-primary)",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    fontSize: "11px",
                    cursor: rows.some(r => r.key === h.key) ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  <span style={{ color: "var(--accent-color)" }}>+</span>
                  {h.key}
                </button>
              ))}
            </div>
          </div>

          {/* Current Headers Table */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>Headers</label>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, overflowY: "auto", paddingRight: "4px" }}>
              {rows.length === 0 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "30px", textAlign: "center", color: "var(--text-muted)", background: "var(--bg-sidebar)", borderRadius: "8px", border: "1px dashed var(--border-color)", fontSize: "12px" }}>
                  No headers added yet. Choose a popular header above or add a custom one.
                </div>
              ) : (
                rows.map((row, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <input
                      type="text"
                      placeholder="Header Key"
                      value={row.key}
                      onChange={(e) => handleRowChange(i, "key", e.target.value)}
                      style={{ flex: 1, height: "36px", boxSizing: "border-box", padding: "8px 12px", background: "var(--bg-sidebar)", border: "1px solid var(--border-color)", color: "var(--text-primary)", borderRadius: "6px", fontSize: "13px" }}
                    />
                    
                    <select
                      value={row.type}
                      onChange={(e) => handleRowChange(i, "type", e.target.value)}
                      style={{ width: "110px", height: "36px", boxSizing: "border-box", padding: "8px 12px", background: "var(--bg-sidebar)", border: "1px solid var(--border-color)", color: "var(--text-primary)", borderRadius: "6px", fontSize: "13px" }}
                    >
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="json">JSON</option>
                    </select>

                    <div style={{ flex: 2 }}>
                      {row.type === 'boolean' ? (
                        <select
                          value={row.value ? "true" : "false"}
                          onChange={(e) => handleRowChange(i, "value", e.target.value === "true")}
                          style={{ width: "100%", height: "36px", boxSizing: "border-box", padding: "8px 12px", background: "var(--bg-sidebar)", border: "1px solid var(--border-color)", color: "var(--text-primary)", borderRadius: "6px", fontSize: "13px" }}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : row.type === 'number' ? (
                        <input
                          type="number"
                          placeholder="Value"
                          value={row.value}
                          onChange={(e) => handleRowChange(i, "value", e.target.value)}
                          style={{ width: "100%", height: "36px", boxSizing: "border-box", padding: "8px 12px", background: "var(--bg-sidebar)", border: "1px solid var(--border-color)", color: "var(--text-primary)", borderRadius: "6px", fontSize: "13px" }}
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder={row.type === 'json' ? '{"foo": "bar"}' : "Value"}
                          value={row.value}
                          onChange={(e) => handleRowChange(i, "value", e.target.value)}
                          style={{ width: "100%", height: "36px", boxSizing: "border-box", padding: "8px 12px", background: "var(--bg-sidebar)", border: "1px solid var(--border-color)", color: "var(--text-primary)", borderRadius: "6px", fontSize: "13px", fontFamily: row.type === 'json' ? 'var(--font-mono)' : 'inherit' }}
                        />
                      )}
                    </div>

                    <button
                      onClick={() => handleDeleteRow(i)}
                      style={{ width: "36px", height: "36px", padding: 0, flexShrink: 0, background: "var(--danger-bg)", color: "var(--danger-color)", border: "1px solid rgba(244, 63, 94, 0.2)", borderRadius: "6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                      title="Remove Header"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                ))
              )}
            </div>
            
            <button
              onClick={handleAddCustom}
              style={{ marginTop: "12px", background: "none", border: "1px dashed var(--border-color)", color: "var(--text-secondary)", padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", width: "100%", transition: "all 0.2s" }}
            >
              + Add Custom Header
            </button>
          </div>

          {error && (
            <div style={{ color: "var(--danger-color)", fontSize: "12px", padding: "8px", background: "var(--danger-bg)", borderRadius: "6px", border: "1px solid rgba(244, 63, 94, 0.2)" }}>
              {error}
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "flex-end", gap: "12px", background: "var(--bg-sidebar)", borderBottomLeftRadius: "12px", borderBottomRightRadius: "12px" }}>
          <button className="btn-secondary" style={{ padding: "8px 16px" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ padding: "8px 16px" }} onClick={handleSave}>Save Headers</button>
        </div>
      </div>
    </div>
  );
}
