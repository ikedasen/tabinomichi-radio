export type Emotion = "a" | "b" | "c" | "d";

// 各フォルダの最大連番（ゼロ埋め2桁。例：a01..a09、c01..c04）
export const KYARA_MAX: Record<Emotion, number> = {
  a: 4,
  b: 9,
  c: 5,
  d: 4,
};

const pad2 = (n: number) => n.toString().padStart(2, "0");

// 記事IDから安定ハッシュ（同じ記事は同じ差分）
const stableHash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const pickKyaraPath = (id: string, emo: Emotion) => {
  const max = KYARA_MAX[emo] ?? 4;
  const variant = (stableHash(id) % max) + 1; // 1..max
  const file = `${emo}${pad2(variant)}.png`;
  return `/characters/kyara-${emo}/${file}`; // public配下
};
