/**
 * サイドバーに表示するプロジェクトの絞り込み。
 * お気に入り登録があればそれだけを、未登録なら全件を表示する(初回のフォールバック)。
 * アクティブプロジェクトはお気に入り外でも表示し続ける(音声での切替先が消えないように)。
 */
export function visibleProjects<T extends { name: string }>(
  projects: T[],
  favorites: string[],
  activeProject: string | null,
): T[] {
  if (favorites.length === 0) return projects;
  const wanted = new Set(favorites);
  return projects.filter((p) => wanted.has(p.name) || p.name === activeProject);
}
