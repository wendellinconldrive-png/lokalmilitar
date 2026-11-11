export function getMountableSizes(product, productsById) {
  const componentCounts = (product.linked_ids || []).reduce((counts, componentId) => ({
    ...counts,
    [componentId]: (counts[componentId] || 0) + 1,
  }), {});
  const componentIds = Object.keys(componentCounts);

  if (!componentIds.length || componentIds.some((id) => !productsById[id])) return [];

  return (product.sizes || []).map(({ size }) => {
    const quantity = Math.min(...componentIds.map((id) => {
      const componentSize = (productsById[id].sizes || []).find((item) => item.size === size);
      return Math.floor(Number(componentSize?.stock || 0) / componentCounts[id]);
    }));
    return { size, quantity };
  }).filter(({ quantity }) => quantity > 0);
}

export function getMountableQuantity(product, size, productsById) {
  return getMountableSizes(product, productsById).find((item) => item.size === size)?.quantity || 0;
}
