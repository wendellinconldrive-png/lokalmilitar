export const isValidExpenseMonth = (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

export const filterMonthlyExpenses = (expenses, month, vehicleId) => expenses
  .filter(() => isValidExpenseMonth(month))
  .filter((expense) => String(expense.date || "").slice(0, 7) === month)
  .filter((expense) => !vehicleId
    || expense.vehicle_id === vehicleId
    || (expense.type === "INSUMO" && !expense.vehicle_id));

export const summarizeExpenses = (expenses) => expenses.reduce((summary, expense) => {
  const amount = Number(expense.amount || 0);
  const fuel = Number(expense.fuel_cost || 0);
  const toll = Number(expense.toll_cost || 0);
  const dailyAllowance = Number(expense.daily_allowance || 0);

  if (expense.type === "INSUMO") summary.supplies += amount;
  if (expense.type === "MANUTENCAO") summary.maintenance += amount;
  if (expense.type === "VIAGEM") {
    summary.fuel += fuel;
    summary.tolls += toll;
    summary.deliveryOther += amount + dailyAllowance;
  }
  summary.total += amount + fuel + toll + dailyAllowance;
  return summary;
}, {
  supplies: 0,
  maintenance: 0,
  fuel: 0,
  tolls: 0,
  deliveryOther: 0,
  total: 0,
});
