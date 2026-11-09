"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

// Toggle order: system → light → dark → brutal → grass → glass → dawn → candy → jelly
// (the store's toggleTheme).
// "system" tracks the OS day/night so Windows personalization / macOS
// appearance / the fnOS browser drive the theme with no manual switching;
// "brutal" is the neo-brutalist skin, "grass" the meadow-green one,
// "glass" the frosted-indigo one, "dawn" its warm amber-rose sibling and
// "candy" the pastel sweet-shop skin (cream paper, orchid pink, big radii) and
// "jelly" the iOS jelly-glass skin (indigo ink, fluid multi-hue light, thick
// translucent cards with top highlight + arc shading — NOT the flat matte of glass).
const MODE_META = {
  system: { icon: "routine", label: "Theme: system", next: "light" },
  light: { icon: "light_mode", label: "Theme: light", next: "dark" },
  dark: { icon: "dark_mode", label: "Theme: dark", next: "brutal" },
  brutal: { icon: "palette", label: "Theme: brutal", next: "grass" },
  grass: { icon: "grass", label: "Theme: grass", next: "glass" },
  glass: { icon: "blur_on", label: "Theme: glass", next: "dawn" },
  dawn: { icon: "wb_twilight", label: "Theme: dawn", next: "candy" },
  candy: { icon: "cake", label: "Theme: candy", next: "jelly" },
  jelly: { icon: "bubble_chart", label: "Theme: jelly", next: "system" },
};

export default function ThemeToggle({ className, variant = "default" }) {
  const { theme, toggleTheme } = useTheme();
  const mode = MODE_META[theme] || MODE_META.system;

  const variants = {
    default: cn(
      "flex items-center justify-center size-10 rounded-full",
      "text-text-muted hover:text-text-main",
      "hover:bg-surface-2 transition-colors"
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded-full",
      "bg-surface/60 hover:bg-surface",
      "border border-border",
      "backdrop-blur-md shadow-sm hover:shadow-[var(--shadow-warm)]",
      "text-text-muted hover:text-brand-500",
      "transition-all group"
    ),
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={mode.label}
      title={mode.label}
      data-theme-mode={theme}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[22px]",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12"
        )}
      >
        {mode.icon}
      </span>
    </button>
  );
}
