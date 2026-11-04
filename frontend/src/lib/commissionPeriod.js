export const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export const periodLabel = (period, month) => {
  if (period !== "mes") return { hoje: "Hoje", semana: "Semana", todos: "Todos" }[period];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "Mês";
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

export const inPeriod = (iso, period, month) => {
  if (period === "todos") return true;
  if (period === "mes" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  const date = new Date(iso);
  const now = new Date();
  if (Number.isNaN(date.getTime())) return false;
  if (period === "hoje") return date.toDateString() === now.toDateString();
  if (period === "semana") return now - date <= 7 * 86400000;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === month;
};
