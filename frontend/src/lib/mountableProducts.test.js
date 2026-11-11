import { getMountableQuantity, getMountableSizes } from "./mountableProducts";

describe("mountable product availability", () => {
  const components = {
    trousers: { sizes: [{ size: "M", stock: 5 }, { size: "G", stock: 1 }] },
    jacket: { sizes: [{ size: "M", stock: 2 }, { size: "G", stock: 4 }] },
  };

  it("uses the available stock of all components and counts repeated components", () => {
    const uniform = {
      linked_ids: ["trousers", "trousers", "jacket"],
      sizes: [{ size: "M" }, { size: "G" }],
    };

    expect(getMountableSizes(uniform, components)).toEqual([{ size: "M", quantity: 2 }]);
    expect(getMountableQuantity(uniform, "M", components)).toBe(2);
    expect(getMountableQuantity(uniform, "G", components)).toBe(0);
  });

  it("does not offer products with missing links or no linked components", () => {
    expect(getMountableSizes({ linked_ids: ["missing"], sizes: [{ size: "M" }] }, components)).toEqual([]);
    expect(getMountableSizes({ linked_ids: [], sizes: [{ size: "M" }] }, components)).toEqual([]);
  });
});
