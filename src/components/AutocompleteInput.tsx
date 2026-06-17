import { useState, useRef, useEffect } from "react";

interface Props {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function AutocompleteInput({ value, onChange, options, placeholder, disabled, title, className, style }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options based on input value, or show all if empty
  const filteredOptions = options.filter(o => o.toLowerCase().includes(value.toLowerCase()));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", ...style }} className={className} title={title}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        style={{
          width: "100%",
          padding: "8px 30px 8px 12px",
          fontSize: "13px",
          height: "36px",
          boxSizing: "border-box",
          backgroundColor: disabled ? "var(--bg-secondary)" : undefined,
          opacity: disabled ? 0.6 : 1,
        }}
      />
      {isOpen && filteredOptions.length > 0 && !disabled && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: "4px",
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 100,
          maxHeight: "200px",
          overflowY: "auto",
        }}>
          {filteredOptions.map((opt, i) => (
            <div
              key={i}
              onClick={() => {
                onChange(opt);
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              style={{
                padding: "8px 12px",
                fontSize: "13px",
                cursor: "pointer",
                borderBottom: i < filteredOptions.length - 1 ? "1px solid var(--border-color)" : "none",
                color: "var(--text-primary)"
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-sidebar)"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
      {value && !disabled && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          style={{
            position: "absolute",
            right: "8px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            lineHeight: 1
          }}
          title="Clear"
        >
          ✕
        </button>
      )}
    </div>
  );
}
