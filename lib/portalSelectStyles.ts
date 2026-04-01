/**
 * Shared portal <select> styling. Requires `primary` in tailwind.config (see theme.extend.colors).
 * Use with `SelectArrowWrap` + `pr-9` for consistent custom chevron.
 */
export const PORTAL_SELECT_CLASS =
  "w-full h-10 px-3 pr-9 border rounded-lg border-gray-300 appearance-none bg-white text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed";

/** Label above portal selects (matches design brief “muted” caption). */
export const PORTAL_SELECT_LABEL_CLASS = "text-sm text-muted-foreground";
