import { DEFAULT_DASHBOARD_PREFERENCES, getVisibleDashboardGridPositions, mergeDashboardPreferences } from "./dashboardPreferences";

describe("dashboard announcements preferences", () => {
  it("shows announcements by default and preserves the explicit hidden setting", () => {
    expect(DEFAULT_DASHBOARD_PREFERENCES.show_announcements).toBe(true);
    expect(mergeDashboardPreferences({ show_announcements: false }).show_announcements).toBe(false);
    expect(mergeDashboardPreferences({}).show_announcements).toBe(true);
  });
});

describe("getVisibleDashboardGridPositions", () => {
  it("compacts visible cards while preserving their configured order", () => {
    const positions = getVisibleDashboardGridPositions(
      ["first", "hidden", "third", "fourth", "fifth"],
      ["first", "hidden", "third", "fourth", "fifth"],
      {
        first: { row: 1, column: 1 },
        hidden: { row: 1, column: 2 },
        third: { row: 1, column: 3 },
        fourth: { row: 1, column: 4 },
        fifth: { row: 2, column: 1 },
      },
      { hidden: false },
    );

    expect(positions).toEqual({
      first: { row: 1, column: 1 },
      third: { row: 1, column: 2 },
      fourth: { row: 1, column: 3 },
      fifth: { row: 1, column: 4 },
    });
  });
});
