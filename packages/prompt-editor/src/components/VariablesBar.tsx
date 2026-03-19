import { useState } from "react";
import type { Variable } from "@promptfarm/editor-core";
import { cn } from "../cn";

export interface VariablesBarProps {
  variables: Variable[];
  onChange: (variables: Variable[]) => void;
  onInsert?: (variableName: string) => void;
  className?: string;
}

export function VariablesBar({ variables, onChange, onInsert, className }: VariablesBarProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  function handleAdd() {
    const name = newName.trim();
    if (!name || variables.some((v) => v.name === name)) return;
    onChange([...variables, { name, value: newValue }]);
    setNewName("");
    setNewValue("");
    setAdding(false);
  }

  function handleRemove(name: string) {
    onChange(variables.filter((v) => v.name !== name));
  }

  return (
    <div className={cn("flex items-center gap-2 px-5 py-2.5", className)}>
      <span className="text-xs font-medium text-gray-400">Variables</span>

      <div className="flex flex-wrap items-center gap-1.5">
        {variables.map((v) => (
          <button
            key={v.name}
            type="button"
            onClick={() => onInsert?.(v.name)}
            className="group flex items-center gap-1 rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-200"
            title={v.value ? `${v.name} = ${v.value}` : v.name}
          >
            {v.name}
            <span
              onClick={(e) => { e.stopPropagation(); handleRemove(v.name); }}
              className="hidden cursor-pointer text-purple-400 hover:text-red-500 group-hover:inline"
            >
              &times;
            </span>
          </button>
        ))}

        {adding ? (
          <form
            onSubmit={(e) => { e.preventDefault(); handleAdd(); }}
            className="flex items-center gap-1.5"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="name"
              autoFocus
              className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="default"
              className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
            <button type="submit" className="text-xs text-gray-500 hover:text-gray-900">ok</button>
            <button type="button" onClick={() => { setAdding(false); setNewName(""); setNewValue(""); }} className="text-xs text-gray-500 hover:text-gray-900">&times;</button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-600"
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
}
