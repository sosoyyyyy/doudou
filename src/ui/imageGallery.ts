export type GalleryLayout = "empty" | "single" | "double" | "hero" | "quad" | "nine";

export interface GalleryPresentation {
  layout: GalleryLayout;
  visiblePaths: string[];
  overflowCount: number;
}

export function galleryLayoutForCount(count: number): GalleryLayout {
  if (count <= 0) return "empty";
  if (count === 1) return "single";
  if (count === 2) return "double";
  if (count === 3) return "hero";
  if (count === 4) return "quad";
  return "nine";
}

export function galleryPresentation(paths: readonly string[]): GalleryPresentation {
  return {
    layout: galleryLayoutForCount(paths.length),
    visiblePaths: paths.slice(0, 9),
    overflowCount: Math.max(0, paths.length - 9)
  };
}
