export const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

export const formatCustomerCep = (value) => {
  const digits = digitsOnly(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
};

export const formatCustomerPhone = (value) => {
  const raw = String(value || "");
  let digits = digitsOnly(value);
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith("21") && (digits.length >= 10 || /^\s*\(21\)/.test(raw))) digits = digits.slice(2);
  if (digits.length === 8) return `(21) ${digits.slice(0, 4)}-${digits.slice(4)}`;
  digits = digits.slice(0, 9);
  if (!digits) return "";
  return `(21) ${digits.slice(0, 5)}${digits.length > 5 ? `-${digits.slice(5)}` : ""}`;
};

export const buildCustomerAddress = (details, number, cep) => {
  const street = [details.logradouro, number].filter(Boolean).join(", ");
  const locality = [details.localidade, details.uf].filter(Boolean).join(" - ");
  return [street, details.bairro, locality, `CEP ${formatCustomerCep(cep)}`].filter(Boolean).join(", ");
};
