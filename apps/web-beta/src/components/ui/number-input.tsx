import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { Input } from "./input";

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max" | "step"> {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Allow a fraction (accepts "0,5" as well as "0.5"). */
  decimal?: boolean;
}

const clamp = (value: number, min?: number, max?: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));

/**
 * Numeric text field without browser spinners: numeric keyboard on phones (`inputMode`), free typing while focused
 * (so "0," or an empty field are allowed mid-edit) and clamping to min/max when the field is left.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(({ value, onValueChange, min, max, decimal = false, onBlur, ...props }, ref) => {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current.replace(",", ".")) === value ? current : String(value)));
  }, [value]);
  return (
    <Input
      ref={ref}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      value={text}
      onChange={(event) => {
        const next = event.target.value.replace(decimal ? /[^\d.,]/g : /\D/g, "");
        setText(next);
        const parsed = Number(next.replace(",", "."));
        if (next !== "" && Number.isFinite(parsed)) onValueChange(clamp(parsed, min, max));
      }}
      onBlur={(event) => {
        const parsed = Number(text.replace(",", "."));
        const committed = text === "" || !Number.isFinite(parsed) ? clamp(min ?? 0, min, max) : clamp(parsed, min, max);
        setText(String(committed));
        if (committed !== value) onValueChange(committed);
        onBlur?.(event);
      }}
      {...props}
    />
  );
});
NumberInput.displayName = "NumberInput";
