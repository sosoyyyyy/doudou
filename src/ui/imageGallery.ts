export type GalleryMode = "none" | "single" | "double" | "grid";

export interface GalleryPresentation {
  mode: GalleryMode;
  paths: string[];
  overflowCount: number;
}

export function galleryMode(count: number): GalleryMode {
  if (count <= 0) return "none";
  if (count === 1) return "single";
  if (count === 2) return "double";
  return "grid";
}

export function allPageGalleryPresentation(paths: readonly string[]): GalleryPresentation {
  return {
    mode: galleryMode(paths.length),
    paths: paths.slice(0, 9),
    overflowCount: Math.max(0, paths.length - 9)
  };
}

export function recordPageGalleryPresentation(paths: readonly string[]): GalleryPresentation {
  return {
    mode: galleryMode(paths.length),
    paths: [...paths],
    overflowCount: 0
  };
}
