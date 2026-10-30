import { sortBySku } from "./utils";

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
});
