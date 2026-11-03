import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";

export default function CustomerSearchSelect({
  customers,
  value,
  onChange,
  className = "",
  testid,
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selectedCustomer = customers.find((customer) => customer.id === value);
  const options = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return customers.filter((customer) => (
      !search || [
        customer.name,
        customer.nome_guerra,
        customer.cpf,
        customer.phone,
      ].some((field) => String(field || "").toLocaleLowerCase().includes(search))
    )).slice(0, 100);
  }, [customers, query]);

  const selectCustomer = (customer) => {
    onChange(customer.id);
    setQuery("");
    setFocused(false);
  };

  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
      <input
        className="input lm-search-input w-full"
        value={focused ? query : selectedCustomer?.name || ""}
        placeholder="Buscar cliente por nome, nome de guerra, CPF ou telefone..."
        onFocus={() => { setQuery(""); setFocused(true); }}
        onBlur={() => setFocused(false)}
        onChange={(event) => setQuery(event.target.value)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={focused}
        aria-controls={testid ? `${testid}-options` : undefined}
        data-testid={testid}
      />
      {focused && (
        <div
          id={testid ? `${testid}-options` : undefined}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded border border-neutral-300 bg-white shadow-lg"
        >
          {options.map((customer) => (
            <button
              key={customer.id}
              type="button"
              role="option"
              aria-selected={customer.id === value}
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-[#F4EFE3]"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectCustomer(customer)}
            >
              <span className="font-medium">{customer.name}</span>
              {(customer.nome_guerra || customer.cpf || customer.phone) && (
                <span className="ml-2 text-xs text-neutral-500">
                  {[customer.nome_guerra, customer.cpf, customer.phone].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-neutral-500">Nenhum cliente encontrado.</div>
          )}
        </div>
      )}
    </div>
  );
}
