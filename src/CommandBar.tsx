import { useEffect, useRef } from "react";

type Props = {
  value: string;
  hint?: string | null;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export function CommandBar({
  value,
  hint,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="command" role="dialog" aria-label="Coco command bar">
      <p className="command__title">Command</p>
      <form
        className="command__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <input
          ref={inputRef}
          className="command__input"
          type="text"
          value={value}
          placeholder='e.g. "screenshot", "remember", "note this"'
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <div className="command__actions">
          <button type="button" className="command__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="command__btn command__btn--primary">
            Run
          </button>
        </div>
      </form>
      {hint ? <p className="command__hint">{hint}</p> : null}
      <p className="command__meta">Local stubs · no Gemini yet</p>
    </div>
  );
}
