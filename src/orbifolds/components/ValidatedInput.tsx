/**
 * ValidatedInput component for number inputs.
 * Allows invalid values while typing, but cues the user and resets on blur if invalid.
 */
import { useState, useCallback } from "react";

export function ValidatedInput({
  value,
  onChange,
  min,
  max,
  label,
  extraValidate,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
  /** Optional extra validation. Return null if valid, or an error message string if invalid. */
  extraValidate?: (n: number) => string | null;
  disabled?: boolean;
}) {
  const [inputValue, setInputValue] = useState(String(value));
  const [isValid, setIsValid] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastExternalValue, setLastExternalValue] = useState(value);

  // Update input when external value changes (not from our own onChange)
  // This pattern is recommended by React docs for derived state
  if (lastExternalValue !== value) {
    setLastExternalValue(value);
    setInputValue(String(value));
    setIsValid(true);
    setErrorMsg("");
  }

  const validate = useCallback((val: string): { valid: boolean; msg: string } => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < min || num > max) {
      return { valid: false, msg: `(${min}-${max})` };
    }
    if (extraValidate) {
      const extra = extraValidate(num);
      if (extra) return { valid: false, msg: extra };
    }
    return { valid: true, msg: "" };
  }, [min, max, extraValidate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    const { valid, msg } = validate(newValue);
    setIsValid(valid);
    setErrorMsg(msg);
    
    if (valid) {
      onChange(parseInt(newValue, 10));
    }
  };

  const handleBlur = () => {
    if (!isValid) {
      // Reset to last valid value
      setInputValue(String(value));
      setIsValid(true);
      setErrorMsg("");
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <label>{label}:</label>
      <input
        type="text"
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        style={{
          width: "60px",
          padding: "4px 8px",
          border: isValid ? "1px solid #ccc" : "2px solid #e74c3c",
          borderRadius: "4px",
          backgroundColor: isValid ? "white" : "#ffebee",
        }}
      />
      {!isValid && (
        <span style={{ color: "#e74c3c", fontSize: "12px" }}>
          {errorMsg}
        </span>
      )}
    </div>
  );
}
