import { getStockHistoryRows } from "./stockHistory";

describe("getStockHistoryRows", () => {
  it("consolidates item movements and compares their total with the separated sale", () => {
    const rows = getStockHistoryRows(
      [
        { id: "movement-1", order_id: "order-1", product_id: "product-1", product_name: "Bota", size: "42", kind: "SAIDA", qty: 4, created_at: "2026-10-29T16:00:00" },
        { id: "movement-2", order_id: "order-1", product_id: "product-1", product_name: "Bota", size: "42", kind: "SAIDA", qty: 2, created_at: "2026-10-29T16:01:00" },
      ],
      [{
        id: "order-1",
        number: 4,
        status: "Entregue",
        items: [
          { product_id: "product-1", name: "Bota", size: "42", qty: 4 },
          { product_id: "product-1", name: "Bota", size: "42", qty: 2 },
        ],
      }],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      qty: 6,
      expectedQty: 6,
      groupedCount: 2,
      reconciliation: "matched",
      order_number: 4,
    });
  });

  it("flags extra and missing stock movements against stock-applied sales", () => {
    const rows = getStockHistoryRows(
      [{
        id: "movement-1",
        order_id: "order-1",
        product_id: "product-1",
        product_name: "Bota",
        size: "42",
        kind: "SAIDA",
        qty: 6,
      }],
      [{
        id: "order-1",
        number: 4,
        status: "Retirado",
        items: [{ product_id: "product-1", name: "Bota", size: "42", qty: 4 }],
      }, {
        id: "order-2",
        number: 5,
        status: "Entregue",
        fulfilled_at: "2026-10-29T16:05:00",
        items: [{ product_id: "product-2", name: "Calça", size: "M", qty: 3 }],
      }],
    );

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ order_id: "order-1", qty: 6, expectedQty: 4, reconciliation: "mismatch" }),
      expect.objectContaining({ order_id: "order-2", kind: "SEM_BAIXA", qty: 0, expectedQty: 3, reconciliation: "missing" }),
    ]));
  });

  it("ignores annotated orders and expects stock movements for separated orders", () => {
    const rows = getStockHistoryRows(
      [],
      [{
        id: "annotated",
        status: "Anotado",
        items: [{ product_id: "product-1", name: "Bota", size: "42", qty: 1 }],
      }, {
        id: "separated",
        status: "Separado",
        items: [{ product_id: "product-2", name: "Calça", size: "M", qty: 2 }],
      }],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      order_id: "separated",
      kind: "SEM_BAIXA",
      expectedQty: 2,
    });
  });

  it("labels returned products from completed orders as returned", () => {
    const rows = getStockHistoryRows(
      [
        {
          id: "return-movement",
          order_id: "order-1",
          product_id: "product-1",
          product_name: "Bota",
          size: "42",
          kind: "ENTRADA",
          qty: 1,
          reason: "Devolução pedido #4",
        },
        {
          id: "manual-entry",
          order_id: null,
          product_id: "product-2",
          product_name: "Camisa",
          size: "M",
          kind: "ENTRADA",
          qty: 3,
        },
      ],
      [{
        id: "order-1",
        number: 4,
        status: "Entregue",
        items: [],
        returned_items: [{ product_id: "product-1", name: "Bota", size: "42", qty: 1 }],
      }],
    );

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "return-movement", kind: "DEVOLVIDO", qty: 1 }),
      expect.objectContaining({ id: "manual-entry", kind: "ENTRADA", qty: 3 }),
    ]));
  });
});
