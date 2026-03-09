# Design System Quick Reference

## Core Philosophy
**Reduction to Essence**
Remove everything until only the essential remains. Every element must justify its existence. Use as little CSS as possible. CSS should be minified. If using tailwind, etc makes the codebase smaller, use that. If critically necessary, define CSS classes and reuse them as much as possible.

**Borders as Structure**
Borders define space, create hierarchy, and provide visual rhythm. They are not decoration—they are the architectural framework. No rounding. Headings/headers do not have borders, and neither do individual lines or items if for example they are on a list of some kind. Anything and only things that are clickable will have a border.

**Borders as Interaction**
Border color change signals interactivity. Reduced contrast borders (#333/#CCC) become pure black/white on hover. Only the border changes—background and text remain constant.

**Grid as Law**
All elements align to a strict grid system. No floating, no arbitrary positioning, no exceptions.

## Colors
```css
/* Light Mode */
--bg: #FFFFFF;
--fg: #000000;
--border: #333333;
--border-hover: #000000;

/* Dark Mode */
--bg: #000000;
--fg: #FFFFFF;
--border: #CCCCCC;
--border-hover: #FFFFFF;
```

**Rules:** Gray only for borders. No color accents. No gradients. Monochrome images.

**Font:** Monospace font. No decorative fonts.

**Spacing:** Use default spacing.


## Borders
```css
border: 1px solid var(--border);
transition: border-color 200ms ease;

:hover {
    border-color: var(--border-hover);
}
```

**All major containers have borders.** 
Only border color changes on hover—never background or text.

## Grid
12-column, max-width 1200px, no gutters (borders create separation)

**Breakpoints:**
- Mobile: <768px (1 column)
- Tablet: 768-1024px (2-3 columns)
- Desktop: >1024px (3-4 columns)


## Interaction
**On Hover if an object does not have any other properties and has border:** Border color changes to pure black/white (200ms ease)
**Focus:** 2px outline, 2px offset
**Links:** Underlined, 60% opacity on hover


