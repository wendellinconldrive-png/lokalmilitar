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
