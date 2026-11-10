export const isValidExpenseMonth = (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

export const filterMonthlyExpenses = (expenses, month, vehicleId) => expenses
  .filter(() => isValidExpenseMonth(month))
  .filter((expense) => String(expense.date || "").slice(0, 7) === month)
  .filter((expense) => !vehicleId
    || expense.vehicle_id === vehicleId
    || (expense.type === "INSUMO" && !expense.vehicle_id));

export const buildMonthlyExpenseDetails = (expenses, vehicles = []) => expenses.flatMap((expense) => {
  const vehicle = vehicles.find((item) => item.id === expense.vehicle_id);
  const vehicleName = vehicle
    ? [vehicle.name, vehicle.model, vehicle.plate].filter(Boolean).join(" · ")
    : [expense.vehicle_name, expense.vehicle_model, expense.plate].filter(Boolean).join(" · ") || "—";
  const base = {
    id: expense.id,
    date: expense.date,
    vehicle: vehicleName,
  };
  const tripDescription = [expense.description || "Viagem/entrega", expense.route].filter(Boolean).join(" — ");

  if (expense.type === "VIAGEM") {
    const details = [];
    const fuelings = Array.isArray(expense.fuelings) ? expense.fuelings : [];
    const tolls = Array.isArray(expense.tolls) ? expense.tolls : [];
    const fuelCost = Number(expense.fuel_cost || 0);
    const tollCost = Number(expense.toll_cost || 0);

    if (fuelings.length) {
      fuelings.forEach((fueling, index) => {
        const fuelType = fueling.fuel_type || expense.fuel_type || "Combustível";
        const unit = fueling.unit || (fuelType === "GNV" ? "m³" : "L");
        const quantity = fueling.quantity == null ? "" : `${fueling.quantity} ${unit}`;
        const unitPrice = fueling.price_per_unit ?? fueling.price_per_liter;
        const detail = [
          quantity,
          unitPrice == null ? "" : `${unit}: R$ ${Number(unitPrice).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        ].filter(Boolean).join(" · ");
        details.push({
          ...base,
          category: "Combustível",
          description: `${tripDescription} — Abastecimento ${index + 1} (${fuelType})`,
          detail: detail || "Quantidade/preço unitário não informado",
          amount: Number(fueling.amount || 0),
        });
      });
    } else if (fuelCost !== 0) {
      const fuelType = expense.fuel_type || "Combustível";
      const unit = expense.fuel_quantity_unit || (fuelType === "GNV" ? "m³" : "L");
      const quantity = expense.fuel_quantity ?? expense.fuel_liters;
      details.push({
        ...base,
        category: "Combustível",
        description: `${tripDescription} — ${fuelType} (sem abastecimentos discriminados)`,
        detail: quantity == null ? "Quantidade não informada" : `${quantity} ${unit}`,
        amount: fuelCost,
      });
    }

    if (tolls.length) {
      tolls.forEach((toll, index) => {
        details.push({
          ...base,
          category: "Pedágio",
          description: `${tripDescription} — ${toll.description || `Pedágio ${index + 1}`}`,
          detail: `Pedágio ${index + 1}`,
          amount: Number(toll.amount || 0),
        });
      });
    } else if (tollCost !== 0) {
      details.push({
        ...base,
        category: "Pedágio",
        description: `${tripDescription} — Total de pedágios sem discriminação`,
        detail: "O registro não contém praças individuais",
        amount: tollCost,
      });
    }

    const dailyAllowance = Number(expense.daily_allowance || 0);
    if (dailyAllowance !== 0) {
      details.push({
        ...base,
        category: "Diária",
        description: `${tripDescription} — Diária`,
        detail: "",
        amount: dailyAllowance,
      });
    }

    const otherCosts = Number(expense.amount || 0);
    if (otherCosts !== 0) {
      details.push({
        ...base,
        category: "Outros custos da entrega",
        description: `${tripDescription} — ${expense.other_expense_description || "Outros gastos"}`,
        detail: "",
        amount: otherCosts,
      });
    }

    if (!details.length) {
      details.push({
        ...base,
        category: "Entrega/viagem",
        description: tripDescription,
        detail: "Nenhum custo individual informado",
        amount: 0,
      });
    }
    return details;
  }

  if (expense.type === "INSUMO") {
    const quantity = expense.quantity == null ? "" : `${expense.quantity}${expense.unit ? ` ${expense.unit}` : ""}`;
    const remaining = expense.remaining_quantity == null
      ? ""
      : `Restante: ${expense.remaining_quantity}${expense.unit ? ` ${expense.unit}` : ""}`;
    return [{
      ...base,
      category: "Insumo",
      description: expense.description,
      detail: [quantity && `Comprado: ${quantity}`, remaining].filter(Boolean).join(" · "),
      amount: Number(expense.amount || 0),
    }];
  }

  if (expense.type === "MANUTENCAO") {
    const detail = [
      expense.km == null ? "" : `${expense.km} km`,
      expense.next_review_date ? `Próxima revisão: ${expense.next_review_date}` : "",
    ].filter(Boolean).join(" · ");
    return [{
      ...base,
      category: "Manutenção",
      description: expense.description,
      detail,
      amount: Number(expense.amount || 0),
    }];
  }

  return [{
    ...base,
    category: expense.type || "Despesa",
    description: expense.description,
    detail: "",
    amount: Number(expense.amount || 0),
  }];
});

export const summarizeExpenses = (expenses) => expenses.reduce((summary, expense) => {
  const amount = Number(expense.amount || 0);
  const fuelings = Array.isArray(expense.fuelings) ? expense.fuelings : [];
  const tolls = Array.isArray(expense.tolls) ? expense.tolls : [];
  const fuel = fuelings.length
    ? fuelings.reduce((sum, fueling) => sum + Number(fueling.amount || 0), 0)
    : Number(expense.fuel_cost || 0);
  const toll = tolls.length
    ? tolls.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    : Number(expense.toll_cost || 0);
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
