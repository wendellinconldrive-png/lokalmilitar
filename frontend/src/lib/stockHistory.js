const STOCK_APPLIED_ORDER_STATUSES = new Set(["Separado", "Entregue", "Retirado"]);
const STOCK_ORDER_TYPES = new Set(["VENDA", "TROCA", "DEVOLUCAO"]);
const ORDER_DISASSEMBLY_KINDS = new Set([
  "DESMONTAGEM_SAIDA",
  "DESMONTAGEM_ENTRADA",
  "MONTAGEM_SAIDA",
  "MONTAGEM_ENTRADA",
]);

const itemKey = (orderId, productId, size) => JSON.stringify([orderId, productId, size]);
const quantitiesMatch = (first, second) => Math.abs(first - second) < 1e-9;

export const getStockHistoryRows = (movements, orders) => {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const expectedSales = new Map();
  const returnedItems = new Set();

  orders.filter((order) => (
    STOCK_APPLIED_ORDER_STATUSES.has(order.status) && STOCK_ORDER_TYPES.has(order.type || "VENDA")
  )).forEach((order) => {
    (order.items || []).forEach((item) => {
      if (!item.product_id) return;
      const key = itemKey(order.id, item.product_id, item.size);
      const expected = expectedSales.get(key) || {
        order,
        product_id: item.product_id,
        product_name: item.name,
        sku: item.sku,
        size: item.size,
        qty: 0,
      };
      expected.qty += Number(item.qty || 1);
      expectedSales.set(key, expected);
    });
    (order.returned_items || []).forEach((item) => {
      if (item.product_id) returnedItems.add(itemKey(order.id, item.product_id, item.size));
    });
  });

  const rows = new Map();
  movements.forEach((movement) => {
    if (movement.order_id && movement.kind === "SAIDA") {
      const key = itemKey(movement.order_id, movement.product_id, movement.size);
      const existing = rows.get(key);
      if (existing) {
        existing.qty += Number(movement.qty || 0);
        existing.groupedCount += 1;
        existing.reconciliation = existing.expectedQty == null
          ? null
          : quantitiesMatch(existing.qty, existing.expectedQty) ? "matched" : "mismatch";
        return;
      }

      const expected = expectedSales.get(key);
      const order = ordersById.get(movement.order_id);
      const expectedQty = expected?.qty ?? (order ? 0 : null);
      const qty = Number(movement.qty || 0);
      rows.set(key, {
        ...movement,
        qty,
        groupedCount: 1,
        order_number: order?.number,
        expectedQty,
        reconciliation: expectedQty === null ? null : quantitiesMatch(qty, expectedQty) ? "matched" : "mismatch",
      });
      return;
    }

    if (
      movement.order_id
      && movement.kind === "ENTRADA"
      && returnedItems.has(itemKey(movement.order_id, movement.product_id, movement.size))
    ) {
      rows.set(movement.id, { ...movement, kind: "DEVOLVIDO" });
      return;
    }

    const isOrderDisassembly = movement.order_id && ORDER_DISASSEMBLY_KINDS.has(movement.kind);
    const key = isOrderDisassembly
      ? JSON.stringify([movement.order_id, movement.product_id, movement.size, movement.kind, movement.reason])
      : movement.id;
    const existing = rows.get(key);
    if (existing) {
      existing.qty += Number(movement.qty || 0);
      existing.groupedCount += 1;
    } else {
      rows.set(key, { ...movement, qty: Number(movement.qty || 0), groupedCount: 1 });
    }
  });

  expectedSales.forEach((expected, key) => {
    if (rows.has(key)) return;
    rows.set(key, {
      id: `missing:${key}`,
      order_id: expected.order.id,
      order_number: expected.order.number,
      product_id: expected.product_id,
      product_name: expected.product_name,
      sku: expected.sku,
      size: expected.size,
      created_at: expected.order.fulfilled_at || expected.order.created_at,
      kind: "SEM_BAIXA",
      qty: 0,
      expectedQty: expected.qty,
      groupedCount: 0,
      reconciliation: "missing",
      reason: "Pedido separado/concluído sem saída no histórico",
    });
  });

  return [...rows.values()].sort((first, second) => (
    (second.created_at || "").localeCompare(first.created_at || "")
  ));
};
