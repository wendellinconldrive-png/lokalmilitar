import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { buildCustomerAddress, digitsOnly, formatCustomerCep } from "@/lib/customerFields";
import { toast } from "sonner";

export default function CustomerAddressFields({ editing, setEditing }) {
  const [cepLookup, setCepLookup] = useState(null);
  const [baseAddress, setBaseAddress] = useState(null);
  const [loadingCep, setLoadingCep] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const cepRequest = useRef(0);
  const pendingCep = useRef(null);
  const distanceRequest = useRef(0);
  const cep = digitsOnly(editing.cep);

  const lookupCep = async (value) => {
    const normalizedCep = digitsOnly(value);
    if (normalizedCep.length !== 8) {
      toast.error("Informe um CEP válido com 8 dígitos");
      return;
    }
    if (pendingCep.current === normalizedCep) return;
    const requestId = ++cepRequest.current;
    pendingCep.current = normalizedCep;
    setLoadingCep(true);
    distanceRequest.current += 1;
    setCalculating(false);
    try {
      const { data } = await api.get(`/customers/cep/${normalizedCep}`);
      if (requestId !== cepRequest.current) return;
      setBaseAddress(data);
      setCepLookup(normalizedCep);
      setEditing((current) => ({
        ...current,
        cep: normalizedCep,
        address: buildCustomerAddress(data, current.address_number, normalizedCep),
        distance_km: "",
      }));
    } catch (error) {
      if (requestId === cepRequest.current) {
        setBaseAddress(null);
        setCepLookup(null);
        toast.error(error.response?.data?.detail || "Não foi possível consultar o CEP");
      }
    } finally {
      if (requestId === cepRequest.current) {
        pendingCep.current = null;
        setLoadingCep(false);
      }
    }
  };

  useEffect(() => {
    if (cepLookup !== cep || cep.length !== 8 || !editing.address_number || !editing.address) return undefined;
    const requestId = ++distanceRequest.current;
    const timer = setTimeout(async () => {
      setCalculating(true);
      try {
        const { data } = await api.post("/customers/distance", {
          address: editing.address,
          cep,
        });
        if (requestId !== distanceRequest.current) return;
        setEditing((current) => ({ ...current, distance_km: data.distance_km }));
      } catch (error) {
        if (requestId === distanceRequest.current) {
          setEditing((current) => ({ ...current, distance_km: "" }));
          toast.error(error.response?.data?.detail || "Não foi possível calcular a distância");
        }
      } finally {
        if (requestId === distanceRequest.current) setCalculating(false);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [cepLookup, cep, editing.address_number, editing.address, setEditing]);

  const changeCep = (value) => {
    const normalizedCep = digitsOnly(value).slice(0, 8);
    cepRequest.current += 1;
    pendingCep.current = null;
    setLoadingCep(false);
    setBaseAddress(null);
    setCepLookup(null);
    distanceRequest.current += 1;
    setCalculating(false);
    setEditing((current) => ({ ...current, cep: normalizedCep, address: "", distance_km: "" }));
  };

  const changeNumber = (value) => {
    distanceRequest.current += 1;
    setCalculating(false);
    setEditing((current) => ({
      ...current,
      address_number: value,
      address: baseAddress ? buildCustomerAddress(baseAddress, value, cep) : current.address,
      distance_km: "",
    }));
    if (!baseAddress && cep.length === 8 && pendingCep.current !== cep) lookupCep(cep);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="text-[11px] font-mono text-neutral-500">
          <div>CEP</div>
          <div className="flex gap-2 mt-1">
            <input
              className="crud-input"
              aria-label="CEP"
              inputMode="numeric"
              placeholder="00000-000"
              value={formatCustomerCep(cep)}
              onChange={(event) => changeCep(event.target.value)}
              onBlur={() => cep.length === 8 && cepLookup !== cep && lookupCep(cep)}
              data-testid="field-cep"
            />
            <button type="button" className="lm-btn lm-btn-outline whitespace-nowrap" disabled={loadingCep} onClick={() => lookupCep(cep)}>
              {loadingCep ? "Buscando..." : "Buscar CEP"}
            </button>
          </div>
        </div>
        <div className="text-[11px] font-mono text-neutral-500">
          <div>Número do endereço</div>
          <input
            className="crud-input mt-1"
            aria-label="Número do endereço"
            value={editing.address_number ?? ""}
            onChange={(event) => changeNumber(event.target.value)}
            data-testid="field-address_number"
          />
        </div>
      </div>
      <div className="block text-[11px] font-mono text-neutral-500">
        <div>Endereço preenchido pelo CEP</div>
        <input
          className="crud-input mt-1"
          aria-label="Endereço preenchido pelo CEP"
          value={editing.address ?? ""}
          onChange={(event) => {
            distanceRequest.current += 1;
            setCalculating(false);
            setEditing((current) => ({ ...current, address: event.target.value, distance_km: "" }));
          }}
          data-testid="field-address"
        />
      </div>
      <p className="text-[11px] text-neutral-500">
        Depósito: RUA SALUSTIANO SILVA 550, CEP 21745590. A distância é calculada pela rota de carro após informar o número.
        {calculating ? " Calculando..." : " Rota: OSRM / OpenStreetMap."}
      </p>
    </div>
  );
}
