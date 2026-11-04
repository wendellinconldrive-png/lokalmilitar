import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { focusNextField } from "@/lib/keyboardNavigation";

export default function ProductSearchSelect({
  products,
  value,
  onChange,
  placeholder = "Buscar produto por nome ou SKU...",
  className = "",
  inputClassName = "input",
  testid,
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedProduct = products.find((product) => product.id === value);
  const options = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return products.filter((product) => (
      !search || `${product.name || ""} ${product.sku || ""}`.toLocaleLowerCase().includes(search)
    )).slice(0, 100);
  }, [products, query]);
  const selectOption = (product, advance = false, input) => {
    onChange(product.id);
    setQuery("");
    setFocused(false);
    if (advance) window.setTimeout(() => focusNextField(input), 0);
  };
  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Enter" && focused && options[activeIndex]) {
      event.preventDefault();
      selectOption(options[activeIndex], true, event.currentTarget);
    } else if (event.key === "Escape" && focused) {
      event.preventDefault();
      setFocused(false);
    }
  };
  const optionId = (product) => `${testid || "product-search"}-option-${product.id}`;

  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
      <input
        className={`${inputClassName} lm-search-input w-full`}
        value={focused ? query : selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : ""}
        placeholder={placeholder}
        onFocus={(event) => {
          const currentValue = selectedProduct ? selectedProduct.name : "";
          setQuery(currentValue);
          setActiveIndex(0);
          setFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={focused}
        aria-controls={testid ? `${testid}-options` : undefined}
        aria-activedescendant={focused && options[activeIndex] ? optionId(options[activeIndex]) : undefined}
        data-testid={testid}
      />
      {focused && (
        <div
          id={testid ? `${testid}-options` : undefined}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded border border-neutral-300 bg-white shadow-lg"
        >
          {options.map((product, index) => (
            <button
              key={product.id}
              id={optionId(product)}
              type="button"
              role="option"
              aria-selected={product.id === value}
              className={`block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-[#F4EFE3] ${activeIndex === index ? "bg-[#F4EFE3]" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(product)}
            >
              <span className="font-medium">{product.name}</span>
              <span className="ml-2 text-xs text-neutral-500">{product.sku}</span>
            </button>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-neutral-500">Nenhum produto encontrado pelo nome ou SKU.</div>
          )}
        </div>
      )}
    </div>
  );
}
