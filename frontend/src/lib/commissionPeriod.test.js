import { inPeriod, periodLabel } from "./commissionPeriod";

describe("commission month filtering", () => {
  test("filters commission data to the selected month, including previous months", () => {
    expect(inPeriod("2024-02-15T12:00:00Z", "mes", "2024-02")).toBe(true);
    expect(inPeriod("2024-01-31T12:00:00Z", "mes", "2024-02")).toBe(false);
    expect(inPeriod("2024-03-01T12:00:00Z", "mes", "2024-02")).toBe(false);
  });

  test("labels the selected month in the report", () => {
    expect(periodLabel("mes", "2024-02")).toContain("2024");
    expect(periodLabel("mes", "")).toBe("Mês");
  });
});
