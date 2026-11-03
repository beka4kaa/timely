import {
  Atom,
  BookOpen,
  Code,
  Dumbbell,
  FlaskConical,
  Globe,
  Landmark,
  Languages,
  Leaf,
  Music,
  Palette,
  Sigma,
  Triangle,
  type LucideIcon,
} from "lucide-react";

import { subjectVisual, type SubjectIconKey, type SubjectTint } from "@/lib/subject-visual";

import styles from "./now.module.css";

const ICONS: Record<SubjectIconKey, LucideIcon> = {
  sigma: Sigma,
  triangle: Triangle,
  atom: Atom,
  flask: FlaskConical,
  leaf: Leaf,
  book: BookOpen,
  languages: Languages,
  landmark: Landmark,
  globe: Globe,
  code: Code,
  music: Music,
  palette: Palette,
  dumbbell: Dumbbell,
};

export const TINT_CLASS: Record<SubjectTint, string> = {
  pink: styles.tPink,
  lilac: styles.tLilac,
  sky: styles.tSky,
  mint: styles.tMint,
};

/** Класс оттенка предмета — для строк, где цветом красится не только плашка. */
export function tintClass(subject: string | null | undefined): string {
  return TINT_CLASS[subjectVisual(subject).tint];
}

/** Плашка предмета: значок или буквы на пастельном фоне. */
export function SubjectTile({
  subject,
  size = "md",
  className = "",
}: {
  subject: string | null | undefined;
  size?: "md" | "sm";
  className?: string;
}) {
  const visual = subjectVisual(subject);
  const Icon = visual.glyph.kind === "icon" ? ICONS[visual.glyph.icon] : null;
  return (
    <span
      className={`${styles.subj} ${size === "sm" ? styles.subjSm : ""} ${
        TINT_CLASS[visual.tint]
      } ${className}`}
      aria-hidden="true"
    >
      {Icon ? (
        <Icon />
      ) : (
        <span className={styles.subjText}>
          {visual.glyph.kind === "letters" ? visual.glyph.text : ""}
        </span>
      )}
    </span>
  );
}
