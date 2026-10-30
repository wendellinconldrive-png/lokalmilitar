import { groupRowsByProduct, sortBySku } from "./utils";

describe("sortBySku", () => {
  it("sorts naturally by SKU without changing the source array", () => {
    const items = [{ sku: "SKU-10" }, { sku: "SKU-2" }, { sku: "SKU-1" }];

    expect(sortBySku(items).map((item) => item.sku)).toEqual(["SKU-1", "SKU-2", "SKU-10"]);
    expect(items.map((item) => item.sku)).toEqual(["SKU-10", "SKU-2", "SKU-1"]);
  });

  it("places items without a SKU after identified items", () => {
    const items = [{ sku: "" }, { sku: "ABC-1" }];

    expect(sortBySku(items)).toEqual([{ sku: "ABC-1" }, { sku: "" }]);
  });

  it("groups sorted stock variants under their product", () => {
    const rows = [
      { product_id: "b", name: "Calça", sku: "SKU-2", size: "M" },
      { product_id: "a", name: "Farda", sku: "SKU-1", size: "G" },
      { product_id: "a", name: "Farda", sku: "SKU-1", size: "P" },
    ];

    expect(groupRowsByProduct(rows)).toEqual([
      {
        id: "a",
        name: "Farda",
        sku: "SKU-1",
        variants: [
          { product_id: "a", name: "Farda", sku: "SKU-1", size: "G" },
          { product_id: "a", name: "Farda", sku: "SKU-1", size: "P" },
        ],
      },
      {
        id: "b",
        name: "Calça",
        sku: "SKU-2",
        variants: [{ product_id: "b", name: "Calça", sku: "SKU-2", size: "M" }],
      },
    ]);
  });
});
