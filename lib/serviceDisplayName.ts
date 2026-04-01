import { MANAGED_SERVICE_CATEGORIES } from "@/lib/managedServiceCategories";

/** Match portal CategoryBadge / Firestore category slugs */
export function normalizeCategorySlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[&/]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Prefer stored categoryLabel; else map known category value to label; else humanize. */
export function getManagedServiceCategoryLabel(
  category?: string | null,
  categoryLabel?: string | null
): string {
  const direct = categoryLabel?.trim();
  if (direct) return direct;
  const c = category?.trim();
  if (!c) return "";
  const normalized = normalizeCategorySlug(c);
  const opt = MANAGED_SERVICE_CATEGORIES.find((o) => o.value === normalized);
  if (opt) return opt.label;
  return c.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export type ServiceNameFields = {
  name?: string | null;
  category?: string | null;
  categoryLabel?: string | null;
};

/**
 * User-visible service title: explicit name, else category label, else neutral fallback (never blank).
 */
export function getManagedServiceDisplayName(input: ServiceNameFields): string {
  const n = input.name?.trim();
  if (n) return n;
  const cat = getManagedServiceCategoryLabel(input.category, input.categoryLabel);
  if (cat) return cat;
  return "Managed service";
}
