import { filterMonthlyExpenses, isValidExpenseMonth, summarizeExpenses } from "./dashboardMonthlyExpenses";

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
});
