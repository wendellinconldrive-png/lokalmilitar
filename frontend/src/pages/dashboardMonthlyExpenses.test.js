import {
  buildMonthlyExpenseDetails,
  filterMonthlyExpenses,
  isValidExpenseMonth,
  summarizeExpenses,
} from "./dashboardMonthlyExpenses";

const expenses = [
  { id: "supply", type: "INSUMO", date: "2026-03-05", amount: 40 },
  { id: "maintenance", type: "MANUTENCAO", date: "2026-03-06", amount: 100, vehicle_id: "ford" },
  {
    id: "trip",
    type: "VIAGEM",
    date: "2026-03-07",
    vehicle_id: "ford",
    amount: 5,
    fuel_cost: 60,
    toll_cost: 20,
    daily_allowance: 15,
  },
  { id: "other-month", type: "INSUMO", date: "2026-02-28", amount: 50 },
  { id: "other-vehicle", type: "MANUTENCAO", date: "2026-03-08", amount: 30, vehicle_id: "van" },
];

describe("monthly dashboard expense reports", () => {
  it("filters by month and includes unassigned supplies for a selected vehicle", () => {
    expect(filterMonthlyExpenses(expenses, "2026-03", "ford").map(({ id }) => id))
      .toEqual(["supply", "maintenance", "trip"]);
  });

  it("includes every vehicle when no vehicle filter is selected", () => {
    expect(filterMonthlyExpenses(expenses, "2026-03", "").map(({ id }) => id))
      .toEqual(["supply", "maintenance", "trip", "other-vehicle"]);
  });

  it("rejects incomplete or out-of-range months", () => {
    expect(isValidExpenseMonth("2026-03")).toBe(true);
    expect(isValidExpenseMonth("2026-13")).toBe(false);
    expect(filterMonthlyExpenses(expenses, "", "")).toEqual([]);
  });

  it("summarizes each expense component without double counting delivery costs", () => {
    const summary = summarizeExpenses(filterMonthlyExpenses(expenses, "2026-03", "ford"));
    expect(summary).toEqual({
      supplies: 40,
      maintenance: 100,
      fuel: 60,
      tolls: 20,
      deliveryOther: 20,
      total: 240,
    });
  });

  it("lists each fuel fill-up and toll separately with its recorded amount", () => {
    const details = buildMonthlyExpenseDetails([{
      id: "trip-details",
      type: "VIAGEM",
      description: "Entrega centro",
      vehicle_id: "ford",
      fuel_cost: 100,
      toll_cost: 18,
      fuelings: [
        { fuel_type: "Gasolina", amount: 70, quantity: 10, unit: "L", price_per_unit: 7 },
        { fuel_type: "Etanol", amount: 30, quantity: 10, unit: "L", price_per_unit: 3 },
      ],
      tolls: [
        { description: "Praça A", amount: 10 },
        { description: "Praça B", amount: 8 },
      ],
      daily_allowance: 20,
      amount: 5,
    }], [{ id: "ford", name: "Ford", plate: "ABC-1234" }]);

    expect(details.map(({ category }) => category)).toEqual([
      "Combustível",
      "Combustível",
      "Pedágio",
      "Pedágio",
      "Diária",
      "Outros custos da entrega",
    ]);
    expect(details.map(({ amount }) => amount)).toEqual([70, 30, 10, 8, 20, 5]);
    expect(details[0].vehicle).toBe("Ford · ABC-1234");
    expect(details[0].detail).toContain("10 L");
    expect(details[2].description).toContain("Praça A");
    expect(details.reduce((sum, item) => sum + item.amount, 0)).toBe(143);
    expect(summarizeExpenses([{
      type: "VIAGEM",
      fuel_cost: 0,
      toll_cost: 0,
      fuelings: [
        { amount: 70 },
        { amount: 30 },
      ],
      tolls: [
        { amount: 10 },
        { amount: 8 },
      ],
      daily_allowance: 20,
      amount: 5,
    }]).total).toBe(143);
  });

  it("keeps supply and maintenance records individually itemized", () => {
    const details = buildMonthlyExpenseDetails([
      { id: "supply", type: "INSUMO", description: "Linha", amount: 40, quantity: 4, unit: "rolos", remaining_quantity: 2 },
      { id: "service", type: "MANUTENCAO", description: "Troca de óleo", amount: 100, km: 2000, next_review_date: "2026-09-10" },
    ]);

    expect(details.map(({ description, amount }) => [description, amount])).toEqual([
      ["Linha", 40],
      ["Troca de óleo", 100],
    ]);
    expect(details[0].detail).toContain("Comprado: 4 rolos");
    expect(details[1].detail).toContain("2000 km");
  });
});
