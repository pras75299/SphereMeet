```markdown
# Multiplayer Office Space – Tileset Specification

This document defines the asset requirements and design standards for a **32x32 top-down retro pixel art tileset**.

---

# 1. Technical Specifications

| Parameter | Specification |
|-----------|---------------|
| **Perspective** | Top-Down (Bird's Eye) |
| **Tile Size** | 32x32 Pixels |
| **Art Style** | Retro Pixel Art (High Contrast, Limited Palette) |
| **Color Palette** | 16 Colors (per biome/room type) |

---

# 2. Environment & Structural Tiles

## Outdoor & Transition
- **Grass:** Seamlessly tileable, low-detail texture to prevent visual noise.
- **Road:** Dark grey asphalt with optional yellow/white lane markers.
- **Floor:** Polished office linoleum or carpet textures.

## Walls & Boundaries
- **Wall:** Vertical segments with depth; include variations for corners and T-junctions.
- **Door:** 32x32 (single) or 64x32 (double) frames; include open and closed states.
- **Window:** Glass pane with light blue/white "shine" pixels to indicate transparency.

---

# 3. Furniture & Office Props

## Workstations
- **Office Table:** Wooden or metal textures; designed to connect horizontally.
- **Chair:** 4-directional sprites (facing North, South, East, West).
- **Meeting Table:** Large 64x64 or 96x64 composite asset for conference rooms.

## Lounge & Decor
- **Sofa:** Modular design (Left end, Middle, Right end).
- **Plant:** Potted office greenery (uses "Circle" shape language for friendliness).
- **Coffee Machine:** 1x1 tile prop; include 2-frame "steam" animation.
- **Whiteboard:** 2x1 tile wall-mounted asset with marker scribbles.

---

# 4. Design Principles

### Silhouette & Clarity
- **Readability:** Objects must be distinct from the floor tiles.
- **Object Scaling:** Ensure the coffee machine is smaller than the sofa but larger than a keyboard.
- **Collision:** Define clear boundaries for walls and large furniture.

### Lighting & Shading
- **Global Light:** Consistent top-down lighting (usually coming from the top-left).
- **Shadows:** Use a single dark semi-transparent color for floor shadows to ensure consistency across different floor tiles.

---

# 5. Asset Checklist

- [ ] **Flooring:** Grass, Road, Office Carpet, Tile
- [ ] **Structures:** Wall (set), Door (open/closed), Window
- [ ] **Seating:** Office Chair (4 directions), Sofa (modular)
- [ ] **Tables:** Standard Desk, Meeting Table (large)
- [ ] **Equipment:** Coffee Machine, Whiteboard
- [ ] **Nature:** Potted Plant
```
