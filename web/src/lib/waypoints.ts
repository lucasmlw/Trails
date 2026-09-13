import type { WaypointCategory } from "@trails/shared";

export interface CategoryStyle {
  label: string;
  color: string;
  glyph: string;
}

/**
 * Category presentation. Adding a category = add it to WAYPOINT_CATEGORIES in
 * shared/ and give it a style here.
 */
export const CATEGORY_STYLES: Record<WaypointCategory, CategoryStyle> = {
  start: { label: "Start", color: "#2ecc71", glyph: "▶" },
  finish: { label: "Finish", color: "#e74c3c", glyph: "⚑" },
  parking: { label: "Parking", color: "#3c8cff", glyph: "P" },
  camp: { label: "Camp", color: "#8e5a2b", glyph: "⛺" },
  water: { label: "Water", color: "#1fa2c9", glyph: "💧" },
  food: { label: "Food", color: "#f39c12", glyph: "🍴" },
  shelter: { label: "Shelter", color: "#7f8c8d", glyph: "⌂" },
  viewpoint: { label: "Viewpoint", color: "#9b59b6", glyph: "◉" },
  warning: { label: "Warning", color: "#e8b04a", glyph: "!" },
  custom: { label: "Custom", color: "#ff7a00", glyph: "●" },
};

export function categoryStyle(cat: string): CategoryStyle {
  return CATEGORY_STYLES[cat as WaypointCategory] ?? CATEGORY_STYLES.custom;
}
