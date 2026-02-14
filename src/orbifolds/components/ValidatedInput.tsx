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
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  const [inputValue, setInputValue] = useState(String(value));
  const [isValid, setIsValid] = useState(true);
  const [lastExternalValue, setLastExternalValue] = useState(value);

  // Update input when external value changes (not from our own onChange)
  // This pattern is recommended by React docs for derived state
  if (lastExternalValue !== value) {
    setLastExternalValue(value);
    setInputValue(String(value));
    setIsValid(true);
  }

  const validate = useCallback((val: string): boolean => {
    const num = parseInt(val, 10);
    return !isNaN(num) && num >= min && num <= max;
  }, [min, max]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    const valid = validate(newValue);
    setIsValid(valid);
    
    if (valid) {
      onChange(parseInt(newValue, 10));
    }
  };

  const handleBlur = () => {
    if (!isValid) {
      // Reset to last valid value
      setInputValue(String(value));
      setIsValid(true);
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
          ({min}-{max})
        </span>
      )}
    </div>
  );
}
