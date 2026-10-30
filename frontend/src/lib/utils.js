import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function sortBySku(items) {
  return [...items].sort((left, right) => {
    const leftSku = String(left.sku || "").trim();
    const rightSku = String(right.sku || "").trim();
    if (!leftSku) return rightSku ? 1 : 0;
    if (!rightSku) return -1;
    return leftSku.localeCompare(rightSku, "pt-BR", { numeric: true, sensitivity: "base" });
  });
}

export function groupRowsByProduct(rows) {
  const groups = new Map();
  sortBySku(rows).forEach((row) => {
    const productId = row.product_id || row.id;
    const group = groups.get(productId);
    if (group) group.variants.push(row);
    else groups.set(productId, { id: productId, name: row.name || "", sku: row.sku || "", variants: [row] });
  });
  return [...groups.values()];
}

export function stockRowHighlightClass(row) {
  const stock = Number(row.stock || 0);
  if (stock <= 0) return "stock-zero";
  return stock <= Number(row.min || 0) ? "stock-below-min" : "stock-above-min";
}
