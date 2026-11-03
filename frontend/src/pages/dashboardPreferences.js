export const DASHBOARD_KPIS = [
  { id: "orders_today", label: "Pedidos hoje" },
  { id: "pending", label: "Pedidos pendentes" },
  { id: "customers", label: "Clientes" },
  { id: "commission_month", label: "Comissão do mês" },
  { id: "low_stock", label: "Estoque baixo" },
  { id: "insumos", label: "Gastos insumos (mês)" },
  { id: "maintenance", label: "Manutenção veículo" },
];

export const DASHBOARD_COLORS = {
  background: "#F5F0E6",
  card_background: "#FBF9F4",
  card_text: "#222222",
  card_border: "#D9D2C3",
  chart_line: "#4B5320",
  chart_accent: "#B8860B",
  chart_grid: "#E6DFCF",
};

export const DEFAULT_DASHBOARD_PREFERENCES = {
  visibility: {},
  order: [],
  grid_positions: {},
  card_text_customized: false,
  chart_type: "linha",
  chart_days: 7,
  show_announcements: true,
  colors: DASHBOARD_COLORS,
};

export function mergeDashboardPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ...DEFAULT_DASHBOARD_PREFERENCES,
      visibility: {},
      order: [],
      grid_positions: {},
      colors: { ...DASHBOARD_COLORS },
    };
  }
  return {
    ...DEFAULT_DASHBOARD_PREFERENCES,
    ...value,
    visibility: { ...DEFAULT_DASHBOARD_PREFERENCES.visibility, ...value.visibility },
    order: Array.isArray(value.order) ? value.order : [],
    grid_positions: value.grid_positions && typeof value.grid_positions === "object" && !Array.isArray(value.grid_positions)
      ? value.grid_positions
      : {},
    card_text_customized: value.card_text_customized === true,
    chart_type: value.chart_type === "barras" ? "barras" : "linha",
    chart_days: [7, 14, 30].includes(value.chart_days) ? value.chart_days : 7,
    show_announcements: value.show_announcements !== false,
    colors: { ...DASHBOARD_COLORS, ...value.colors },
  };
}

export function getDashboardGridPositions(order, itemIds, configuredPositions = {}) {
  const positions = {};
  const occupied = new Set();
  const orderedItems = order.filter((id) => id !== "chart" && itemIds.includes(id));
  const remainingItems = itemIds.filter((id) => id !== "chart" && !orderedItems.includes(id));

  for (const id of [...orderedItems, ...remainingItems]) {
    const configured = configuredPositions[id];
    const row = Number(configured?.row);
    const column = Number(configured?.column);
    const valid = Number.isSafeInteger(row) && row > 0
      && Number.isSafeInteger(column) && column >= 1 && column <= 4
      && !occupied.has(`${row}:${column}`);
    if (valid) {
      positions[id] = { row, column };
      occupied.add(`${row}:${column}`);
      continue;
    }

    let index = 0;
    while (occupied.has(`${Math.floor(index / 4) + 1}:${(index % 4) + 1}`)) index += 1;
    const fallback = { row: Math.floor(index / 4) + 1, column: (index % 4) + 1 };
    positions[id] = fallback;
    occupied.add(`${fallback.row}:${fallback.column}`);
  }
  return positions;
}

export function getVisibleDashboardGridPositions(order, itemIds, configuredPositions = {}, visibility = {}) {
  const positions = getDashboardGridPositions(order, itemIds, configuredPositions);
  const visibleItems = itemIds
    .filter((id) => visibility[id] !== false)
    .sort((firstId, secondId) => {
      const first = positions[firstId];
      const second = positions[secondId];
      return first.row - second.row || first.column - second.column;
    });

  return Object.fromEntries(visibleItems.map((id, index) => [
    id,
    { row: Math.floor(index / 4) + 1, column: (index % 4) + 1 },
  ]));
}
